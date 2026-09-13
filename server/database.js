import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyMigrations, SEED_VERSION } from './migrate.js';

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

const finalStatuses = [
  'DRAFT', 'SUBMITTED', 'SCREENING', 'REVIEW', 'INTERVIEW', 'WAITLISTED',
  'OFFERED', 'ACCEPTED', 'DECLINED', 'WITHDRAWN', 'SCREENING', 'REVIEW',
  'INTERVIEW', 'WAITLISTED', 'OFFERED', 'ACCEPTED', 'DECLINED', 'SUBMITTED',
  'REVIEW', 'INTERVIEW', 'WAITLISTED', 'OFFERED', 'ACCEPTED', 'ACCEPTED',
];

const programmeRows = [
  ['BBA-IS', 'BBA in Information Systems', 'School of Business and Management', 'UG'],
  ['BSC-AI', 'BSc in Artificial Intelligence', 'School of Engineering', 'UG'],
  ['BSC-QF', 'BSc in Quantitative Finance', 'School of Science', 'UG'],
  ['MSC-BA', 'MSc in Business Analytics', 'School of Business and Management', 'PG'],
  ['MSC-ISM', 'MSc in Information Systems Management', 'School of Business and Management', 'PG'],
  ['MSC-FIN', 'MSc in Financial Technology', 'School of Business and Management', 'PG'],
];

function isoDate(year, month, day, hour = 9) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00Z`;
}

function addStatusPath(insertStatus, applicationId, finalStatus, staffId, base, { viaWaitlist = false } = {}) {
  const add = (fromStatus, toStatus, offsetHours, reason = null) => insertStatus.run(
    applicationId,
    fromStatus,
    toStatus,
    staffId,
    reason,
    new Date(new Date(base).getTime() + offsetHours * 3_600_000).toISOString(),
  );

  if (finalStatus === 'DRAFT') {
    add(null, 'DRAFT', 0);
    return;
  }
  add(null, 'SUBMITTED', 0);
  if (finalStatus === 'SUBMITTED') return;
  if (finalStatus === 'WITHDRAWN') {
    add('SUBMITTED', 'WITHDRAWN', 24, 'Withdrawn at the applicant request');
    return;
  }
  add('SUBMITTED', 'SCREENING', 24);
  if (finalStatus === 'SCREENING') return;
  add('SCREENING', 'REVIEW', 48);
  if (finalStatus === 'REVIEW') return;
  if (finalStatus === 'DECLINED') {
    add('REVIEW', 'DECLINED', 96, 'Academic profile below the competitive threshold');
    return;
  }
  add('REVIEW', 'INTERVIEW', 72);
  if (finalStatus === 'INTERVIEW') return;
  if (finalStatus === 'WAITLISTED') {
    add('INTERVIEW', 'WAITLISTED', 120, 'Competitive profile placed on the active waitlist');
    return;
  }
  if (viaWaitlist) {
    add('INTERVIEW', 'WAITLISTED', 110, 'Competitive profile retained pending programme capacity');
    add('WAITLISTED', 'OFFERED', 120, 'Converted when a programme place became available');
  } else {
    add('INTERVIEW', 'OFFERED', 120, 'Offer approved after holistic review');
  }
  if (finalStatus === 'OFFERED') return;
  add('OFFERED', 'ACCEPTED', 168);
}

function seedDatabase(db) {
  if (db.prepare('SELECT COUNT(*) AS count FROM staff_users').get().count > 0) return;

  db.transaction(() => {
    const insertStaff = db.prepare('INSERT INTO staff_users (name, email, role, active) VALUES (?, ?, ?, ?)');
    [
      ['Alex Morgan', 'alex.morgan@ust.hk', 'ADMIN', 1],
      ['Renee Leung', 'renee.leung@ust.hk', 'ADMISSIONS', 1],
      ['Marcus Yip', 'marcus.yip@ust.hk', 'REVIEWER', 1],
      ['Iris Kwan', 'iris.kwan@ust.hk', 'REVIEWER', 1],
      ['Taylor Ng', 'taylor.ng@ust.hk', 'REVIEWER', 0],
    ].forEach((row) => insertStaff.run(...row));

    const insertCycle = db.prepare(`
      INSERT INTO admission_cycles (cycle_year, name, opens_at, closes_at, status)
      VALUES (?, ?, ?, ?, ?)
    `);
    const closedCycleId = Number(insertCycle.run(2026, '2026 Admission Cycle', isoDate(2025, 5, 1), isoDate(2025, 12, 15, 23), 'CLOSED').lastInsertRowid);
    const openCycleId = Number(insertCycle.run(2027, '2027 Admission Cycle', isoDate(2026, 5, 1), isoDate(2026, 12, 15, 23), 'OPEN').lastInsertRowid);

    const insertProgramme = db.prepare(`
      INSERT INTO programmes (code, name, school, degree_level) VALUES (?, ?, ?, ?)
    `);
    const programmeIds = programmeRows.map((row) => Number(insertProgramme.run(...row).lastInsertRowid));
    const insertOffering = db.prepare(`
      INSERT INTO programme_offerings
        (programme_id, cycle_id, capacity, application_deadline, active)
      VALUES (?, ?, ?, ?, 1)
    `);
    const offeringIds = new Map();
    [
      [closedCycleId, 2025, [18, 16, 14, 12, 12, 10]],
      [openCycleId, 2026, [22, 20, 18, 15, 14, 13]],
    ].forEach(([cycleId, deadlineYear, capacities]) => {
      programmeIds.forEach((programmeId, index) => {
        const offeringId = Number(insertOffering.run(
          programmeId,
          cycleId,
          capacities[index],
          isoDate(deadlineYear, index < 3 ? 11 : 10, index < 3 ? 30 : 31, 23),
        ).lastInsertRowid);
        offeringIds.set(`${cycleId}:${index}`, offeringId);
      });
    });

    const insertRequirement = db.prepare(`
      INSERT INTO document_requirements (cycle_id, degree_level, document_type, required_by_status)
      VALUES (?, ?, ?, ?)
    `);
    [closedCycleId, openCycleId].forEach((cycleId) => {
      ['ID', 'TRANSCRIPT', 'PERSONAL_STATEMENT'].forEach((type) => insertRequirement.run(cycleId, 'UG', type, type === 'ID' ? 'SCREENING' : 'OFFERED'));
      ['ID', 'TRANSCRIPT', 'PERSONAL_STATEMENT', 'CV'].forEach((type) => insertRequirement.run(cycleId, 'PG', type, type === 'ID' ? 'SCREENING' : 'OFFERED'));
    });

    const insertScholarship = db.prepare(`
      INSERT INTO scholarships (code, name, amount_hkd, minimum_score, places, active)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    insertScholarship.run('UST-MERIT-50', 'HKUST Academic Merit Award', 50000, 88, 8, 1);
    insertScholarship.run('UST-GLOBAL-30', 'Global Perspectives Award', 30000, 84, 10, 1);
    insertScholarship.run('UST-ACCESS-40', 'Opportunity and Access Award', 40000, 80, 6, 1);
    insertScholarship.run('UST-LEGACY-20', 'Archived Legacy Award', 20000, 75, 4, 0);

    const insertApplicant = db.prepare(`
      INSERT INTO applicants
        (applicant_no, first_name, last_name, preferred_name, email, phone, nationality, birth_date, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertEducation = db.prepare(`
      INSERT INTO education_records
        (applicant_id, institution, qualification, field_of_study, grade, graduation_year)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const insertApplication = db.prepare(`
      INSERT INTO applications
        (application_no, applicant_id, cycle_id, degree_level, submitted_at, assigned_to, last_updated)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const insertChoice = db.prepare(`
      INSERT INTO application_choices
        (application_id, programme_offering_id, preference_rank, academic_score)
      VALUES (?, ?, ?, ?)
    `);
    const insertDocument = db.prepare(`
      INSERT INTO documents
        (application_id, document_type, file_name, verification_status, uploaded_at, reviewed_by, reviewed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const insertStatus = db.prepare(`
      INSERT INTO status_history
        (application_id, from_status, to_status, changed_by, reason, changed_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const insertInterview = db.prepare(`
      INSERT INTO interview_sessions
        (application_choice_id, scheduled_at, duration_minutes, mode, location, status, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const insertPanel = db.prepare(`
      INSERT INTO interview_panel_members (interview_session_id, staff_user_id, panel_role)
      VALUES (?, ?, ?)
    `);
    const completeInterview = db.prepare(`
      UPDATE interview_sessions SET status = 'COMPLETED', score = ?, feedback = ? WHERE id = ?
    `);
    const insertDecision = db.prepare(`
      INSERT INTO decisions
        (application_choice_id, decision, rationale, decided_by, decided_at, supersedes_decision_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const insertWaitlist = db.prepare(`
      INSERT INTO waitlist_entries
        (application_choice_id, status, joined_at, reason, handled_by, handled_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const insertScholarshipApplication = db.prepare(`
      INSERT INTO scholarship_applications
        (application_id, scholarship_id, status, awarded_amount_hkd, decided_by, decided_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const insertNote = db.prepare(`
      INSERT INTO review_notes (application_id, author_id, note, created_at) VALUES (?, ?, ?, ?)
    `);

    [
      { cycleId: closedCycleId, cycleYear: 2026, submissionYear: 2025 },
      { cycleId: openCycleId, cycleYear: 2027, submissionYear: 2026 },
    ].forEach(({ cycleId, cycleYear, submissionYear }, cycleIndex) => {
      people.forEach(([firstName, lastName, nationality, birthDate], index) => {
        const sequence = cycleIndex * people.length + index + 1;
        const number = String(sequence).padStart(3, '0');
        const month = 5 + (index % 6);
        const day = 2 + (index % 24);
        const submittedAt = isoDate(submissionYear, month, day, 8 + (index % 9));
        const finalStatus = finalStatuses[(index + cycleIndex * 3) % finalStatuses.length];
        const isDraft = finalStatus === 'DRAFT';
        const degreeLevel = index % 3 === 0 ? 'PG' : 'UG';
        const staffId = 2 + (index % 3);
        const applicantId = Number(insertApplicant.run(
          `A${String(cycleYear).slice(-2)}${number}`,
          firstName,
          lastName,
          index % 4 === 0 ? firstName : null,
          `${firstName}.${lastName}.${cycleYear}.${number}@example.com`.toLowerCase(),
          `+852 ${String(51000000 + sequence * 7919).slice(-8)}`,
          nationality,
          birthDate,
          submittedAt,
        ).lastInsertRowid);

        insertEducation.run(
          applicantId,
          ['Harbour College', 'Central Academy', 'Starlight University', 'Victoria Institute'][index % 4],
          degreeLevel === 'PG' ? 'Bachelor Degree' : 'Secondary Diploma',
          degreeLevel === 'PG' ? ['Business', 'Computer Science', 'Economics'][index % 3] : 'General Studies',
          `${80 + (index % 17)}%`,
          degreeLevel === 'PG' ? submissionYear - 1 : submissionYear,
        );

        const applicationId = Number(insertApplication.run(
          `APP-${String(cycleYear).slice(-2)}-${number}`,
          applicantId,
          cycleId,
          degreeLevel,
          isDraft ? null : submittedAt,
          staffId,
          new Date(new Date(submittedAt).getTime() + 8 * 24 * 3_600_000).toISOString(),
        ).lastInsertRowid);

        const baseProgrammeIndex = degreeLevel === 'PG' ? 3 : 0;
        const choiceIndex = baseProgrammeIndex + (index % 3);
        const secondChoiceIndex = baseProgrammeIndex + ((index + 1) % 3);
        const score = Number((77 + ((index * 3.7 + cycleIndex * 1.3) % 21)).toFixed(1));
        const firstChoiceId = Number(insertChoice.run(
          applicationId,
          offeringIds.get(`${cycleId}:${choiceIndex}`),
          1,
          score,
        ).lastInsertRowid);
        insertChoice.run(applicationId, offeringIds.get(`${cycleId}:${secondChoiceIndex}`), 2, Number(Math.max(0, score - 1.5).toFixed(1)));

        const mustBeCompliant = ['OFFERED', 'ACCEPTED'].includes(finalStatus);
        const documentException = !mustBeCompliant && index % 8 < 3 ? index % 8 : null;
        const requiredDocuments = degreeLevel === 'PG'
          ? ['ID', 'TRANSCRIPT', 'PERSONAL_STATEMENT', 'CV']
          : ['ID', 'TRANSCRIPT', 'PERSONAL_STATEMENT'];
        requiredDocuments.forEach((documentType, documentIndex) => {
          if (documentException === 0 && documentIndex === requiredDocuments.length - 1) return;
          const status = documentException === 1 && documentIndex === requiredDocuments.length - 1
            ? 'PENDING'
            : documentException === 2 && documentIndex === requiredDocuments.length - 1
              ? 'REJECTED'
              : 'VERIFIED';
          insertDocument.run(
            applicationId,
            documentType,
            `${number}_${documentType.toLowerCase()}.pdf`,
            status,
            submittedAt,
            status === 'PENDING' ? null : 2,
            status === 'PENDING' ? null : new Date(new Date(submittedAt).getTime() + 12 * 3_600_000).toISOString(),
          );
        });

        let interviewId = null;
        const hasInterview = ['INTERVIEW', 'WAITLISTED', 'OFFERED', 'ACCEPTED'].includes(finalStatus);
        if (hasInterview) {
          const scheduledAt = new Date(new Date(submittedAt).getTime() + (4 + index) * 24 * 3_600_000).toISOString();
          interviewId = Number(insertInterview.run(
            firstChoiceId,
            scheduledAt,
            45,
            index % 2 === 0 ? 'ONLINE' : 'IN_PERSON',
            index % 2 === 0 ? 'Zoom admissions room' : `Academic Building Room ${200 + index}`,
            'SCHEDULED',
            2,
          ).lastInsertRowid);
          insertPanel.run(interviewId, 3, 'CHAIR');
          insertPanel.run(interviewId, 4, 'MEMBER');
          if (finalStatus !== 'INTERVIEW') {
            completeInterview.run(
              Number(Math.min(99, score + ((index % 5) - 2)).toFixed(1)),
              'The panel confirmed academic readiness and programme fit.',
              interviewId,
            );
          }
        } else if (index % 12 === 10 || index % 12 === 11) {
          insertInterview.run(
            firstChoiceId,
            new Date(new Date(submittedAt).getTime() + 5 * 24 * 3_600_000).toISOString(),
            45,
            'ONLINE',
            'Zoom admissions room',
            index % 12 === 10 ? 'CANCELLED' : 'NO_SHOW',
            2,
          );
        }

        addStatusPath(insertStatus, applicationId, finalStatus, staffId, submittedAt, {
          viaWaitlist: finalStatus === 'ACCEPTED' && index % 2 === 1,
        });

        if (finalStatus === 'WAITLISTED') {
          const decisionTime = new Date(new Date(submittedAt).getTime() + 121 * 3_600_000).toISOString();
          insertDecision.run(firstChoiceId, 'WAITLIST', 'Competitive profile retained for capacity review.', staffId, decisionTime, null);
          insertWaitlist.run(firstChoiceId, 'ACTIVE', decisionTime, 'Awaiting capacity after the first offer round.', null, null);
        } else if (['OFFERED', 'ACCEPTED'].includes(finalStatus)) {
          const decisionTime = new Date(new Date(submittedAt).getTime() + 121 * 3_600_000).toISOString();
          if (finalStatus === 'ACCEPTED' && index % 2 === 1) {
            const waitlistDecisionId = Number(insertDecision.run(
              firstChoiceId,
              'WAITLIST',
              'Strong profile retained pending programme capacity.',
              staffId,
              new Date(new Date(submittedAt).getTime() + 110 * 3_600_000).toISOString(),
              null,
            ).lastInsertRowid);
            insertWaitlist.run(
              firstChoiceId,
              'CONVERTED',
              new Date(new Date(submittedAt).getTime() + 110 * 3_600_000).toISOString(),
              'Converted when a programme place became available.',
              staffId,
              decisionTime,
            );
            insertDecision.run(firstChoiceId, 'OFFER', 'Waitlist conversion approved against available capacity.', staffId, decisionTime, waitlistDecisionId);
          } else {
            insertDecision.run(firstChoiceId, 'OFFER', 'Strong academic fit and positive holistic review.', staffId, decisionTime, null);
          }
          if (finalStatus === 'ACCEPTED') {
            const offerDecision = db.prepare(`
              SELECT id FROM decisions
              WHERE application_choice_id = ? AND decision = 'OFFER'
              ORDER BY datetime(decided_at) DESC, id DESC LIMIT 1
            `).get(firstChoiceId);
            insertDecision.run(
              firstChoiceId,
              'ACCEPT',
              'Applicant accepted the programme offer.',
              staffId,
              new Date(new Date(decisionTime).getTime() + 24 * 3_600_000).toISOString(),
              offerDecision?.id ?? null,
            );
          }
        } else if (finalStatus === 'DECLINED') {
          insertDecision.run(
            firstChoiceId,
            'REJECT',
            'Profile did not meet the competitive threshold for this intake.',
            staffId,
            new Date(new Date(submittedAt).getTime() + 97 * 3_600_000).toISOString(),
            null,
          );
        }

        insertNote.run(
          applicationId,
          staffId,
          index % 2 === 0
            ? 'Academic profile checked against the programme threshold.'
            : 'Evidence and review progress recorded for the admissions team.',
          new Date(new Date(submittedAt).getTime() + 3 * 24 * 3_600_000).toISOString(),
        );

        if (score >= 84) {
          const scholarshipId = score >= 88 ? 1 : 2;
          const awarded = finalStatus === 'ACCEPTED' && score >= (scholarshipId === 1 ? 88 : 84);
          insertScholarshipApplication.run(
            applicationId,
            scholarshipId,
            awarded ? 'AWARDED' : 'NOMINATED',
            awarded ? (scholarshipId === 1 ? 50000 : 30000) : null,
            awarded ? staffId : null,
            awarded ? new Date(new Date(submittedAt).getTime() + 9 * 24 * 3_600_000).toISOString() : null,
          );
        }
      });
    });

    db.prepare(`
      INSERT INTO schema_migrations (id, checksum)
      VALUES ('seed', ?)
      ON CONFLICT(id) DO UPDATE SET checksum = excluded.checksum, applied_at = CURRENT_TIMESTAMP
    `).run(SEED_VERSION);
  })();
}

export function createDatabase(filename = defaultDatabasePath, { seed = true } = {}) {
  const db = new Database(filename);
  db.pragma('foreign_keys = ON');
  if (filename !== ':memory:') db.pragma('journal_mode = WAL');
  applyMigrations(db);
  if (seed) seedDatabase(db);

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

export { seedDatabase };
