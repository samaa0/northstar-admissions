import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { createApp } from '../server/app.js';
import { createDatabase } from '../server/database.js';
import { reports, runReport } from '../server/reports.js';

let db;
let app;

beforeEach(() => {
  db = createDatabase(':memory:');
  app = createApp(db);
});

afterEach(() => db.close());

describe('HKUST database foundation', () => {
  it('creates 19 business relations plus technical migration metadata', async () => {
    const health = await request(app).get('/api/health');
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
    expect(health.body).toEqual({ status: 'ok', database: 'connected' });
    expect(tables).toHaveLength(20);
    expect(tables.map(({ name }) => name)).toContain('schema_migrations');
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });

  it('seeds two cycles with 24 applications each and every workflow state', () => {
    const cycles = db.prepare(`SELECT c.id, c.status, COUNT(a.id) AS applications
      FROM admission_cycles c LEFT JOIN applications a ON a.cycle_id = c.id GROUP BY c.id ORDER BY c.id`).all();
    const states = db.prepare('SELECT current_status FROM v_application_current_status GROUP BY current_status').all().map(({ current_status }) => current_status);
    expect(cycles).toEqual([{ id: 1, status: 'CLOSED', applications: 24 }, { id: 2, status: 'OPEN', applications: 24 }]);
    expect(states).toEqual(expect.arrayContaining(['DRAFT', 'SUBMITTED', 'SCREENING', 'REVIEW', 'INTERVIEW', 'WAITLISTED', 'OFFERED', 'ACCEPTED', 'DECLINED', 'WITHDRAWN']));
    for (const table of ['programme_offerings', 'document_requirements', 'interview_sessions', 'interview_panel_members', 'waitlist_entries', 'decisions', 'scholarship_applications']) {
      expect(db.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get().count, table).toBeGreaterThan(0);
    }
  });

  it('exposes the physical design and shared catalogue metadata', async () => {
    const response = await request(app).get('/api/model');
    expect(response.status).toBe(200);
    expect(response.body.summary).toMatchObject({ businessRelations: 19, technicalTables: 1, reports: 15 });
    expect(response.body.tables).toHaveLength(19);
    expect(response.body.views).toHaveLength(8);
    expect(response.body.triggers.length).toBeGreaterThanOrEqual(20);
    expect(response.body.migrations.length).toBeGreaterThanOrEqual(1);
    expect(response.body.catalogue.summary.businessRelations).toBe(19);
    expect(response.body.relationships.length).toBeGreaterThan(15);
    expect(response.body.reports.every(({ sql }) => sql.trim().length > 40)).toBe(true);
  });

  it('keeps migrations idempotent on a file-backed database', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hkust-admission-'));
    const filename = path.join(directory, 'admissions.db');
    const first = createDatabase(filename);
    const firstCount = first.prepare('SELECT COUNT(*) AS count FROM applicants').get().count;
    first.close();
    const second = createDatabase(filename);
    expect(second.prepare('SELECT COUNT(*) AS count FROM applicants').get().count).toBe(firstCount);
    expect(second.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get().count).toBeGreaterThanOrEqual(1);
    second.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
});

describe('direct database integrity rules', () => {
  it('rejects invalid identity, age, status history and immutable history writes', () => {
    expect(() => db.prepare(`INSERT INTO applicants (applicant_no, first_name, last_name, email, phone, nationality, birth_date)
      VALUES ('BAD-EMAIL', 'Bad', 'Email', 'invalid', '+852 12345678', 'HK', '2000-01-01')`).run()).toThrow();
    expect(() => db.prepare(`INSERT INTO applicants (applicant_no, first_name, last_name, email, phone, nationality, birth_date)
      VALUES ('BAD-AGE', 'Bad', 'Age', 'bad.age@example.com', '+852 12345678', 'HK', '2015-01-01')`).run()).toThrow();
    const applicationId = db.prepare('SELECT id FROM applications LIMIT 1').get().id;
    expect(() => db.prepare(`INSERT INTO status_history (application_id, from_status, to_status, changed_by, reason)
      VALUES (?, 'DRAFT', 'ACCEPTED', 2, 'skip')`).run(applicationId)).toThrow();
    expect(() => db.prepare('UPDATE status_history SET reason = ? WHERE application_id = ?').run('changed', applicationId)).toThrow();
    expect(() => db.prepare('DELETE FROM status_history WHERE application_id = ?').run(applicationId)).toThrow();
  });

  it('enforces evidence ownership and interview completion requirements', () => {
    const applicationId = db.prepare('SELECT id FROM applications WHERE id NOT IN (SELECT application_id FROM documents) LIMIT 1').get()?.id;
    if (applicationId) {
      expect(() => db.prepare(`INSERT INTO documents (application_id, document_type, file_name, verification_status, reviewed_at)
        VALUES (?, 'ID', 'id.pdf', 'VERIFIED', CURRENT_TIMESTAMP)`).run(applicationId)).toThrow();
    }
    const choiceId = db.prepare('SELECT id FROM application_choices LIMIT 1').get().id;
    expect(() => db.prepare(`INSERT INTO interview_sessions (application_choice_id, scheduled_at, duration_minutes, mode, status, created_by)
      VALUES (?, '2027-02-01T10:00:00Z', 30, 'ONLINE', 'COMPLETED', 2)`).run(choiceId)).toThrow();
  });

  it('prevents mixed-cycle choices and capacity overflow', () => {
    const applicationId = db.prepare('SELECT id FROM applications WHERE cycle_id = 2 LIMIT 1').get().id;
    const otherCycleOffering = db.prepare('SELECT id FROM programme_offerings WHERE cycle_id = 1 LIMIT 1').get().id;
    expect(() => db.prepare(`INSERT INTO application_choices (application_id, programme_offering_id, preference_rank, academic_score)
      VALUES (?, ?, 3, 88)`).run(applicationId, otherCycleOffering)).toThrow();
    const offering = db.prepare('SELECT id FROM programme_offerings LIMIT 1').get().id;
    const accepted = db.prepare(`SELECT COUNT(*) AS count FROM v_application_current_status cs
      JOIN applications a ON a.id = cs.application_id JOIN application_choices ac ON ac.application_id = a.id
      WHERE ac.programme_offering_id = ? AND cs.current_status = 'ACCEPTED'`).get(offering).count;
    expect(() => db.prepare('UPDATE programme_offerings SET capacity = ? WHERE id = ?').run(Math.max(0, accepted - 1), offering)).toThrow();
  });
});

describe('cycle-aware API and workflows', () => {
  it('returns branded version, cycles, offerings and filtered register', async () => {
    const version = await request(app).get('/api/version');
    const cycles = await request(app).get('/api/cycles');
    const offerings = await request(app).get('/api/programmes').query({ cycleId: 2 });
    const register = await request(app).get('/api/applicants').query({ cycleId: 2, status: 'WAITLISTED', page: 1 });
    expect(version.body).toMatchObject({ product: 'HKUST Student Admission System', database: 'connected', seedVersion: expect.any(String) });
    expect(cycles.body).toHaveLength(2);
    expect(offerings.body).toHaveLength(6);
    expect(offerings.body.every((row) => row.offeringId && row.capacity > 0 && row.remaining_places >= 0)).toBe(true);
    expect(register.body.items.length).toBeGreaterThan(0);
    expect(register.body.items.every((row) => row.status === 'WAITLISTED')).toBe(true);
  });

  it('returns detail with evidence, interviews, decisions and waitlist rank', async () => {
    const id = db.prepare("SELECT application_id FROM v_application_current_status WHERE current_status = 'WAITLISTED' AND application_id IN (SELECT id FROM applications WHERE cycle_id = 2) LIMIT 1").get().application_id;
    const response = await request(app).get(`/api/applicants/${id}`);
    expect(response.status).toBe(200);
    expect(response.body.application).toMatchObject({ id, cycle_id: 2, status: 'WAITLISTED' });
    expect(response.body).toHaveProperty('requirements');
    expect(response.body).toHaveProperty('compliance');
    expect(response.body).toHaveProperty('interviews');
    expect(response.body).toHaveProperty('waitlist');
    expect(response.body.waitlist.waitlist_rank).toEqual(expect.any(Number));
  });

  it('validates intake payload and writes linked records atomically', async () => {
    const offerings = await request(app).get('/api/programmes').query({ cycleId: 2 });
    const payload = {
      firstName: 'New', lastName: 'Applicant', preferredName: '', email: 'new.applicant@example.com', phone: '+852 61234567', nationality: 'Hong Kong', birthDate: '2001-02-03',
      institution: 'HKUST', qualification: 'BSc', fieldOfStudy: 'Information Systems', grade: 'A', graduationYear: 2024,
      cycleId: 2, degreeLevel: offerings.body[0].degree_level, choices: offerings.body.slice(0, 2).map((row, index) => ({ offeringId: row.offeringId, academicScore: 86 - index * 2 })),
    };
    const before = db.prepare('SELECT COUNT(*) AS count FROM applications').get().count;
    const created = await request(app).post('/api/applicants').send(payload);
    expect(created.status).toBe(201);
    expect(db.prepare('SELECT COUNT(*) AS count FROM applications').get().count).toBe(before + 1);
    expect(db.prepare('SELECT COUNT(*) AS count FROM application_choices WHERE application_id = ?').get(created.body.applicationId).count).toBe(2);
    const invalid = await request(app).post('/api/applicants').send({ ...payload, email: 'invalid', choices: [] });
    expect(invalid.status).toBe(422);
    expect(invalid.body.fields).toBeTruthy();
  });

  it('moves a case through a legal transition and appends one history row', async () => {
    const id = db.prepare("SELECT application_id FROM v_application_current_status WHERE current_status = 'REVIEW' AND application_id IN (SELECT id FROM applications WHERE cycle_id = 2) LIMIT 1").get().application_id;
    const before = db.prepare('SELECT COUNT(*) AS count FROM status_history WHERE application_id = ?').get(id).count;
    const response = await request(app).patch(`/api/applications/${id}/status`).send({ status: 'INTERVIEW' });
    expect(response.status).toBe(200);
    expect(db.prepare('SELECT COUNT(*) AS count FROM status_history WHERE application_id = ?').get(id).count).toBe(before + 1);
    const illegal = await request(app).patch(`/api/applications/${id}/status`).send({ status: 'ACCEPTED' });
    expect(illegal.status).toBe(422);
  });

  it('handles interview completion and staff panel assignment transactionally', async () => {
    const interview = db.prepare("SELECT i.id, a.id AS application_id FROM interview_sessions i JOIN application_choices ac ON ac.id = i.application_choice_id JOIN applications a ON a.id = ac.application_id WHERE i.status = 'SCHEDULED' AND a.cycle_id = 2 LIMIT 1").get();
    const completed = await request(app).patch(`/api/interviews/${interview.id}/complete`).send({ score: 91, feedback: 'Strong analytical communication.' });
    expect(completed.status).toBe(200);
    expect(db.prepare('SELECT status, score FROM interview_sessions WHERE id = ?').get(interview.id)).toMatchObject({ status: 'COMPLETED', score: 91 });
  });

  it('rejects assignment to archived staff and invalid report filters', async () => {
    const staff = await request(app).post('/api/admin/staff').send({ name: 'Inactive Reviewer', email: 'inactive@example.com', role: 'REVIEWER' });
    await request(app).patch(`/api/admin/staff/${staff.body.id}`).send({ active: false });
    const applicationId = db.prepare('SELECT id FROM applications WHERE cycle_id = 2 LIMIT 1').get().id;
    expect((await request(app).patch(`/api/applications/${applicationId}/assignment`).send({ staffId: staff.body.id })).status).toBe(422);
    expect((await request(app).get('/api/reports/pipeline').query({ cycleId: 'invalid' })).status).toBe(422);
    expect((await request(app).get('/api/reports/pipeline').query({ cycleId: 2, from: '2027-03-01', to: '2027-01-01' })).status).toBe(422);
  });
});

describe('managerial SQL catalogue', () => {
  it('runs all 15 reports with independent cycle parameters', async () => {
    expect(reports).toHaveLength(15);
    for (const report of reports) {
      const rows = await runReport(db, report, { cycleId: 2, from: '2027-01-01', to: '2027-12-31' });
      expect(rows, report.id).toBeInstanceOf(Array);
      const response = await request(app).get(`/api/reports/${report.id}`).query({ cycleId: 2 });
      expect(response.status, report.id).toBe(200);
      expect(response.body.parameters.cycleId).toBe(2);
    }
  });

  it('reconciles core report totals to database views', async () => {
    const pipeline = await request(app).get('/api/reports/pipeline').query({ cycleId: 2 });
    const total = db.prepare('SELECT COUNT(*) AS count FROM applications WHERE cycle_id = 2').get().count;
    expect(pipeline.body.rows.reduce((sum, row) => sum + row.applications, 0)).toBe(total);
    const waitlist = await request(app).get('/api/reports/waitlist-pressure').query({ cycleId: 2 });
    expect(waitlist.body.rows.every((row) => row.active_waitlist >= 0 && row.remaining_places >= 0)).toBe(true);
  });
});
