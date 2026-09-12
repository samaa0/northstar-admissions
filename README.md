# HKUST Student Admission System

HKUST Student Admission System is a complete admissions decision desk with a responsive React interface, a validated Express API, and a normalized 19-relation relational database. The local application uses SQLite, while the production deployment uses the equivalent persistent Turso/libSQL database. The system includes admission cycles, annual programme offerings, ranked choices, requirement-driven evidence, review workflows, append-only audit history, interviews, panels, waitlists, scholarships, and 15 live managerial reports.

Live system: https://northstar-admissions-bay.vercel.app

Source repository: https://github.com/samaa0/northstar-admissions

Public demonstration repository. All records are fictional.

## Run the project

Prerequisites: Node.js 22.22.2+ (22.x), 24.15.0+ (24.x), or 26+, and pnpm. The DOM test environment requires these Node versions.

```bash
pnpm install
pnpm dev
```

Open `http://127.0.0.1:5173`. The API runs on `http://127.0.0.1:3001` and the persistent database is created at `data/admissions.db`. Demonstration data is inserted automatically when the database is empty.

## Assessment highlights

- Nineteen business relations plus a technical `schema_migrations` table, with primary keys, foreign keys, CHECK/UNIQUE constraints, views, triggers, indexes and a documented 3NF design.
- Transactional applicant intake with field, age, email, academic-score, and ranked-choice validation.
- Controlled status transitions with mandatory reasons for adverse decisions and append-only audit history.
- Searchable applicant register, linked record inspection, review notes, evidence status, and exception flags.
- Fifteen whitelisted SQL reports covering demand, conversion, capacity, document compliance, risk, scholarships, reviewer workload, interviews, waitlists and cross-cycle comparison.
- In-app conceptual model, logical schema, business rules, data dictionary, SQL catalogue, and CSV export.
- Responsive desktop and mobile layouts with accessible controls, focus states, loading states, and error handling.

## Quality checks

```bash
pnpm check
```

This runs the automated API/database workflows, database-integrity checks, frontend request resilience, report controls, all 15 report renderings, register/case-summary interactions, interview/waitlist workflows, chart sizing/recovery, HKUST shell navigation and responsive stability checks, followed by a production frontend build. Tests use isolated in-memory databases and DOM fixtures, so they do not alter demonstration data. DOM tests simulate chart dimensions; they do not replace real-browser responsive QA.

Run `pnpm audit` to check the locked dependency tree. Use `pnpm install --frozen-lockfile` for repeatable installs.

For the production preview:

```bash
pnpm build
PORT=3003 pnpm start
```

Open `http://localhost:3003/`. Keep the terminal process running; refresh the browser after a new build. Starting with an alternate `DATABASE_PATH` allows an isolated demonstration without touching the existing database.

## Interactive analysis refinement

- The workspace uses the HKUST official navy/gold identity and official logo assets. It is a student coursework demonstration and does not represent an official service; all records are fictional.
- Radix UI supplies accessible report-category tabs and focus/hover tooltips; Motion and Recharts share the university-inspired design tokens.
- Report charts include a measure selector, complete donut categories with toggles, consistent totals, keyboard-accessible charts, and reduced-motion support.
- Report layouts use container-width breakpoints. Charts measure their own panels, adapt axes/radii, defer drawing below 180px, recover from zero-width containers, and isolate chart exceptions without removing the result table. Long bar charts retain readable row spacing inside a scrollable plot.
- Result sets support local search, numeric sorting, a full export and an export of the visible filtered/sorted rows.
- Overview supports explicit refresh and first-choice/accepted capacity comparisons across every programme.
- Applications includes quick stage filters, comfortable/compact desktop rows, the `/` search shortcut, explicit refresh/retry, and visible exceptions on mobile records. Summary shows the first-choice score and a core-evidence shortcut.
- Requests time out after 15 seconds, cancel obsolete report loads, preserve server field errors, and offer recoverable loading/error states. Writes are never automatically retried.
- The public repository intentionally excludes private coursework documents and supplied source files.

## Project structure

```text
src/                 React interface and styles
server/app.js        API routes and validation
server/database.js   Database creation and seed data
server/schema.sql    Relational schema and constraints
server/reports.js    Documented SQL report catalogue
server/migrate.js    Idempotent schema migration runner
server/migrations/   Versioned migration manifest
scripts/reset-database.mjs  Verified backup and deterministic rebuild
tests/               API, client, UI and stability regression suites
docs/                Final report and report builder
data/                Persistent local SQLite database
api/                 Vercel serverless API entry point
```

The implementation includes the relational schema, validation evidence, automated tests, responsive interface, demonstration guide, and SQL catalogue.

## Demonstration route

Start on **Overview**, switch the cycle context, then show filtering and the tabbed case workspace in **Applications**. Use **New applicant** to demonstrate cycle/degree-level offering validation, update profile/assignment/evidence/interview/waitlist/scholarship workflows, maintain cycle and reference records in **Operations**, run all 15 queries in **Reports**, and finish with the schema, physical design, rules and SQL catalogue in **Data model**.

## Database operations

```bash
pnpm db:reset
pnpm cloud:backup
pnpm cloud:migrate
pnpm cloud:seed -- --replace
pnpm cloud:verify
```

`db:reset` verifies and preserves a local backup before rebuilding the two-cycle fictional fixture. Cloud replacement must only be run after a verified Turso backup. The production seed contains 2026 CLOSED and 2027 OPEN cycles with 24 applications per cycle.

Student coursework demonstration. Fictional records. Not an official HKUST service.
