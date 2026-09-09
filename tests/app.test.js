import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import request from 'supertest';
import { createApp, transitions } from '../server/app.js';
import { createDatabase } from '../server/database.js';
import { reports } from '../server/reports.js';

let db;
let app;

beforeEach(() => {
  db = createDatabase(':memory:');
  app = createApp(db);
});

afterEach(() => {
  db.close();
});

describe('database design and health', () => {
  it('creates the complete normalized schema with foreign keys enabled', async () => {
    const health = await request(app).get('/api/health');
    const tableCount = db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").get().count;

    expect(health.status).toBe(200);
    expect(health.body).toEqual({ status: 'ok', database: 'connected' });
    expect(tableCount).toBe(12);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it('seeds enough linked data to demonstrate every table', () => {
    const tableNames = db.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `).all().map(({ name }) => name);
    const seededCounts = Object.fromEntries(
      tableNames.map((tableName) => [
        tableName,
        db.prepare(`SELECT COUNT(*) AS count FROM "${tableName}"`).get().count,
      ]),
    );

    expect(tableNames).toHaveLength(12);
    expect(Object.values(seededCounts).every((count) => count > 0), seededCounts).toBe(true);
    expect(seededCounts.applicants).toBe(24);
    expect(seededCounts.application_choices).toBe(48);
    expect(seededCounts.status_history).toBeGreaterThan(50);
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });

  it('returns dashboard decision signals from the live application table', async () => {
    const response = await request(app).get('/api/dashboard');

    expect(response.status).toBe(200);
    expect(response.body.metrics.total).toBe(24);
    expect(response.body.metrics.flagged).toBeGreaterThan(0);
    expect(response.body.metrics.yieldRate).toBe(43);
    expect(response.body.pipeline).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 'REVIEW', count: 6 }),
      expect.objectContaining({ status: 'OFFERED', count: 4 }),
    ]));
    expect(response.body.capacity[0]).toEqual(expect.objectContaining({ code: 'BSC-AI', demand: 8 }));
  });

  it('enforces key database integrity constraints', () => {
    expect(() => db.prepare(`
      INSERT INTO programmes (code, name, school, degree_level, capacity, deadline)
      VALUES ('BAD-CAP', 'Invalid', 'Test', 'UG', 0, '2026-10-15')
    `).run()).toThrow();
    expect(() => db.prepare(`
      INSERT INTO applications
        (application_no, applicant_id, intake_year, status, risk_flag)
      VALUES ('DUPLICATE-INTAKE', 1, 2027, 'DRAFT', 'NONE')
    `).run()).toThrow();
    expect(() => db.prepare(`
      INSERT INTO application_choices
        (application_id, programme_id, preference_rank, academic_score)
      VALUES (1, 3, 3, 101)
    `).run()).toThrow();
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });

  it('describes every relation and report through the model API', async () => {
    const response = await request(app).get('/api/model');

    expect(response.status).toBe(200);
    expect(response.body.tables).toHaveLength(12);
    expect(response.body.reports).toHaveLength(12);
    expect(response.body.tables.every((table) => table.columns.length > 0)).toBe(true);
    expect(response.body.tables.find((table) => table.name === 'applications').foreignKeys).toHaveLength(2);
    expect(response.body.reports.every((report) => report.sql.trim().toUpperCase().startsWith('SELECT'))).toBe(true);
  });

  it('migrates an existing scholarship catalogue without losing records', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'northstar-migration-'));
    const filename = path.join(directory, 'legacy.db');
    const legacy = new Database(filename);
    legacy.exec(`
      CREATE TABLE scholarships (
        id INTEGER PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        amount_hkd INTEGER NOT NULL,
        minimum_score REAL NOT NULL,
        places INTEGER NOT NULL
      );
      INSERT INTO scholarships (code, name, amount_hkd, minimum_score, places)
      VALUES ('LEGACY-20', 'Legacy Award', 20000, 75, 4);
    `);
    legacy.close();

    const migrated = createDatabase(filename);
    try {
      const record = migrated.prepare("SELECT code, active FROM scholarships WHERE code = 'LEGACY-20'").get();
      const columns = migrated.prepare("PRAGMA table_info('scholarships')").all().map(({ name }) => name);
      expect(record).toEqual({ code: 'LEGACY-20', active: 1 });
      expect(columns).toContain('active');
      expect(migrated.pragma('foreign_key_check')).toEqual([]);
    } finally {
      migrated.close();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe('administrative catalogues', () => {
  it('creates, edits and archives a programme while preserving usage history', async () => {
    const created = await request(app).post('/api/admin/programmes').send({
      code: 'MSC-DT',
      name: 'MSc in Digital Transformation',
      school: 'School of Business',
      degreeLevel: 'PG',
      capacity: 44,
      deadline: '2026-11-30',
    });
    const edited = await request(app).patch(`/api/admin/programmes/${created.body.id}`).send({ capacity: 48 });
    const archived = await request(app).patch('/api/admin/programmes/1').send({ active: false });
    const catalogue = await request(app).get('/api/admin/programmes');
    const intake = await request(app).get('/api/programmes');
    const report = await request(app).get('/api/reports/programme-demand');

    expect(created.status).toBe(201);
    expect(edited.status).toBe(200);
    expect(archived.status).toBe(200);
    expect(catalogue.body.find(({ id }) => id === created.body.id).capacity).toBe(48);
    expect(catalogue.body.find(({ id }) => id === 1)).toEqual(expect.objectContaining({ active: 0, usage_count: expect.any(Number) }));
    expect(intake.body.some(({ id }) => id === 1)).toBe(false);
    expect(report.body.rows.some(({ code }) => code === 'BBA-IS')).toBe(true);
  });

  it('enforces unique catalogue identifiers and field-level validation', async () => {
    const duplicateProgramme = await request(app).post('/api/admin/programmes').send({
      code: 'BBA-IS', name: 'Duplicate', school: 'School of Business', degreeLevel: 'UG', capacity: 10, deadline: '2026-12-01',
    });
    const invalidPatch = await request(app).patch('/api/admin/programmes/1').send({ capacity: 0 });
    const emptyPatch = await request(app).patch('/api/admin/programmes/1').send({});

    expect(duplicateProgramme.status).toBe(409);
    expect(duplicateProgramme.body.fields.code).toBeTruthy();
    expect(invalidPatch.status).toBe(422);
    expect(invalidPatch.body.fields.capacity).toBeTruthy();
    expect(emptyPatch.status).toBe(422);
  });

  it('manages staff records and prevents archived staff from new assignments', async () => {
    const created = await request(app).post('/api/admin/staff').send({
      name: 'Dana Wu', email: 'dana.wu@northstar.edu', role: 'REVIEWER',
    });
    const assigned = await request(app).patch('/api/applications/1/assignment').send({ staffId: created.body.id });
    const archived = await request(app).patch(`/api/admin/staff/${created.body.id}`).send({ active: false });
    const rejected = await request(app).patch('/api/applications/2/assignment').send({ staffId: created.body.id });
    const catalogue = await request(app).get('/api/admin/staff');

    expect(created.status).toBe(201);
    expect(assigned.status).toBe(200);
    expect(archived.status).toBe(200);
    expect(rejected.status).toBe(422);
    expect(catalogue.body.find(({ id }) => id === created.body.id)).toEqual(expect.objectContaining({ active: 0, assigned_count: 1 }));
  });

  it('creates, edits and archives scholarships without deleting nominations', async () => {
    const created = await request(app).post('/api/admin/scholarships').send({
      code: 'LEAD-25', name: 'Registry Leadership Award', amountHkd: 25000, minimumScore: 78, places: 6,
    });
    const edited = await request(app).patch(`/api/admin/scholarships/${created.body.id}`).send({ amountHkd: 28000 });
    const existingCount = db.prepare('SELECT COUNT(*) AS count FROM scholarship_applications WHERE scholarship_id = 1').get().count;
    const archived = await request(app).patch('/api/admin/scholarships/1').send({ active: false });
    const catalogue = await request(app).get('/api/admin/scholarships');

    expect(created.status).toBe(201);
    expect(edited.status).toBe(200);
    expect(archived.status).toBe(200);
    expect(catalogue.body.find(({ id }) => id === created.body.id).amount_hkd).toBe(28000);
    expect(catalogue.body.find(({ id }) => id === 1).active).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS count FROM scholarship_applications WHERE scholarship_id = 1').get().count).toBe(existingCount);
  });
});

describe('application register', () => {
  it('filters by stage and search term without returning unrelated records', async () => {
    const response = await request(app).get('/api/applicants').query({ status: 'REVIEW', q: 'APP-27' });

    expect(response.status).toBe(200);
    expect(response.body.items.length).toBeGreaterThan(0);
    expect(response.body.items.every((item) => item.status === 'REVIEW')).toBe(true);
    expect(response.body.items.every((item) => item.application_no.includes('APP-27'))).toBe(true);
  });

  it('returns a complete application record for review', async () => {
    const response = await request(app).get('/api/applicants/1');

    expect(response.status).toBe(200);
    expect(response.body.choices).toHaveLength(2);
    expect(response.body.education.length).toBeGreaterThan(0);
    expect(response.body.documents.length).toBeGreaterThanOrEqual(2);
    expect(response.body.history.length).toBeGreaterThan(0);
    expect(response.body.allowedTransitions).toEqual(transitions[response.body.application.status]);
  });

  it('paginates deterministically and combines programme and status filters', async () => {
    const firstPage = await request(app).get('/api/applicants').query({ page: 1 });
    const secondPage = await request(app).get('/api/applicants').query({ page: 2 });
    const sample = firstPage.body.items[0];
    const filtered = await request(app).get('/api/applicants').query({
      programme: sample.programme.toLowerCase(),
      status: sample.status.toLowerCase(),
    });

    expect(firstPage.body.items).toHaveLength(12);
    expect(secondPage.body.items).toHaveLength(12);
    expect(new Set([...firstPage.body.items, ...secondPage.body.items].map((item) => item.id)).size).toBe(24);
    expect(filtered.body.items.length).toBeGreaterThan(0);
    expect(filtered.body.items.every((item) => item.programme === sample.programme && item.status === sample.status)).toBe(true);
  });

  it('normalizes invalid page inputs instead of passing them to SQLite', async () => {
    for (const page of ['-2', '1.1', 'not-a-number']) {
      const response = await request(app).get('/api/applicants').query({ page });
      expect(response.status, page).toBe(200);
      expect(response.body.page, page).toBe(1);
    }
  });

  it('returns not found for an unknown application record', async () => {
    const response = await request(app).get('/api/applicants/999999');
    expect(response.status).toBe(404);
    expect(response.body.message).toContain('not found');
  });

  it('lists all active programmes with the fields required by intake', async () => {
    const response = await request(app).get('/api/programmes');
    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(6);
    expect(response.body.every((programme) => programme.id && programme.code && programme.capacity > 0 && programme.deadline)).toBe(true);
  });
});

describe('validated applicant intake', () => {
  const validPayload = {
    firstName: 'Tara',
    lastName: 'Sen',
    preferredName: '',
    email: 'tara.sen@example.com',
    phone: '+852 6123 8899',
    nationality: 'India',
    birthDate: '2005-05-12',
    institution: 'Harbour University',
    qualification: 'Bachelor Degree',
    fieldOfStudy: 'Information Systems',
    grade: '91%',
    graduationYear: 2026,
    choices: [
      { programmeId: 4, academicScore: 91.2 },
      { programmeId: 5, academicScore: 89.8 },
    ],
  };

  it('rejects invalid personal and academic values with field-level errors', async () => {
    const response = await request(app).post('/api/applicants').send({
      ...validPayload,
      email: 'not-an-email',
      birthDate: '2020-01-01',
      choices: [{ programmeId: 4, academicScore: 101 }],
    });

    expect(response.status).toBe(422);
    expect(response.body.fields.email).toBeTruthy();
    expect(response.body.fields.birthDate).toBeTruthy();
    expect(response.body.fields['choices.0.academicScore']).toBeTruthy();
  });

  it('rejects duplicate ranked programme choices', async () => {
    const response = await request(app).post('/api/applicants').send({
      ...validPayload,
      choices: [
        { programmeId: 4, academicScore: 91.2 },
        { programmeId: 4, academicScore: 89.8 },
      ],
    });

    expect(response.status).toBe(422);
    expect(response.body.fields.choices).toContain('unique');
  });

  it('creates all linked intake records in one transaction', async () => {
    const before = db.prepare('SELECT COUNT(*) AS count FROM applicants').get().count;
    const response = await request(app).post('/api/applicants').send(validPayload);

    expect(response.status).toBe(201);
    expect(db.prepare('SELECT COUNT(*) AS count FROM applicants').get().count).toBe(before + 1);
    const application = db.prepare('SELECT * FROM applications WHERE id = ?').get(response.body.applicationId);
    expect(application.status).toBe('SUBMITTED');
    expect(application.risk_flag).toBe('MISSING_DOCS');
    expect(db.prepare('SELECT COUNT(*) AS count FROM application_choices WHERE application_id = ?').get(application.id).count).toBe(2);
    expect(db.prepare('SELECT COUNT(*) AS count FROM status_history WHERE application_id = ?').get(application.id).count).toBe(1);
    expect(db.prepare('SELECT COUNT(*) AS count FROM education_records WHERE applicant_id = ?').get(application.applicant_id).count).toBe(1);
  });

  it('prevents duplicate applicant email addresses', async () => {
    const created = await request(app).post('/api/applicants').send(validPayload);
    expect(created.status, created.text).toBe(201);
    const duplicate = await request(app).post('/api/applicants').send(validPayload);

    expect(duplicate.status, duplicate.text).toBe(409);
    expect(duplicate.body.fields.email).toContain('already');
  });

  it('normalizes stored names and email while preserving ranked choices', async () => {
    const response = await request(app).post('/api/applicants').send({
      ...validPayload,
      firstName: '  Tara  ',
      email: 'TARA.SEN@EXAMPLE.COM',
    });
    const detail = await request(app).get(`/api/applicants/${response.body.applicationId}`);

    expect(response.status).toBe(201);
    expect(detail.body.application.first_name).toBe('Tara');
    expect(detail.body.application.email).toBe('tara.sen@example.com');
    expect(detail.body.choices.map((choice) => choice.preference_rank)).toEqual([1, 2]);
  });

  it('rejects applicants who have not reached their sixteenth birthday', async () => {
    const today = new Date();
    const tomorrow = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 1));
    const birthDate = new Date(Date.UTC(tomorrow.getUTCFullYear() - 16, tomorrow.getUTCMonth(), tomorrow.getUTCDate()))
      .toISOString().slice(0, 10);
    const response = await request(app).post('/api/applicants').send({ ...validPayload, birthDate });

    expect(response.status).toBe(422);
    expect(response.body.fields.birthDate).toContain('between 16 and 80');
  });

  it('returns the first actionable message when a field has multiple validation issues', async () => {
    const response = await request(app).post('/api/applicants').send({ ...validPayload, birthDate: '' });
    expect(response.status).toBe(422);
    expect(response.body.fields.birthDate).toBe('Enter a valid birth date');
  });

  it('rejects unavailable programmes and more than three choices', async () => {
    const unavailable = await request(app).post('/api/applicants').send({
      ...validPayload,
      choices: [{ programmeId: 999999, academicScore: 90 }],
    });
    const tooMany = await request(app).post('/api/applicants').send({
      ...validPayload,
      choices: [1, 2, 3, 4].map((programmeId) => ({ programmeId, academicScore: 90 })),
    });

    expect(unavailable.status).toBe(422);
    expect(unavailable.body.fields.choices).toContain('active');
    expect(tooMany.status).toBe(422);
    expect(tooMany.body.fields.choices).toContain('three');
  });

  it('returns a client error for malformed JSON without mutating data', async () => {
    const before = db.prepare('SELECT COUNT(*) AS count FROM applicants').get().count;
    const response = await request(app)
      .post('/api/applicants')
      .set('Content-Type', 'application/json')
      .send('{"firstName":');

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('valid JSON');
    expect(db.prepare('SELECT COUNT(*) AS count FROM applicants').get().count).toBe(before);
  });
});

describe('workflow integrity', () => {
  it('allows a legal transition and appends audit history', async () => {
    const application = db.prepare("SELECT id FROM applications WHERE status = 'SUBMITTED' LIMIT 1").get();
    const before = db.prepare('SELECT COUNT(*) AS count FROM status_history WHERE application_id = ?').get(application.id).count;
    const response = await request(app).patch(`/api/applications/${application.id}/status`).send({ status: 'SCREENING', note: 'Completeness review started' });

    expect(response.status).toBe(200);
    expect(db.prepare('SELECT status FROM applications WHERE id = ?').get(application.id).status).toBe('SCREENING');
    expect(db.prepare('SELECT COUNT(*) AS count FROM status_history WHERE application_id = ?').get(application.id).count).toBe(before + 1);
  });

  it('blocks illegal state jumps and adverse outcomes without a reason', async () => {
    const screening = db.prepare("SELECT id FROM applications WHERE status = 'SCREENING' LIMIT 1").get();
    const review = db.prepare("SELECT id FROM applications WHERE status = 'REVIEW' LIMIT 1").get();
    const illegal = await request(app).patch(`/api/applications/${screening.id}/status`).send({ status: 'ACCEPTED' });
    const missingReason = await request(app).patch(`/api/applications/${review.id}/status`).send({ status: 'DECLINED', note: '' });

    expect(illegal.status).toBe(422);
    expect(missingReason.status).toBe(422);
  });

  it('supports every documented legal workflow edge', async () => {
    const applicationId = 1;
    const choiceId = db.prepare('SELECT id FROM application_choices WHERE application_id = ? AND preference_rank = 1').get(applicationId).id;

    for (const [fromStatus, nextStatuses] of Object.entries(transitions)) {
      for (const nextStatus of nextStatuses) {
        db.prepare('UPDATE applications SET status = ?, risk_flag = ? WHERE id = ?').run(fromStatus, 'MISSING_DOCS', applicationId);
        db.prepare('DELETE FROM decisions WHERE application_choice_id = ?').run(choiceId);
        const response = await request(app)
          .patch(`/api/applications/${applicationId}/status`)
          .send({ status: nextStatus.toLowerCase(), note: `${fromStatus} to ${nextStatus} verified` });

        expect(response.status, `${fromStatus} -> ${nextStatus}`).toBe(200);
        expect(db.prepare('SELECT status FROM applications WHERE id = ?').get(applicationId).status).toBe(nextStatus);
      }
    }
  });

  it('records offer and decline decisions and clears resolved risk flags', async () => {
    const offered = db.prepare("SELECT id FROM applications WHERE status = 'REVIEW' LIMIT 1").get();
    db.prepare("UPDATE applications SET risk_flag = 'MISSING_DOCS' WHERE id = ?").run(offered.id);
    const offerResponse = await request(app).patch(`/api/applications/${offered.id}/status`).send({ status: 'OFFERED', note: 'Panel approved offer' });
    const offerDecision = db.prepare(`
      SELECT d.decision, d.rationale
      FROM decisions d JOIN application_choices ac ON ac.id = d.application_choice_id
      WHERE ac.application_id = ? AND ac.preference_rank = 1
    `).get(offered.id);

    expect(offerResponse.status).toBe(200);
    expect(offerDecision).toEqual({ decision: 'OFFER', rationale: 'Panel approved offer' });
    expect(db.prepare('SELECT risk_flag FROM applications WHERE id = ?').get(offered.id).risk_flag).toBe('NONE');
  });

  it('rejects changes to terminal records and unknown application IDs', async () => {
    for (const terminalStatus of ['ACCEPTED', 'DECLINED', 'WITHDRAWN']) {
      const application = db.prepare('SELECT id FROM applications WHERE status = ? LIMIT 1').get(terminalStatus);
      const response = await request(app).patch(`/api/applications/${application.id}/status`).send({ status: 'REVIEW', note: 'Reopen' });
      expect(response.status, terminalStatus).toBe(422);
    }
    const missing = await request(app).patch('/api/applications/999999/status').send({ status: 'REVIEW' });
    expect(missing.status).toBe(404);
  });

  it('validates and persists review notes', async () => {
    const invalid = await request(app).post('/api/applications/1/notes').send({ note: ' ' });
    const created = await request(app).post('/api/applications/1/notes').send({ note: '  Verified against original transcript.  ' });
    const detail = await request(app).get('/api/applicants/1');
    const missing = await request(app).post('/api/applications/999999/notes').send({ note: 'Valid note' });

    expect(invalid.status).toBe(422);
    expect(created.status).toBe(201);
    expect(detail.body.notes[0].note).toBe('Verified against original transcript.');
    expect(missing.status).toBe(404);
  });
});

describe('applicant maintenance and evidence workflow', () => {
  function profilePayload(detail, overrides = {}) {
    const { application, education } = detail;
    return {
      firstName: application.first_name,
      lastName: application.last_name,
      preferredName: application.preferred_name || '',
      email: application.email,
      phone: application.phone,
      nationality: application.nationality,
      birthDate: application.birth_date,
      institution: education[0].institution,
      qualification: education[0].qualification,
      fieldOfStudy: education[0].field_of_study,
      grade: education[0].grade,
      graduationYear: education[0].graduation_year,
      ...overrides,
    };
  }

  it('updates profile and latest education in one request', async () => {
    const before = await request(app).get('/api/applicants/1');
    const response = await request(app).patch(`/api/applicants/${before.body.application.applicant_id}`).send(profilePayload(before.body, {
      preferredName: 'May',
      institution: 'Northstar College',
      grade: '96%',
    }));
    const after = await request(app).get('/api/applicants/1');

    expect(response.status).toBe(200);
    expect(after.body.application.preferred_name).toBe('May');
    expect(after.body.education[0]).toEqual(expect.objectContaining({ institution: 'Northstar College', grade: '96%' }));
  });

  it('does not partially update a profile when validation or uniqueness fails', async () => {
    const before = await request(app).get('/api/applicants/1');
    const conflictingEmail = db.prepare('SELECT email FROM applicants WHERE id != ? LIMIT 1').get(before.body.application.applicant_id).email;
    const invalid = await request(app).patch(`/api/applicants/${before.body.application.applicant_id}`).send(profilePayload(before.body, {
      firstName: 'Changed',
      email: conflictingEmail,
      institution: 'Should Not Persist',
    }));
    const after = await request(app).get('/api/applicants/1');

    expect(invalid.status).toBe(409);
    expect(after.body.application.first_name).toBe(before.body.application.first_name);
    expect(after.body.education[0].institution).toBe(before.body.education[0].institution);
  });

  it('registers document metadata, rejects duplicates and records verification staff', async () => {
    const application = db.prepare(`
      SELECT a.id
      FROM applications a
      WHERE NOT EXISTS (
        SELECT 1 FROM documents d WHERE d.application_id = a.id AND d.document_type = 'REFERENCE'
      ) LIMIT 1
    `).get();
    const created = await request(app).post(`/api/applications/${application.id}/documents`).send({
      documentType: 'REFERENCE', fileName: 'academic_reference.pdf',
    });
    const duplicate = await request(app).post(`/api/applications/${application.id}/documents`).send({
      documentType: 'REFERENCE', fileName: 'second_reference.pdf',
    });
    const verified = await request(app).patch(`/api/applications/${application.id}/documents/${created.body.id}`).send({ status: 'VERIFIED' });
    const row = db.prepare('SELECT verification_status, verified_by FROM documents WHERE id = ?').get(created.body.id);

    expect(created.status).toBe(201);
    expect(duplicate.status).toBe(409);
    expect(verified.status).toBe(200);
    expect(row).toEqual({ verification_status: 'VERIFIED', verified_by: 1 });
  });

  it('reconciles missing-document risk when evidence is rejected and verified', async () => {
    const application = db.prepare(`
      SELECT application_id AS id
      FROM documents
      GROUP BY application_id
      HAVING COUNT(*) >= 3
        AND COUNT(CASE WHEN verification_status != 'VERIFIED' THEN 1 END) = 0
      LIMIT 1
    `).get();
    const document = db.prepare('SELECT id FROM documents WHERE application_id = ? LIMIT 1').get(application.id);
    const rejected = await request(app).patch(`/api/applications/${application.id}/documents/${document.id}`).send({ status: 'REJECTED' });
    const rejectedRisk = db.prepare('SELECT risk_flag FROM applications WHERE id = ?').get(application.id).risk_flag;
    const verified = await request(app).patch(`/api/applications/${application.id}/documents/${document.id}`).send({ status: 'VERIFIED' });
    const verifiedRisk = db.prepare('SELECT risk_flag FROM applications WHERE id = ?').get(application.id).risk_flag;

    expect(rejected.status).toBe(200);
    expect(rejectedRisk).toBe('MISSING_DOCS');
    expect(verified.status).toBe(200);
    expect(verifiedRisk).toBe('NONE');
  });

  it('returns active assignment references and scholarship eligibility in application detail', async () => {
    const response = await request(app).get('/api/applicants/1');

    expect(response.status).toBe(200);
    expect(response.body.activeStaff.length).toBeGreaterThan(0);
    expect(response.body.activeStaff.every(({ role }) => ['ADMISSIONS', 'REVIEWER'].includes(role))).toBe(true);
    expect(response.body.eligibleScholarships).toHaveLength(3);
    expect(response.body.eligibleScholarships.every((item) => typeof item.eligible === 'boolean' && item.available_places >= 0)).toBe(true);
    expect(Array.isArray(response.body.nominations)).toBe(true);
  });
});

describe('scholarship workflow', () => {
  function findCandidate(scholarshipId, eligible) {
    return db.prepare(`
      SELECT a.id, ac.academic_score
      FROM applications a
      JOIN application_choices ac ON ac.application_id = a.id AND ac.preference_rank = 1
      JOIN scholarships s ON s.id = @scholarshipId
      WHERE ${eligible ? 'ac.academic_score >= s.minimum_score' : 'ac.academic_score < s.minimum_score'}
        AND NOT EXISTS (
          SELECT 1 FROM scholarship_applications sa
          WHERE sa.application_id = a.id AND sa.scholarship_id = s.id
        )
      ORDER BY ac.academic_score ${eligible ? 'DESC' : 'ASC'}
      LIMIT 1
    `).get({ scholarshipId });
  }

  it('nominates an eligible applicant and rejects duplicate nominations', async () => {
    const candidate = findCandidate(2, true);
    const created = await request(app).post(`/api/applications/${candidate.id}/scholarships`).send({ scholarshipId: 2 });
    const duplicate = await request(app).post(`/api/applications/${candidate.id}/scholarships`).send({ scholarshipId: 2 });

    expect(created.status).toBe(201);
    expect(duplicate.status).toBe(409);
    expect(db.prepare('SELECT status FROM scholarship_applications WHERE id = ?').get(created.body.id).status).toBe('NOMINATED');
  });

  it('rejects ineligible and archived scholarship nominations', async () => {
    const candidate = findCandidate(1, false);
    const ineligible = await request(app).post(`/api/applications/${candidate.id}/scholarships`).send({ scholarshipId: 1 });
    db.prepare('UPDATE scholarships SET active = 0 WHERE id = 3').run();
    const archivedCandidate = db.prepare('SELECT id FROM applications LIMIT 1').get();
    const archived = await request(app).post(`/api/applications/${archivedCandidate.id}/scholarships`).send({ scholarshipId: 3 });

    expect(ineligible.status).toBe(422);
    expect(ineligible.body.fields.scholarshipId).toBeTruthy();
    expect(archived.status).toBe(422);
  });

  it('awards the definition amount and supports declining a pending nomination', async () => {
    const awardCandidate = findCandidate(2, true);
    const nomination = await request(app).post(`/api/applications/${awardCandidate.id}/scholarships`).send({ scholarshipId: 2 });
    const awarded = await request(app).patch(`/api/applications/${awardCandidate.id}/scholarships/${nomination.body.id}`).send({ status: 'AWARDED' });
    const awardRow = db.prepare('SELECT status, awarded_amount_hkd FROM scholarship_applications WHERE id = ?').get(nomination.body.id);

    const declineCandidate = findCandidate(2, true);
    const declineNomination = await request(app).post(`/api/applications/${declineCandidate.id}/scholarships`).send({ scholarshipId: 2 });
    const declined = await request(app).patch(`/api/applications/${declineCandidate.id}/scholarships/${declineNomination.body.id}`).send({ status: 'DECLINED' });

    expect(awarded.status).toBe(200);
    expect(awardRow).toEqual({ status: 'AWARDED', awarded_amount_hkd: 30000 });
    expect(declined.status).toBe(200);
  });

  it('rolls back an award when no place remains', async () => {
    const candidate = findCandidate(2, true);
    const nomination = await request(app).post(`/api/applications/${candidate.id}/scholarships`).send({ scholarshipId: 2 });
    const awardedCount = db.prepare("SELECT COUNT(*) AS count FROM scholarship_applications WHERE scholarship_id = 2 AND status = 'AWARDED'").get().count;
    db.prepare('UPDATE scholarships SET places = ? WHERE id = 2').run(Math.max(1, awardedCount));
    if (awardedCount === 0) {
      const existing = db.prepare('SELECT id FROM scholarship_applications WHERE scholarship_id = 2 AND id != ? LIMIT 1').get(nomination.body.id);
      db.prepare("UPDATE scholarship_applications SET status = 'AWARDED', awarded_amount_hkd = 30000 WHERE id = ?").run(existing.id);
    }
    const response = await request(app).patch(`/api/applications/${candidate.id}/scholarships/${nomination.body.id}`).send({ status: 'AWARDED' });
    const row = db.prepare('SELECT status, awarded_amount_hkd FROM scholarship_applications WHERE id = ?').get(nomination.body.id);

    expect(response.status).toBe(422);
    expect(response.body.message).toContain('No award places');
    expect(row).toEqual({ status: 'NOMINATED', awarded_amount_hkd: null });
  });
});

describe('managerial reports', () => {
  it('exposes all documented report definitions through the GUI API', async () => {
    const response = await request(app).get('/api/reports');

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(12);
    expect(response.body.every((report) => !Object.hasOwn(report, 'sql'))).toBe(true);
  });

  it('runs every whitelisted SQL statement without error', async () => {
    for (const report of reports) {
      const response = await request(app).get(`/api/reports/${report.id}`);
      expect(response.status, report.id).toBe(200);
      expect(Array.isArray(response.body.rows), report.id).toBe(true);
    }
  });

  it('calculates pipeline totals from the underlying application table', async () => {
    const response = await request(app).get('/api/reports/pipeline');
    const reportTotal = response.body.rows.reduce((sum, row) => sum + row.applications, 0);
    const databaseTotal = db.prepare('SELECT COUNT(*) AS count FROM applications').get().count;

    expect(reportTotal).toBe(databaseTotal);
  });

  it('reconciles programme demand, nationality mix and scholarship totals', async () => {
    const demand = await request(app).get('/api/reports/programme-demand');
    const nationalities = await request(app).get('/api/reports/nationality-mix');
    const scholarships = await request(app).get('/api/reports/scholarship-budget');
    const primaryChoiceCount = db.prepare('SELECT COUNT(*) AS count FROM application_choices WHERE preference_rank = 1').get().count;
    const committed = db.prepare('SELECT COALESCE(SUM(awarded_amount_hkd), 0) AS total FROM scholarship_applications').get().total;

    expect(demand.body.rows.reduce((sum, row) => sum + row.first_choice_demand, 0)).toBe(primaryChoiceCount);
    expect(nationalities.body.rows.reduce((sum, row) => sum + row.applicants, 0)).toBe(24);
    expect(scholarships.body.rows.reduce((sum, row) => sum + row.committed_hkd, 0)).toBe(committed);
    expect(demand.body.rows.every((row) => row.accepted <= row.offers && row.capacity > 0)).toBe(true);
  });

  it('rejects unknown report identifiers', async () => {
    const response = await request(app).get('/api/reports/not-a-report');
    expect(response.status).toBe(404);
    expect(response.body.message).toContain('not found');
  });
});

describe('production entrypoint', () => {
  it('starts successfully and serves the production SPA fallback', async () => {
    const port = 34000 + Math.floor(Math.random() * 1000);
    const child = spawn(process.execPath, ['server/index.js'], {
      cwd: process.cwd(),
      env: { ...process.env, NODE_ENV: 'production', PORT: String(port), DATABASE_PATH: ':memory:' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });

    try {
      await Promise.race([
        new Promise((resolve, reject) => {
          const check = () => output.includes('Northstar API listening') ? resolve() : setTimeout(check, 20);
          check();
          child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(output)));
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error(`Production server did not start: ${output}`)), 10_000)),
      ]);
      expect(output).toContain('Northstar API listening');
      const home = await fetch(`http://127.0.0.1:${port}/`);
      const html = await home.text();
      expect(home.status).toBe(200);
      expect(home.headers.get('content-type')).toContain('text/html');
      expect(html).toContain('<div id="root"></div>');
    } finally {
      child.kill('SIGTERM');
      if (child.exitCode === null) await once(child, 'exit');
    }
  }, 15_000);
});
