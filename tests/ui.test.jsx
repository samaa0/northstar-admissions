// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReportsPage from '../src/components/ReportsPage.jsx';
import ReportVisual from '../src/components/ReportVisual.jsx';
import ResultTable from '../src/components/ResultTable.jsx';
import ApplicationsPage from '../src/components/ApplicationsPage.jsx';
import CaseBrief from '../src/components/CaseBrief.jsx';
import ChartBoundary from '../src/components/ChartBoundary.jsx';
import App from '../src/App.jsx';
import DashboardPage from '../src/components/DashboardPage.jsx';
import { api } from '../src/lib/api.js';
import { createDatabase } from '../server/database.js';
import { reports as reportDefinitions } from '../server/reports.js';

vi.mock('../src/lib/api.js', () => ({ api: vi.fn() }));

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 640, height: 320, top: 0, left: 0, bottom: 320, right: 640, x: 0, y: 0, toJSON() {} });
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('matchMedia', () => ({ matches: true, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const reports = [
  { id: 'programme-demand', title: 'Programme demand', category: 'Planning', visual: 'table' },
  { id: 'pipeline', title: 'Application pipeline', category: 'Operations', visual: 'table' },
];
const result = (item) => ({ ...item, generatedAt: '2026-09-06T12:00:00Z', description: 'Live report', rows: [{ programme: 'B', applicants: 20 }, { programme: 'A', applicants: 3 }] });

describe('public workspace', () => {
  const dashboard = {
    metrics: { active: 12, total: 18, in_review: 4, flagged: 0, offers: 6, accepted: 3, yieldRate: 50 },
    pipeline: [{ status: 'REVIEW', count: 4 }, { status: 'OFFERED', count: 3 }],
    recent: [], attention: [],
    capacity: [{ code: 'BBA-IS', demand: 9, accepted: 3, capacity: 20 }],
  };

  beforeEach(() => {
    api.mockImplementation(async (path) => {
      if (path === '/dashboard') return dashboard;
      if (path === '/programmes') return [{ id: 1, code: 'BBA-IS', name: 'Information Systems' }];
      if (path.startsWith('/applicants')) return { items: [], total: 0, page: 1, pages: 1 };
      throw new Error(`Unexpected test request: ${path}`);
    });
  });

  it('identifies the public workspace and preserves all five destinations', async () => {
    const view = render(<App />);
    await screen.findByRole('heading', { name: 'Admissions overview' });
    expect(screen.getByLabelText('Northstar Academic Registry')).toBeTruthy();
    expect(within(screen.getByRole('banner')).getByText('N')).toBeTruthy();
    expect(screen.getByText('Fictional records for demonstration. Not an official service.')).toBeTruthy();
    expect(screen.getByText('Demonstration cycle')).toBeTruthy();
    expect(view.container.querySelector('.sidebar-project').textContent).toContain('Fictional records');
    expect(view.container.querySelector('.project-notice').textContent).not.toMatch(/personal|private identifier|internal label/i);
    expect(view.container.querySelector('.workspace-context').textContent).toContain('Academic Registry');
    for (const label of ['Main navigation', 'Mobile navigation']) {
      const nav = within(screen.getByRole('navigation', { name: label }));
      expect(nav.getAllByRole('button').map((button) => button.textContent)).toEqual(['Overview', 'Applications', 'Operations', 'Reports', 'Data model']);
      expect(nav.getByRole('button', { name: 'Overview' }).getAttribute('aria-current')).toBe('page');
    }
    expect(screen.getByRole('link', { name: 'Skip to main content' }).getAttribute('href')).toBe('#main-content');
  });

  it('keeps navigation and applicant intake usable in the rebranded shell', async () => {
    const user = userEvent.setup();
    const view = render(<App />);
    await screen.findByRole('heading', { name: 'Admissions overview' });
    await user.click(screen.getByRole('button', { name: 'Open navigation' }));
    expect(view.container.querySelector('.sidebar').classList.contains('sidebar-open')).toBe(true);
    await user.click(within(screen.getByRole('navigation', { name: 'Main navigation' })).getByRole('button', { name: 'Applications' }));
    await screen.findByRole('heading', { name: 'Application register' });
    await screen.findByText('0 applications');
    expect(screen.queryByText('Register unavailable')).toBeNull();
    expect(view.container.querySelector('.sidebar').classList.contains('sidebar-open')).toBe(false);
    expect(within(screen.getByRole('navigation', { name: 'Mobile navigation' })).getByRole('button', { name: 'Applications' }).getAttribute('aria-current')).toBe('page');
    await user.click(within(screen.getByRole('banner')).getByRole('button', { name: 'New applicant' }));
    const dialog = await screen.findByRole('dialog', { name: 'New applicant' });
    expect(within(dialog).getByRole('navigation', { name: 'Applicant intake progress' })).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Close applicant intake' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New applicant' })).toBeNull());
    expect(api.mock.calls.every(([, options]) => !options?.method || options.method === 'GET')).toBe(true);
  });

  it('preserves live capacity measures, pipeline drill-down and explicit refresh', async () => {
    const user = userEvent.setup();
    const onViewAll = vi.fn();
    render(<DashboardPage onOpenApplication={vi.fn()} onViewAll={onViewAll} />);
    await screen.findByRole('heading', { name: 'Admissions overview' });
    expect(screen.getByRole('progressbar', { name: 'BBA-IS first-choice demand' }).getAttribute('aria-valuenow')).toBe('45');
    await user.click(screen.getByRole('button', { name: 'Accepted', exact: true }));
    expect(screen.getByRole('progressbar', { name: 'BBA-IS accepted places' }).getAttribute('aria-valuenow')).toBe('15');
    await user.click(screen.getByRole('button', { name: 'Show 4 Review applications' }));
    expect(onViewAll).toHaveBeenCalledWith('REVIEW');
    await user.click(screen.getByRole('button', { name: 'Open offers issued in the application register' }));
    expect(onViewAll).toHaveBeenCalledWith('OFFERED');
    await user.click(screen.getByRole('button', { name: 'Refresh overview' }));
    await waitFor(() => expect(api.mock.calls.filter(([path]) => path === '/dashboard')).toHaveLength(2));
    expect(screen.getByText(/Demo deadline/)).toBeTruthy();
  });
});

describe('chart resizing', () => {
  it.each(['bar', 'line', 'donut'])('renders safe SVG geometry for %s across panel widths', (visual) => {
    for (const width of [180, 220, 280, 390, 560, 768, 1024, 1440]) {
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width, height: 300, top: 0, left: 0, bottom: 300, right: width, x: 0, y: 0, toJSON() {} });
      const view = render(<ReportVisual report={{ ...result(reports[0]), visual }} />);
      const svg = view.container.querySelector('svg.recharts-surface');
      expect(svg).toBeTruthy();
      expect(Number(svg.getAttribute('width'))).toBe(width);
      expect(Number(svg.getAttribute('height'))).toBeGreaterThanOrEqual(220);
      expect(svg.innerHTML).not.toMatch(/NaN|Infinity/);
      view.unmount();
    }
  });

  it('recovers after the panel collapses to zero and reopens', async () => {
    const observations = new Map();
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback) { this.callback = callback; this.disconnect = vi.fn(); }
      observe(element) { observations.set(element, this); }
      unobserve() {}
    });
    const view = render(<ReportVisual report={{ ...result(reports[0]), visual: 'bar' }} />);
    const observed = view.container.querySelector('.analysis-chart-frame');
    const observation = observations.get(observed);
    expect(view.container.querySelector('svg.recharts-surface').getAttribute('width')).toBe('640');
    act(() => observation.callback([{ target: observed, contentRect: { width: 0 } }]));
    await screen.findByText('Preparing chart…');
    expect(view.container.querySelector('svg.recharts-surface')).toBeNull();
    act(() => observation.callback([{ target: observed, contentRect: { width: 284 } }]));
    await waitFor(() => expect(view.container.querySelector('svg.recharts-surface')?.getAttribute('width')).toBe('284'));
    act(() => observation.callback([{ target: observed, contentRect: { width: 960 } }]));
    await waitFor(() => expect(view.container.querySelector('svg.recharts-surface')?.getAttribute('width')).toBe('960'));
    view.unmount();
    expect(observation.disconnect).toHaveBeenCalledOnce();
  });

  it('keeps the result table usable when the panel is too narrow', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 120, height: 300, top: 0, left: 0, bottom: 300, right: 120, x: 0, y: 0, toJSON() {} });
    const report = { ...result(reports[0]), visual: 'donut' };
    const view = render(<><ReportVisual report={report} /><ResultTable report={report} /></>);
    expect(screen.getByText(/Widen this panel/)).toBeTruthy();
    expect(view.container.querySelector('svg.recharts-surface')).toBeNull();
    expect(screen.getByRole('table')).toBeTruthy();
  });

  it('isolates a chart exception and allows retry without losing results', async () => {
    let fail = true;
    function TestChart() { if (fail) throw new Error('Synthetic chart fault'); return <div>Recovered chart</div>; }
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    const user = userEvent.setup();
    render(<><ChartBoundary><TestChart /></ChartBoundary><ResultTable report={result(reports[0])} /></>);
    expect(screen.getByText('Chart unavailable')).toBeTruthy();
    expect(screen.getByRole('table')).toBeTruthy();
    expect(errorLog).toHaveBeenCalled();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Retry chart' }));
    expect(screen.getByText('Recovered chart')).toBeTruthy();
    expect(screen.queryByText('Chart unavailable')).toBeNull();
  });
});

describe('register refinement', () => {
  const record = { id: 1, applicant: 'Mei Chan', application_no: 'APP-27-001', email: 'mei@example.com', nationality: 'Hong Kong', programme: 'BBA-IS', programme_name: 'Information Systems', status: 'REVIEW', academic_score: 89, risk_flag: 'MISSING_DOCS', reviewer: null, last_updated: '2026-09-06' };
  const registerResult = { items: [record], total: 1, page: 1, pages: 1 };
  const props = { programmes: [{ id: 1, code: 'BBA-IS' }], onOpenApplication: vi.fn(), onNewApplicant: vi.fn() };

  it('combines quick stages with programme and text filters', async () => {
    api.mockResolvedValue(registerResult);
    const user = userEvent.setup();
    const { container } = render(<ApplicationsPage {...props} />);
    await screen.findByRole('table');
    expect([...container.querySelectorAll('.record-avatar')].map((avatar) => avatar.textContent)).toEqual(['MC', 'MC']);
    expect(container.querySelector('.table-avatar')).toBeNull();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Filter by programme' }), 'BBA-IS');
    await user.type(screen.getByRole('textbox', { name: 'Search applications' }), 'Mei');
    await user.click(screen.getByRole('button', { name: 'Academic review' }));
    await waitFor(() => {
      const path = api.mock.calls.at(-1)[0];
      expect(path).toContain('q=Mei');
      expect(path).toContain('status=REVIEW');
      expect(path).toContain('programme=BBA-IS');
    });
    expect(screen.getByRole('button', { name: 'Academic review' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('switches density without changing the records', async () => {
    api.mockResolvedValue(registerResult);
    const user = userEvent.setup();
    const { container } = render(<ApplicationsPage {...props} />);
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: 'Compact rows' }));
    expect(container.querySelector('.density-compact')).toBeTruthy();
    expect(screen.getAllByText('Unassigned')).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Comfortable rows' }));
    expect(container.querySelector('.density-comfortable')).toBeTruthy();
  });

  it('focuses search with slash but preserves normal typing', async () => {
    api.mockResolvedValue(registerResult);
    const user = userEvent.setup();
    render(<ApplicationsPage {...props} />);
    await screen.findByRole('table');
    await user.keyboard('/');
    const search = screen.getByRole('textbox', { name: 'Search applications' });
    expect(document.activeElement).toBe(search);
    expect(search.value).toBe('');
    await user.keyboard('/');
    expect(search.value).toBe('/');
  });

  it('does not steal focus from an open dialog', async () => {
    api.mockResolvedValue(registerResult);
    const user = userEvent.setup();
    render(<><ApplicationsPage {...props} /><div role="dialog" aria-label="Case"><button type="button">Case action</button></div></>);
    await user.click(screen.getByRole('button', { name: 'Case action' }));
    await user.keyboard('/');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Case action' }));
  });

  it('offers retry after a register request fails', async () => {
    api.mockRejectedValueOnce(new Error('Offline')).mockResolvedValue(registerResult);
    const user = userEvent.setup();
    render(<ApplicationsPage {...props} />);
    await screen.findByText('Register unavailable');
    expect(screen.queryByRole('table')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByRole('table');
    expect(screen.queryByText('Register unavailable')).toBeNull();
  });

  it('cancels obsolete register requests after a filter change', async () => {
    let resolveOld;
    api.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; })).mockResolvedValue(registerResult);
    const user = userEvent.setup();
    render(<ApplicationsPage {...props} />);
    await waitFor(() => expect(api).toHaveBeenCalled());
    const oldSignal = api.mock.calls[0][1].signal;
    await user.click(screen.getByRole('button', { name: 'Academic review' }));
    await screen.findByRole('table');
    expect(oldSignal.aborted).toBe(true);
    await act(async () => resolveOld({ ...registerResult, items: [], total: 0 }));
    expect(screen.getByRole('table')).toBeTruthy();
  });

  it('summarizes only core evidence and the first-ranked score', async () => {
    const onEvidence = vi.fn();
    const user = userEvent.setup();
    render(<CaseBrief data={{ choices: [{ preference_rank: 2, academic_score: 75 }, { preference_rank: 1, academic_score: 89, code: 'BBA-IS' }], documents: [{ document_type: 'ID', verification_status: 'VERIFIED' }, { document_type: 'CV', verification_status: 'VERIFIED' }, { document_type: 'TRANSCRIPT', verification_status: 'REJECTED' }] }} onEvidence={onEvidence} />);
    expect(screen.getByText('1 of 3 verified')).toBeTruthy();
    expect(screen.getByText('2 documents need attention')).toBeTruthy();
    expect(screen.getByText('BBA-IS')).toBeTruthy();
    await user.click(screen.getByRole('button'));
    expect(onEvidence).toHaveBeenCalledOnce();
  });

  it('handles an empty case summary without invented values', () => {
    render(<CaseBrief data={{ choices: [], documents: [] }} onEvidence={() => {}} />);
    expect(screen.getByText('Not recorded')).toBeTruthy();
    expect(screen.getByText('0 of 3 verified')).toBeTruthy();
  });
});

describe('report workspace interactions', () => {
  it.each(reportDefinitions)('renders real seeded results for $id', (definition) => {
    const database = createDatabase(':memory:');
    let rows;
    try { rows = database.prepare(definition.sql).all(); } finally { database.close(); }
    const report = { ...definition, rows };
    const { container } = render(<><ResultTable report={report} />{definition.visual !== 'table' && rows.length ? <ReportVisual report={report} /> : null}</>);
    expect(screen.getByRole('table')).toBeTruthy();
    expect(screen.getAllByRole('row')).toHaveLength(rows.length + 1);
    if (definition.visual !== 'table') expect(container.querySelector('svg.recharts-surface')).toBeTruthy();
  });

  it('sorts and filters result rows with accessible controls', async () => {
    const user = userEvent.setup();
    render(<ResultTable report={result(reports[0])} />);
    await user.click(screen.getByRole('button', { name: 'Applicants' }));
    expect(screen.getByRole('columnheader', { name: 'Applicants' }).getAttribute('aria-sort')).toBe('ascending');
    expect(within(screen.getAllByRole('row')[1]).getByText('3')).toBeTruthy();
    await user.type(screen.getByRole('searchbox'), 'not found');
    expect(screen.getByText('No matching results')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Export visible' }).disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(screen.getAllByRole('row')).toHaveLength(3);
  });

  it('uses Radix arrow-key navigation for report categories', async () => {
    api.mockImplementation((path) => Promise.resolve(path === '/reports' ? reports : result(reports.find((item) => path.endsWith(item.id)))));
    const user = userEvent.setup();
    render(<ReportsPage />);
    const all = await screen.findByRole('tab', { name: 'All' });
    await screen.findByRole('tab', { name: 'Planning' });
    all.focus();
    await user.keyboard('{ArrowRight}');
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Planning' }).getAttribute('aria-selected')).toBe('true'));
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Planning' }));
  });

  it('ignores stale responses after changing report', async () => {
    let resolveOld;
    api.mockImplementation((path) => path === '/reports' ? Promise.resolve(reports) : path.endsWith('programme-demand') ? new Promise((resolve) => { resolveOld = resolve; }) : Promise.resolve(result(reports[1])));
    const user = userEvent.setup();
    render(<ReportsPage />);
    await user.click(await screen.findByRole('button', { name: /Application pipeline/ }));
    await screen.findByRole('heading', { name: 'Application pipeline' });
    await act(async () => resolveOld(result(reports[0])));
    expect(screen.queryByRole('heading', { name: 'Programme demand' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Application pipeline' })).toBeTruthy();
  });

  it('recovers after report failure and never shows stale output', async () => {
    let failed = true;
    api.mockImplementation((path) => path === '/reports' ? Promise.resolve(reports) : failed ? Promise.reject(new Error('Service unavailable')) : Promise.resolve(result(reports[0])));
    const user = userEvent.setup();
    render(<ReportsPage />);
    await screen.findByText('Report could not run');
    expect(screen.queryByRole('table')).toBeNull();
    failed = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByRole('table');
    expect(screen.queryByText('Report could not run')).toBeNull();
  });

  it('retries report library independently', async () => {
    let failed = true;
    api.mockImplementation((path) => path === '/reports' ? failed ? Promise.reject(new Error('Offline')) : Promise.resolve(reports) : Promise.resolve(result(reports[0])));
    const user = userEvent.setup();
    render(<ReportsPage />);
    await screen.findByText('Library unavailable');
    failed = false;
    await user.click(screen.getByRole('button', { name: 'Retry library' }));
    await screen.findByRole('button', { name: /Application pipeline/ });
    expect(screen.queryByText('Library unavailable')).toBeNull();
  });

  it('includes every donut category and recalculates selected total', async () => {
    const user = userEvent.setup();
    const rows = Array.from({ length: 12 }, (_, index) => ({ nationality: `Country ${index + 1}`, applicants: 2 }));
    render(<ReportVisual report={{ ...result(reports[0]), visual: 'donut', rows }} />);
    expect(screen.getAllByRole('button')).toHaveLength(12);
    expect(screen.getByText('24', { selector: '.donut-center strong' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Country 12: 2 Applicants' }));
    expect(screen.getByText('22', { selector: '.donut-center strong' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Country 12: 2 Applicants' }).getAttribute('aria-pressed')).toBe('false');
    await user.click(screen.getByRole('button', { name: 'Show all categories' }));
    expect(screen.getByText('24', { selector: '.donut-center strong' })).toBeTruthy();
  });

  it('allows switching measures without mixing units', async () => {
    const user = userEvent.setup();
    render(<ReportVisual report={{ ...result(reports[0]), visual: 'bar', rows: [{ programme: 'A', offers: 4, yield_pct: 50 }] }} />);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Measure' }), 'yield_pct');
    expect(screen.getByRole('heading', { name: 'Yield Pct' })).toBeTruthy();
  });
});
