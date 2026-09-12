import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SCHEMA_VERSION = '002_hkust_database_integrity';
export const SEED_VERSION = '2026-09-12-v2';
export const schemaSql = fs.readFileSync(path.join(here, 'schema.sql'), 'utf8');
export const schemaChecksum = crypto.createHash('sha256').update(schemaSql).digest('hex');

function tableExists(db, tableName) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName));
}

export function isLegacyDatabase(db) {
  if (!tableExists(db, 'applications')) return false;
  const applicationColumns = db.prepare("PRAGMA table_info('applications')").all().map(({ name }) => name);
  return applicationColumns.includes('status') || applicationColumns.includes('intake_year');
}

export function applyMigrations(db) {
  if (isLegacyDatabase(db)) {
    const error = new Error('Legacy v1 database detected. Create a verified backup, then run npm run db:reset.');
    error.code = 'LEGACY_SCHEMA_REQUIRES_RESET';
    throw error;
  }

  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(schemaSql);
    const existing = db.prepare('SELECT checksum FROM schema_migrations WHERE id = ?').get(SCHEMA_VERSION);
    if (existing && existing.checksum !== schemaChecksum) {
      throw new Error(`Migration checksum mismatch for ${SCHEMA_VERSION}`);
    }
    db.prepare(`
      INSERT OR IGNORE INTO schema_migrations (id, checksum)
      VALUES (?, ?)
    `).run(SCHEMA_VERSION, schemaChecksum);
    db.exec('COMMIT');
  } catch (error) {
    if (db.inTransaction) db.exec('ROLLBACK');
    throw error;
  }
}

export async function getSchemaVersion(db) {
  try {
    return (await db.prepare(`
      SELECT id FROM schema_migrations WHERE id <> 'seed'
      ORDER BY applied_at DESC, id DESC LIMIT 1
    `).get())?.id ?? null;
  } catch {
    return null;
  }
}
