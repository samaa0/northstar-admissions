// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ApplicationDrawer from '../src/components/ApplicationDrawer.jsx';
import { api } from '../src/lib/api.js';

vi.mock('../src/lib/api.js', () => ({ api: vi.fn() }));

const applicationDetail = {
  application: { id: 42, application_no: 'APP-27-042', applicant_no: 'A27042', first_name: 'Clara', last_name: 'Rossi', email: 'clara@example.com', phone: '+852 51332598', nationality: 'Italy', birth_date: '2003-11-08', degree_level: 'UG', status: 'WAITLISTED', assigned_to: 4, risk_flag: 'NONE' },
  choices: [{ id: 83, code: 'BSC-QF', name: 'BSc in Quantitative Finance', preference_rank: 1, academic_score: 78.2, capacity: 18, remaining_places: 17 }],
  education: [], documents: [], requirements: [], history: [], notes: [], interviews: [], nominations: [], eligibleScholarships: [],
  compliance: { required_count: 0, verified_count: 0, missing_count: 0, pending_count: 0, rejected_count: 0, compliant: 1 },
  currentDecision: { decision: 'WAITLIST' },
  waitlist: { status: 'ACTIVE', waitlist_rank: 2, ranking_score: 78.2, remaining_places: 17 },
  activeStaff: [{ id: 2, name: 'Renee Leung', role: 'ADMISSIONS' }, { id: 4, name: 'Iris Kwan', role: 'REVIEWER' }],
  allowedTransitions: ['OFFERED'], transitionRules: [{ status: 'OFFERED', requiresReason: true }],
};

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('matchMedia', () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  api.mockImplementation(async (path) => {
    if (path === '/applicants/42') return applicationDetail;
    if (path === '/applications/42/interviews') return { id: 99, message: 'Interview scheduled' };
    throw new Error(`Unexpected test request: ${path}`);
  });
});

afterEach(() => { cleanup(); vi.clearAllMocks(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('interview scheduling', () => {
  it('keeps the date when time is entered and submits one ISO timestamp', async () => {
    const user = userEvent.setup();
    render(<ApplicationDrawer applicationId={42} onClose={vi.fn()} onUpdated={vi.fn()} />);
    await screen.findByRole('heading', { name: 'Clara Rossi' });
    await user.click(screen.getByRole('tab', { name: 'Interview' }));

    const scheduledDate = screen.getByLabelText('Scheduled date');
    const scheduledTime = screen.getByLabelText('Scheduled time');
    fireEvent.change(scheduledDate, { target: { value: '2026-11-09' } });
    fireEvent.change(scheduledTime, { target: { value: '10:00' } });

    expect(scheduledDate.value).toBe('2026-11-09');
    expect(scheduledTime.value).toBe('10:00');
    await user.click(screen.getByRole('button', { name: 'Schedule interview' }));
    await waitFor(() => expect(api).toHaveBeenCalledWith('/applications/42/interviews', expect.objectContaining({ method: 'POST' })));
    const request = api.mock.calls.find(([path]) => path === '/applications/42/interviews')[1];
    expect(JSON.parse(request.body)).toMatchObject({ scheduledAt: new Date('2026-11-09T10:00').toISOString() });
  });
});
