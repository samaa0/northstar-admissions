// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ApplicationDrawer from '../src/components/ApplicationDrawer.jsx';
import { api } from '../src/lib/api.js';

vi.mock('../src/lib/api.js', () => ({ api: vi.fn() }));

const applicationDetail = {
  application: { id: 42, application_no: 'APP-27-042', applicant_no: 'A27042', first_name: 'Clara', last_name: 'Rossi', email: 'clara@example.com', phone: '+852 51332598', nationality: 'Italy', birth_date: '2003-11-08', degree_level: 'UG', status: 'WAITLISTED', assigned_to: 4, risk_flag: 'NONE' },
  choices: [{ id: 83, code: 'BSC-QF', name: 'BSc in Quantitative Finance', preference_rank: 1, academic_score: 78.2, capacity: 18, remaining_places: 17 }],
  education: [], documents: [], requirements: [], interviews: [], nominations: [], eligibleScholarships: [],
  history: [
    { id: 1, to_status: 'SUBMITTED', changed_by_name: 'Iris Kwan', changed_at: '2026-10-20T09:00:00.000Z', note: null },
    { id: 2, to_status: 'WAITLISTED', changed_by_name: 'Iris Kwan', changed_at: '2026-10-25T09:30:00.000Z', note: 'Competitive profile placed on the active waitlist' },
  ],
  notes: [{ id: 3, author: 'Iris Kwan', created_at: '2026-10-23T10:00:00.000Z', note: 'Evidence and review progress recorded.' }],
  compliance: { required_count: 0, verified_count: 0, missing_count: 0, pending_count: 0, rejected_count: 0, compliant: 1 },
  currentDecision: { decision: 'WAITLIST' },
  waitlist: { status: 'ACTIVE', waitlist_rank: 2, ranking_score: 78.2, remaining_places: 17 },
  activeStaff: [{ id: 4, name: 'Iris Kwan', role: 'REVIEWER' }],
  allowedTransitions: ['OFFERED'], transitionRules: [{ status: 'OFFERED', requiresReason: true }],
};

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('matchMedia', () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  api.mockResolvedValue(applicationDetail);
});

afterEach(() => { cleanup(); vi.clearAllMocks(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('application activity presentation', () => {
  it('uses a structured timeline and omits duplicate HKUST branding from the case header', async () => {
    const user = userEvent.setup();
    render(<ApplicationDrawer applicationId={42} onClose={vi.fn()} onUpdated={vi.fn()} />);

    const dialog = await screen.findByRole('dialog', { name: 'Clara Rossi' });
    expect(within(dialog).getByText('Application case')).toBeTruthy();
    expect(within(dialog).queryByText(/HKUST/i)).toBeNull();

    await user.click(within(dialog).getByRole('tab', { name: /^Activity/ }));
    const timeline = within(dialog).getByRole('list', { name: 'Audit activity' });
    expect(within(timeline).getAllByRole('listitem')).toHaveLength(3);
    expect(within(timeline).getByText('Internal note')).toBeTruthy();
    expect(within(timeline).getAllByText('Status change')).toHaveLength(2);
    expect(timeline.querySelectorAll('time[datetime]')).toHaveLength(3);
  });
});
