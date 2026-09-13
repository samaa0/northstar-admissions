import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { reports } from '../server/reports.js';

const baseUrl = (process.env.PRODUCTION_URL || 'https://northstar-admissions-bay.vercel.app').replace(/\/$/, '');
const expectedCommit = (process.env.EXPECTED_GIT_COMMIT || execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' })).trim();
const timings = [];

async function request(path, options = {}) {
  const startedAt = performance.now();
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: options.body === undefined
      ? options.headers
      : { 'Content-Type': 'application/json', ...options.headers },
    signal: AbortSignal.timeout(30_000),
  });
  timings.push({ path, method: options.method || 'GET', status: response.status, durationMs: Number((performance.now() - startedAt).toFixed(2)) });
  return response;
}

async function json(path, expectedStatus = 200, options = {}) {
  const response = await request(path, options);
  assert.equal(response.status, expectedStatus, `${options.method || 'GET'} ${path} returned ${response.status}`);
  assert.match(response.headers.get('content-type') || '', /application\/json/i, `${path} did not return JSON`);
  return response.json();
}

let offeringId;
let originalCapacity;
try {
  const home = await request('/');
  assert.equal(home.status, 200);
  assert.match(await home.text(), /<title>HKUST Student Admission System \| ISOM5260 Demo<\/title>/);

  const logo = await request('/hkust-logo-white.svg');
  assert.equal(logo.status, 200);
  assert.match(logo.headers.get('content-type') || '', /image\/svg\+xml/i);

  assert.deepEqual(await json('/api/health'), { status: 'ok', database: 'connected' });
  const version = await json('/api/version');
  assert.equal(version.product, 'HKUST Student Admission System');
  assert.equal(version.gitCommit, expectedCommit);
  assert.equal(version.schemaVersion, '003_acceptance_decision_traceability');
  assert.equal(version.seedVersion, '2026-09-12-v2');
  assert.equal(version.database, 'connected');

  const model = await json('/api/model');
  assert.deepEqual(model.summary, {
    businessRelations: 19,
    technicalTables: 1,
    reports: 15,
    schemaVersion: '003_acceptance_decision_traceability',
  });
  assert.equal(model.views.length, 8);
  assert.equal(model.triggers.length, 21);
  assert.equal(model.indexes.length, 14);
  assert.equal(model.reports.length, 15);

  const dashboard = await json('/api/dashboard?cycleId=2');
  assert.equal(dashboard.metrics.total, 24);
  for (const report of reports) {
    const result = await json(`/api/reports/${report.id}?cycleId=2`);
    assert.ok(Array.isArray(result.rows), `${report.id} did not return rows`);
  }
  const invalidFilter = await json('/api/reports/pipeline?cycleId=invalid', 422);
  assert.ok(invalidFilter.fields?.cycleId, 'Invalid cycle filter did not return a field-level error');

  const offerings = await json('/api/admin/offerings?cycleId=2');
  assert.ok(offerings.length > 0);
  offeringId = offerings[0].id;
  originalCapacity = offerings[0].capacity;
  await json(`/api/admin/offerings/${offeringId}`, 200, {
    method: 'PATCH',
    body: JSON.stringify({ capacity: originalCapacity + 1 }),
  });
  const updated = await json('/api/admin/offerings?cycleId=2');
  assert.equal(updated.find(({ id }) => id === offeringId).capacity, originalCapacity + 1);
  await json(`/api/admin/offerings/${offeringId}`, 200, {
    method: 'PATCH',
    body: JSON.stringify({ capacity: originalCapacity }),
  });
  originalCapacity = undefined;

  const summary = {
    baseUrl,
    gitCommit: version.gitCommit,
    schemaVersion: version.schemaVersion,
    seedVersion: version.seedVersion,
    reportsVerified: reports.length,
    requests: timings.length,
    failedRequests: timings.filter(({ status }) => status >= 400 && status !== 422).length,
    maximumResponseMs: Math.max(...timings.map(({ durationMs }) => durationMs)),
    passed: true,
  };
  console.log(JSON.stringify(summary, null, 2));
} finally {
  if (offeringId !== undefined && originalCapacity !== undefined) {
    try {
      await json(`/api/admin/offerings/${offeringId}`, 200, {
        method: 'PATCH',
        body: JSON.stringify({ capacity: originalCapacity }),
      });
    } catch (error) {
      console.error(`CRITICAL: failed to restore offering ${offeringId} capacity to ${originalCapacity}`);
      throw error;
    }
  }
}
