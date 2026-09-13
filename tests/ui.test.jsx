// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../src/App.jsx';
import DashboardPage from '../src/components/DashboardPage.jsx';
import ReportsPage from '../src/components/ReportsPage.jsx';
import DataModelPage from '../src/components/DataModelPage.jsx';
import ApplicationDrawer from '../src/components/ApplicationDrawer.jsx';
import { api } from '../src/lib/api.js';

vi.mock('../src/lib/api.js', () => ({ api: vi.fn() }));

const cycles = [
  { id: 2, cycle_year: 2027, status: 'OPEN', application_count: 24, opens_at: '2026-09-01', closes_at: '2027-01-31' },
  { id: 1, cycle_year: 2026, status: 'CLOSED', application_count: 24, opens_at: '2025-09-01', closes_at: '2026-01-31' },
];
const programmes = [{ id: 1, code: 'BBA-IS', name: 'Information Systems', degree_level: 'UG', offeringId: 7, capacity: 20, remaining_places: 16, deadline: '2027-01-31' }];
const dashboard = {
  metrics: { active: 12, total: 24, in_review: 6, flagged: 4, offers: 8, accepted: 4, yieldRate: 50 },
  pipeline: [{ status: 'REVIEW', count: 6 }, { status: 'WAITLISTED', count: 3 }, { status: 'OFFERED', count: 4 }],
  recent: [], attention: [], capacity: [{ code: 'BBA-IS', demand: 9, accepted: 4, capacity: 20, remaining_places: 16 }],
  currentCycle: cycles[0],
};
const reportDefinition = { id: 'programme-demand', title: 'Programme demand and capacity', category: 'Planning', visual: 'table', purpose: 'Capacity planning', description: 'Live SQL report' };
const applicationDetail = {
  application: { id: 42, application_no: 'APP-27-042', applicant_no: 'A27042', first_name: 'Clara', last_name: 'Rossi', email: 'clara@example.com', phone: '+852 51332598', nationality: 'Italy', birth_date: '2003-11-08', degree_level: 'UG', status: 'WAITLISTED', assigned_to: 4, risk_flag: 'MISSING_DOCS' },
  choices: [{ id: 83, code: 'BSC-QF', name: 'BSc in Quantitative Finance', preference_rank: 1, academic_score: 78.2, capacity: 18, remaining_places: 17 }],
  education: [],
  documents: [{ id: 132, document_type: 'ID', file_name: '042_id.pdf', verification_status: 'VERIFIED', reviewer: 'Renee Leung' }],
  requirements: [{ id: 8, document_type: 'ID', required_by_status: 'SCREENING', verification_status: 'VERIFIED', file_name: '042_id.pdf' }],
  compliance: { required_count: 3, verified_count: 2, missing_count: 0, pending_count: 1, rejected_count: 0, compliant: 0 },
  history: [],
  notes: [],
  interviews: [{ id: 25, code: 'BSC-QF', scheduled_at: '2026-11-09T16:00:00Z', duration_minutes: 45, mode: 'IN_PERSON', location: 'Academic Building Room 217', status: 'COMPLETED', score: 78.2, panel: 'Marcus Yip (CHAIR)' }],
  currentDecision: { decision: 'WAITLIST' },
  waitlist: { status: 'ACTIVE', waitlist_rank: 2, ranking_score: 78.2, remaining_places: 17 },
  nominations: [],
  eligibleScholarships: [],
  activeStaff: [{ id: 2, name: 'Renee Leung', role: 'ADMISSIONS' }, { id: 4, name: 'Iris Kwan', role: 'REVIEWER' }],
  allowedTransitions: ['OFFERED', 'DECLINED'],
  transitionRules: [{ status: 'OFFERED', requiresReason: true }, { status: 'DECLINED', requiresReason: true }],
};

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('matchMedia', () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  api.mockImplementation(async (path) => {
    if (path === '/cycles') return cycles;
    if (path.startsWith('/programmes')) return programmes;
    if (path.startsWith('/dashboard')) return dashboard;
    if (path === '/reports') return [reportDefinition];
    if (path.startsWith('/reports/')) return { ...reportDefinition, rows: [{ code: 'BBA-IS', first_choice_demand: 9, capacity: 20 }], generatedAt: '2026-09-13T00:00:00Z' };
    if (path === '/model') return { summary: { businessRelations: 19, technicalTables: 1, reports: 15 }, tables: [{ name: 'applications', columns: [{ name: 'id' }], foreignKeys: [], indexes: [] }], views: [], triggers: [], indexes: [], migrations: [], relationships: [], businessRules: ['Required evidence must be verified before an offer or acceptance.'], reports: [] };
    if (path === '/applicants/42') return applicationDetail;
    if (path.startsWith('/applicants')) return { items: [], total: 0, page: 1, pages: 1 };
    throw new Error(`Unexpected test request: ${path}`);
  });
});

afterEach(() => { cleanup(); vi.clearAllMocks(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('HKUST branded shell', () => {
  it('renders official logo, school name, cycle context and disclaimer', async () => {
    render(<App />);
    await screen.findByRole('heading', { name: 'Admissions overview' });
    expect(screen.getByRole('img', { name: 'HKUST logo' }).getAttribute('src')).toBe('/hkust-logo-white.svg');
    expect(document.querySelector('.university-name').textContent).toContain('香港科技大學');
    expect(screen.getAllByText('Student Admission System').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByLabelText('Current admission cycle').value).toBe('2');
    expect(screen.getByText('Student coursework demonstration. Fictional records. Not an official HKUST service.')).toBeTruthy();
  });

  it('switches cycle context and keeps navigation accessible', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: 'Admissions overview' });
    await user.selectOptions(screen.getByLabelText('Current admission cycle'), '1');
    await waitFor(() => expect(api.mock.calls.some(([path]) => path.includes('cycleId=1'))).toBe(true));
    const nav = within(screen.getByRole('navigation', { name: 'Main navigation' }));
    expect(nav.getAllByRole('button').map((button) => button.textContent)).toEqual(['Overview', 'Applications', 'Operations', 'Reports', 'Data model']);
    expect(screen.getByRole('link', { name: 'Skip to main content' }).getAttribute('href')).toBe('#main-content');
  });
});

describe('database-facing workspaces', () => {
  it('renders dashboard pipeline and capacity interactions', async () => {
    const onViewAll = vi.fn();
    const user = userEvent.setup();
    render(<DashboardPage cycleId="2" cycle={cycles[0]} onOpenApplication={vi.fn()} onViewAll={onViewAll} />);
    await screen.findByRole('heading', { name: 'Admissions overview' });
    expect(screen.getByText('Waitlisted')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Show 6 Review applications' }));
    expect(onViewAll).toHaveBeenCalledWith('REVIEW');
  });

  it('runs a cycle-filtered report and offers CSV export', async () => {
    render(<ReportsPage cycles={cycles} cycleId="2" onCycleChange={vi.fn()} />);
    await screen.findByRole('heading', { name: 'Programme demand and capacity' });
    expect(screen.getByText('Capacity planning')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Export all' })).toBeTruthy();
    expect(api.mock.calls.some(([path]) => path.includes('/reports/programme-demand?cycleId=2'))).toBe(true);
  });

  it('shows physical design metadata in the Data Model workspace', async () => {
    render(<DataModelPage />);
    await screen.findByRole('heading', { name: 'Data model and SQL' });
    expect(screen.getByText('19 business relations')).toBeTruthy();
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Physical design' }));
    expect(screen.getByText('Views')).toBeTruthy();
    expect(screen.getByText('Triggers')).toBeTruthy();
  });

  it('renders the evidence, interview and decision case workflows without crashing', async () => {
    const user = userEvent.setup();
    render(<ApplicationDrawer applicationId={42} onClose={vi.fn()} onUpdated={vi.fn()} />);
    await screen.findByRole('heading', { name: 'Clara Rossi' });

    await user.click(screen.getByRole('tab', { name: /Evidence/ }));
    expect(screen.getByRole('heading', { name: 'Evidence register' })).toBeTruthy();

    await user.click(screen.getByRole('tab', { name: 'Interview' }));
    expect(screen.getByRole('heading', { name: 'Schedule interview' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Schedule interview' })).toBeTruthy();

    await user.click(screen.getByRole('tab', { name: 'Decision' }));
    expect(screen.getByRole('heading', { name: 'Application decision' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Waitlist position' })).toBeTruthy();
  });
});
