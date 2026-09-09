import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../server/app.js';
import { createCloudDatabase } from '../server/cloud-database.js';
import { reports } from '../server/reports.js';

const db = createCloudDatabase();
const app = createApp(db);
let originalCapacity;

try {
  const health = await request(app).get('/api/health').expect(200);
  assert.deepEqual(health.body, { status: 'ok', database: 'connected' });

  const dashboard = await request(app).get('/api/dashboard').expect(200);
  assert.equal(dashboard.body.metrics.total, 24);

  const model = await request(app).get('/api/model').expect(200);
  assert.equal(model.body.tables.length, 12);

  for (const report of reports) {
    const result = await request(app).get(`/api/reports/${report.id}`).expect(200);
    assert.ok(Array.isArray(result.body.rows));
  }

  const programmes = await request(app).get('/api/admin/programmes').expect(200);
  const programme = programmes.body.find(({ id }) => id === 1);
  assert.ok(programme);
  originalCapacity = programme.capacity;
  await request(app).patch('/api/admin/programmes/1').send({ capacity: originalCapacity + 1 }).expect(200);
  const updated = await request(app).get('/api/admin/programmes').expect(200);
  assert.equal(updated.body.find(({ id }) => id === 1).capacity, originalCapacity + 1);
  await request(app).patch('/api/admin/programmes/1').send({ capacity: originalCapacity }).expect(200);
  originalCapacity = undefined;

  await db.prepare('CREATE TABLE IF NOT EXISTS deployment_probe (id INTEGER PRIMARY KEY, value TEXT NOT NULL)').run();
  await db.prepare('DELETE FROM deployment_probe').run();
  await assert.rejects(db.runTransaction(async (transactionDb) => {
    await transactionDb.prepare('INSERT INTO deployment_probe (value) VALUES (?)').run('rollback');
    throw new Error('intentional rollback');
  }), /intentional rollback/);
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM deployment_probe').get()).count, 0);
  await db.runTransaction(async (transactionDb) => {
    await transactionDb.prepare('INSERT INTO deployment_probe (value) VALUES (?)').run('commit');
  });
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM deployment_probe').get()).count, 1);
  await db.prepare('DROP TABLE deployment_probe').run();

  console.log(`Cloud verification passed: 12 tables, ${reports.length} reports, read/write, commit, and rollback`);
} finally {
  if (originalCapacity !== undefined) {
    await request(app).patch('/api/admin/programmes/1').send({ capacity: originalCapacity });
  }
  try {
    await db.prepare('DROP TABLE IF EXISTS deployment_probe').run();
  } finally {
    db.close();
  }
}
