import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';
import Database from 'better-sqlite3';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const sourcePath = process.env.DATABASE_PATH || path.join(root, 'data', 'admissions.db');
const replace = process.argv.includes('--replace');
const immutableTriggerSql = [
  `CREATE TRIGGER IF NOT EXISTS status_history_no_delete
   BEFORE DELETE ON status_history
   BEGIN
     SELECT RAISE(ABORT, 'Status history is append-only');
   END`,
  `CREATE TRIGGER IF NOT EXISTS decisions_no_update
   BEFORE UPDATE ON decisions
   BEGIN
     SELECT RAISE(ABORT, 'Decision history is append-only');
   END`,
  `CREATE TRIGGER IF NOT EXISTS decisions_no_delete
   BEFORE DELETE ON decisions
   BEGIN
     SELECT RAISE(ABORT, 'Decision history is append-only');
   END`,
];
const orderedReplay = new Set(['application_choices', 'status_history', 'decisions']);
const orderingByTable = {
  application_choices: 'ORDER BY application_id, preference_rank, id',
  decisions: 'ORDER BY id',
  interview_panel_members: 'ORDER BY interview_session_id, staff_user_id',
  status_history: 'ORDER BY application_id, datetime(changed_at), id',
  status_transitions: 'ORDER BY from_status, to_status',
};
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
      await transaction.execute('DROP TRIGGER IF EXISTS decisions_no_update');
      await transaction.execute('DROP TRIGGER IF EXISTS decisions_no_delete');
      // Preserve the copied decision chain, but remove self-references from the
      // obsolete rows before deleting them under ON DELETE RESTRICT.
      await transaction.execute('UPDATE decisions SET supersedes_decision_id = NULL');
      for (const table of [...tables].reverse()) {
        if (table === 'application_choices') {
          // Keep the contiguous-rank guard active by removing lower-priority
          // choices before their predecessors, after all dependent rows are gone.
          for (const rank of [3, 2, 1]) {
            await transaction.execute({
              sql: 'DELETE FROM application_choices WHERE preference_rank = ?',
              args: [rank],
            });
          }
          continue;
        }
        await transaction.execute(`DELETE FROM "${table}"`);
      }
    }

    for (const table of tables) {
      const columns = local.prepare(`PRAGMA table_info("${table}")`).all().map(({ name }) => name);
      const ordering = orderingByTable[table] ?? 'ORDER BY id';
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
      if (orderedReplay.has(table)) {
        for (const row of rows) {
          await transaction.execute({ sql, args: columns.map((column) => row[column]) });
        }
        continue;
      }
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
    for (const triggerSql of immutableTriggerSql) {
      await transaction.execute(triggerSql);
    }
    for (const table of tables) {
      const expected = local.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get().count;
      const actual = Number((await transaction.execute(`SELECT COUNT(*) AS count FROM "${table}"`)).rows[0].count);
      if (actual !== expected) {
        throw new Error(`${table} pre-commit verification failed: local=${expected}, cloud=${actual}`);
      }
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
