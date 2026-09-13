import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';
import { SCHEMA_VERSION, schemaChecksum } from '../server/migrate.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) throw new Error('TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are required');
const client = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN, intMode: 'number' });
const sql = fs.readFileSync(path.join(root, 'server', 'schema.sql'), 'utf8');

const quoteIdentifier = (value) => `"${String(value).replaceAll('"', '""')}"`;
const existingTables = (await client.execute(`
  SELECT name FROM sqlite_master
  WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
  ORDER BY name
`)).rows.map(({ name }) => String(name));
const applicationColumns = existingTables.includes('applications')
  ? (await client.execute(`PRAGMA table_info(${quoteIdentifier('applications')})`)).rows.map(({ name }) => String(name))
  : [];
const decisionDefinition = existingTables.includes('decisions')
  ? (await client.execute("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'decisions'")).rows[0]?.sql
  : null;
const decisionNeedsUpgrade = Boolean(decisionDefinition && !String(decisionDefinition).includes("'ACCEPT'"));
const legacySchema = applicationColumns.includes('status')
  || applicationColumns.includes('intake_year')
  || !applicationColumns.includes('cycle_id');

if (legacySchema && existingTables.length) {
  // The logical backup is the recovery point. Drop the incompatible v1 graph
  // atomically so the canonical DDL can be applied without mixed columns.
  const objectNames = (await client.execute(`
    SELECT name, type FROM sqlite_master
    WHERE name NOT LIKE 'sqlite_%' AND type IN ('trigger', 'view')
  `)).rows;
  // SQLite checks references while dropping parent tables. No rows are kept
  // from this incompatible graph, so disable that check for the reset only.
  await client.execute('PRAGMA foreign_keys = OFF');
  const transaction = await client.transaction('write');
  try {
    for (const { name, type } of objectNames) {
      await transaction.execute(`DROP ${String(type).toUpperCase()} IF EXISTS ${quoteIdentifier(name)}`);
    }
    for (const name of [...existingTables].reverse()) {
      await transaction.execute(`DROP TABLE IF EXISTS ${quoteIdentifier(name)}`);
    }
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  } finally {
    transaction.close();
    await client.execute('PRAGMA foreign_keys = ON');
  }
}

if (decisionNeedsUpgrade && !legacySchema) {
  const transaction = await client.transaction('write');
  try {
    await transaction.execute('DROP VIEW IF EXISTS v_current_decisions');
    await transaction.execute('DROP TRIGGER IF EXISTS decisions_no_update');
    await transaction.execute('DROP TRIGGER IF EXISTS decisions_no_delete');
    await transaction.execute('ALTER TABLE decisions RENAME TO decisions_legacy');
    await transaction.execute(`
      CREATE TABLE decisions (
        id INTEGER PRIMARY KEY,
        application_choice_id INTEGER NOT NULL REFERENCES application_choices(id) ON DELETE RESTRICT,
        decision TEXT NOT NULL CHECK (decision IN ('OFFER', 'ACCEPT', 'REJECT', 'WAITLIST')),
        rationale TEXT NOT NULL CHECK (length(trim(rationale)) BETWEEN 5 AND 2000),
        decided_by INTEGER NOT NULL REFERENCES staff_users(id) ON DELETE RESTRICT,
        decided_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP CHECK (datetime(decided_at) IS NOT NULL),
        supersedes_decision_id INTEGER REFERENCES decisions(id) ON DELETE RESTRICT,
        CHECK (supersedes_decision_id IS NULL OR supersedes_decision_id <> id)
      ) STRICT;
    `);
    await transaction.execute(`
      INSERT INTO decisions (id, application_choice_id, decision, rationale, decided_by, decided_at, supersedes_decision_id)
      SELECT id, application_choice_id, decision, rationale, decided_by, decided_at, supersedes_decision_id
      FROM decisions_legacy;
    `);
    await transaction.execute('DROP TABLE decisions_legacy');
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  } finally {
    transaction.close();
  }
}

await client.executeMultiple(sql);
await client.execute({
  sql: `INSERT OR REPLACE INTO schema_migrations (id, checksum) VALUES (?, ?)`,
  args: [SCHEMA_VERSION, schemaChecksum],
});
const result = await client.execute("SELECT id, checksum, applied_at FROM schema_migrations WHERE id <> 'seed' ORDER BY applied_at DESC LIMIT 1");
if (!result.rows.length || result.rows[0].checksum !== schemaChecksum) throw new Error('Cloud migration did not record the expected schema checksum');
console.log(`${legacySchema ? 'Legacy cloud schema replaced' : 'Cloud schema applied'}: ${result.rows[0].id}`);
client.close();
