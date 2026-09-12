import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';
import Database from 'better-sqlite3';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const sourcePath = process.env.DATABASE_PATH || path.join(root, 'data', 'admissions.db');
const replace = process.argv.includes('--replace');
const tables = [
  'schema_migrations',
  'staff_users',
  'applicants',
  'admission_cycles',
  'programmes',
  'programme_offerings',
  'document_requirements',
  'scholarships',
  'applications',
  'application_choices',
  'education_records',
  'documents',
  'interview_sessions',
  'interview_panel_members',
  'decisions',
  'status_transitions',
  'status_history',
  'waitlist_entries',
  'scholarship_applications',
  'review_notes',
];

if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) {
  throw new Error('TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are required');
}

const local = new Database(sourcePath, { readonly: true });
const cloud = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
  intMode: 'number',
});

try {
  const remoteTables = await cloud.execute(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
  `);
  if (remoteTables.rows.length === 0) {
    await cloud.executeMultiple(fs.readFileSync(path.join(root, 'server', 'schema.sql'), 'utf8'));
  } else {
    const remoteApplicants = await cloud.execute('SELECT COUNT(*) AS count FROM applicants');
    if (Number(remoteApplicants.rows[0].count) > 0 && !replace) {
      throw new Error('Cloud database already contains records; use --replace only for an intentional full resync');
    }
  }

  const transaction = await cloud.transaction('write');
  try {
    const completedInterviews = [];
    if (replace) {
      // Append-only audit tables intentionally reject DELETE; a full fixture
      // replacement temporarily removes only those guards inside this transaction.
      await transaction.execute('DROP TRIGGER IF EXISTS status_history_no_delete');
      await transaction.execute('DROP TRIGGER IF EXISTS decisions_no_delete');
      for (const table of [...tables].filter((name) => name !== 'schema_migrations').reverse()) {
        await transaction.execute(`DELETE FROM "${table}"`);
      }
    }

    for (const table of tables) {
      const columns = local.prepare(`PRAGMA table_info("${table}")`).all().map(({ name }) => name);
      const ordering = table === 'interview_panel_members' ? 'ORDER BY interview_session_id, staff_user_id' : table === 'status_transitions' ? 'ORDER BY from_status, to_status' : 'ORDER BY id';
      const sourceRows = local.prepare(`SELECT * FROM "${table}" ${ordering}`).all();
      const rows = sourceRows.map((row) => {
        if (table === 'interview_sessions' && row.status === 'COMPLETED') {
          completedInterviews.push({ id: row.id, score: row.score, feedback: row.feedback });
          return { ...row, status: 'SCHEDULED', score: null, feedback: null };
        }
        return row;
      });
      const command = table === 'schema_migrations' ? 'INSERT OR REPLACE' : 'INSERT';
      const sql = `${command} INTO "${table}" (${columns.map((column) => `"${column}"`).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`;
      for (let index = 0; index < rows.length; index += 100) {
        const statements = rows.slice(index, index + 100).map((row) => ({
          sql,
          args: columns.map((column) => row[column]),
        }));
        if (statements.length) await transaction.batch(statements);
      }
    }
    // Completion requires an existing panel, so finish those sessions only
    // after interview_panel_members has been copied above.
    for (const interview of completedInterviews) {
      await transaction.execute({
        sql: 'UPDATE interview_sessions SET status = ?, score = ?, feedback = ? WHERE id = ?',
        args: ['COMPLETED', interview.score, interview.feedback, interview.id],
      });
    }
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  } finally {
    transaction.close();
  }

  const verification = [];
  for (const table of tables) {
    const localCount = local.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get().count;
    const remoteCount = await cloud.execute(`SELECT COUNT(*) AS count FROM "${table}"`);
    const cloudCount = Number(remoteCount.rows[0].count);
    if (cloudCount !== localCount) {
      throw new Error(`${table} verification failed: local=${localCount}, cloud=${cloudCount}`);
    }
    verification.push(`${table}:${cloudCount}`);
  }
  console.log(`Cloud database synchronized and verified (${verification.join(', ')})`);
} finally {
  local.close();
  cloud.close();
}
