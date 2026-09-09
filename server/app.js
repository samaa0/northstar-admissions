import express from 'express';
import { z } from 'zod';
import { getReport, reports } from './reports.js';

const intakeSchema = z.object({
  firstName: z.string().trim().min(2, 'Enter at least 2 characters').max(60),
  lastName: z.string().trim().min(2, 'Enter at least 2 characters').max(60),
  preferredName: z.string().trim().max(60).optional().default(''),
  email: z.email('Enter a valid email address').transform((value) => value.toLowerCase()),
  phone: z.string().trim().regex(/^\+?[0-9 ()-]{8,20}$/, 'Enter a valid phone number'),
  nationality: z.string().trim().min(2, 'Select or enter a nationality').max(80),
  birthDate: z.iso.date('Enter a valid birth date').refine((value) => {
    const birth = new Date(`${value}T00:00:00Z`);
    const today = new Date();
    let age = today.getUTCFullYear() - birth.getUTCFullYear();
    const birthdayHasPassed = today.getUTCMonth() > birth.getUTCMonth()
      || (today.getUTCMonth() === birth.getUTCMonth() && today.getUTCDate() >= birth.getUTCDate());
    if (!birthdayHasPassed) age -= 1;
    return age >= 16 && age <= 80;
  }, 'Applicant must be between 16 and 80 years old'),
  institution: z.string().trim().min(2, 'Enter the institution name').max(120),
  qualification: z.string().trim().min(2, 'Enter the qualification').max(100),
  fieldOfStudy: z.string().trim().min(2, 'Enter the field of study').max(100),
  grade: z.string().trim().min(1, 'Enter the latest grade').max(30),
  graduationYear: z.coerce.number().int().min(1950).max(2100),
  choices: z.array(z.object({
    programmeId: z.coerce.number().int().positive(),
    academicScore: z.coerce.number().min(0).max(100),
  })).min(1, 'Choose at least one programme').max(3, 'Choose no more than three programmes')
    .refine((items) => new Set(items.map((item) => item.programmeId)).size === items.length, {
      message: 'Programme choices must be unique',
    }),
});

const profileSchema = z.object({
  firstName: z.string().trim().min(2, 'Enter at least 2 characters').max(60),
  lastName: z.string().trim().min(2, 'Enter at least 2 characters').max(60),
  preferredName: z.string().trim().max(60).optional().default(''),
  email: z.email('Enter a valid email address').transform((value) => value.toLowerCase()),
  phone: z.string().trim().regex(/^\+?[0-9 ()-]{8,20}$/, 'Enter a valid phone number'),
  nationality: z.string().trim().min(2, 'Enter a nationality').max(80),
  birthDate: z.iso.date('Enter a valid birth date'),
  institution: z.string().trim().min(2, 'Enter the institution name').max(120),
  qualification: z.string().trim().min(2, 'Enter the qualification').max(100),
  fieldOfStudy: z.string().trim().min(2, 'Enter the field of study').max(100),
  grade: z.string().trim().min(1, 'Enter the latest grade').max(30),
  graduationYear: z.coerce.number().int().min(1950).max(2100),
});

const programmeSchema = z.object({
  code: z.string().trim().min(2).max(20).transform((value) => value.toUpperCase()),
  name: z.string().trim().min(3).max(120),
  school: z.string().trim().min(3).max(120),
  degreeLevel: z.enum(['UG', 'PG']),
  capacity: z.coerce.number().int().positive().max(10000),
  deadline: z.iso.date('Enter a valid deadline'),
  active: z.boolean().optional(),
});

const staffSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.email('Enter a valid email address').transform((value) => value.toLowerCase()),
  role: z.enum(['ADMIN', 'ADMISSIONS', 'REVIEWER']),
  active: z.boolean().optional(),
});

const scholarshipSchema = z.object({
  code: z.string().trim().min(2).max(20).transform((value) => value.toUpperCase()),
  name: z.string().trim().min(3).max(120),
  amountHkd: z.coerce.number().int().positive().max(10000000),
  minimumScore: z.coerce.number().min(0).max(100),
  places: z.coerce.number().int().positive().max(10000),
  active: z.boolean().optional(),
});

const documentSchema = z.object({
  documentType: z.enum(['ID', 'TRANSCRIPT', 'CV', 'PERSONAL_STATEMENT', 'REFERENCE']),
  fileName: z.string().trim().min(3, 'Enter a file name').max(180),
});

const documentStatusSchema = z.object({
  status: z.enum(['PENDING', 'VERIFIED', 'REJECTED']),
});

const assignmentSchema = z.object({
  staffId: z.coerce.number().int().positive(),
});

const nominationSchema = z.object({
  scholarshipId: z.coerce.number().int().positive(),
});

const nominationStatusSchema = z.object({
  status: z.enum(['AWARDED', 'DECLINED']),
});

const transitions = {
  DRAFT: ['SUBMITTED', 'WITHDRAWN'],
  SUBMITTED: ['SCREENING', 'WITHDRAWN'],
  SCREENING: ['REVIEW', 'WITHDRAWN'],
  REVIEW: ['INTERVIEW', 'OFFERED', 'DECLINED', 'WITHDRAWN'],
  INTERVIEW: ['OFFERED', 'DECLINED', 'WITHDRAWN'],
  OFFERED: ['ACCEPTED', 'DECLINED', 'WITHDRAWN'],
  ACCEPTED: [],
  DECLINED: [],
  WITHDRAWN: [],
};

const CURRENT_STAFF_ID = 1;

function issuesToFields(error) {
  return error.issues.reduce((fields, issue) => {
    const field = issue.path.join('.') || 'form';
    if (!Object.hasOwn(fields, field)) fields[field] = issue.message;
    return fields;
  }, {});
}

function statusLabel(status) {
  return status.charAt(0) + status.slice(1).toLowerCase();
}

function validationError(response, parsed) {
  return response.status(422).json({ message: 'Check the highlighted fields', fields: issuesToFields(parsed.error) });
}

function parsePartial(schema, body) {
  return schema.partial().refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field',
  }).safeParse(body);
}

function booleanToInteger(value) {
  return value === undefined ? undefined : Number(value);
}

async function reconcileDocumentRisk(db, applicationId) {
  const outstanding = (await db.prepare(`
    SELECT COUNT(*) AS count
    FROM documents
    WHERE application_id = ? AND verification_status != 'VERIFIED'
  `).get(applicationId)).count;
  const documentCount = (await db.prepare('SELECT COUNT(*) AS count FROM documents WHERE application_id = ?').get(applicationId)).count;
  const risk = outstanding === 0 && documentCount >= 3 ? 'NONE' : 'MISSING_DOCS';
  await db.prepare(`
    UPDATE applications
    SET risk_flag = CASE WHEN risk_flag IN ('DEADLINE', 'DUPLICATE') THEN risk_flag ELSE ? END,
      last_updated = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(risk, applicationId);
}

export function createApp(db) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', async (_request, response) => {
    await db.prepare('SELECT COUNT(*) AS table_count FROM sqlite_master WHERE type = ?').get('table');
    response.json({ status: 'ok', database: 'connected' });
  });

  app.get('/api/dashboard', async (_request, response) => {
    const metrics = await db.prepare(`
      SELECT
        COUNT(*) AS total,
        COUNT(CASE WHEN status IN ('SUBMITTED', 'SCREENING', 'REVIEW', 'INTERVIEW') THEN 1 END) AS active,
        COUNT(CASE WHEN status = 'REVIEW' THEN 1 END) AS in_review,
        COUNT(CASE WHEN status IN ('OFFERED', 'ACCEPTED') THEN 1 END) AS offers,
        COUNT(CASE WHEN status = 'ACCEPTED' THEN 1 END) AS accepted,
        COUNT(CASE WHEN risk_flag != 'NONE' THEN 1 END) AS flagged
      FROM applications
    `).get();
    const pipeline = await db.prepare(`
      SELECT status, COUNT(*) AS count
      FROM applications
      WHERE status != 'DRAFT'
      GROUP BY status
      ORDER BY CASE status
        WHEN 'SUBMITTED' THEN 1 WHEN 'SCREENING' THEN 2 WHEN 'REVIEW' THEN 3
        WHEN 'INTERVIEW' THEN 4 WHEN 'OFFERED' THEN 5 WHEN 'ACCEPTED' THEN 6
        WHEN 'DECLINED' THEN 7 WHEN 'WITHDRAWN' THEN 8 END
    `).all();
    const recent = await db.prepare(`
      SELECT a.id, a.application_no, a.status, a.risk_flag, a.last_updated,
        ap.applicant_no, ap.first_name || ' ' || ap.last_name AS applicant,
        p.code AS programme, ac.academic_score, s.name AS reviewer
      FROM applications a
      JOIN applicants ap ON ap.id = a.applicant_id
      JOIN application_choices ac ON ac.application_id = a.id AND ac.preference_rank = 1
      JOIN programmes p ON p.id = ac.programme_id
      LEFT JOIN staff_users s ON s.id = a.assigned_to
      ORDER BY a.last_updated DESC
      LIMIT 8
    `).all();
    const attention = await db.prepare(`
      SELECT a.id, a.application_no, ap.first_name || ' ' || ap.last_name AS applicant,
        a.status, a.risk_flag, p.code AS programme,
        ROUND(julianday('now') - julianday(a.last_updated)) AS idle_days
      FROM applications a
      JOIN applicants ap ON ap.id = a.applicant_id
      JOIN application_choices ac ON ac.application_id = a.id AND ac.preference_rank = 1
      JOIN programmes p ON p.id = ac.programme_id
      WHERE a.risk_flag != 'NONE'
        OR (a.status IN ('SUBMITTED', 'SCREENING', 'REVIEW') AND julianday('now') - julianday(a.last_updated) >= 5)
      ORDER BY CASE WHEN a.risk_flag != 'NONE' THEN 0 ELSE 1 END, a.last_updated
      LIMIT 5
    `).all();
    const capacity = await db.prepare(`
      SELECT p.code, p.capacity,
        COUNT(CASE WHEN a.status = 'ACCEPTED' THEN 1 END) AS accepted,
        COUNT(ac.id) AS demand
      FROM programmes p
      LEFT JOIN application_choices ac ON ac.programme_id = p.id AND ac.preference_rank = 1
      LEFT JOIN applications a ON a.id = ac.application_id
      WHERE p.active = 1
      GROUP BY p.id
      ORDER BY demand DESC
    `).all();
    const yieldRate = metrics.offers ? Math.round((metrics.accepted / metrics.offers) * 100) : 0;
    response.json({ metrics: { ...metrics, yieldRate }, pipeline, recent, attention, capacity });
  });

  app.get('/api/programmes', async (_request, response) => {
    response.json(await db.prepare(`
      SELECT id, code, name, school, degree_level, capacity, deadline
      FROM programmes WHERE active = 1 ORDER BY degree_level, code
    `).all());
  });

  app.get('/api/admin/programmes', async (_request, response) => {
    response.json(await db.prepare(`
      SELECT p.id, p.code, p.name, p.school, p.degree_level, p.capacity, p.deadline, p.active,
        COUNT(ac.id) AS usage_count,
        COUNT(CASE WHEN ac.preference_rank = 1 THEN 1 END) AS primary_choice_count
      FROM programmes p
      LEFT JOIN application_choices ac ON ac.programme_id = p.id
      GROUP BY p.id
      ORDER BY p.active DESC, p.degree_level, p.code
    `).all());
  });

  app.post('/api/admin/programmes', async (request, response) => {
    const parsed = programmeSchema.safeParse(request.body);
    if (!parsed.success) return validationError(response, parsed);
    const data = parsed.data;
    if (await db.prepare('SELECT id FROM programmes WHERE code = ?').get(data.code)) {
      return response.status(409).json({ message: 'Programme code already exists', fields: { code: 'Use a unique programme code' } });
    }
    const result = await db.prepare(`
      INSERT INTO programmes (code, name, school, degree_level, capacity, deadline, active)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(data.code, data.name, data.school, data.degreeLevel, data.capacity, data.deadline, booleanToInteger(data.active ?? true));
    response.status(201).json({ id: Number(result.lastInsertRowid), message: `${data.code} created` });
  });

  app.patch('/api/admin/programmes/:id', async (request, response) => {
    const parsed = parsePartial(programmeSchema, request.body);
    if (!parsed.success) return validationError(response, parsed);
    const existing = await db.prepare('SELECT * FROM programmes WHERE id = ?').get(request.params.id);
    if (!existing) return response.status(404).json({ message: 'Programme not found' });
    const data = parsed.data;
    if (data.code && await db.prepare('SELECT id FROM programmes WHERE code = ? AND id != ?').get(data.code, request.params.id)) {
      return response.status(409).json({ message: 'Programme code already exists', fields: { code: 'Use a unique programme code' } });
    }
    const fields = {
      code: data.code,
      name: data.name,
      school: data.school,
      degree_level: data.degreeLevel,
      capacity: data.capacity,
      deadline: data.deadline,
      active: booleanToInteger(data.active),
    };
    const updates = Object.entries(fields).filter(([, value]) => value !== undefined);
    await db.prepare(`UPDATE programmes SET ${updates.map(([field]) => `${field} = ?`).join(', ')} WHERE id = ?`)
      .run(...updates.map(([, value]) => value), request.params.id);
    response.json({ message: data.active === false ? `${existing.code} archived` : `${data.code || existing.code} updated` });
  });

  app.get('/api/admin/staff', async (_request, response) => {
    response.json(await db.prepare(`
      SELECT s.id, s.name, s.email, s.role, s.active,
        (SELECT COUNT(*) FROM applications a WHERE a.assigned_to = s.id)
        + (SELECT COUNT(*) FROM review_notes n WHERE n.author_id = s.id)
        + (SELECT COUNT(*) FROM status_history h WHERE h.changed_by = s.id)
        + (SELECT COUNT(*) FROM decisions d WHERE d.decided_by = s.id) AS usage_count,
        (SELECT COUNT(*) FROM applications a WHERE a.assigned_to = s.id) AS assigned_count
      FROM staff_users s
      ORDER BY s.active DESC, s.name
    `).all());
  });

  app.post('/api/admin/staff', async (request, response) => {
    const parsed = staffSchema.safeParse(request.body);
    if (!parsed.success) return validationError(response, parsed);
    const data = parsed.data;
    if (await db.prepare('SELECT id FROM staff_users WHERE email = ?').get(data.email)) {
      return response.status(409).json({ message: 'Staff email already exists', fields: { email: 'Use a unique email address' } });
    }
    const result = await db.prepare('INSERT INTO staff_users (name, email, role, active) VALUES (?, ?, ?, ?)')
      .run(data.name, data.email, data.role, booleanToInteger(data.active ?? true));
    response.status(201).json({ id: Number(result.lastInsertRowid), message: `${data.name} created` });
  });

  app.patch('/api/admin/staff/:id', async (request, response) => {
    const parsed = parsePartial(staffSchema, request.body);
    if (!parsed.success) return validationError(response, parsed);
    const existing = await db.prepare('SELECT * FROM staff_users WHERE id = ?').get(request.params.id);
    if (!existing) return response.status(404).json({ message: 'Staff member not found' });
    const data = parsed.data;
    if (data.email && await db.prepare('SELECT id FROM staff_users WHERE email = ? AND id != ?').get(data.email, request.params.id)) {
      return response.status(409).json({ message: 'Staff email already exists', fields: { email: 'Use a unique email address' } });
    }
    const fields = { name: data.name, email: data.email, role: data.role, active: booleanToInteger(data.active) };
    const updates = Object.entries(fields).filter(([, value]) => value !== undefined);
    await db.prepare(`UPDATE staff_users SET ${updates.map(([field]) => `${field} = ?`).join(', ')} WHERE id = ?`)
      .run(...updates.map(([, value]) => value), request.params.id);
    response.json({ message: data.active === false ? `${existing.name} archived` : `${data.name || existing.name} updated` });
  });

  app.get('/api/admin/scholarships', async (_request, response) => {
    response.json(await db.prepare(`
      SELECT s.id, s.code, s.name, s.amount_hkd, s.minimum_score, s.places, s.active,
        COUNT(sa.id) AS usage_count,
        COUNT(CASE WHEN sa.status = 'AWARDED' THEN 1 END) AS awarded_count,
        COALESCE(SUM(CASE WHEN sa.status = 'AWARDED' THEN sa.awarded_amount_hkd ELSE 0 END), 0) AS committed_hkd
      FROM scholarships s
      LEFT JOIN scholarship_applications sa ON sa.scholarship_id = s.id
      GROUP BY s.id
      ORDER BY s.active DESC, s.code
    `).all());
  });

  app.post('/api/admin/scholarships', async (request, response) => {
    const parsed = scholarshipSchema.safeParse(request.body);
    if (!parsed.success) return validationError(response, parsed);
    const data = parsed.data;
    if (await db.prepare('SELECT id FROM scholarships WHERE code = ?').get(data.code)) {
      return response.status(409).json({ message: 'Scholarship code already exists', fields: { code: 'Use a unique scholarship code' } });
    }
    const result = await db.prepare(`
      INSERT INTO scholarships (code, name, amount_hkd, minimum_score, places, active)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(data.code, data.name, data.amountHkd, data.minimumScore, data.places, booleanToInteger(data.active ?? true));
    response.status(201).json({ id: Number(result.lastInsertRowid), message: `${data.code} created` });
  });

  app.patch('/api/admin/scholarships/:id', async (request, response) => {
    const parsed = parsePartial(scholarshipSchema, request.body);
    if (!parsed.success) return validationError(response, parsed);
    const existing = await db.prepare('SELECT * FROM scholarships WHERE id = ?').get(request.params.id);
    if (!existing) return response.status(404).json({ message: 'Scholarship not found' });
    const data = parsed.data;
    if (data.code && await db.prepare('SELECT id FROM scholarships WHERE code = ? AND id != ?').get(data.code, request.params.id)) {
      return response.status(409).json({ message: 'Scholarship code already exists', fields: { code: 'Use a unique scholarship code' } });
    }
    const fields = {
      code: data.code,
      name: data.name,
      amount_hkd: data.amountHkd,
      minimum_score: data.minimumScore,
      places: data.places,
      active: booleanToInteger(data.active),
    };
    const updates = Object.entries(fields).filter(([, value]) => value !== undefined);
    await db.prepare(`UPDATE scholarships SET ${updates.map(([field]) => `${field} = ?`).join(', ')} WHERE id = ?`)
      .run(...updates.map(([, value]) => value), request.params.id);
    response.json({ message: data.active === false ? `${existing.code} archived` : `${data.code || existing.code} updated` });
  });

  app.get('/api/applicants', async (request, response) => {
    const search = String(request.query.q || '').trim();
    const status = String(request.query.status || '').trim().toUpperCase();
    const programme = String(request.query.programme || '').trim().toUpperCase();
    const requestedPage = Number(request.query.page);
    const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
    const pageSize = 12;
    const clauses = [];
    const parameters = {};
    if (search) {
      clauses.push(`(ap.first_name || ' ' || ap.last_name LIKE @search OR ap.email LIKE @search OR a.application_no LIKE @search OR ap.applicant_no LIKE @search)`);
      parameters.search = `%${search}%`;
    }
    if (status && transitions[status]) {
      clauses.push('a.status = @status');
      parameters.status = status;
    }
    if (programme) {
      clauses.push('p.code = @programme');
      parameters.programme = programme;
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const total = (await db.prepare(`
      SELECT COUNT(*) AS count
      FROM applications a
      JOIN applicants ap ON ap.id = a.applicant_id
      JOIN application_choices ac ON ac.application_id = a.id AND ac.preference_rank = 1
      JOIN programmes p ON p.id = ac.programme_id
      ${where}
    `).get(parameters)).count;
    const items = await db.prepare(`
      SELECT a.id, a.application_no, a.status, a.risk_flag, a.submitted_at, a.last_updated,
        ap.id AS applicant_id, ap.applicant_no, ap.first_name || ' ' || ap.last_name AS applicant,
        ap.email, ap.nationality, p.code AS programme, p.name AS programme_name,
        ac.academic_score, s.name AS reviewer
      FROM applications a
      JOIN applicants ap ON ap.id = a.applicant_id
      JOIN application_choices ac ON ac.application_id = a.id AND ac.preference_rank = 1
      JOIN programmes p ON p.id = ac.programme_id
      LEFT JOIN staff_users s ON s.id = a.assigned_to
      ${where}
      ORDER BY a.last_updated DESC, a.application_no
      LIMIT @limit OFFSET @offset
    `).all({ ...parameters, limit: pageSize, offset: (page - 1) * pageSize });
    response.json({ items, total, page, pages: Math.max(1, Math.ceil(total / pageSize)) });
  });

  app.get('/api/applicants/:id', async (request, response) => {
    const application = await db.prepare(`
      SELECT a.*, ap.applicant_no, ap.first_name, ap.last_name, ap.preferred_name,
        ap.email, ap.phone, ap.nationality, ap.birth_date, s.name AS reviewer
      FROM applications a
      JOIN applicants ap ON ap.id = a.applicant_id
      LEFT JOIN staff_users s ON s.id = a.assigned_to
      WHERE a.id = ?
    `).get(request.params.id);
    if (!application) return response.status(404).json({ message: 'Application not found' });
    const choices = await db.prepare(`
      SELECT ac.*, p.code, p.name, p.school
      FROM application_choices ac JOIN programmes p ON p.id = ac.programme_id
      WHERE ac.application_id = ? ORDER BY ac.preference_rank
    `).all(request.params.id);
    const education = await db.prepare('SELECT * FROM education_records WHERE applicant_id = ? ORDER BY graduation_year DESC').all(application.applicant_id);
    const documents = await db.prepare(`
      SELECT d.*, s.name AS verifier
      FROM documents d LEFT JOIN staff_users s ON s.id = d.verified_by
      WHERE d.application_id = ? ORDER BY d.document_type
    `).all(request.params.id);
    const history = await db.prepare(`
      SELECT h.*, s.name AS changed_by_name
      FROM status_history h JOIN staff_users s ON s.id = h.changed_by
      WHERE h.application_id = ? ORDER BY h.changed_at DESC, h.id DESC
    `).all(request.params.id);
    const notes = await db.prepare(`
      SELECT n.*, s.name AS author
      FROM review_notes n JOIN staff_users s ON s.id = n.author_id
      WHERE n.application_id = ? ORDER BY n.created_at DESC, n.id DESC
    `).all(request.params.id);
    const nominations = await db.prepare(`
      SELECT sa.id, sa.status, sa.awarded_amount_hkd, sa.scholarship_id,
        s.code, s.name, s.amount_hkd, s.minimum_score, s.places, s.active
      FROM scholarship_applications sa
      JOIN scholarships s ON s.id = sa.scholarship_id
      WHERE sa.application_id = ?
      ORDER BY sa.id DESC
    `).all(request.params.id);
    const primaryScore = choices.find(({ preference_rank: rank }) => rank === 1)?.academic_score ?? 0;
    const eligibleScholarships = (await db.prepare(`
      SELECT s.id, s.code, s.name, s.amount_hkd, s.minimum_score, s.places,
        COUNT(CASE WHEN sa.status = 'AWARDED' THEN 1 END) AS awarded_count,
        s.places - COUNT(CASE WHEN sa.status = 'AWARDED' THEN 1 END) AS available_places
      FROM scholarships s
      LEFT JOIN scholarship_applications sa ON sa.scholarship_id = s.id
      WHERE s.active = 1
      GROUP BY s.id
      ORDER BY s.minimum_score DESC, s.code
    `).all()).map((scholarship) => ({
      ...scholarship,
      eligible: primaryScore >= scholarship.minimum_score && scholarship.available_places > 0,
      nominated: nominations.some(({ scholarship_id: scholarshipId }) => scholarshipId === scholarship.id),
    }));
    const activeStaff = await db.prepare(`
      SELECT id, name, email, role
      FROM staff_users
      WHERE active = 1 AND role IN ('ADMISSIONS', 'REVIEWER')
      ORDER BY role, name
    `).all();
    response.json({
      application,
      choices,
      education,
      documents,
      history,
      notes,
      nominations,
      eligibleScholarships,
      activeStaff,
      allowedTransitions: transitions[application.status],
    });
  });

  app.post('/api/applicants', async (request, response) => {
    const parsed = intakeSchema.safeParse(request.body);
    if (!parsed.success) {
      return response.status(422).json({ message: 'Check the highlighted fields', fields: issuesToFields(parsed.error) });
    }
    const data = parsed.data;
    const existing = await db.prepare('SELECT id FROM applicants WHERE email = ?').get(data.email);
    if (existing) {
      return response.status(409).json({ message: 'An applicant with this email already exists', fields: { email: 'Email address is already in use' } });
    }
    const validProgrammes = await db.prepare(`SELECT id FROM programmes WHERE active = 1 AND id IN (${data.choices.map(() => '?').join(',')})`).all(...data.choices.map((choice) => choice.programmeId));
    if (validProgrammes.length !== data.choices.length) {
      return response.status(422).json({ message: 'One or more programme choices are unavailable', fields: { choices: 'Select active programmes only' } });
    }

    const created = await db.runTransaction(async (transactionDb) => {
      const sequence = (await transactionDb.prepare('SELECT COALESCE(MAX(id), 0) + 1 AS next FROM applicants').get()).next;
      const number = String(sequence).padStart(3, '0');
      const applicantResult = await transactionDb.prepare(`
        INSERT INTO applicants
          (applicant_no, first_name, last_name, preferred_name, email, phone, nationality, birth_date)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(`A27${number}`, data.firstName, data.lastName, data.preferredName || null, data.email, data.phone, data.nationality, data.birthDate);
      const applicantId = Number(applicantResult.lastInsertRowid);
      await transactionDb.prepare(`
        INSERT INTO education_records
          (applicant_id, institution, qualification, field_of_study, grade, graduation_year)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(applicantId, data.institution, data.qualification, data.fieldOfStudy, data.grade, data.graduationYear);
      const applicationResult = await transactionDb.prepare(`
        INSERT INTO applications
          (application_no, applicant_id, intake_year, submitted_at, status, risk_flag, assigned_to)
        VALUES (?, ?, 2027, CURRENT_TIMESTAMP, 'SUBMITTED', 'MISSING_DOCS', 2)
      `).run(`APP-27-${number}`, applicantId);
      const applicationId = Number(applicationResult.lastInsertRowid);
      const addChoice = transactionDb.prepare(`
        INSERT INTO application_choices
          (application_id, programme_id, preference_rank, academic_score)
        VALUES (?, ?, ?, ?)
      `);
      for (const [index, choice] of data.choices.entries()) {
        await addChoice.run(applicationId, choice.programmeId, index + 1, choice.academicScore);
      }
      await transactionDb.prepare(`
        INSERT INTO status_history (application_id, from_status, to_status, changed_by, note)
        VALUES (?, NULL, 'SUBMITTED', 2, 'Application created through intake form')
      `).run(applicationId);
      return { applicationId, applicationNo: `APP-27-${number}` };
    });

    response.status(201).json({ ...created, message: `${created.applicationNo} created` });
  });

  app.patch('/api/applicants/:id', async (request, response) => {
    const parsed = profileSchema.safeParse(request.body);
    if (!parsed.success) return validationError(response, parsed);
    const applicant = await db.prepare('SELECT * FROM applicants WHERE id = ?').get(request.params.id);
    if (!applicant) return response.status(404).json({ message: 'Applicant not found' });
    const data = parsed.data;
    if (await db.prepare('SELECT id FROM applicants WHERE email = ? AND id != ?').get(data.email, request.params.id)) {
      return response.status(409).json({ message: 'Applicant email already exists', fields: { email: 'Email address is already in use' } });
    }
    await db.runTransaction(async (transactionDb) => {
      await transactionDb.prepare(`
        UPDATE applicants
        SET first_name = ?, last_name = ?, preferred_name = ?, email = ?, phone = ?, nationality = ?, birth_date = ?
        WHERE id = ?
      `).run(
        data.firstName,
        data.lastName,
        data.preferredName || null,
        data.email,
        data.phone,
        data.nationality,
        data.birthDate,
        request.params.id,
      );
      const education = await transactionDb.prepare(`
        SELECT id FROM education_records
        WHERE applicant_id = ?
        ORDER BY graduation_year DESC, id DESC
        LIMIT 1
      `).get(request.params.id);
      if (education) {
        await transactionDb.prepare(`
          UPDATE education_records
          SET institution = ?, qualification = ?, field_of_study = ?, grade = ?, graduation_year = ?
          WHERE id = ?
        `).run(data.institution, data.qualification, data.fieldOfStudy, data.grade, data.graduationYear, education.id);
      } else {
        await transactionDb.prepare(`
          INSERT INTO education_records (applicant_id, institution, qualification, field_of_study, grade, graduation_year)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(request.params.id, data.institution, data.qualification, data.fieldOfStudy, data.grade, data.graduationYear);
      }
      await transactionDb.prepare('UPDATE applications SET last_updated = CURRENT_TIMESTAMP WHERE applicant_id = ?').run(request.params.id);
    });
    response.json({ message: `${applicant.applicant_no} profile updated` });
  });

  app.patch('/api/applications/:id/assignment', async (request, response) => {
    const parsed = assignmentSchema.safeParse(request.body);
    if (!parsed.success) return validationError(response, parsed);
    const application = await db.prepare('SELECT id FROM applications WHERE id = ?').get(request.params.id);
    if (!application) return response.status(404).json({ message: 'Application not found' });
    const staff = await db.prepare(`
      SELECT id, name FROM staff_users
      WHERE id = ? AND active = 1 AND role IN ('ADMISSIONS', 'REVIEWER')
    `).get(parsed.data.staffId);
    if (!staff) {
      return response.status(422).json({ message: 'Select an active admissions or reviewer staff member', fields: { staffId: 'Staff member is not available for assignment' } });
    }
    await db.prepare('UPDATE applications SET assigned_to = ?, last_updated = CURRENT_TIMESTAMP WHERE id = ?')
      .run(staff.id, request.params.id);
    response.json({ message: `Assigned to ${staff.name}` });
  });

  app.patch('/api/applications/:id/status', async (request, response) => {
    const nextStatus = String(request.body.status || '').toUpperCase();
    const note = String(request.body.note || '').trim();
    const application = await db.prepare('SELECT id, status FROM applications WHERE id = ?').get(request.params.id);
    if (!application) return response.status(404).json({ message: 'Application not found' });
    if (!transitions[application.status].includes(nextStatus)) {
      return response.status(422).json({ message: `Cannot move from ${statusLabel(application.status)} to ${statusLabel(nextStatus || 'unknown')}` });
    }
    if (['DECLINED', 'WITHDRAWN'].includes(nextStatus) && note.length < 5) {
      return response.status(422).json({ message: 'Add a reason of at least 5 characters for this decision' });
    }
    await db.runTransaction(async (transactionDb) => {
      await transactionDb.prepare(`
        UPDATE applications
        SET status = ?, last_updated = CURRENT_TIMESTAMP,
          risk_flag = CASE WHEN ? IN ('SCREENING', 'REVIEW', 'INTERVIEW', 'OFFERED', 'ACCEPTED') THEN 'NONE' ELSE risk_flag END
        WHERE id = ?
      `).run(nextStatus, nextStatus, request.params.id);
      await transactionDb.prepare(`
        INSERT INTO status_history (application_id, from_status, to_status, changed_by, note)
        VALUES (?, ?, ?, ?, ?)
      `).run(request.params.id, application.status, nextStatus, CURRENT_STAFF_ID, note || `Moved to ${statusLabel(nextStatus)}`);
      if (['OFFERED', 'DECLINED'].includes(nextStatus)) {
        const choice = await transactionDb.prepare('SELECT id FROM application_choices WHERE application_id = ? AND preference_rank = 1').get(request.params.id);
        await transactionDb.prepare(`
          INSERT OR REPLACE INTO decisions (application_choice_id, decision, rationale, decided_by, decided_at)
          VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        `).run(choice.id, nextStatus === 'OFFERED' ? 'OFFER' : 'REJECT', note || 'Decision recorded through application review.', CURRENT_STAFF_ID);
      }
    });
    response.json({ message: `Application moved to ${statusLabel(nextStatus)}`, status: nextStatus });
  });

  app.post('/api/applications/:id/notes', async (request, response) => {
    const note = z.string().trim().min(2, 'Enter at least 2 characters').max(1000, 'Keep notes under 1,000 characters').safeParse(request.body.note);
    if (!note.success) return response.status(422).json({ message: note.error.issues[0].message });
    const application = await db.prepare('SELECT id FROM applications WHERE id = ?').get(request.params.id);
    if (!application) return response.status(404).json({ message: 'Application not found' });
    const result = await db.prepare('INSERT INTO review_notes (application_id, author_id, note) VALUES (?, ?, ?)')
      .run(request.params.id, CURRENT_STAFF_ID, note.data);
    response.status(201).json({ id: result.lastInsertRowid, message: 'Review note added' });
  });

  app.post('/api/applications/:id/documents', async (request, response) => {
    const parsed = documentSchema.safeParse(request.body);
    if (!parsed.success) return validationError(response, parsed);
    const application = await db.prepare('SELECT id FROM applications WHERE id = ?').get(request.params.id);
    if (!application) return response.status(404).json({ message: 'Application not found' });
    const data = parsed.data;
    if (await db.prepare('SELECT id FROM documents WHERE application_id = ? AND document_type = ?').get(request.params.id, data.documentType)) {
      return response.status(409).json({
        message: 'This document type is already registered',
        fields: { documentType: 'Choose a document type that is not already listed' },
      });
    }
    const id = await db.runTransaction(async (transactionDb) => {
      const result = await transactionDb.prepare(`
        INSERT INTO documents (application_id, document_type, file_name, verification_status)
        VALUES (?, ?, ?, 'PENDING')
      `).run(request.params.id, data.documentType, data.fileName);
      await reconcileDocumentRisk(transactionDb, request.params.id);
      return Number(result.lastInsertRowid);
    });
    response.status(201).json({ id, message: `${data.documentType.replaceAll('_', ' ')} registered` });
  });

  app.patch('/api/applications/:id/documents/:documentId', async (request, response) => {
    const parsed = documentStatusSchema.safeParse(request.body);
    if (!parsed.success) return validationError(response, parsed);
    const document = await db.prepare('SELECT * FROM documents WHERE id = ? AND application_id = ?')
      .get(request.params.documentId, request.params.id);
    if (!document) return response.status(404).json({ message: 'Document not found' });
    const status = parsed.data.status;
    await db.runTransaction(async (transactionDb) => {
      await transactionDb.prepare(`
        UPDATE documents
        SET verification_status = ?, verified_by = ?
        WHERE id = ? AND application_id = ?
      `).run(status, status === 'VERIFIED' ? CURRENT_STAFF_ID : null, request.params.documentId, request.params.id);
      await reconcileDocumentRisk(transactionDb, request.params.id);
    });
    response.json({ message: `${document.document_type.replaceAll('_', ' ')} marked ${status.toLowerCase()}` });
  });

  app.post('/api/applications/:id/scholarships', async (request, response) => {
    const parsed = nominationSchema.safeParse(request.body);
    if (!parsed.success) return validationError(response, parsed);
    const application = await db.prepare(`
      SELECT a.id, ac.academic_score
      FROM applications a
      JOIN application_choices ac ON ac.application_id = a.id AND ac.preference_rank = 1
      WHERE a.id = ?
    `).get(request.params.id);
    if (!application) return response.status(404).json({ message: 'Application not found' });
    const scholarship = await db.prepare('SELECT * FROM scholarships WHERE id = ?').get(parsed.data.scholarshipId);
    if (!scholarship || scholarship.active !== 1) {
      return response.status(422).json({ message: 'Scholarship is not available', fields: { scholarshipId: 'Select an active scholarship' } });
    }
    if (await db.prepare('SELECT id FROM scholarship_applications WHERE application_id = ? AND scholarship_id = ?')
      .get(request.params.id, scholarship.id)) {
      return response.status(409).json({ message: 'Applicant has already been nominated for this scholarship' });
    }
    if (application.academic_score < scholarship.minimum_score) {
      return response.status(422).json({
        message: `Academic score must be at least ${scholarship.minimum_score}`,
        fields: { scholarshipId: 'Applicant does not meet the minimum score' },
      });
    }
    const result = await db.prepare(`
      INSERT INTO scholarship_applications (application_id, scholarship_id, status, awarded_amount_hkd)
      VALUES (?, ?, 'NOMINATED', NULL)
    `).run(request.params.id, scholarship.id);
    response.status(201).json({ id: Number(result.lastInsertRowid), message: `Nominated for ${scholarship.name}` });
  });

  app.patch('/api/applications/:id/scholarships/:nominationId', async (request, response) => {
    const parsed = nominationStatusSchema.safeParse(request.body);
    if (!parsed.success) return validationError(response, parsed);
    const nomination = await db.prepare(`
      SELECT sa.*, s.name, s.amount_hkd, s.places, s.active
      FROM scholarship_applications sa
      JOIN scholarships s ON s.id = sa.scholarship_id
      WHERE sa.id = ? AND sa.application_id = ?
    `).get(request.params.nominationId, request.params.id);
    if (!nomination) return response.status(404).json({ message: 'Scholarship nomination not found' });
    if (nomination.status !== 'NOMINATED') {
      return response.status(422).json({ message: `This nomination is already ${nomination.status.toLowerCase()}` });
    }
    const nextStatus = parsed.data.status;
    try {
      await db.runTransaction(async (transactionDb) => {
        if (nextStatus === 'AWARDED') {
          if (nomination.active !== 1) {
            const error = new Error('Archived scholarships cannot receive new awards');
            error.businessRule = true;
            throw error;
          }
          const awarded = (await transactionDb.prepare(`
            SELECT COUNT(*) AS count
            FROM scholarship_applications
            WHERE scholarship_id = ? AND status = 'AWARDED'
          `).get(nomination.scholarship_id)).count;
          if (awarded >= nomination.places) {
            const error = new Error('No award places remain for this scholarship');
            error.businessRule = true;
            throw error;
          }
        }
        await transactionDb.prepare(`
          UPDATE scholarship_applications
          SET status = ?, awarded_amount_hkd = ?
          WHERE id = ? AND application_id = ?
        `).run(nextStatus, nextStatus === 'AWARDED' ? nomination.amount_hkd : null, request.params.nominationId, request.params.id);
        await transactionDb.prepare('UPDATE applications SET last_updated = CURRENT_TIMESTAMP WHERE id = ?').run(request.params.id);
      });
    } catch (error) {
      if (error.businessRule) return response.status(422).json({ message: error.message });
      throw error;
    }
    response.json({ message: `${nomination.name} ${nextStatus.toLowerCase()}` });
  });

  app.get('/api/reports', (_request, response) => {
    response.json(reports.map(({ sql, ...report }) => report));
  });

  app.get('/api/reports/:id', async (request, response) => {
    const report = getReport(request.params.id);
    if (!report) return response.status(404).json({ message: 'Report not found' });
    const rows = await db.prepare(report.sql).all();
    response.json({ ...report, rows, generatedAt: new Date().toISOString() });
  });

  app.get('/api/model', async (_request, response) => {
    const tableNames = (await db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `).all()).map(({ name }) => name);
    const tables = await Promise.all(tableNames.map(async (name) => ({
      name,
      columns: await db.prepare(`PRAGMA table_info('${name}')`).all(),
      foreignKeys: await db.prepare(`PRAGMA foreign_key_list('${name}')`).all(),
      rowCount: (await db.prepare(`SELECT COUNT(*) AS count FROM "${name}"`).get()).count,
    })));
    response.json({ tables, reports: reports.map(({ id, title, description, sql }) => ({ id, title, description, sql: sql.trim() })) });
  });

  app.use((error, _request, response, _next) => {
    if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
      return response.status(400).json({ message: 'Request body must contain valid JSON' });
    }
    console.error(error);
    response.status(500).json({ message: 'The request could not be completed' });
  });

  return app;
}

export { transitions };
