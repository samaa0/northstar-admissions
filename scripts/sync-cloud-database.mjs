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
  'staff_users',
  'applicants',
  'programmes',
  'scholarships',
  'applications',
  'application_choices',
  'education_records',
  'documents',
  'decisions',
  'status_history',
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
    if (replace) {
      for (const table of [...tables].reverse()) {
        await transaction.execute(`DELETE FROM "${table}"`);
      }
    }

    for (const table of tables) {
      const columns = local.prepare(`PRAGMA table_info("${table}")`).all().map(({ name }) => name);
      const rows = local.prepare(`SELECT * FROM "${table}" ORDER BY id`).all();
      const sql = `INSERT INTO "${table}" (${columns.map((column) => `"${column}"`).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`;
      for (let index = 0; index < rows.length; index += 100) {
        const statements = rows.slice(index, index + 100).map((row) => ({
          sql,
          args: columns.map((column) => row[column]),
        }));
        if (statements.length) await transaction.batch(statements);
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
