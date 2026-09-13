import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { z } from 'zod';
import { getSchemaVersion, SCHEMA_VERSION, SEED_VERSION } from './migrate.js';
import { getReport, reports, runReport } from './reports.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let sharedCatalogue = null;
try {
  sharedCatalogue = JSON.parse(fs.readFileSync(path.join(ROOT, 'model-catalogue.json'), 'utf8'));
} catch {
  // The API remains usable on a clean checkout before the generated catalogue runs.
}

const CURRENT_STAFF_ID = 2;
const statuses = ['DRAFT', 'SUBMITTED', 'SCREENING', 'REVIEW', 'INTERVIEW', 'WAITLISTED', 'OFFERED', 'ACCEPTED', 'DECLINED', 'WITHDRAWN'];
const documentTypes = ['ID', 'TRANSCRIPT', 'CV', 'PERSONAL_STATEMENT', 'REFERENCE'];

const ageCheckedDate = z.iso.date('Enter a valid birth date').refine((value) => {
  const birth = new Date(`${value}T00:00:00Z`);
  const today = new Date();
  let age = today.getUTCFullYear() - birth.getUTCFullYear();
  if (today.getUTCMonth() < birth.getUTCMonth()
    || (today.getUTCMonth() === birth.getUTCMonth() && today.getUTCDate() < birth.getUTCDate())) age -= 1;
  return age >= 16 && age <= 80;
}, 'Applicant must be between 16 and 80 years old');

const personFields = {
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  preferredName: z.string().trim().max(80).optional().default(''),
  email: z.email('Enter a valid email address').transform((value) => value.toLowerCase()),
  phone: z.string().trim().regex(/^\+?[0-9 ()-]{8,25}$/, 'Enter a valid phone number'),
  nationality: z.string().trim().min(2).max(80),
  birthDate: ageCheckedDate,
  institution: z.string().trim().min(2).max(160),
  qualification: z.string().trim().min(2).max(120),
  fieldOfStudy: z.string().trim().min(2).max(120),
  grade: z.string().trim().min(1).max(40),
  graduationYear: z.coerce.number().int().min(1950).max(2100),
};

const intakeSchema = z.object({
  ...personFields,
  cycleId: z.coerce.number().int().positive(),
  degreeLevel: z.enum(['UG', 'PG']),
  choices: z.array(z.object({
    offeringId: z.coerce.number().int().positive(),
    academicScore: z.coerce.number().min(0).max(100),
  })).min(1).max(3).refine((items) => new Set(items.map(({ offeringId }) => offeringId)).size === items.length, {
    message: 'Programme choices must be unique',
  }),
});
const profileSchema = z.object(personFields);
const programmeSchema = z.object({
  code: z.string().trim().min(3).max(20).transform((value) => value.toUpperCase()),
  name: z.string().trim().min(4).max(160),
  school: z.string().trim().min(3).max(120),
  degreeLevel: z.enum(['UG', 'PG']),
  active: z.boolean().optional(),
});
const datetimeValue = z.union([z.iso.datetime({ offset: true }), z.iso.datetime({ local: true })]);
const cycleSchema = z.object({
  cycleYear: z.coerce.number().int().min(2020).max(2100),
  name: z.string().trim().min(4).max(80),
  opensAt: datetimeValue,
  closesAt: datetimeValue,
  status: z.enum(['PLANNED', 'OPEN', 'CLOSED']),
}).refine(({ opensAt, closesAt }) => new Date(closesAt) > new Date(opensAt), {
  message: 'Closing date must be after opening date', path: ['closesAt'],
});
const offeringSchema = z.object({
  programmeId: z.coerce.number().int().positive(),
  cycleId: z.coerce.number().int().positive(),
  capacity: z.coerce.number().int().positive().max(10000),
  applicationDeadline: datetimeValue,
  active: z.boolean().optional(),
});
const requirementSchema = z.object({
  cycleId: z.coerce.number().int().positive(),
  degreeLevel: z.enum(['UG', 'PG']),
  documentType: z.enum(documentTypes),
  requiredByStatus: z.enum(['SUBMITTED', 'SCREENING', 'REVIEW', 'INTERVIEW', 'WAITLISTED', 'OFFERED']),
  active: z.boolean().optional(),
});
const staffSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.email().transform((value) => value.toLowerCase()),
  role: z.enum(['ADMIN', 'ADMISSIONS', 'REVIEWER']),
  active: z.boolean().optional(),
});
const scholarshipSchema = z.object({
  code: z.string().trim().min(3).max(30).transform((value) => value.toUpperCase()),
  name: z.string().trim().min(4).max(160),
  amountHkd: z.coerce.number().int().positive().max(10_000_000),
  minimumScore: z.coerce.number().min(0).max(100),
  places: z.coerce.number().int().positive().max(10000),
  active: z.boolean().optional(),
});
const reportQuerySchema = z.object({
  cycleId: z.coerce.number().int().positive().optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
}).refine(({ from, to }) => !from || !to || from <= to, { message: 'From date must not be after to date', path: ['to'] });

function issuesToFields(error) {
  return error.issues.reduce((fields, issue) => {
    const key = issue.path.join('.') || 'form';
    if (!Object.hasOwn(fields, key)) fields[key] = issue.message;
    return fields;
  }, {});
}

function validationError(response, parsed) {
  return response.status(422).json({ message: 'Check the highlighted fields', fields: issuesToFields(parsed.error) });
}

function parsePartial(schema, body) {
  const objectSchema = schema instanceof z.ZodObject ? schema : schema._def.in;
  return objectSchema.partial().refine((value) => Object.keys(value).length > 0, { message: 'Provide at least one field' }).safeParse(body);
}

function asInteger(value) {
  return value === undefined ? undefined : Number(value);
}

function statusLabel(status) {
  return String(status || 'unknown').toLowerCase().replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase());
}

async function defaultCycle(db) {
  return db.prepare(`
    SELECT * FROM admission_cycles
    ORDER BY CASE status WHEN 'OPEN' THEN 1 WHEN 'PLANNED' THEN 2 ELSE 3 END, cycle_year DESC
    LIMIT 1
  `).get();
}

async function resolveCycleId(db, requested) {
  if (requested !== undefined && requested !== null && String(requested).trim() !== '') return Number(requested);
  return Number((await defaultCycle(db)).id);
}

function constraintMessage(error) {
  const message = String(error?.message || '');
  const known = [
    'All required documents', 'capacity', 'status transition', 'from_status', 'reason is required',
    'assignee', 'Preference ranks', 'Choice offering', 'Scholarship award', 'overlapping interview',
    'Completed interview', 'panel member', 'between 16 and 80', 'append-only',
  ];
  return known.some((text) => message.toLowerCase().includes(text.toLowerCase())) ? message.replace(/^.*?: /, '') : null;
}

function gitCommit() {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA;
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return 'development';
  }
}

export function createApp(db) {
  const app = express();
  app.use(express.json({ limit: '200kb' }));

  app.get('/api/health', async (_request, response) => {
    await db.prepare('SELECT 1 AS connected').get();
    response.json({ status: 'ok', database: 'connected' });
  });

  app.get('/api/version', async (_request, response) => {
    const connected = (await db.prepare('SELECT 1 AS connected').get()).connected === 1;
    response.json({
      product: 'HKUST Student Admission System',
      gitCommit: gitCommit(),
      schemaVersion: await getSchemaVersion(db) || SCHEMA_VERSION,
      seedVersion: SEED_VERSION,
      database: connected ? 'connected' : 'unavailable',
    });
  });

  app.get('/api/cycles', async (_request, response) => {
    response.json(await db.prepare(`
      SELECT c.*,
        COUNT(a.id) AS application_count
      FROM admission_cycles c
      LEFT JOIN applications a ON a.cycle_id = c.id
      GROUP BY c.id
      ORDER BY c.cycle_year DESC
    `).all());
  });

  app.get('/api/dashboard', async (request, response) => {
    const cycleId = await resolveCycleId(db, request.query.cycleId);
    const currentCycle = await db.prepare('SELECT * FROM admission_cycles WHERE id = ?').get(cycleId);
    if (!currentCycle) return response.status(422).json({ message: 'Unknown admission cycle', fields: { cycleId: 'Select a valid cycle' } });
    const metrics = await db.prepare(`
      SELECT COUNT(*) AS total,
        COUNT(CASE WHEN status IN ('SUBMITTED', 'SCREENING', 'REVIEW', 'INTERVIEW', 'WAITLISTED') THEN 1 END) AS active,
        COUNT(CASE WHEN status = 'REVIEW' THEN 1 END) AS in_review,
        COUNT(CASE WHEN status IN ('OFFERED', 'ACCEPTED') THEN 1 END) AS offers,
        COUNT(CASE WHEN status = 'ACCEPTED' THEN 1 END) AS accepted,
        COUNT(CASE WHEN risk_flag <> 'NONE' THEN 1 END) AS flagged
      FROM v_application_register WHERE cycle_id = ?
    `).get(cycleId);
    const pipeline = await db.prepare(`
      SELECT status, COUNT(*) AS count FROM v_application_register
      WHERE cycle_id = ? GROUP BY status ORDER BY status
    `).all(cycleId);
    const recent = await db.prepare(`
      SELECT ar.id, ar.application_no, ar.status, ar.risk_flag, ar.last_updated,
        ar.first_name || ' ' || ar.last_name AS applicant, p.code AS programme,
        ac.academic_score, ar.assigned_name AS reviewer
      FROM v_application_register ar
      JOIN application_choices ac ON ac.application_id = ar.id AND ac.preference_rank = 1
      JOIN programme_offerings po ON po.id = ac.programme_offering_id
      JOIN programmes p ON p.id = po.programme_id
      WHERE ar.cycle_id = ? ORDER BY ar.last_updated DESC LIMIT 6
    `).all(cycleId);
    const attention = await db.prepare(`
      SELECT ar.id, ar.application_no, ar.status, ar.risk_flag,
        ar.first_name || ' ' || ar.last_name AS applicant, p.code AS programme,
        CAST(julianday('now') - julianday(ar.last_updated) AS INTEGER) AS idle_days
      FROM v_application_register ar
      JOIN application_choices ac ON ac.application_id = ar.id AND ac.preference_rank = 1
      JOIN programme_offerings po ON po.id = ac.programme_offering_id
      JOIN programmes p ON p.id = po.programme_id
      WHERE ar.cycle_id = ? AND (ar.risk_flag <> 'NONE'
        OR (ar.status IN ('SUBMITTED', 'SCREENING', 'REVIEW', 'WAITLISTED') AND julianday('now') - julianday(ar.last_updated) >= 5))
      ORDER BY CASE WHEN ar.risk_flag <> 'NONE' THEN 0 ELSE 1 END, ar.last_updated LIMIT 6
    `).all(cycleId);
    const capacity = await db.prepare(`
      SELECT code, capacity, first_choice_demand AS demand, accepted_count AS accepted, remaining_places
      FROM v_programme_capacity WHERE cycle_id = ? ORDER BY code
    `).all(cycleId);
    const yieldRate = metrics.offers ? Number((100 * metrics.accepted / metrics.offers).toFixed(1)) : 0;
    response.json({ currentCycle, metrics: { ...metrics, yieldRate }, pipeline, recent, attention, capacity });
  });

  app.get('/api/programmes', async (request, response) => {
    const cycleId = await resolveCycleId(db, request.query.cycleId);
    response.json(await db.prepare(`
      SELECT p.id, p.code, p.name, p.school, p.degree_level, p.active,
        po.id AS offeringId, po.id AS offering_id, po.cycle_id, po.capacity,
        po.application_deadline AS deadline, po.active AS offering_active,
        pc.accepted_count, pc.remaining_places
      FROM programmes p
      JOIN programme_offerings po ON po.programme_id = p.id
      JOIN v_programme_capacity pc ON pc.programme_offering_id = po.id
      WHERE po.cycle_id = ?
      ORDER BY p.degree_level, p.code
    `).all(cycleId));
  });

  app.get('/api/admin/cycles', async (_request, response) => {
    response.json(await db.prepare(`
      SELECT c.*, COUNT(a.id) AS application_count,
        (SELECT COUNT(*) FROM programme_offerings po WHERE po.cycle_id = c.id AND po.active = 1) AS active_offerings
      FROM admission_cycles c LEFT JOIN applications a ON a.cycle_id = c.id
      GROUP BY c.id ORDER BY c.cycle_year DESC
    `).all());
  });

  app.post('/api/admin/cycles', async (request, response) => {
    const parsed = cycleSchema.safeParse(request.body);
    if (!parsed.success) return validationError(response, parsed);
    const data = parsed.data;
    const result = await db.prepare(`
      INSERT INTO admission_cycles (cycle_year, name, opens_at, closes_at, status) VALUES (?, ?, ?, ?, ?)
    `).run(data.cycleYear, data.name, data.opensAt, data.closesAt, data.status);
    response.status(201).json({ id: Number(result.lastInsertRowid), message: `${data.name} created` });
  });

  app.patch('/api/admin/cycles/:id', async (request, response) => {
    const parsed = parsePartial(cycleSchema, request.body);
    if (!parsed.success) return validationError(response, parsed);
    const existing = await db.prepare('SELECT * FROM admission_cycles WHERE id = ?').get(request.params.id);
    if (!existing) return response.status(404).json({ message: 'Admission cycle not found' });
    const data = parsed.data;
    await db.prepare(`
      UPDATE admission_cycles SET cycle_year = ?, name = ?, opens_at = ?, closes_at = ?, status = ? WHERE id = ?
    `).run(data.cycleYear ?? existing.cycle_year, data.name ?? existing.name, data.opensAt ?? existing.opens_at,
      data.closesAt ?? existing.closes_at, data.status ?? existing.status, request.params.id);
    response.json({ message: `${data.name ?? existing.name} updated` });
  });

  app.get('/api/admin/programmes', async (_request, response) => {
    response.json(await db.prepare(`
      SELECT p.*,
        COUNT(DISTINCT po.id) AS offering_count,
        COUNT(DISTINCT ac.application_id) AS application_count,
        COUNT(DISTINCT ac.id) AS choice_count
      FROM programmes p
      LEFT JOIN programme_offerings po ON po.programme_id = p.id
      LEFT JOIN application_choices ac ON ac.programme_offering_id = po.id
      GROUP BY p.id ORDER BY p.degree_level, p.code
    `).all());
  });

  app.post('/api/admin/programmes', async (request, response) => {
    const parsed = programmeSchema.safeParse(request.body);
    if (!parsed.success) return validationError(response, parsed);
    const data = parsed.data;
    const result = await db.prepare(`INSERT INTO programmes (code, name, school, degree_level, active) VALUES (?, ?, ?, ?, ?)`)
      .run(data.code, data.name, data.school, data.degreeLevel, asInteger(data.active ?? true));
    response.status(201).json({ id: Number(result.lastInsertRowid), message: `${data.code} created` });
  });

  app.patch('/api/admin/programmes/:id', async (request, response) => {
    const parsed = parsePartial(programmeSchema, request.body);
    if (!parsed.success) return validationError(response, parsed);
    const existing = await db.prepare('SELECT * FROM programmes WHERE id = ?').get(request.params.id);
    if (!existing) return response.status(404).json({ message: 'Programme not found' });
    const data = parsed.data;
    await db.prepare(`UPDATE programmes SET code = ?, name = ?, school = ?, degree_level = ?, active = ? WHERE id = ?`)
      .run(data.code ?? existing.code, data.name ?? existing.name, data.school ?? existing.school,
        data.degreeLevel ?? existing.degree_level, asInteger(data.active) ?? existing.active, request.params.id);
    response.json({ message: `${data.code ?? existing.code} updated` });
  });

  app.get('/api/admin/offerings', async (request, response) => {
    const cycleId = request.query.cycleId ? Number(request.query.cycleId) : null;
    response.json(await db.prepare(`
      SELECT po.*, p.code, p.name, p.degree_level, c.cycle_year,
        pc.first_choice_demand, pc.accepted_count, pc.remaining_places
      FROM programme_offerings po
      JOIN programmes p ON p.id = po.programme_id
      JOIN admission_cycles c ON c.id = po.cycle_id
      JOIN v_programme_capacity pc ON pc.programme_offering_id = po.id
      WHERE (? IS NULL OR po.cycle_id = ?)
      ORDER BY c.cycle_year DESC, p.code
    `).all(cycleId, cycleId));
  });

  app.post('/api/admin/offerings', async (request, response) => {
    const parsed = offeringSchema.safeParse(request.body);
    if (!parsed.success) return validationError(response, parsed);
    const data = parsed.data;
    const result = await db.prepare(`
      INSERT INTO programme_offerings (programme_id, cycle_id, capacity, application_deadline, active)
      VALUES (?, ?, ?, ?, ?)
    `).run(data.programmeId, data.cycleId, data.capacity, data.applicationDeadline, asInteger(data.active ?? true));
    response.status(201).json({ id: Number(result.lastInsertRowid), message: 'Programme offering created' });
  });

  app.patch('/api/admin/offerings/:id', async (request, response) => {
    const parsed = parsePartial(offeringSchema, request.body);
    if (!parsed.success) return validationError(response, parsed);
    const existing = await db.prepare('SELECT * FROM programme_offerings WHERE id = ?').get(request.params.id);
    if (!existing) return response.status(404).json({ message: 'Programme offering not found' });
    const data = parsed.data;
    await db.prepare(`
      UPDATE programme_offerings SET programme_id = ?, cycle_id = ?, capacity = ?, application_deadline = ?, active = ? WHERE id = ?
    `).run(data.programmeId ?? existing.programme_id, data.cycleId ?? existing.cycle_id,
      data.capacity ?? existing.capacity, data.applicationDeadline ?? existing.application_deadline,
      asInteger(data.active) ?? existing.active, request.params.id);
    response.json({ message: 'Programme offering updated' });
  });

  app.get('/api/admin/document-requirements', async (request, response) => {
    const cycleId = request.query.cycleId ? Number(request.query.cycleId) : null;
    response.json(await db.prepare(`
      SELECT dr.*, c.cycle_year FROM document_requirements dr
      JOIN admission_cycles c ON c.id = dr.cycle_id
      WHERE (? IS NULL OR dr.cycle_id = ?)
      ORDER BY c.cycle_year DESC, dr.degree_level, dr.document_type
    `).all(cycleId, cycleId));
  });

  app.post('/api/admin/document-requirements', async (request, response) => {
    const parsed = requirementSchema.safeParse(request.body);
    if (!parsed.success) return validationError(response, parsed);
    const data = parsed.data;
    const result = await db.prepare(`
      INSERT INTO document_requirements (cycle_id, degree_level, document_type, required_by_status, active)
      VALUES (?, ?, ?, ?, ?)
    `).run(data.cycleId, data.degreeLevel, data.documentType, data.requiredByStatus, asInteger(data.active ?? true));
    response.status(201).json({ id: Number(result.lastInsertRowid), message: 'Document requirement created' });
  });

  app.patch('/api/admin/document-requirements/:id', async (request, response) => {
    const parsed = parsePartial(requirementSchema, request.body);
    if (!parsed.success) return validationError(response, parsed);
    const existing = await db.prepare('SELECT * FROM document_requirements WHERE id = ?').get(request.params.id);
    if (!existing) return response.status(404).json({ message: 'Document requirement not found' });
    const data = parsed.data;
    await db.prepare(`
      UPDATE document_requirements SET cycle_id = ?, degree_level = ?, document_type = ?, required_by_status = ?, active = ? WHERE id = ?
    `).run(data.cycleId ?? existing.cycle_id, data.degreeLevel ?? existing.degree_level,
      data.documentType ?? existing.document_type, data.requiredByStatus ?? existing.required_by_status,
      asInteger(data.active) ?? existing.active, request.params.id);
    response.json({ message: 'Document requirement updated' });
  });

  app.get('/api/admin/staff', async (_request, response) => {
    response.json(await db.prepare(`
      SELECT s.*,
        (SELECT COUNT(*) FROM applications a WHERE a.assigned_to = s.id) AS assigned_count,
        (SELECT COUNT(*) FROM status_history h WHERE h.changed_by = s.id) AS usage_count
      FROM staff_users s ORDER BY s.active DESC, s.role, s.name
    `).all());
  });

  app.post('/api/admin/staff', async (request, response) => {
    const parsed = staffSchema.safeParse(request.body);
    if (!parsed.success) return validationError(response, parsed);
    const data = parsed.data;
    const result = await db.prepare('INSERT INTO staff_users (name, email, role, active) VALUES (?, ?, ?, ?)')
      .run(data.name, data.email, data.role, asInteger(data.active ?? true));
    response.status(201).json({ id: Number(result.lastInsertRowid), message: `${data.name} created` });
  });

  app.patch('/api/admin/staff/:id', async (request, response) => {
    const parsed = parsePartial(staffSchema, request.body);
    if (!parsed.success) return validationError(response, parsed);
    const existing = await db.prepare('SELECT * FROM staff_users WHERE id = ?').get(request.params.id);
    if (!existing) return response.status(404).json({ message: 'Staff member not found' });
    const data = parsed.data;
    await db.prepare('UPDATE staff_users SET name = ?, email = ?, role = ?, active = ? WHERE id = ?')
      .run(data.name ?? existing.name, data.email ?? existing.email, data.role ?? existing.role,
        asInteger(data.active) ?? existing.active, request.params.id);
    response.json({ message: `${data.name ?? existing.name} updated` });
  });

  app.get('/api/admin/scholarships', async (_request, response) => {
    response.json(await db.prepare(`
      SELECT s.*, COUNT(CASE WHEN sa.status = 'AWARDED' THEN 1 END) AS awarded_count,
        s.places - COUNT(CASE WHEN sa.status = 'AWARDED' THEN 1 END) AS available_places,
        COALESCE(SUM(CASE WHEN sa.status = 'AWARDED' THEN sa.awarded_amount_hkd ELSE 0 END), 0) AS committed_hkd
      FROM scholarships s LEFT JOIN scholarship_applications sa ON sa.scholarship_id = s.id
      GROUP BY s.id ORDER BY s.active DESC, s.code
    `).all());
  });

  app.post('/api/admin/scholarships', async (request, response) => {
    const parsed = scholarshipSchema.safeParse(request.body);
    if (!parsed.success) return validationError(response, parsed);
    const data = parsed.data;
    const result = await db.prepare(`
      INSERT INTO scholarships (code, name, amount_hkd, minimum_score, places, active) VALUES (?, ?, ?, ?, ?, ?)
    `).run(data.code, data.name, data.amountHkd, data.minimumScore, data.places, asInteger(data.active ?? true));
    response.status(201).json({ id: Number(result.lastInsertRowid), message: `${data.code} created` });
  });

  app.patch('/api/admin/scholarships/:id', async (request, response) => {
    const parsed = parsePartial(scholarshipSchema, request.body);
    if (!parsed.success) return validationError(response, parsed);
    const existing = await db.prepare('SELECT * FROM scholarships WHERE id = ?').get(request.params.id);
    if (!existing) return response.status(404).json({ message: 'Scholarship not found' });
    const data = parsed.data;
    await db.prepare(`
      UPDATE scholarships SET code = ?, name = ?, amount_hkd = ?, minimum_score = ?, places = ?, active = ? WHERE id = ?
    `).run(data.code ?? existing.code, data.name ?? existing.name, data.amountHkd ?? existing.amount_hkd,
      data.minimumScore ?? existing.minimum_score, data.places ?? existing.places,
      asInteger(data.active) ?? existing.active, request.params.id);
    response.json({ message: `${data.code ?? existing.code} updated` });
  });

  app.get('/api/applicants', async (request, response) => {
    const cycleId = await resolveCycleId(db, request.query.cycleId);
    const status = String(request.query.status || '').trim().toUpperCase();
    const search = String(request.query.search || request.query.q || '').trim();
    const programme = String(request.query.programme || '').trim().toUpperCase();
    const requestedPage = Number.parseInt(String(request.query.page || '1'), 10);
    const page = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;
    const pageSize = 12;
    const parameters = { cycleId, status, search, programme };
    const total = (await db.prepare(`
      SELECT COUNT(*) AS count
      FROM v_application_register ar
      JOIN application_choices ac ON ac.application_id = ar.id AND ac.preference_rank = 1
      JOIN programme_offerings po ON po.id = ac.programme_offering_id
      JOIN programmes p ON p.id = po.programme_id
      WHERE ar.cycle_id = @cycleId
        AND (@status = '' OR ar.status = @status)
        AND (@programme = '' OR p.code = @programme)
        AND (@search = '' OR ar.application_no LIKE '%' || @search || '%'
          OR ar.first_name || ' ' || ar.last_name LIKE '%' || @search || '%'
          OR ar.email LIKE '%' || @search || '%')
    `).get(parameters)).count;
    const rows = await db.prepare(`
      SELECT ar.id, ar.application_no, ar.status, ar.risk_flag, ar.submitted_at, ar.last_updated,
        ar.applicant_id, ar.applicant_no, ar.first_name, ar.last_name, ar.email, ar.nationality,
        ar.first_name || ' ' || ar.last_name AS applicant,
        ar.assigned_to, ar.assigned_name, ar.assigned_name AS reviewer,
        p.code AS programme, p.name AS programme_name,
        ac.academic_score, wr.waitlist_rank
      FROM v_application_register ar
      JOIN application_choices ac ON ac.application_id = ar.id AND ac.preference_rank = 1
      JOIN programme_offerings po ON po.id = ac.programme_offering_id
      JOIN programmes p ON p.id = po.programme_id
      LEFT JOIN v_waitlist_ranking wr ON wr.application_id = ar.id
      WHERE ar.cycle_id = @cycleId
        AND (@status = '' OR ar.status = @status)
        AND (@programme = '' OR p.code = @programme)
        AND (@search = '' OR ar.application_no LIKE '%' || @search || '%'
          OR ar.first_name || ' ' || ar.last_name LIKE '%' || @search || '%'
          OR ar.email LIKE '%' || @search || '%')
      ORDER BY ar.last_updated DESC, ar.id DESC
      LIMIT @pageSize OFFSET @offset
    `).all({ ...parameters, pageSize, offset: (page - 1) * pageSize });
    response.json({ items: rows, total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) });
  });

  app.get('/api/applicants/:id', async (request, response) => {
    const application = await db.prepare(`
      SELECT ar.*, ap.preferred_name, ap.phone, ap.birth_date, ap.created_at
      FROM v_application_register ar JOIN applicants ap ON ap.id = ar.applicant_id
      WHERE ar.id = ?
    `).get(request.params.id);
    if (!application) return response.status(404).json({ message: 'Application not found' });
    const choices = await db.prepare(`
      SELECT ac.*, po.capacity, po.application_deadline, po.active AS offering_active,
        p.code, p.name, p.school, p.degree_level, pc.remaining_places,
        (SELECT score FROM interview_sessions i WHERE i.application_choice_id = ac.id AND i.status = 'COMPLETED'
          ORDER BY datetime(i.scheduled_at) DESC, i.id DESC LIMIT 1) AS interview_score,
        COALESCE((SELECT decision FROM v_current_decisions d WHERE d.application_choice_id = ac.id), 'PENDING') AS choice_status
      FROM application_choices ac
      JOIN programme_offerings po ON po.id = ac.programme_offering_id
      JOIN programmes p ON p.id = po.programme_id
      JOIN v_programme_capacity pc ON pc.programme_offering_id = po.id
      WHERE ac.application_id = ? ORDER BY ac.preference_rank
    `).all(request.params.id);
    const education = await db.prepare('SELECT * FROM education_records WHERE applicant_id = ? ORDER BY graduation_year DESC').all(application.applicant_id);
    const documents = await db.prepare(`
      SELECT d.*, d.reviewed_by AS verified_by, s.name AS reviewer, s.name AS verifier
      FROM documents d LEFT JOIN staff_users s ON s.id = d.reviewed_by
      WHERE d.application_id = ? ORDER BY d.document_type
    `).all(request.params.id);
    const requirements = await db.prepare(`
      SELECT dr.*, d.id AS document_id, d.file_name, d.verification_status, d.reviewed_at
      FROM document_requirements dr
      LEFT JOIN documents d ON d.application_id = ? AND d.document_type = dr.document_type
      WHERE dr.cycle_id = ? AND dr.degree_level = ? AND dr.active = 1
      ORDER BY dr.document_type
    `).all(request.params.id, application.cycle_id, application.degree_level);
    const compliance = await db.prepare('SELECT * FROM v_document_compliance WHERE application_id = ?').get(request.params.id);
    const history = await db.prepare(`
      SELECT h.*, h.reason AS note, s.name AS changed_by_name FROM status_history h
      JOIN staff_users s ON s.id = h.changed_by
      WHERE h.application_id = ? ORDER BY datetime(h.changed_at) DESC, h.id DESC
    `).all(request.params.id);
    const notes = await db.prepare(`
      SELECT n.*, s.name AS author FROM review_notes n JOIN staff_users s ON s.id = n.author_id
      WHERE n.application_id = ? ORDER BY datetime(n.created_at) DESC, n.id DESC
    `).all(request.params.id);
    const interviews = await db.prepare(`
      SELECT i.*, ac.preference_rank, p.code,
        GROUP_CONCAT(s.name || ' (' || ip.panel_role || ')', ', ') AS panel
      FROM interview_sessions i
      JOIN application_choices ac ON ac.id = i.application_choice_id
      JOIN programme_offerings po ON po.id = ac.programme_offering_id
      JOIN programmes p ON p.id = po.programme_id
      LEFT JOIN interview_panel_members ip ON ip.interview_session_id = i.id
      LEFT JOIN staff_users s ON s.id = ip.staff_user_id
      WHERE ac.application_id = ? GROUP BY i.id ORDER BY datetime(i.scheduled_at) DESC
    `).all(request.params.id);
    const currentDecision = await db.prepare(`
      SELECT d.*, p.code, s.name AS decided_by_name FROM v_current_decisions d
      JOIN application_choices ac ON ac.id = d.application_choice_id
      JOIN programme_offerings po ON po.id = ac.programme_offering_id
      JOIN programmes p ON p.id = po.programme_id
      JOIN staff_users s ON s.id = d.decided_by
      WHERE ac.application_id = ? ORDER BY ac.preference_rank LIMIT 1
    `).get(request.params.id);
    const waitlist = await db.prepare(`
      SELECT we.*, wr.waitlist_rank, wr.ranking_score, pc.remaining_places, p.code
      FROM waitlist_entries we
      JOIN application_choices ac ON ac.id = we.application_choice_id
      JOIN programme_offerings po ON po.id = ac.programme_offering_id
      JOIN programmes p ON p.id = po.programme_id
      JOIN v_programme_capacity pc ON pc.programme_offering_id = po.id
      LEFT JOIN v_waitlist_ranking wr ON wr.waitlist_entry_id = we.id
      WHERE ac.application_id = ? ORDER BY datetime(we.joined_at) DESC LIMIT 1
    `).get(request.params.id);
    const nominations = await db.prepare(`
      SELECT sa.*, s.code, s.name, s.amount_hkd, s.minimum_score, s.places, s.active
      FROM scholarship_applications sa JOIN scholarships s ON s.id = sa.scholarship_id
      WHERE sa.application_id = ? ORDER BY sa.id DESC
    `).all(request.params.id);
    const primaryScore = choices.find(({ preference_rank: rank }) => rank === 1)?.academic_score ?? 0;
    const eligibleScholarships = (await db.prepare(`
      SELECT s.*, COUNT(CASE WHEN sa.status = 'AWARDED' THEN 1 END) AS awarded_count,
        s.places - COUNT(CASE WHEN sa.status = 'AWARDED' THEN 1 END) AS available_places
      FROM scholarships s LEFT JOIN scholarship_applications sa ON sa.scholarship_id = s.id
      WHERE s.active = 1 GROUP BY s.id ORDER BY s.minimum_score DESC
    `).all()).map((scholarship) => ({
      ...scholarship,
      eligible: primaryScore >= scholarship.minimum_score && scholarship.available_places > 0,
      nominated: nominations.some(({ scholarship_id: scholarshipId }) => scholarshipId === scholarship.id),
    }));
    const activeStaff = await db.prepare(`
      SELECT id, name, email, role FROM staff_users
      WHERE active = 1 AND role IN ('ADMISSIONS', 'REVIEWER') ORDER BY role, name
    `).all();
    const transitionRules = (await db.prepare(`
      SELECT to_status, requires_reason FROM status_transitions WHERE from_status = ? ORDER BY to_status
    `).all(application.status)).map(({ to_status: status, requires_reason: requiresReason }) => ({ status, requiresReason: Boolean(requiresReason) }));
    const allowedTransitions = transitionRules.map(({ status }) => status);
    response.json({
      application, choices, education, documents, requirements, compliance, history, notes, interviews,
      currentDecision, waitlist, nominations, eligibleScholarships, activeStaff, allowedTransitions, transitionRules,
    });
  });

  app.post('/api/applicants', async (request, response) => {
    const parsed = intakeSchema.safeParse(request.body);
    if (!parsed.success) return validationError(response, parsed);
    const data = parsed.data;
    if (await db.prepare('SELECT id FROM applicants WHERE email = ?').get(data.email)) {
      return response.status(409).json({ message: 'An applicant with this email already exists', fields: { email: 'Email address is already in use' } });
    }
    const placeholders = data.choices.map(() => '?').join(',');
    const offerings = await db.prepare(`
      SELECT po.id FROM programme_offerings po JOIN programmes p ON p.id = po.programme_id
      JOIN admission_cycles c ON c.id = po.cycle_id
      WHERE po.id IN (${placeholders}) AND po.cycle_id = ? AND p.degree_level = ?
        AND po.active = 1 AND p.active = 1 AND c.status = 'OPEN'
        AND datetime(po.application_deadline) >= datetime('now')
    `).all(...data.choices.map(({ offeringId }) => offeringId), data.cycleId, data.degreeLevel);
    if (offerings.length !== data.choices.length) {
      return response.status(422).json({ message: 'One or more programme choices are unavailable', fields: { choices: 'Use active, unexpired offerings from the selected cycle and level' } });
    }
    const created = await db.runTransaction(async (transactionDb) => {
      const cycle = await transactionDb.prepare('SELECT cycle_year FROM admission_cycles WHERE id = ?').get(data.cycleId);
      const next = (await transactionDb.prepare('SELECT COALESCE(MAX(id), 0) + 1 AS value FROM applicants').get()).value;
      const suffix = String(next).padStart(3, '0');
      const applicantResult = await transactionDb.prepare(`
        INSERT INTO applicants (applicant_no, first_name, last_name, preferred_name, email, phone, nationality, birth_date)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(`A${String(cycle.cycle_year).slice(-2)}${suffix}`, data.firstName, data.lastName, data.preferredName || null,
        data.email, data.phone, data.nationality, data.birthDate);
      const applicantId = Number(applicantResult.lastInsertRowid);
      await transactionDb.prepare(`
        INSERT INTO education_records (applicant_id, institution, qualification, field_of_study, grade, graduation_year)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(applicantId, data.institution, data.qualification, data.fieldOfStudy, data.grade, data.graduationYear);
      const applicationResult = await transactionDb.prepare(`
        INSERT INTO applications (application_no, applicant_id, cycle_id, degree_level, submitted_at, assigned_to)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
      `).run(`APP-${String(cycle.cycle_year).slice(-2)}-${suffix}`, applicantId, data.cycleId, data.degreeLevel, CURRENT_STAFF_ID);
      const applicationId = Number(applicationResult.lastInsertRowid);
      const addChoice = transactionDb.prepare(`
        INSERT INTO application_choices (application_id, programme_offering_id, preference_rank, academic_score)
        VALUES (?, ?, ?, ?)
      `);
      for (const [index, choice] of data.choices.entries()) {
        await addChoice.run(applicationId, choice.offeringId, index + 1, choice.academicScore);
      }
      await transactionDb.prepare(`
        INSERT INTO status_history (application_id, from_status, to_status, changed_by, reason)
        VALUES (?, NULL, 'SUBMITTED', ?, NULL)
      `).run(applicationId, CURRENT_STAFF_ID);
      return { applicationId, applicationNo: `APP-${String(cycle.cycle_year).slice(-2)}-${suffix}` };
    });
    response.status(201).json({ ...created, message: `${created.applicationNo} created` });
  });

  app.patch('/api/applicants/:id', async (request, response) => {
    const parsed = profileSchema.safeParse(request.body);
    if (!parsed.success) return validationError(response, parsed);
    const application = await db.prepare('SELECT applicant_id FROM applications WHERE id = ?').get(request.params.id);
    if (!application) return response.status(404).json({ message: 'Application not found' });
    const data = parsed.data;
    await db.runTransaction(async (transactionDb) => {
      await transactionDb.prepare(`
        UPDATE applicants SET first_name = ?, last_name = ?, preferred_name = ?, email = ?, phone = ?, nationality = ?, birth_date = ? WHERE id = ?
      `).run(data.firstName, data.lastName, data.preferredName || null, data.email, data.phone, data.nationality, data.birthDate, application.applicant_id);
      const education = await transactionDb.prepare('SELECT id FROM education_records WHERE applicant_id = ? ORDER BY graduation_year DESC LIMIT 1').get(application.applicant_id);
      if (education) {
        await transactionDb.prepare(`UPDATE education_records SET institution = ?, qualification = ?, field_of_study = ?, grade = ?, graduation_year = ? WHERE id = ?`)
          .run(data.institution, data.qualification, data.fieldOfStudy, data.grade, data.graduationYear, education.id);
      } else {
        await transactionDb.prepare(`INSERT INTO education_records (applicant_id, institution, qualification, field_of_study, grade, graduation_year) VALUES (?, ?, ?, ?, ?, ?)`)
          .run(application.applicant_id, data.institution, data.qualification, data.fieldOfStudy, data.grade, data.graduationYear);
      }
      await transactionDb.prepare('UPDATE applications SET last_updated = CURRENT_TIMESTAMP WHERE id = ?').run(request.params.id);
    });
    response.json({ message: 'Applicant profile updated' });
  });

  app.patch('/api/applications/:id/assignment', async (request, response) => {
    const parsed = z.object({ staffId: z.coerce.number().int().positive() }).safeParse(request.body);
    if (!parsed.success) return validationError(response, parsed);
    const result = await db.prepare('UPDATE applications SET assigned_to = ?, last_updated = CURRENT_TIMESTAMP WHERE id = ?')
      .run(parsed.data.staffId, request.params.id);
    if (!result.changes) return response.status(404).json({ message: 'Application not found' });
    response.json({ message: 'Application assignment updated' });
  });

  app.patch('/api/applications/:id/status', async (request, response) => {
    const parsed = z.object({ status: z.enum(statuses), reason: z.string().trim().max(1000).optional(), note: z.string().trim().max(1000).optional() }).safeParse(request.body);
    if (!parsed.success) return validationError(response, parsed);
    const nextStatus = parsed.data.status;
    const reason = parsed.data.reason || parsed.data.note || null;
    const existing = await db.prepare(`
      SELECT a.id, cs.current_status FROM applications a
      JOIN v_application_current_status cs ON cs.application_id = a.id WHERE a.id = ?
    `).get(request.params.id);
    if (!existing) return response.status(404).json({ message: 'Application not found' });
    try {
      await db.runTransaction(async (transactionDb) => {
        const transition = await transactionDb.prepare(`
          SELECT requires_reason FROM status_transitions WHERE from_status = ? AND to_status = ?
        `).get(existing.current_status, nextStatus);
        if (!transition) {
          const error = new Error(`Cannot move from ${statusLabel(existing.current_status)} to ${statusLabel(nextStatus)}`);
          error.businessRule = true;
          throw error;
        }
        if (transition.requires_reason && (!reason || reason.length < 3)) {
          const error = new Error('Add a reason of at least 3 characters for this transition');
          error.businessRule = true;
          error.field = 'reason';
          throw error;
        }
        const choice = await transactionDb.prepare(`
          SELECT id FROM application_choices WHERE application_id = ? AND preference_rank = 1
        `).get(request.params.id);
        await transactionDb.prepare(`
          INSERT INTO status_history (application_id, from_status, to_status, changed_by, reason)
          VALUES (?, ?, ?, ?, ?)
        `).run(request.params.id, existing.current_status, nextStatus, CURRENT_STAFF_ID, reason);

        const priorDecision = await transactionDb.prepare(`
          SELECT id FROM v_current_decisions WHERE application_choice_id = ?
        `).get(choice.id);
        if (nextStatus === 'WAITLISTED') {
          await transactionDb.prepare(`
            INSERT INTO decisions (application_choice_id, decision, rationale, decided_by, supersedes_decision_id)
            VALUES (?, 'WAITLIST', ?, ?, ?)
          `).run(choice.id, reason, CURRENT_STAFF_ID, priorDecision?.id ?? null);
          await transactionDb.prepare(`
            INSERT INTO waitlist_entries (application_choice_id, status, reason) VALUES (?, 'ACTIVE', ?)
          `).run(choice.id, reason);
        }
        if (nextStatus === 'OFFERED') {
          const activeWaitlist = await transactionDb.prepare(`
            SELECT id FROM waitlist_entries WHERE application_choice_id = ? AND status = 'ACTIVE'
          `).get(choice.id);
          if (activeWaitlist) {
            await transactionDb.prepare(`
              UPDATE waitlist_entries SET status = 'CONVERTED', handled_by = ?, handled_at = CURRENT_TIMESTAMP WHERE id = ?
            `).run(CURRENT_STAFF_ID, activeWaitlist.id);
          }
          await transactionDb.prepare(`
            INSERT INTO decisions (application_choice_id, decision, rationale, decided_by, supersedes_decision_id)
            VALUES (?, 'OFFER', ?, ?, ?)
          `).run(choice.id, reason || 'Offer approved after holistic review.', CURRENT_STAFF_ID, priorDecision?.id ?? null);
        }
        if (nextStatus === 'DECLINED') {
          await transactionDb.prepare(`
            UPDATE waitlist_entries SET status = 'REMOVED', handled_by = ?, handled_at = CURRENT_TIMESTAMP
            WHERE application_choice_id = ? AND status = 'ACTIVE'
          `).run(CURRENT_STAFF_ID, choice.id);
          await transactionDb.prepare(`
            INSERT INTO decisions (application_choice_id, decision, rationale, decided_by, supersedes_decision_id)
            VALUES (?, 'REJECT', ?, ?, ?)
          `).run(choice.id, reason, CURRENT_STAFF_ID, priorDecision?.id ?? null);
        }
        if (nextStatus === 'ACCEPTED') {
          await transactionDb.prepare(`
            INSERT INTO decisions (application_choice_id, decision, rationale, decided_by, supersedes_decision_id)
            VALUES (?, 'ACCEPT', ?, ?, ?)
          `).run(choice.id, reason || 'Applicant accepted the programme offer.', CURRENT_STAFF_ID, priorDecision?.id ?? null);
        }
        if (nextStatus === 'WITHDRAWN') {
          await transactionDb.prepare(`
            UPDATE waitlist_entries SET status = 'REMOVED', handled_by = ?, handled_at = CURRENT_TIMESTAMP
            WHERE application_choice_id = ? AND status = 'ACTIVE'
          `).run(CURRENT_STAFF_ID, choice.id);
        }
        await transactionDb.prepare('UPDATE applications SET last_updated = CURRENT_TIMESTAMP WHERE id = ?').run(request.params.id);
      });
    } catch (error) {
      if (error.businessRule) return response.status(422).json({ message: error.message, fields: error.field ? { [error.field]: error.message } : undefined });
      const message = constraintMessage(error);
      if (message) return response.status(422).json({ message });
      throw error;
    }
    response.json({ message: `Application moved to ${statusLabel(nextStatus)}`, status: nextStatus });
  });

  app.post('/api/applications/:id/notes', async (request, response) => {
    const parsed = z.object({ note: z.string().trim().min(2).max(1000) }).safeParse(request.body);
    if (!parsed.success) return validationError(response, parsed);
    const result = await db.prepare('INSERT INTO review_notes (application_id, author_id, note) VALUES (?, ?, ?)')
      .run(request.params.id, CURRENT_STAFF_ID, parsed.data.note);
    response.status(201).json({ id: Number(result.lastInsertRowid), message: 'Review note added' });
  });

  app.post('/api/applications/:id/documents', async (request, response) => {
    const parsed = z.object({ documentType: z.enum(documentTypes), fileName: z.string().trim().min(3).max(255) }).safeParse(request.body);
    if (!parsed.success) return validationError(response, parsed);
    const result = await db.prepare(`
      INSERT INTO documents (application_id, document_type, file_name, verification_status)
      VALUES (?, ?, ?, 'PENDING')
    `).run(request.params.id, parsed.data.documentType, parsed.data.fileName);
    response.status(201).json({ id: Number(result.lastInsertRowid), message: 'Document registered' });
  });

  app.patch('/api/applications/:id/documents/:documentId', async (request, response) => {
    const parsed = z.object({ status: z.enum(['PENDING', 'VERIFIED', 'REJECTED']) }).safeParse(request.body);
    if (!parsed.success) return validationError(response, parsed);
    const reviewed = parsed.data.status !== 'PENDING';
    const result = await db.prepare(`
      UPDATE documents SET verification_status = ?, reviewed_by = ?, reviewed_at = ?
      WHERE id = ? AND application_id = ?
    `).run(parsed.data.status, reviewed ? CURRENT_STAFF_ID : null, reviewed ? new Date().toISOString() : null,
      request.params.documentId, request.params.id);
    if (!result.changes) return response.status(404).json({ message: 'Document not found' });
    response.json({ message: `Document marked ${parsed.data.status.toLowerCase()}` });
  });

  app.post('/api/applications/:id/interviews', async (request, response) => {
    const parsed = z.object({
      applicationChoiceId: z.coerce.number().int().positive(),
      scheduledAt: z.iso.datetime({ offset: true }),
      durationMinutes: z.coerce.number().int().min(15).max(240),
      mode: z.enum(['IN_PERSON', 'ONLINE', 'HYBRID']),
      location: z.string().trim().min(2).max(160),
      panelMemberIds: z.array(z.coerce.number().int().positive()).min(1),
      chairId: z.coerce.number().int().positive(),
    }).refine(({ panelMemberIds, chairId }) => panelMemberIds.includes(chairId), { message: 'Chair must be a panel member', path: ['chairId'] }).safeParse(request.body);
    if (!parsed.success) return validationError(response, parsed);
    const data = parsed.data;
    const choice = await db.prepare('SELECT id FROM application_choices WHERE id = ? AND application_id = ?').get(data.applicationChoiceId, request.params.id);
    if (!choice) return response.status(422).json({ message: 'Interview choice does not belong to this application', fields: { applicationChoiceId: 'Select an application choice' } });
    const id = await db.runTransaction(async (transactionDb) => {
      const result = await transactionDb.prepare(`
        INSERT INTO interview_sessions (application_choice_id, scheduled_at, duration_minutes, mode, location, status, created_by)
        VALUES (?, ?, ?, ?, ?, 'SCHEDULED', ?)
      `).run(data.applicationChoiceId, data.scheduledAt, data.durationMinutes, data.mode, data.location, CURRENT_STAFF_ID);
      const interviewId = Number(result.lastInsertRowid);
      for (const staffId of [...new Set(data.panelMemberIds)]) {
        await transactionDb.prepare(`
          INSERT INTO interview_panel_members (interview_session_id, staff_user_id, panel_role) VALUES (?, ?, ?)
        `).run(interviewId, staffId, staffId === data.chairId ? 'CHAIR' : 'MEMBER');
      }
      return interviewId;
    });
    response.status(201).json({ id, message: 'Interview scheduled' });
  });

  app.post('/api/interviews/:id/panel', async (request, response) => {
    const parsed = z.object({ staffId: z.coerce.number().int().positive(), role: z.enum(['CHAIR', 'MEMBER']) }).safeParse(request.body);
    if (!parsed.success) return validationError(response, parsed);
    await db.prepare(`INSERT INTO interview_panel_members (interview_session_id, staff_user_id, panel_role) VALUES (?, ?, ?)`)
      .run(request.params.id, parsed.data.staffId, parsed.data.role);
    response.status(201).json({ message: 'Panel member assigned' });
  });

  app.patch('/api/interviews/:id/complete', async (request, response) => {
    const parsed = z.object({ score: z.coerce.number().min(0).max(100), feedback: z.string().trim().min(5).max(2000) }).safeParse(request.body);
    if (!parsed.success) return validationError(response, parsed);
    const result = await db.prepare(`UPDATE interview_sessions SET status = 'COMPLETED', score = ?, feedback = ? WHERE id = ? AND status = 'SCHEDULED'`)
      .run(parsed.data.score, parsed.data.feedback, request.params.id);
    if (!result.changes) return response.status(404).json({ message: 'Scheduled interview not found' });
    response.json({ message: 'Interview completed' });
  });

  app.patch('/api/interviews/:id/cancel', async (request, response) => {
    const parsed = z.object({ status: z.enum(['CANCELLED', 'NO_SHOW']).default('CANCELLED') }).safeParse(request.body);
    if (!parsed.success) return validationError(response, parsed);
    const result = await db.prepare(`UPDATE interview_sessions SET status = ?, score = NULL, feedback = NULL WHERE id = ? AND status = 'SCHEDULED'`)
      .run(parsed.data.status, request.params.id);
    if (!result.changes) return response.status(404).json({ message: 'Scheduled interview not found' });
    response.json({ message: `Interview marked ${statusLabel(parsed.data.status)}` });
  });

  app.post('/api/applications/:id/scholarships', async (request, response) => {
    const parsed = z.object({ scholarshipId: z.coerce.number().int().positive() }).safeParse(request.body);
    if (!parsed.success) return validationError(response, parsed);
    const scholarship = await db.prepare('SELECT * FROM scholarships WHERE id = ? AND active = 1').get(parsed.data.scholarshipId);
    const score = await db.prepare('SELECT MAX(academic_score) AS score FROM application_choices WHERE application_id = ?').get(request.params.id);
    if (!scholarship || score.score < scholarship.minimum_score) {
      return response.status(422).json({ message: 'Applicant is not eligible for this active scholarship', fields: { scholarshipId: 'Check active status and score threshold' } });
    }
    const result = await db.prepare(`
      INSERT INTO scholarship_applications (application_id, scholarship_id, status) VALUES (?, ?, 'NOMINATED')
    `).run(request.params.id, scholarship.id);
    response.status(201).json({ id: Number(result.lastInsertRowid), message: `Nominated for ${scholarship.name}` });
  });

  app.patch('/api/applications/:id/scholarships/:nominationId', async (request, response) => {
    const parsed = z.object({ status: z.enum(['AWARDED', 'DECLINED']) }).safeParse(request.body);
    if (!parsed.success) return validationError(response, parsed);
    const nomination = await db.prepare(`
      SELECT sa.*, s.amount_hkd, s.name FROM scholarship_applications sa
      JOIN scholarships s ON s.id = sa.scholarship_id
      WHERE sa.id = ? AND sa.application_id = ? AND sa.status = 'NOMINATED'
    `).get(request.params.nominationId, request.params.id);
    if (!nomination) return response.status(404).json({ message: 'Active scholarship nomination not found' });
    await db.prepare(`
      UPDATE scholarship_applications SET status = ?, awarded_amount_hkd = ?, decided_by = ?, decided_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(parsed.data.status, parsed.data.status === 'AWARDED' ? nomination.amount_hkd : null, CURRENT_STAFF_ID, nomination.id);
    response.json({ message: `${nomination.name} ${parsed.data.status.toLowerCase()}` });
  });

  app.get('/api/reports', (_request, response) => {
    response.json(reports.map(({ sql, fixtureAssertions, ...report }) => report));
  });

  app.get('/api/reports/:id', async (request, response) => {
    const report = getReport(request.params.id);
    if (!report) return response.status(404).json({ message: 'Report not found' });
    const parsed = reportQuerySchema.safeParse(request.query);
    if (!parsed.success) return validationError(response, parsed);
    const parameters = { ...parsed.data };
    if (!parameters.cycleId) parameters.cycleId = await resolveCycleId(db);
    if (parameters.cycleId && !(await db.prepare('SELECT 1 FROM admission_cycles WHERE id = ?').get(parameters.cycleId))) {
      return response.status(422).json({ message: 'Unknown admission cycle', fields: { cycleId: 'Select a valid cycle' } });
    }
    const rows = await runReport(db, report, parameters);
    response.json({ ...report, fixtureAssertions: undefined, rows, parameters, generatedAt: new Date().toISOString() });
  });

  app.get('/api/model', async (_request, response) => {
    const objects = await db.prepare(`
      SELECT name, type, sql FROM sqlite_master
      WHERE name NOT LIKE 'sqlite_%' AND type IN ('table', 'view', 'trigger', 'index')
      ORDER BY type, name
    `).all();
    const tableNames = objects.filter(({ type, name }) => type === 'table' && name !== 'schema_migrations').map(({ name }) => name);
    const tables = await Promise.all(tableNames.map(async (name) => ({
      name,
      columns: await db.prepare(`PRAGMA table_info("${name}")`).all(),
      foreignKeys: await db.prepare(`PRAGMA foreign_key_list("${name}")`).all(),
      indexes: await db.prepare(`PRAGMA index_list("${name}")`).all(),
      rowCount: (await db.prepare(`SELECT COUNT(*) AS count FROM "${name}"`).get()).count,
    })));
    const relationships = tables.flatMap((table) => table.foreignKeys.map((foreignKey) => ({
      fromTable: table.name, fromColumn: foreignKey.from, toTable: foreignKey.table, toColumn: foreignKey.to,
    })));
    response.json({
      summary: { businessRelations: tables.length, technicalTables: 1, reports: reports.length, schemaVersion: await getSchemaVersion(db) },
      catalogue: sharedCatalogue ? { generatedAt: sharedCatalogue.generatedAt, summary: sharedCatalogue.summary } : null,
      tables,
      views: objects.filter(({ type }) => type === 'view'),
      triggers: objects.filter(({ type }) => type === 'trigger'),
      indexes: objects.filter(({ type, sql }) => type === 'index' && sql),
      migrations: await db.prepare('SELECT * FROM schema_migrations ORDER BY applied_at').all(),
      relationships,
      businessRules: [
        'Application status and decisions are append-only histories.',
        'Only legal status transitions may be inserted, and selected transitions require a reason.',
        'Required evidence must be verified before an offer or acceptance.',
        'Accepted applications and scholarship awards cannot exceed annual capacity.',
        'Application choices must share cycle and degree level with contiguous preference ranks.',
        'Completed interviews require a panel, score and feedback; panel schedules cannot overlap.',
      ],
      reports: reports.map(({ fixtureAssertions, ...report }) => ({ ...report, sql: report.sql.trim() })),
    });
  });

  app.use((error, _request, response, _next) => {
    if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
      return response.status(400).json({ message: 'Request body must contain valid JSON' });
    }
    const message = constraintMessage(error);
    if (message) return response.status(422).json({ message });
    if (String(error?.code || '').startsWith('SQLITE_CONSTRAINT') || String(error?.message || '').includes('UNIQUE constraint failed')) {
      return response.status(409).json({ message: 'A record with these unique values already exists' });
    }
    console.error(error);
    response.status(500).json({ message: 'The request could not be completed' });
  });

  return app;
}
