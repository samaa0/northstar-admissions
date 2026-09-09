PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS staff_users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('ADMIN', 'ADMISSIONS', 'REVIEWER')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);

CREATE TABLE IF NOT EXISTS applicants (
  id INTEGER PRIMARY KEY,
  applicant_no TEXT NOT NULL UNIQUE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  preferred_name TEXT,
  email TEXT NOT NULL UNIQUE,
  phone TEXT NOT NULL,
  nationality TEXT NOT NULL,
  birth_date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS programmes (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  school TEXT NOT NULL,
  degree_level TEXT NOT NULL CHECK (degree_level IN ('UG', 'PG')),
  capacity INTEGER NOT NULL CHECK (capacity > 0),
  deadline TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);

CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY,
  application_no TEXT NOT NULL UNIQUE,
  applicant_id INTEGER NOT NULL REFERENCES applicants(id) ON DELETE RESTRICT,
  intake_year INTEGER NOT NULL CHECK (intake_year BETWEEN 2026 AND 2100),
  submitted_at TEXT,
  status TEXT NOT NULL CHECK (status IN (
    'DRAFT', 'SUBMITTED', 'SCREENING', 'REVIEW', 'INTERVIEW',
    'OFFERED', 'ACCEPTED', 'DECLINED', 'WITHDRAWN'
  )),
  risk_flag TEXT NOT NULL DEFAULT 'NONE' CHECK (risk_flag IN ('NONE', 'MISSING_DOCS', 'DEADLINE', 'DUPLICATE')),
  assigned_to INTEGER REFERENCES staff_users(id) ON DELETE SET NULL,
  last_updated TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (applicant_id, intake_year)
);

CREATE TABLE IF NOT EXISTS application_choices (
  id INTEGER PRIMARY KEY,
  application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  programme_id INTEGER NOT NULL REFERENCES programmes(id) ON DELETE RESTRICT,
  preference_rank INTEGER NOT NULL CHECK (preference_rank BETWEEN 1 AND 3),
  academic_score REAL CHECK (academic_score BETWEEN 0 AND 100),
  interview_score REAL CHECK (interview_score BETWEEN 0 AND 100),
  choice_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (choice_status IN ('PENDING', 'SHORTLISTED', 'OFFERED', 'REJECTED')),
  UNIQUE (application_id, programme_id),
  UNIQUE (application_id, preference_rank)
);

CREATE TABLE IF NOT EXISTS education_records (
  id INTEGER PRIMARY KEY,
  applicant_id INTEGER NOT NULL REFERENCES applicants(id) ON DELETE CASCADE,
  institution TEXT NOT NULL,
  qualification TEXT NOT NULL,
  field_of_study TEXT NOT NULL,
  grade TEXT NOT NULL,
  graduation_year INTEGER NOT NULL CHECK (graduation_year BETWEEN 1950 AND 2100)
);

CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY,
  application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL CHECK (document_type IN ('ID', 'TRANSCRIPT', 'CV', 'PERSONAL_STATEMENT', 'REFERENCE')),
  file_name TEXT NOT NULL,
  verification_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (verification_status IN ('PENDING', 'VERIFIED', 'REJECTED')),
  uploaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  verified_by INTEGER REFERENCES staff_users(id) ON DELETE SET NULL,
  UNIQUE (application_id, document_type)
);

CREATE TABLE IF NOT EXISTS decisions (
  id INTEGER PRIMARY KEY,
  application_choice_id INTEGER NOT NULL REFERENCES application_choices(id) ON DELETE CASCADE,
  decision TEXT NOT NULL CHECK (decision IN ('OFFER', 'REJECT', 'WAITLIST')),
  rationale TEXT NOT NULL,
  decided_by INTEGER NOT NULL REFERENCES staff_users(id) ON DELETE RESTRICT,
  decided_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (application_choice_id)
);

CREATE TABLE IF NOT EXISTS status_history (
  id INTEGER PRIMARY KEY,
  application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  changed_by INTEGER NOT NULL REFERENCES staff_users(id) ON DELETE RESTRICT,
  note TEXT,
  changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS scholarships (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  amount_hkd INTEGER NOT NULL CHECK (amount_hkd > 0),
  minimum_score REAL NOT NULL CHECK (minimum_score BETWEEN 0 AND 100),
  places INTEGER NOT NULL CHECK (places > 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);

CREATE TABLE IF NOT EXISTS scholarship_applications (
  id INTEGER PRIMARY KEY,
  application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  scholarship_id INTEGER NOT NULL REFERENCES scholarships(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('NOMINATED', 'AWARDED', 'DECLINED')),
  awarded_amount_hkd INTEGER CHECK (awarded_amount_hkd >= 0),
  UNIQUE (application_id, scholarship_id)
);

CREATE TABLE IF NOT EXISTS review_notes (
  id INTEGER PRIMARY KEY,
  application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  author_id INTEGER NOT NULL REFERENCES staff_users(id) ON DELETE RESTRICT,
  note TEXT NOT NULL CHECK (length(note) BETWEEN 2 AND 1000),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status);
CREATE INDEX IF NOT EXISTS idx_applications_assigned_to ON applications(assigned_to);
CREATE INDEX IF NOT EXISTS idx_choices_programme ON application_choices(programme_id);
CREATE INDEX IF NOT EXISTS idx_documents_application ON documents(application_id);
CREATE INDEX IF NOT EXISTS idx_history_application ON status_history(application_id, changed_at);
