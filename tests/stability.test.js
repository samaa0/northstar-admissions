import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/app.js';
import { createDatabase } from '../server/database.js';
import { reports } from '../server/reports.js';

let database;
let app;
beforeEach(() => { database = createDatabase(':memory:'); app = createApp(database); });
afterEach(() => database.close());

describe('system stability under repeated operations', () => {
  it('serves 240 mixed reads without errors or data changes', async () => {
    const paths = ['/health', '/dashboard', '/programmes', '/applicants', '/applicants/1', '/model', '/admin/programmes', '/admin/staff', '/admin/scholarships', ...reports.map((report) => `/reports/${report.id}`)];
    const before = database.prepare('SELECT COUNT(*) AS count FROM status_history').get().count;
    for (let batch = 0; batch < 12; batch += 1) {
      const responses = await Promise.all(Array.from({ length: 20 }, (_, index) => request(app).get(`/api${paths[(batch * 20 + index) % paths.length]}`)));
      expect(responses.every((response) => response.status === 200)).toBe(true);
    }
    expect(database.prepare('SELECT COUNT(*) AS count FROM status_history').get().count).toBe(before);
    expect(database.pragma('integrity_check', { simple: true })).toBe('ok');
    expect(database.pragma('foreign_key_check')).toEqual([]);
  });

  it('allows exactly one catalogue insert for simultaneous duplicate requests', async () => {
    const payload = { code: 'STABILITY', name: 'Stability Scholarship', amountHkd: 1000, minimumScore: 70, places: 2 };
    const responses = await Promise.all(Array.from({ length: 8 }, () => request(app).post('/api/admin/scholarships').send(payload)));
    expect(responses.filter((response) => response.status === 201)).toHaveLength(1);
    expect(responses.filter((response) => response.status === 409)).toHaveLength(7);
    expect(database.prepare("SELECT COUNT(*) AS count FROM scholarships WHERE code = 'STABILITY'").get().count).toBe(1);
    expect(database.pragma('foreign_key_check')).toEqual([]);
  });

  it('remains healthy after malformed JSON and unknown record requests', async () => {
    for (let index = 0; index < 10; index += 1) {
      expect((await request(app).post('/api/admin/staff').set('Content-Type', 'application/json').send('{bad')).status).toBe(400);
      expect((await request(app).get('/api/applicants/999999')).status).toBe(404);
      expect((await request(app).get('/api/reports/unknown')).status).toBe(404);
    }
    expect((await request(app).get('/api/health')).body.status).toBe('ok');
    expect(database.pragma('integrity_check', { simple: true })).toBe('ok');
  });
});
