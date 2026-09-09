import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const defaultDatabasePath = path.resolve(here, '../data/admissions.db');

const people = [
  ['Mei', 'Chan', 'Hong Kong', '2007-02-14'],
  ['Arjun', 'Mehta', 'India', '2005-09-02'],
  ['Sofia', 'Martinez', 'Spain', '2004-05-19'],
  ['Ethan', 'Wong', 'Hong Kong', '2006-11-23'],
  ['Hana', 'Kim', 'South Korea', '2005-03-07'],
  ['Noah', 'Williams', 'United Kingdom', '2003-12-11'],
  ['Yuki', 'Tanaka', 'Japan', '2005-08-28'],
  ['Aisha', 'Rahman', 'Malaysia', '2004-06-16'],
  ['Lucas', 'Silva', 'Brazil', '2003-01-25'],
  ['Jiahao', 'Li', 'Mainland China', '2006-04-03'],
  ['Amelia', 'Clarke', 'Australia', '2005-10-30'],
  ['Minh', 'Nguyen', 'Vietnam', '2004-07-09'],
  ['Daniel', 'Ho', 'Hong Kong', '2006-01-18'],
  ['Nadia', 'Hassan', 'Indonesia', '2003-03-21'],
  ['Leo', 'Schmidt', 'Germany', '2004-09-13'],
  ['Ananya', 'Patel', 'India', '2005-12-05'],
  ['Kai', 'Lau', 'Hong Kong', '2006-06-27'],
  ['Clara', 'Rossi', 'Italy', '2003-11-08'],
  ['Mira', 'Lim', 'Singapore', '2005-02-01'],
  ['Owen', 'Chen', 'Canada', '2004-08-20'],
  ['Fatima', 'Zahra', 'Morocco', '2003-07-17'],
  ['Henry', 'Cheung', 'Hong Kong', '2006-10-12'],
  ['Priya', 'Nair', 'India', '2004-02-26'],
  ['Emma', 'Dubois', 'France', '2005-05-15'],
];

const statuses = [
  'SUBMITTED', 'SCREENING', 'REVIEW', 'REVIEW', 'INTERVIEW', 'OFFERED',
  'ACCEPTED', 'REVIEW', 'SCREENING', 'OFFERED', 'DECLINED', 'SUBMITTED',
  'INTERVIEW', 'ACCEPTED', 'REVIEW', 'WITHDRAWN', 'SCREENING', 'OFFERED',
  'REVIEW', 'SUBMITTED', 'INTERVIEW', 'REVIEW', 'OFFERED', 'ACCEPTED',
];

const programmes = [
  ['BBA-IS', 'BBA in Information Systems', 'School of Business', 'UG', 120, '2026-10-15'],
  ['BSC-AI', 'BSc in Artificial Intelligence', 'School of Engineering', 'UG', 90, '2026-10-15'],
  ['BSC-QF', 'BSc in Quantitative Finance', 'School of Science', 'UG', 75, '2026-10-15'],
  ['MSC-BA', 'MSc in Business Analytics', 'School of Business', 'PG', 80, '2026-09-30'],
  ['MSC-ISM', 'MSc in Information Systems Management', 'School of Business', 'PG', 65, '2026-09-30'],
  ['MSC-FIN', 'MSc in Financial Technology', 'School of Business', 'PG', 70, '2026-09-30'],
];

function seedDatabase(db) {
  if (db.prepare('SELECT COUNT(*) AS count FROM applicants').get().count > 0) return;

  const seed = db.transaction(() => {
    const addStaff = db.prepare('INSERT INTO staff_users (name, email, role) VALUES (?, ?, ?)');
    [
      ['Alex Morgan', 'alex.morgan@northstar.edu', 'ADMIN'],
      ['Renee Leung', 'renee.leung@northstar.edu', 'ADMISSIONS'],
      ['Marcus Yip', 'marcus.yip@northstar.edu', 'REVIEWER'],
      ['Iris Kwan', 'iris.kwan@northstar.edu', 'REVIEWER'],
    ].forEach((row) => addStaff.run(...row));

    const addProgramme = db.prepare(`
      INSERT INTO programmes (code, name, school, degree_level, capacity, deadline)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    programmes.forEach((row) => addProgramme.run(...row));

    const addScholarship = db.prepare(`
      INSERT INTO scholarships (code, name, amount_hkd, minimum_score, places)
      VALUES (?, ?, ?, ?, ?)
    `);
    addScholarship.run('MERIT-50', 'Northstar Merit Award', 50000, 88, 12);
    addScholarship.run('GLOBAL-30', 'Global Perspectives Award', 30000, 84, 10);
    addScholarship.run('ACCESS-40', 'Opportunity and Access Award', 40000, 80, 8);

    const addApplicant = db.prepare(`
      INSERT INTO applicants
        (applicant_no, first_name, last_name, preferred_name, email, phone, nationality, birth_date, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const addEducation = db.prepare(`
      INSERT INTO education_records
        (applicant_id, institution, qualification, field_of_study, grade, graduation_year)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const addApplication = db.prepare(`
      INSERT INTO applications
        (application_no, applicant_id, intake_year, submitted_at, status, risk_flag, assigned_to, last_updated)
      VALUES (?, ?, 2027, ?, ?, ?, ?, ?)
    `);
    const addChoice = db.prepare(`
      INSERT INTO application_choices
        (application_id, programme_id, preference_rank, academic_score, interview_score, choice_status)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const addDocument = db.prepare(`
      INSERT INTO documents
        (application_id, document_type, file_name, verification_status, uploaded_at, verified_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const addHistory = db.prepare(`
      INSERT INTO status_history
        (application_id, from_status, to_status, changed_by, note, changed_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const addDecision = db.prepare(`
      INSERT INTO decisions
        (application_choice_id, decision, rationale, decided_by, decided_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    const addScholarshipApplication = db.prepare(`
      INSERT INTO scholarship_applications
        (application_id, scholarship_id, status, awarded_amount_hkd)
      VALUES (?, ?, ?, ?)
    `);
    const addNote = db.prepare(`
      INSERT INTO review_notes (application_id, author_id, note, created_at)
      VALUES (?, ?, ?, ?)
    `);

    people.forEach(([firstName, lastName, nationality, birthDate], index) => {
      const number = String(index + 1).padStart(3, '0');
      const submittedDay = String((index % 24) + 2).padStart(2, '0');
      const submittedAt = `2026-08-${submittedDay}T0${index % 9}:20:00Z`;
      const updatedDay = String(Math.min((index % 24) + 5, 29)).padStart(2, '0');
      const updatedAt = `2026-08-${updatedDay}T1${index % 9}:05:00Z`;
      const email = `${firstName}.${lastName}${index + 1}@example.com`.toLowerCase();
      const applicantId = Number(addApplicant.run(
        `A27${number}`,
        firstName,
        lastName,
        index % 4 === 0 ? firstName : null,
        email,
        `+852 5${String(1000000 + index * 7919).slice(-7)}`,
        nationality,
        birthDate,
        submittedAt,
      ).lastInsertRowid);

      const isPostgraduate = index % 3 === 0;
      addEducation.run(
        applicantId,
        `${['Harbour College', 'Central Academy', 'Starlight University', 'Victoria Institute'][index % 4]}`,
        isPostgraduate ? 'Bachelor Degree' : 'Secondary Diploma',
        isPostgraduate ? ['Business', 'Computer Science', 'Economics'][index % 3] : 'General Studies',
        `${82 + (index % 15)}%`,
        isPostgraduate ? 2025 : 2026,
      );

      const status = statuses[index];
      const risk = [1, 8, 16, 19].includes(index) ? 'MISSING_DOCS' : index === 21 ? 'DEADLINE' : 'NONE';
      const applicationId = Number(addApplication.run(
        `APP-27-${number}`,
        applicantId,
        submittedAt,
        status,
        risk,
        2 + (index % 3),
        updatedAt,
      ).lastInsertRowid);

      const firstProgramme = isPostgraduate ? 4 + (index % 3) : 1 + (index % 3);
      const secondProgramme = isPostgraduate ? 4 + ((index + 1) % 3) : 1 + ((index + 1) % 3);
      const score = 76 + ((index * 3.7) % 21);
      const interviewScore = ['INTERVIEW', 'OFFERED', 'ACCEPTED', 'DECLINED'].includes(status)
        ? Math.min(98, score + ((index % 5) - 2))
        : null;
      const firstChoiceStatus = ['OFFERED', 'ACCEPTED'].includes(status)
        ? 'OFFERED'
        : status === 'DECLINED' ? 'REJECTED' : status === 'INTERVIEW' ? 'SHORTLISTED' : 'PENDING';
      const firstChoiceId = Number(addChoice.run(
        applicationId, firstProgramme, 1, Number(score.toFixed(1)), interviewScore, firstChoiceStatus,
      ).lastInsertRowid);
      addChoice.run(
        applicationId,
        secondProgramme,
        2,
        Number(Math.max(0, score - 1.5).toFixed(1)),
        interviewScore,
        'PENDING',
      );

      const requiredDocuments = ['ID', 'TRANSCRIPT', 'PERSONAL_STATEMENT'];
      requiredDocuments.forEach((documentType, documentIndex) => {
        if (risk === 'MISSING_DOCS' && documentIndex === 2) return;
        addDocument.run(
          applicationId,
          documentType,
          `${number}_${documentType.toLowerCase()}.pdf`,
          documentIndex === 2 && index % 6 === 0 ? 'PENDING' : 'VERIFIED',
          submittedAt,
          documentIndex === 2 && index % 6 === 0 ? null : 2,
        );
      });
      if (isPostgraduate) {
        addDocument.run(applicationId, 'CV', `${number}_cv.pdf`, 'VERIFIED', submittedAt, 2);
      }

      addHistory.run(applicationId, null, 'SUBMITTED', 2, 'Application submitted', submittedAt);
      if (status !== 'SUBMITTED' && status !== 'WITHDRAWN') {
        addHistory.run(applicationId, 'SUBMITTED', 'SCREENING', 2, 'Initial completeness check', `2026-08-${updatedDay}T08:00:00Z`);
      }
      if (!['SUBMITTED', 'SCREENING', 'WITHDRAWN'].includes(status)) {
        addHistory.run(applicationId, 'SCREENING', 'REVIEW', 2 + (index % 3), 'Assigned for academic review', `2026-08-${updatedDay}T09:15:00Z`);
      }
      if (['INTERVIEW', 'OFFERED', 'ACCEPTED'].includes(status)) {
        addHistory.run(applicationId, 'REVIEW', 'INTERVIEW', 3, 'Shortlisted by review panel', `2026-08-${updatedDay}T10:30:00Z`);
      }
      if (['OFFERED', 'ACCEPTED'].includes(status)) {
        addHistory.run(applicationId, 'INTERVIEW', 'OFFERED', 3, 'Offer approved by panel', updatedAt);
        addDecision.run(firstChoiceId, 'OFFER', 'Strong academic fit and positive holistic review.', 3, updatedAt);
      } else if (status === 'DECLINED') {
        addHistory.run(applicationId, 'REVIEW', 'DECLINED', 3, 'Decision recorded', updatedAt);
        addDecision.run(firstChoiceId, 'REJECT', 'Profile did not meet the competitive threshold.', 3, updatedAt);
      } else if (status === 'WITHDRAWN') {
        addHistory.run(applicationId, 'SUBMITTED', 'WITHDRAWN', 2, 'Withdrawn at applicant request', updatedAt);
      }
      if (status === 'ACCEPTED') {
        addHistory.run(applicationId, 'OFFERED', 'ACCEPTED', 2, 'Offer accepted', updatedAt);
      }

      addNote.run(
        applicationId,
        2 + (index % 3),
        index % 2 === 0
          ? 'Academic profile checked against the programme threshold.'
          : 'Document set reviewed; follow-up recorded where required.',
        updatedAt,
      );

      if (score >= 84) {
        const scholarshipId = score >= 89 ? 1 : 2;
        const scholarshipStatus = status === 'ACCEPTED' && score >= 89 ? 'AWARDED' : 'NOMINATED';
        addScholarshipApplication.run(
          applicationId,
          scholarshipId,
          scholarshipStatus,
          scholarshipStatus === 'AWARDED' ? 50000 : null,
        );
      }
    });
  });

  seed();
}

export function createDatabase(filename = defaultDatabasePath) {
  const db = new Database(filename);
  db.pragma('foreign_keys = ON');
  if (filename !== ':memory:') db.pragma('journal_mode = WAL');
  db.exec(fs.readFileSync(path.join(here, 'schema.sql'), 'utf8'));
  const scholarshipColumns = db.prepare("PRAGMA table_info('scholarships')").all();
  if (!scholarshipColumns.some(({ name }) => name === 'active')) {
    db.exec('ALTER TABLE scholarships ADD COLUMN active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))');
  }
  seedDatabase(db);

  let transactionQueue = Promise.resolve();
  db.runTransaction = (callback) => {
    const execute = async () => {
      db.exec('BEGIN IMMEDIATE');
      try {
        const result = await callback(db);
        db.exec('COMMIT');
        return result;
      } catch (error) {
        if (db.inTransaction) db.exec('ROLLBACK');
        throw error;
      }
    };
    const result = transactionQueue.then(execute, execute);
    transactionQueue = result.catch(() => undefined);
    return result;
  };
  return db;
}
