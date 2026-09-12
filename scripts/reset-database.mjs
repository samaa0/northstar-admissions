import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { createDatabase } from '../server/database.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const databasePath = path.resolve(process.env.DATABASE_PATH || path.join(root, 'data', 'admissions.db'));
const backupDirectory = path.join(root, 'tmp', 'database-backups');
const timestamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');

fs.mkdirSync(path.dirname(databasePath), { recursive: true });
fs.mkdirSync(backupDirectory, { recursive: true });

if (fs.existsSync(databasePath)) {
  const source = new Database(databasePath);
  try {
    const integrity = source.pragma('integrity_check', { simple: true });
    if (integrity !== 'ok') throw new Error(`Backup stopped: source integrity check returned ${integrity}`);
    source.pragma('wal_checkpoint(TRUNCATE)');
  } finally {
    source.close();
  }
  const backupPath = path.join(backupDirectory, `admissions-before-v2-${timestamp}.db`);
  fs.copyFileSync(databasePath, backupPath, fs.constants.COPYFILE_EXCL);
  if (fs.statSync(backupPath).size !== fs.statSync(databasePath).size) {
    throw new Error('Backup stopped: copied database size does not match source');
  }
  fs.renameSync(databasePath, `${databasePath}.legacy-${timestamp}`);
  console.log(`Verified backup: ${path.relative(root, backupPath)}`);
}

for (const suffix of ['-wal', '-shm']) {
  const sidecar = `${databasePath}${suffix}`;
  if (fs.existsSync(sidecar)) fs.renameSync(sidecar, `${sidecar}.legacy-${timestamp}`);
}

const db = createDatabase(databasePath);
try {
  const integrity = db.pragma('integrity_check', { simple: true });
  const foreignKeys = db.pragma('foreign_key_check');
  const businessTables = db.prepare(`
    SELECT COUNT(*) AS count FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'schema_migrations'
  `).get().count;
  const applications = db.prepare('SELECT COUNT(*) AS count FROM applications').get().count;
  const reportsFixture = db.prepare('SELECT cycle_id, COUNT(*) AS count FROM applications GROUP BY cycle_id ORDER BY cycle_id').all();
  if (integrity !== 'ok' || foreignKeys.length || businessTables !== 19 || applications !== 48) {
    throw new Error(`Reset verification failed: integrity=${integrity}, foreignKeys=${foreignKeys.length}, tables=${businessTables}, applications=${applications}`);
  }
  db.pragma('wal_checkpoint(TRUNCATE)');
  const checksum = crypto.createHash('sha256').update(fs.readFileSync(databasePath)).digest('hex');
  console.log(`Database reset verified: 19 business relations, 48 applications, cycles=${JSON.stringify(reportsFixture)}, sha256=${checksum}`);
} finally {
  db.close();
}
