import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const databasePath = process.env.DATABASE_PATH || path.join(root, 'data', 'admissions.db');
const outputPath = path.join(root, 'model-catalogue.json');
const db = new Database(databasePath, { readonly: true });

try {
  const tables = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'schema_migrations'
    ORDER BY name
  `).all().map(({ name }) => ({
    name,
    columns: db.prepare(`PRAGMA table_info("${name}")`).all(),
    foreignKeys: db.prepare(`PRAGMA foreign_key_list("${name}")`).all(),
    indexes: db.prepare(`PRAGMA index_list("${name}")`).all(),
    rowCount: db.prepare(`SELECT COUNT(*) AS count FROM "${name}"`).get().count,
  }));
  const objects = db.prepare(`
    SELECT name, type, sql FROM sqlite_master
    WHERE name NOT LIKE 'sqlite_%' AND type IN ('view', 'trigger', 'index')
    ORDER BY type, name
  `).all();
  const migrations = db.prepare('SELECT * FROM schema_migrations ORDER BY applied_at, id').all();
  const relationships = tables.flatMap((table) => table.foreignKeys.map((foreignKey) => ({
    fromTable: table.name,
    fromColumn: foreignKey.from,
    toTable: foreignKey.table,
    toColumn: foreignKey.to,
  })));
  const catalogue = {
    product: 'HKUST Student Admission System',
    generatedAt: new Date().toISOString(),
    summary: {
      businessRelations: tables.length,
      technicalTables: 1,
      views: objects.filter(({ type }) => type === 'view').length,
      triggers: objects.filter(({ type }) => type === 'trigger').length,
      indexes: objects.filter(({ type, sql }) => type === 'index' && sql).length,
      migrations: migrations.length,
    },
    tables,
    views: objects.filter(({ type }) => type === 'view'),
    triggers: objects.filter(({ type }) => type === 'trigger'),
    indexes: objects.filter(({ type, sql }) => type === 'index' && sql),
    migrations,
    relationships,
    businessRules: [
      'Application status and decisions are append-only histories.',
      'Only legal status transitions may be inserted, and selected transitions require a reason.',
      'Required evidence must be verified before an offer or acceptance.',
      'Accepted applications and scholarship awards cannot exceed annual capacity.',
      'Application choices must share cycle and degree level with contiguous preference ranks.',
      'Completed interviews require a panel, score and feedback; panel schedules cannot overlap.',
    ],
  };
  fs.writeFileSync(outputPath, `${JSON.stringify(catalogue, null, 2)}\n`);
  console.log(`Model catalogue generated: ${tables.length} relations, ${catalogue.summary.views} views, ${catalogue.summary.triggers} triggers`);
} finally {
  db.close();
}
