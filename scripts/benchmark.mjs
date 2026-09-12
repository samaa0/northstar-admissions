import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { isDeepStrictEqual } from 'node:util';
import request from 'supertest';
import { createApp } from '../server/app.js';
import { createDatabase } from '../server/database.js';
import { reports } from '../server/reports.js';

function positiveInteger(name, fallback) {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

const READ_REQUESTS = positiveInteger('BENCHMARK_READ_REQUESTS', 1200);
const CONCURRENCY = positiveInteger('BENCHMARK_CONCURRENCY', 30);
const WARM_UP_REQUESTS = positiveInteger('BENCHMARK_WARM_UP_REQUESTS', 60);
const DUPLICATE_WRITE_ATTEMPTS = positiveInteger('BENCHMARK_DUPLICATE_WRITE_ATTEMPTS', 20);
const MALFORMED_REQUESTS = positiveInteger('BENCHMARK_MALFORMED_REQUESTS', 20);

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'northstar-benchmark-'));
const filename = path.join(directory, 'benchmark.db');
const db = createDatabase(filename);
const app = createApp(db);

const readPaths = [
  '/api/health',
  '/api/dashboard',
  '/api/programmes',
  '/api/applicants',
  '/api/applicants/1',
  '/api/model',
  '/api/admin/programmes',
  '/api/admin/staff',
  '/api/admin/scholarships',
  ...reports.map(({ id }) => `/api/reports/${id}`),
];

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function round(value) {
  return Number(value.toFixed(2));
}

async function timedRead(url) {
  const started = performance.now();
  const response = await request(app).get(url);
  return { status: response.status, latencyMs: performance.now() - started };
}

function tableCounts() {
  const names = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all().map(({ name }) => name);
  return Object.fromEntries(names.map((name) => [
    name,
    db.prepare(`SELECT COUNT(*) AS count FROM "${name}"`).get().count,
  ]));
}

try {
  for (let index = 0; index < WARM_UP_REQUESTS; index += 1) {
    const response = await request(app).get(readPaths[index % readPaths.length]);
    if (response.status !== 200) throw new Error(`Warm-up failed for ${readPaths[index % readPaths.length]}`);
  }

  const latencies = [];
  const failures = [];
  let cursor = 0;
  const started = performance.now();
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= READ_REQUESTS) return;
      const url = readPaths[index % readPaths.length];
      const result = await timedRead(url);
      latencies.push(result.latencyMs);
      if (result.status !== 200) failures.push({ url, status: result.status });
    }
  }));
  const durationMs = performance.now() - started;

  const reportChecks = [];
  for (const report of reports) {
    const response = await request(app).get(`/api/reports/${report.id}`).query({ cycleId: 2 });
    const directRows = db.prepare(report.sql).all({ cycleId: 2, from: null, to: null });
    reportChecks.push({
      id: report.id,
      status: response.status,
      rows: response.body.rows?.length ?? -1,
      exactMatch: response.status === 200 && isDeepStrictEqual(response.body.rows, directRows),
    });
  }

  const duplicatePayload = {
    code: 'BENCH-DUPE',
    name: 'Benchmark Duplicate Award',
    amountHkd: 10000,
    minimumScore: 75,
    places: 2,
  };
  const duplicateResponses = await Promise.all(
    Array.from({ length: DUPLICATE_WRITE_ATTEMPTS }, () => request(app).post('/api/admin/scholarships').send(duplicatePayload)),
  );
  const duplicateStatuses = Object.groupBy(duplicateResponses, ({ status }) => String(status));

  const beforeInvalid = tableCounts();
  const invalidResponse = await request(app).post('/api/applicants').send({
    firstName: 'Benchmark',
    lastName: 'Invalid',
    preferredName: '',
    email: 'benchmark.invalid@example.test',
    phone: '+852 5000 0000',
    nationality: 'Hong Kong',
    birthDate: '2000-01-01',
    institution: 'QA Institute',
    qualification: 'Bachelor Degree',
    fieldOfStudy: 'Information Systems',
    grade: 'A',
    graduationYear: 2026,
    choices: [{ programmeId: 999999, academicScore: 95 }],
  });
  const afterInvalid = tableCounts();

  const beforeValid = tableCounts();
  const validResponse = await request(app).post('/api/applicants').send({
    firstName: 'Benchmark',
    lastName: 'Valid',
    preferredName: 'Load Test',
    email: 'benchmark.valid@example.test',
    phone: '+852 5111 2222',
    nationality: 'Hong Kong',
    birthDate: '2000-01-01',
    institution: 'QA Institute',
    qualification: 'Bachelor Degree',
    fieldOfStudy: 'Information Systems',
    grade: 'A',
    graduationYear: 2026,
    cycleId: 2,
    degreeLevel: 'UG',
    choices: [
      { offeringId: 7, academicScore: 95 },
      { offeringId: 8, academicScore: 92 },
    ],
  });
  const afterValid = tableCounts();
  const expectedIncrements = {
    applicants: 1,
    education_records: 1,
    applications: 1,
    application_choices: 2,
    status_history: 1,
  };
  const validWriteAtomic = validResponse.status === 201
    && Object.entries(expectedIncrements).every(([table, increment]) => afterValid[table] - beforeValid[table] === increment);

  const malformedResponses = [];
  for (let index = 0; index < MALFORMED_REQUESTS; index += 1) {
    malformedResponses.push(await request(app)
      .post('/api/admin/staff')
      .set('Content-Type', 'application/json')
      .send('{bad'));
  }
  const healthAfterErrors = await request(app).get('/api/health');

  const checks = {
    readRequestsSuccessful: failures.length === 0 && latencies.length === READ_REQUESTS,
    allReportsMatchDirectSql: reportChecks.every(({ exactMatch }) => exactMatch),
    concurrentDuplicateProtected: (duplicateStatuses['201']?.length ?? 0) === 1
      && (duplicateStatuses['409']?.length ?? 0) === DUPLICATE_WRITE_ATTEMPTS - 1
      && db.prepare("SELECT COUNT(*) AS count FROM scholarships WHERE code = 'BENCH-DUPE'").get().count === 1,
    rejectedWriteLeftAllTablesUnchanged: invalidResponse.status === 422 && isDeepStrictEqual(beforeInvalid, afterInvalid),
    validIntakeCommittedAtomically: validWriteAtomic,
    malformedRequestsRemainContained: malformedResponses.every(({ status }) => status === 400)
      && healthAfterErrors.status === 200,
    sqliteIntegrity: db.pragma('integrity_check', { simple: true }) === 'ok',
    foreignKeysValid: db.pragma('foreign_key_check').length === 0,
  };

  const result = {
    benchmark: 'HKUST Student Admission System isolated stability benchmark',
    timestamp: new Date().toISOString(),
    environment: {
      node: process.version,
      platform: `${process.platform}-${process.arch}`,
      database: 'file-backed temporary SQLite database (WAL)',
      transport: 'Express application exercised through Supertest',
    },
    workload: {
      warmUpRequests: WARM_UP_REQUESTS,
      readRequests: READ_REQUESTS,
      concurrency: CONCURRENCY,
      routeCount: readPaths.length,
      durationMs: round(durationMs),
      throughputRequestsPerSecond: round((READ_REQUESTS * 1000) / durationMs),
      latencyMs: {
        p50: round(percentile(latencies, 0.5)),
        p95: round(percentile(latencies, 0.95)),
        p99: round(percentile(latencies, 0.99)),
        max: round(Math.max(...latencies)),
      },
      failures,
    },
    reportAccuracy: reportChecks,
    writeAccuracy: {
      simultaneousDuplicateAttempts: duplicateResponses.length,
      duplicateStatusCounts: Object.fromEntries(
        Object.entries(duplicateStatuses).map(([status, responses]) => [status, responses.length]),
      ),
      invalidIntakeStatus: invalidResponse.status,
      validIntakeStatus: validResponse.status,
      expectedIncrements,
    },
    checks,
    passed: Object.values(checks).every(Boolean),
  };

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.passed) process.exitCode = 1;
} finally {
  db.close();
  fs.rmSync(directory, { recursive: true, force: true });
}
