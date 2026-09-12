PRAGMA foreign_keys = ON;

-- Technical metadata. This table is intentionally excluded from the 19-relation ERD.
CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  checksum TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;

CREATE TABLE IF NOT EXISTS staff_users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL CHECK (name = trim(name) AND length(name) BETWEEN 2 AND 100),
  email TEXT NOT NULL COLLATE NOCASE UNIQUE
    CHECK (email = lower(trim(email)) AND email GLOB '*?@?*.?*' AND email NOT GLOB '* *'),
  role TEXT NOT NULL CHECK (role IN ('ADMIN', 'ADMISSIONS', 'REVIEWER')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
) STRICT;

CREATE TABLE IF NOT EXISTS applicants (
  id INTEGER PRIMARY KEY,
  applicant_no TEXT NOT NULL UNIQUE CHECK (applicant_no = trim(applicant_no) AND length(applicant_no) BETWEEN 4 AND 20),
  first_name TEXT NOT NULL CHECK (first_name = trim(first_name) AND length(first_name) BETWEEN 1 AND 80),
  last_name TEXT NOT NULL CHECK (last_name = trim(last_name) AND length(last_name) BETWEEN 1 AND 80),
  preferred_name TEXT CHECK (preferred_name IS NULL OR (preferred_name = trim(preferred_name) AND length(preferred_name) BETWEEN 1 AND 80)),
  email TEXT NOT NULL COLLATE NOCASE UNIQUE
    CHECK (email = lower(trim(email)) AND email GLOB '*?@?*.?*' AND email NOT GLOB '* *'),
  phone TEXT NOT NULL CHECK (phone = trim(phone) AND length(phone) BETWEEN 8 AND 25),
  nationality TEXT NOT NULL CHECK (nationality = trim(nationality) AND length(nationality) BETWEEN 2 AND 80),
  birth_date TEXT NOT NULL CHECK (date(birth_date) = birth_date),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP CHECK (datetime(created_at) IS NOT NULL)
) STRICT;

CREATE TABLE IF NOT EXISTS admission_cycles (
  id INTEGER PRIMARY KEY,
  cycle_year INTEGER NOT NULL UNIQUE CHECK (cycle_year BETWEEN 2020 AND 2100),
  name TEXT NOT NULL UNIQUE CHECK (name = trim(name) AND length(name) BETWEEN 4 AND 80),
  opens_at TEXT NOT NULL CHECK (datetime(opens_at) IS NOT NULL),
  closes_at TEXT NOT NULL CHECK (datetime(closes_at) IS NOT NULL AND datetime(closes_at) > datetime(opens_at)),
  status TEXT NOT NULL CHECK (status IN ('PLANNED', 'OPEN', 'CLOSED')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP CHECK (datetime(created_at) IS NOT NULL)
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_admission_cycles_single_open
  ON admission_cycles(status) WHERE status = 'OPEN';

CREATE TABLE IF NOT EXISTS programmes (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (code = upper(trim(code)) AND length(code) BETWEEN 3 AND 20),
  name TEXT NOT NULL CHECK (name = trim(name) AND length(name) BETWEEN 4 AND 160),
  school TEXT NOT NULL CHECK (school = trim(school) AND length(school) BETWEEN 3 AND 120),
  degree_level TEXT NOT NULL CHECK (degree_level IN ('UG', 'PG')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
) STRICT;

CREATE TABLE IF NOT EXISTS programme_offerings (
  id INTEGER PRIMARY KEY,
  programme_id INTEGER NOT NULL REFERENCES programmes(id) ON DELETE RESTRICT,
  cycle_id INTEGER NOT NULL REFERENCES admission_cycles(id) ON DELETE RESTRICT,
  capacity INTEGER NOT NULL CHECK (capacity > 0),
  application_deadline TEXT NOT NULL CHECK (datetime(application_deadline) IS NOT NULL),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP CHECK (datetime(created_at) IS NOT NULL),
  UNIQUE (programme_id, cycle_id)
) STRICT;

CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY,
  application_no TEXT NOT NULL UNIQUE CHECK (application_no = trim(application_no) AND length(application_no) BETWEEN 6 AND 30),
  applicant_id INTEGER NOT NULL REFERENCES applicants(id) ON DELETE RESTRICT,
  cycle_id INTEGER NOT NULL REFERENCES admission_cycles(id) ON DELETE RESTRICT,
  degree_level TEXT NOT NULL CHECK (degree_level IN ('UG', 'PG')),
  submitted_at TEXT CHECK (submitted_at IS NULL OR datetime(submitted_at) IS NOT NULL),
  assigned_to INTEGER REFERENCES staff_users(id) ON DELETE SET NULL,
  last_updated TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP CHECK (datetime(last_updated) IS NOT NULL),
  UNIQUE (applicant_id, cycle_id)
) STRICT;

CREATE TABLE IF NOT EXISTS application_choices (
  id INTEGER PRIMARY KEY,
  application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  programme_offering_id INTEGER NOT NULL REFERENCES programme_offerings(id) ON DELETE RESTRICT,
  preference_rank INTEGER NOT NULL CHECK (preference_rank BETWEEN 1 AND 3),
  academic_score REAL NOT NULL CHECK (academic_score BETWEEN 0 AND 100),
  UNIQUE (application_id, programme_offering_id),
  UNIQUE (application_id, preference_rank)
) STRICT;

CREATE TABLE IF NOT EXISTS education_records (
  id INTEGER PRIMARY KEY,
  applicant_id INTEGER NOT NULL REFERENCES applicants(id) ON DELETE CASCADE,
  institution TEXT NOT NULL CHECK (institution = trim(institution) AND length(institution) BETWEEN 2 AND 160),
  qualification TEXT NOT NULL CHECK (qualification = trim(qualification) AND length(qualification) BETWEEN 2 AND 120),
  field_of_study TEXT NOT NULL CHECK (field_of_study = trim(field_of_study) AND length(field_of_study) BETWEEN 2 AND 120),
  grade TEXT NOT NULL CHECK (grade = trim(grade) AND length(grade) BETWEEN 1 AND 40),
  graduation_year INTEGER NOT NULL CHECK (graduation_year BETWEEN 1950 AND 2100),
  UNIQUE (applicant_id, institution, qualification, graduation_year)
) STRICT;

CREATE TABLE IF NOT EXISTS document_requirements (
  id INTEGER PRIMARY KEY,
  cycle_id INTEGER NOT NULL REFERENCES admission_cycles(id) ON DELETE RESTRICT,
  degree_level TEXT NOT NULL CHECK (degree_level IN ('UG', 'PG')),
  document_type TEXT NOT NULL CHECK (document_type IN ('ID', 'TRANSCRIPT', 'CV', 'PERSONAL_STATEMENT', 'REFERENCE')),
  required_by_status TEXT NOT NULL CHECK (required_by_status IN ('SUBMITTED', 'SCREENING', 'REVIEW', 'INTERVIEW', 'WAITLISTED', 'OFFERED')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  UNIQUE (cycle_id, degree_level, document_type)
) STRICT;

CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY,
  application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL CHECK (document_type IN ('ID', 'TRANSCRIPT', 'CV', 'PERSONAL_STATEMENT', 'REFERENCE')),
  file_name TEXT NOT NULL CHECK (file_name = trim(file_name) AND length(file_name) BETWEEN 3 AND 255),
  verification_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (verification_status IN ('PENDING', 'VERIFIED', 'REJECTED')),
  uploaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP CHECK (datetime(uploaded_at) IS NOT NULL),
  reviewed_by INTEGER REFERENCES staff_users(id) ON DELETE SET NULL,
  reviewed_at TEXT CHECK (reviewed_at IS NULL OR datetime(reviewed_at) IS NOT NULL),
  CHECK (
    (verification_status = 'PENDING' AND reviewed_by IS NULL AND reviewed_at IS NULL)
    OR (verification_status IN ('VERIFIED', 'REJECTED') AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
  ),
  UNIQUE (application_id, document_type)
) STRICT;

CREATE TABLE IF NOT EXISTS interview_sessions (
  id INTEGER PRIMARY KEY,
  application_choice_id INTEGER NOT NULL REFERENCES application_choices(id) ON DELETE CASCADE,
  scheduled_at TEXT NOT NULL CHECK (datetime(scheduled_at) IS NOT NULL),
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes BETWEEN 15 AND 240),
  mode TEXT NOT NULL CHECK (mode IN ('IN_PERSON', 'ONLINE', 'HYBRID')),
  location TEXT NOT NULL CHECK (location = trim(location) AND length(location) BETWEEN 2 AND 160),
  status TEXT NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW')),
  score REAL CHECK (score IS NULL OR score BETWEEN 0 AND 100),
  feedback TEXT CHECK (feedback IS NULL OR length(trim(feedback)) BETWEEN 5 AND 2000),
  created_by INTEGER NOT NULL REFERENCES staff_users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP CHECK (datetime(created_at) IS NOT NULL),
  CHECK (
    (status = 'COMPLETED' AND score IS NOT NULL AND feedback IS NOT NULL)
    OR (status <> 'COMPLETED' AND score IS NULL)
  )
) STRICT;

CREATE TABLE IF NOT EXISTS interview_panel_members (
  interview_session_id INTEGER NOT NULL REFERENCES interview_sessions(id) ON DELETE CASCADE,
  staff_user_id INTEGER NOT NULL REFERENCES staff_users(id) ON DELETE RESTRICT,
  panel_role TEXT NOT NULL CHECK (panel_role IN ('CHAIR', 'MEMBER')),
  PRIMARY KEY (interview_session_id, staff_user_id)
) WITHOUT ROWID, STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_interview_one_chair
  ON interview_panel_members(interview_session_id) WHERE panel_role = 'CHAIR';

CREATE TABLE IF NOT EXISTS decisions (
  id INTEGER PRIMARY KEY,
  application_choice_id INTEGER NOT NULL REFERENCES application_choices(id) ON DELETE RESTRICT,
  decision TEXT NOT NULL CHECK (decision IN ('OFFER', 'REJECT', 'WAITLIST')),
  rationale TEXT NOT NULL CHECK (length(trim(rationale)) BETWEEN 5 AND 2000),
  decided_by INTEGER NOT NULL REFERENCES staff_users(id) ON DELETE RESTRICT,
  decided_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP CHECK (datetime(decided_at) IS NOT NULL),
  supersedes_decision_id INTEGER REFERENCES decisions(id) ON DELETE RESTRICT,
  CHECK (supersedes_decision_id IS NULL OR supersedes_decision_id <> id)
) STRICT;

CREATE TABLE IF NOT EXISTS status_transitions (
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  requires_reason INTEGER NOT NULL DEFAULT 0 CHECK (requires_reason IN (0, 1)),
  PRIMARY KEY (from_status, to_status),
  CHECK (from_status IN ('DRAFT', 'SUBMITTED', 'SCREENING', 'REVIEW', 'INTERVIEW', 'WAITLISTED', 'OFFERED')),
  CHECK (to_status IN ('SUBMITTED', 'SCREENING', 'REVIEW', 'INTERVIEW', 'WAITLISTED', 'OFFERED', 'ACCEPTED', 'DECLINED', 'WITHDRAWN')),
  CHECK (from_status <> to_status)
) WITHOUT ROWID, STRICT;

CREATE TABLE IF NOT EXISTS status_history (
  id INTEGER PRIMARY KEY,
  application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE RESTRICT,
  from_status TEXT,
  to_status TEXT NOT NULL CHECK (to_status IN ('DRAFT', 'SUBMITTED', 'SCREENING', 'REVIEW', 'INTERVIEW', 'WAITLISTED', 'OFFERED', 'ACCEPTED', 'DECLINED', 'WITHDRAWN')),
  changed_by INTEGER NOT NULL REFERENCES staff_users(id) ON DELETE RESTRICT,
  reason TEXT CHECK (reason IS NULL OR length(trim(reason)) BETWEEN 3 AND 1000),
  changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP CHECK (datetime(changed_at) IS NOT NULL),
  CHECK (from_status IS NULL OR from_status IN ('DRAFT', 'SUBMITTED', 'SCREENING', 'REVIEW', 'INTERVIEW', 'WAITLISTED', 'OFFERED'))
) STRICT;

CREATE TABLE IF NOT EXISTS waitlist_entries (
  id INTEGER PRIMARY KEY,
  application_choice_id INTEGER NOT NULL REFERENCES application_choices(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'CONVERTED', 'REMOVED')),
  joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP CHECK (datetime(joined_at) IS NOT NULL),
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 3 AND 1000),
  handled_by INTEGER REFERENCES staff_users(id) ON DELETE RESTRICT,
  handled_at TEXT CHECK (handled_at IS NULL OR datetime(handled_at) IS NOT NULL),
  CHECK (
    (status = 'ACTIVE' AND handled_by IS NULL AND handled_at IS NULL)
    OR (status IN ('CONVERTED', 'REMOVED') AND handled_by IS NOT NULL AND handled_at IS NOT NULL)
  )
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_waitlist_active_choice
  ON waitlist_entries(application_choice_id) WHERE status = 'ACTIVE';

CREATE TABLE IF NOT EXISTS scholarships (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (code = upper(trim(code)) AND length(code) BETWEEN 3 AND 30),
  name TEXT NOT NULL CHECK (name = trim(name) AND length(name) BETWEEN 4 AND 160),
  amount_hkd INTEGER NOT NULL CHECK (amount_hkd > 0),
  minimum_score REAL NOT NULL CHECK (minimum_score BETWEEN 0 AND 100),
  places INTEGER NOT NULL CHECK (places > 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
) STRICT;

CREATE TABLE IF NOT EXISTS scholarship_applications (
  id INTEGER PRIMARY KEY,
  application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  scholarship_id INTEGER NOT NULL REFERENCES scholarships(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('NOMINATED', 'AWARDED', 'DECLINED')),
  awarded_amount_hkd INTEGER,
  decided_by INTEGER REFERENCES staff_users(id) ON DELETE RESTRICT,
  decided_at TEXT CHECK (decided_at IS NULL OR datetime(decided_at) IS NOT NULL),
  CHECK (
    (status = 'NOMINATED' AND awarded_amount_hkd IS NULL AND decided_by IS NULL AND decided_at IS NULL)
    OR (status = 'AWARDED' AND awarded_amount_hkd > 0 AND decided_by IS NOT NULL AND decided_at IS NOT NULL)
    OR (status = 'DECLINED' AND awarded_amount_hkd IS NULL AND decided_by IS NOT NULL AND decided_at IS NOT NULL)
  ),
  UNIQUE (application_id, scholarship_id)
) STRICT;

CREATE TABLE IF NOT EXISTS review_notes (
  id INTEGER PRIMARY KEY,
  application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  author_id INTEGER NOT NULL REFERENCES staff_users(id) ON DELETE RESTRICT,
  note TEXT NOT NULL CHECK (length(trim(note)) BETWEEN 2 AND 1000),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP CHECK (datetime(created_at) IS NOT NULL)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_applications_cycle_dates
  ON applications(cycle_id, submitted_at, id);
CREATE INDEX IF NOT EXISTS idx_applications_assignee_open
  ON applications(assigned_to, cycle_id) WHERE assigned_to IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_choices_offering_rank_score
  ON application_choices(programme_offering_id, preference_rank, academic_score DESC);
CREATE INDEX IF NOT EXISTS idx_documents_compliance
  ON documents(application_id, document_type, verification_status);
CREATE INDEX IF NOT EXISTS idx_history_chronology
  ON status_history(application_id, datetime(changed_at) DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_history_cycle_status_date
  ON status_history(to_status, changed_at, application_id);
CREATE INDEX IF NOT EXISTS idx_interview_schedule
  ON interview_sessions(scheduled_at, status, application_choice_id);
CREATE INDEX IF NOT EXISTS idx_panel_staff_schedule
  ON interview_panel_members(staff_user_id, interview_session_id);
CREATE INDEX IF NOT EXISTS idx_decisions_choice_latest
  ON decisions(application_choice_id, datetime(decided_at) DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_waitlist_status_joined
  ON waitlist_entries(status, joined_at, application_choice_id);
CREATE INDEX IF NOT EXISTS idx_scholarship_status
  ON scholarship_applications(scholarship_id, status, application_id);

CREATE VIEW IF NOT EXISTS v_application_current_status AS
SELECT application_id, to_status AS current_status, changed_at AS status_changed_at
FROM (
  SELECT sh.*,
         ROW_NUMBER() OVER (PARTITION BY application_id ORDER BY datetime(changed_at) DESC, id DESC) AS row_num
  FROM status_history sh
)
WHERE row_num = 1;

CREATE VIEW IF NOT EXISTS v_current_decisions AS
SELECT id, application_choice_id, decision, rationale, decided_by, decided_at, supersedes_decision_id
FROM (
  SELECT d.*,
         ROW_NUMBER() OVER (PARTITION BY application_choice_id ORDER BY datetime(decided_at) DESC, id DESC) AS row_num
  FROM decisions d
)
WHERE row_num = 1;

CREATE VIEW IF NOT EXISTS v_document_compliance AS
SELECT
  a.id AS application_id,
  COUNT(dr.id) AS required_count,
  SUM(CASE WHEN d.verification_status = 'VERIFIED' THEN 1 ELSE 0 END) AS verified_count,
  SUM(CASE WHEN d.id IS NULL THEN 1 ELSE 0 END) AS missing_count,
  SUM(CASE WHEN d.verification_status = 'PENDING' THEN 1 ELSE 0 END) AS pending_count,
  SUM(CASE WHEN d.verification_status = 'REJECTED' THEN 1 ELSE 0 END) AS rejected_count,
  CASE
    WHEN COUNT(dr.id) > 0
     AND COUNT(dr.id) = SUM(CASE WHEN d.verification_status = 'VERIFIED' THEN 1 ELSE 0 END)
    THEN 1 ELSE 0
  END AS compliant
FROM applications a
JOIN document_requirements dr
  ON dr.cycle_id = a.cycle_id
 AND dr.degree_level = a.degree_level
 AND dr.active = 1
LEFT JOIN documents d
  ON d.application_id = a.id
 AND d.document_type = dr.document_type
GROUP BY a.id;

CREATE VIEW IF NOT EXISTS v_application_risks AS
SELECT
  a.id AS application_id,
  CASE
    WHEN COALESCE(dc.missing_count, 0) > 0 OR COALESCE(dc.pending_count, 0) > 0 OR COALESCE(dc.rejected_count, 0) > 0 THEN 'MISSING_DOCS'
    WHEN EXISTS (
      SELECT 1 FROM application_choices ac
      JOIN programme_offerings po ON po.id = ac.programme_offering_id
      WHERE ac.application_id = a.id
        AND a.submitted_at IS NOT NULL
        AND datetime(a.submitted_at) > datetime(po.application_deadline)
    ) THEN 'DEADLINE'
    ELSE 'NONE'
  END AS risk_flag
FROM applications a
LEFT JOIN v_document_compliance dc ON dc.application_id = a.id;

CREATE VIEW IF NOT EXISTS v_application_register AS
SELECT
  a.id,
  a.application_no,
  a.applicant_id,
  ap.applicant_no,
  ap.first_name,
  ap.last_name,
  ap.email,
  ap.nationality,
  a.cycle_id,
  c.cycle_year,
  c.name AS cycle_name,
  a.degree_level,
  a.submitted_at,
  a.assigned_to,
  su.name AS assigned_name,
  COALESCE(cs.current_status, 'DRAFT') AS status,
  COALESCE(r.risk_flag, 'NONE') AS risk_flag,
  a.last_updated
FROM applications a
JOIN applicants ap ON ap.id = a.applicant_id
JOIN admission_cycles c ON c.id = a.cycle_id
LEFT JOIN staff_users su ON su.id = a.assigned_to
LEFT JOIN v_application_current_status cs ON cs.application_id = a.id
LEFT JOIN v_application_risks r ON r.application_id = a.id;

CREATE VIEW IF NOT EXISTS v_programme_capacity AS
SELECT
  po.id AS programme_offering_id,
  po.cycle_id,
  p.id AS programme_id,
  p.code,
  p.name,
  p.school,
  p.degree_level,
  po.capacity,
  SUM(CASE WHEN ac.preference_rank = 1 THEN 1 ELSE 0 END) AS first_choice_demand,
  SUM(CASE WHEN ac.preference_rank = 1 AND cs.current_status = 'ACCEPTED' THEN 1 ELSE 0 END) AS accepted_count,
  po.capacity - SUM(CASE WHEN ac.preference_rank = 1 AND cs.current_status = 'ACCEPTED' THEN 1 ELSE 0 END) AS remaining_places,
  po.application_deadline,
  po.active
FROM programme_offerings po
JOIN programmes p ON p.id = po.programme_id
LEFT JOIN application_choices ac ON ac.programme_offering_id = po.id
LEFT JOIN v_application_current_status cs ON cs.application_id = ac.application_id
GROUP BY po.id;

CREATE VIEW IF NOT EXISTS v_reviewer_workload AS
SELECT
  su.id AS staff_user_id,
  su.name,
  su.role,
  a.cycle_id,
  SUM(CASE WHEN cs.current_status IS NOT NULL THEN 1 ELSE 0 END) AS open_cases
FROM staff_users su
LEFT JOIN applications a ON a.assigned_to = su.id
LEFT JOIN v_application_current_status cs ON cs.application_id = a.id
  AND cs.current_status NOT IN ('ACCEPTED', 'DECLINED', 'WITHDRAWN')
WHERE su.active = 1 AND su.role IN ('ADMISSIONS', 'REVIEWER')
GROUP BY su.id, a.cycle_id;

CREATE VIEW IF NOT EXISTS v_waitlist_ranking AS
WITH latest_interviews AS (
  SELECT application_choice_id, score
  FROM (
    SELECT
      application_choice_id,
      score,
      ROW_NUMBER() OVER (PARTITION BY application_choice_id ORDER BY datetime(scheduled_at) DESC, id DESC) AS row_num
    FROM interview_sessions
    WHERE status = 'COMPLETED'
  )
  WHERE row_num = 1
), active_waitlist AS (
  SELECT
    we.id AS waitlist_entry_id,
    we.application_choice_id,
    we.joined_at,
    ac.programme_offering_id,
    ac.application_id,
    ac.academic_score,
    COALESCE(li.score, ac.academic_score) AS interview_score,
    ROUND((ac.academic_score * 0.7) + (COALESCE(li.score, ac.academic_score) * 0.3), 2) AS ranking_score
  FROM waitlist_entries we
  JOIN application_choices ac ON ac.id = we.application_choice_id
  LEFT JOIN latest_interviews li ON li.application_choice_id = ac.id
  WHERE we.status = 'ACTIVE'
)
SELECT
  *,
  ROW_NUMBER() OVER (
    PARTITION BY programme_offering_id
    ORDER BY ranking_score DESC, datetime(joined_at), waitlist_entry_id
  ) AS waitlist_rank
FROM active_waitlist;

CREATE TRIGGER IF NOT EXISTS applicants_validate_age_insert
BEFORE INSERT ON applicants
BEGIN
  SELECT CASE
    WHEN date(NEW.birth_date) > date('now', '-16 years')
      OR date(NEW.birth_date) < date('now', '-81 years', '+1 day')
    THEN RAISE(ABORT, 'Applicant must be between 16 and 80 years old')
  END;
END;

CREATE TRIGGER IF NOT EXISTS applicants_validate_age_update
BEFORE UPDATE OF birth_date ON applicants
BEGIN
  SELECT CASE
    WHEN date(NEW.birth_date) > date('now', '-16 years')
      OR date(NEW.birth_date) < date('now', '-81 years', '+1 day')
    THEN RAISE(ABORT, 'Applicant must be between 16 and 80 years old')
  END;
END;

CREATE TRIGGER IF NOT EXISTS applications_validate_assignment_insert
BEFORE INSERT ON applications WHEN NEW.assigned_to IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM staff_users
    WHERE id = NEW.assigned_to AND active = 1 AND role IN ('ADMISSIONS', 'REVIEWER')
  ) THEN RAISE(ABORT, 'Application assignee must be active admissions or reviewer staff') END;
END;

CREATE TRIGGER IF NOT EXISTS applications_validate_assignment_update
BEFORE UPDATE OF assigned_to ON applications WHEN NEW.assigned_to IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM staff_users
    WHERE id = NEW.assigned_to AND active = 1 AND role IN ('ADMISSIONS', 'REVIEWER')
  ) THEN RAISE(ABORT, 'Application assignee must be active admissions or reviewer staff') END;
END;

CREATE TRIGGER IF NOT EXISTS choices_validate_insert
BEFORE INSERT ON application_choices
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM applications a
    JOIN programme_offerings po ON po.id = NEW.programme_offering_id
    JOIN programmes p ON p.id = po.programme_id
    WHERE a.id = NEW.application_id
      AND a.cycle_id = po.cycle_id
      AND a.degree_level = p.degree_level
      AND po.active = 1
      AND p.active = 1
  ) THEN RAISE(ABORT, 'Choice offering must match application cycle and degree level') END;
  SELECT CASE WHEN NEW.preference_rank <> (
    SELECT COUNT(*) + 1 FROM application_choices WHERE application_id = NEW.application_id
  ) THEN RAISE(ABORT, 'Preference ranks must be contiguous') END;
END;

CREATE TRIGGER IF NOT EXISTS choices_validate_update
BEFORE UPDATE OF application_id, programme_offering_id, preference_rank ON application_choices
BEGIN
  SELECT RAISE(ABORT, 'Application choice identity and rank are immutable');
END;

CREATE TRIGGER IF NOT EXISTS choices_validate_delete
BEFORE DELETE ON application_choices
WHEN EXISTS (
  SELECT 1 FROM application_choices
  WHERE application_id = OLD.application_id AND preference_rank > OLD.preference_rank
)
BEGIN
  SELECT RAISE(ABORT, 'Cannot create a gap in preference ranks');
END;

CREATE TRIGGER IF NOT EXISTS status_history_validate_insert
BEFORE INSERT ON status_history
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM status_history WHERE application_id = NEW.application_id)
      AND (NEW.from_status IS NOT NULL OR NEW.to_status NOT IN ('DRAFT', 'SUBMITTED'))
    THEN RAISE(ABORT, 'Initial status must be DRAFT or SUBMITTED with no from_status')
  END;
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM status_history WHERE application_id = NEW.application_id)
      AND NEW.from_status IS NOT (
        SELECT to_status FROM status_history
        WHERE application_id = NEW.application_id
        ORDER BY datetime(changed_at) DESC, id DESC LIMIT 1
      )
    THEN RAISE(ABORT, 'from_status does not match current application status')
  END;
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM status_history WHERE application_id = NEW.application_id)
      AND NOT EXISTS (
        SELECT 1 FROM status_transitions
        WHERE from_status = NEW.from_status AND to_status = NEW.to_status
      )
    THEN RAISE(ABORT, 'Illegal application status transition')
  END;
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM status_transitions
      WHERE from_status = NEW.from_status
        AND to_status = NEW.to_status
        AND requires_reason = 1
    ) AND (NEW.reason IS NULL OR length(trim(NEW.reason)) < 3)
    THEN RAISE(ABORT, 'A reason is required for this status transition')
  END;
  SELECT CASE
    WHEN NEW.to_status IN ('OFFERED', 'ACCEPTED')
      AND NOT EXISTS (
        SELECT 1 FROM v_document_compliance
        WHERE application_id = NEW.application_id AND compliant = 1
      )
    THEN RAISE(ABORT, 'All required documents must be verified before offer or acceptance')
  END;
  SELECT CASE
    WHEN NEW.to_status = 'ACCEPTED' AND (
      SELECT remaining_places FROM v_programme_capacity
      WHERE programme_offering_id = (
        SELECT programme_offering_id FROM application_choices
        WHERE application_id = NEW.application_id AND preference_rank = 1
      )
    ) <= 0
    THEN RAISE(ABORT, 'Programme offering capacity has been reached')
  END;
END;

CREATE TRIGGER IF NOT EXISTS status_history_no_update
BEFORE UPDATE ON status_history
BEGIN
  SELECT RAISE(ABORT, 'Status history is append-only');
END;

CREATE TRIGGER IF NOT EXISTS status_history_no_delete
BEFORE DELETE ON status_history
BEGIN
  SELECT RAISE(ABORT, 'Status history is append-only');
END;

CREATE TRIGGER IF NOT EXISTS decisions_no_update
BEFORE UPDATE ON decisions
BEGIN
  SELECT RAISE(ABORT, 'Decision history is append-only');
END;

CREATE TRIGGER IF NOT EXISTS decisions_no_delete
BEFORE DELETE ON decisions
BEGIN
  SELECT RAISE(ABORT, 'Decision history is append-only');
END;

CREATE TRIGGER IF NOT EXISTS offerings_capacity_guard
BEFORE UPDATE OF capacity ON programme_offerings
BEGIN
  SELECT CASE WHEN NEW.capacity < (
    SELECT accepted_count FROM v_programme_capacity WHERE programme_offering_id = OLD.id
  ) THEN RAISE(ABORT, 'Capacity cannot be lower than accepted enrolments') END;
END;

CREATE TRIGGER IF NOT EXISTS documents_validate_reviewer_insert
BEFORE INSERT ON documents WHEN NEW.reviewed_by IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM staff_users WHERE id = NEW.reviewed_by AND active = 1
  ) THEN RAISE(ABORT, 'Document reviewer must be active staff') END;
END;

CREATE TRIGGER IF NOT EXISTS documents_validate_reviewer_update
BEFORE UPDATE OF verification_status, reviewed_by, reviewed_at ON documents WHEN NEW.reviewed_by IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM staff_users WHERE id = NEW.reviewed_by AND active = 1
  ) THEN RAISE(ABORT, 'Document reviewer must be active staff') END;
END;

CREATE TRIGGER IF NOT EXISTS interview_completion_guard_insert
BEFORE INSERT ON interview_sessions WHEN NEW.status = 'COMPLETED'
BEGIN
  SELECT RAISE(ABORT, 'Create the interview and assign a panel before completion');
END;

CREATE TRIGGER IF NOT EXISTS interview_completion_guard_update
BEFORE UPDATE OF status, score, feedback ON interview_sessions WHEN NEW.status = 'COMPLETED'
BEGIN
  SELECT CASE WHEN NEW.score IS NULL OR NEW.feedback IS NULL OR length(trim(NEW.feedback)) < 5
    THEN RAISE(ABORT, 'Completed interview requires score and feedback') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM interview_panel_members WHERE interview_session_id = OLD.id
  ) THEN RAISE(ABORT, 'Completed interview requires at least one panel member') END;
END;

CREATE TRIGGER IF NOT EXISTS interview_panel_overlap_insert
BEFORE INSERT ON interview_panel_members
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM interview_panel_members existing
    JOIN interview_sessions old_session ON old_session.id = existing.interview_session_id
    JOIN interview_sessions new_session ON new_session.id = NEW.interview_session_id
    WHERE existing.staff_user_id = NEW.staff_user_id
      AND old_session.status = 'SCHEDULED'
      AND new_session.status = 'SCHEDULED'
      AND datetime(old_session.scheduled_at) < datetime(new_session.scheduled_at, '+' || new_session.duration_minutes || ' minutes')
      AND datetime(new_session.scheduled_at) < datetime(old_session.scheduled_at, '+' || old_session.duration_minutes || ' minutes')
  ) THEN RAISE(ABORT, 'Panel member has an overlapping interview') END;
END;

CREATE TRIGGER IF NOT EXISTS interview_schedule_overlap_update
BEFORE UPDATE OF scheduled_at, duration_minutes, status ON interview_sessions
WHEN NEW.status = 'SCHEDULED'
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM interview_panel_members current_panel
    JOIN interview_panel_members other_panel ON other_panel.staff_user_id = current_panel.staff_user_id
    JOIN interview_sessions other_session ON other_session.id = other_panel.interview_session_id
    WHERE current_panel.interview_session_id = OLD.id
      AND other_session.id <> OLD.id
      AND other_session.status = 'SCHEDULED'
      AND datetime(other_session.scheduled_at) < datetime(NEW.scheduled_at, '+' || NEW.duration_minutes || ' minutes')
      AND datetime(NEW.scheduled_at) < datetime(other_session.scheduled_at, '+' || other_session.duration_minutes || ' minutes')
  ) THEN RAISE(ABORT, 'Panel member has an overlapping interview') END;
END;

CREATE TRIGGER IF NOT EXISTS scholarship_award_guard_insert
BEFORE INSERT ON scholarship_applications WHEN NEW.status = 'AWARDED'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM scholarships s
    WHERE s.id = NEW.scholarship_id
      AND s.active = 1
      AND NEW.awarded_amount_hkd <= s.amount_hkd
      AND s.minimum_score <= (
        SELECT MAX(academic_score) FROM application_choices WHERE application_id = NEW.application_id
      )
      AND s.places > (
        SELECT COUNT(*) FROM scholarship_applications sa
        WHERE sa.scholarship_id = NEW.scholarship_id AND sa.status = 'AWARDED'
      )
  ) THEN RAISE(ABORT, 'Scholarship award violates active, amount, score, or places rule') END;
END;

CREATE TRIGGER IF NOT EXISTS scholarship_award_guard_update
BEFORE UPDATE OF scholarship_id, status, awarded_amount_hkd ON scholarship_applications
WHEN NEW.status = 'AWARDED' AND OLD.status <> 'AWARDED'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM scholarships s
    WHERE s.id = NEW.scholarship_id
      AND s.active = 1
      AND NEW.awarded_amount_hkd <= s.amount_hkd
      AND s.minimum_score <= (
        SELECT MAX(academic_score) FROM application_choices WHERE application_id = NEW.application_id
      )
      AND s.places > (
        SELECT COUNT(*) FROM scholarship_applications sa
        WHERE sa.scholarship_id = NEW.scholarship_id AND sa.status = 'AWARDED'
      )
  ) THEN RAISE(ABORT, 'Scholarship award violates active, amount, score, or places rule') END;
END;

INSERT OR IGNORE INTO status_transitions (from_status, to_status, requires_reason) VALUES
  ('DRAFT', 'SUBMITTED', 0),
  ('DRAFT', 'WITHDRAWN', 1),
  ('SUBMITTED', 'SCREENING', 0),
  ('SUBMITTED', 'WITHDRAWN', 1),
  ('SCREENING', 'REVIEW', 0),
  ('SCREENING', 'DECLINED', 1),
  ('SCREENING', 'WITHDRAWN', 1),
  ('REVIEW', 'INTERVIEW', 0),
  ('REVIEW', 'WAITLISTED', 1),
  ('REVIEW', 'OFFERED', 1),
  ('REVIEW', 'DECLINED', 1),
  ('REVIEW', 'WITHDRAWN', 1),
  ('INTERVIEW', 'WAITLISTED', 1),
  ('INTERVIEW', 'OFFERED', 1),
  ('INTERVIEW', 'DECLINED', 1),
  ('INTERVIEW', 'WITHDRAWN', 1),
  ('WAITLISTED', 'OFFERED', 1),
  ('WAITLISTED', 'DECLINED', 1),
  ('WAITLISTED', 'WITHDRAWN', 1),
  ('OFFERED', 'ACCEPTED', 0),
  ('OFFERED', 'DECLINED', 1),
  ('OFFERED', 'WITHDRAWN', 1);
