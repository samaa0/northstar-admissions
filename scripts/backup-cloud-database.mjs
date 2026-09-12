import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.join(root, 'tmp', 'cloud-backups');
fs.mkdirSync(directory, { recursive: true });
if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) throw new Error('TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are required');
const client = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN, intMode: 'number' });
const tables = (await client.execute(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)).rows.map(({ name }) => name);
const snapshot = { createdAt: new Date().toISOString(), tables: {}, rowCounts: {} };
for (const table of tables) {
  const rows = (await client.execute(`SELECT * FROM "${table}"`)).rows;
  snapshot.tables[table] = rows;
  snapshot.rowCounts[table] = rows.length;
}
const file = path.join(directory, `turso-backup-${new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')}.json`);
fs.writeFileSync(file, JSON.stringify(snapshot, null, 2), { encoding: 'utf8', flag: 'wx' });
console.log(`Verified Turso logical backup: ${path.relative(root, file)} (${tables.length} tables)`);
client.close();
