import { useEffect, useRef, useState } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { CalendarClock, CheckCircle2, Download, FileBarChart2, LoaderCircle, Play, RefreshCw } from 'lucide-react';
import { api } from '../lib/api.js';
import { exportCsv, formatDateTime } from '../lib/format.js';
import { EmptyState, Hint, LoadingBlock } from './Ui.jsx';
import ReportVisual from './ReportVisual.jsx';
import ResultTable from './ResultTable.jsx';
import ChartBoundary from './ChartBoundary.jsx';

export default function ReportsPage({ cycles, cycleId, onCycleChange }) {
  const [reports, setReports] = useState([]);
  const [selectedId, setSelectedId] = useState('programme-demand');
  const [report, setReport] = useState(null);
  const [category, setCategory] = useState('All');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [libraryError, setLibraryError] = useState('');
  const [libraryAttempt, setLibraryAttempt] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const requestRef = useRef(0);
  const [dates, setDates] = useState({ from: '', to: '' });

  useEffect(() => {
    const controller = new AbortController();
    setLibraryError('');
    api('/reports', { signal: controller.signal }).then(setReports).catch((failure) => {
      if (!controller.signal.aborted) setLibraryError(failure.message);
    });
    return () => controller.abort();
  }, [libraryAttempt]);

  useEffect(() => {
    const controller = new AbortController();
    const requestId = ++requestRef.current;
    setBusy(true);
    setError('');
    setReport(null);
    const parameters = new URLSearchParams({ cycleId: String(cycleId) });
    if (dates.from) parameters.set('from', dates.from);
    if (dates.to) parameters.set('to', dates.to);
    api(`/reports/${selectedId}?${parameters}`, { signal: controller.signal }).then((result) => {
      if (!controller.signal.aborted && requestRef.current === requestId) setReport(result);
    }).catch((failure) => {
      if (!controller.signal.aborted && requestRef.current === requestId) setError(failure.message);
    }).finally(() => {
      if (!controller.signal.aborted && requestRef.current === requestId) setBusy(false);
    });
    return () => controller.abort();
  }, [cycleId, dates.from, dates.to, selectedId, refresh]);

  const categories = ['All', ...new Set(reports.map((item) => item.category))];
  const filteredReports = category === 'All' ? reports : reports.filter((item) => item.category === category);
  const currentReport = report?.id === selectedId && !busy && !error ? report : null;

  function changeCategory(next) {
    setCategory(next);
    const choices = next === 'All' ? reports : reports.filter((item) => item.category === next);
    if (choices.length && !choices.some((item) => item.id === selectedId)) setSelectedId(choices[0].id);
  }

  return <div className="reports-page page-stack">
    <div className="page-intro reports-intro"><div><span className="eyebrow">15 verified SQL reports</span><h1>Managerial reports</h1><p>Explore intake demand, decisions, interviews, scholarships and waitlist pressure.</p></div><div className="report-assurance"><CheckCircle2 size={18} /><div><strong>Live database</strong><span>Results are generated on request</span></div></div></div>
    <div className="report-filter-bar" aria-label="Report parameters">
      <label><span>Admission cycle</span><select value={cycleId} onChange={(event) => onCycleChange(event.target.value)}>{cycles.map((cycle) => <option key={cycle.id} value={cycle.id}>{cycle.cycle_year} · {cycle.status}</option>)}</select></label>
      <label><span>Submitted from</span><input type="date" value={dates.from} onChange={(event) => setDates((current) => ({ ...current, from: event.target.value }))} /></label>
      <label><span>Submitted to</span><input type="date" min={dates.from || undefined} value={dates.to} onChange={(event) => setDates((current) => ({ ...current, to: event.target.value }))} /></label>
      {(dates.from || dates.to) ? <button className="button button-secondary" type="button" onClick={() => setDates({ from: '', to: '' })}>Clear dates</button> : null}
    </div>
    <Tabs.Root value={category} onValueChange={changeCategory} className="report-tabs-root">
      <Tabs.List className="report-categories" aria-label="Report categories">{categories.map((item) => <Tabs.Trigger className={category === item ? 'active' : ''} value={item} key={item}>{item}</Tabs.Trigger>)}</Tabs.List>
      <Tabs.Content value={category} className="reports-layout">
        <aside className="report-index" aria-label="Report library"><div className="report-index-heading"><span>Report library</span><small>{filteredReports.length} available</small></div>
          {libraryError ? <EmptyState title="Library unavailable" detail={libraryError} action={<button type="button" className="button button-secondary" onClick={() => setLibraryAttempt((value) => value + 1)}>Retry library</button>} /> : null}
          <div className="report-list">{filteredReports.map((item) => <button type="button" className={selectedId === item.id ? 'active' : ''} aria-current={selectedId === item.id ? 'true' : undefined} key={item.id} onClick={() => setSelectedId(item.id)}><span className="report-number">{String(reports.indexOf(item) + 1).padStart(2, '0')}</span><span><strong>{item.title}</strong><small>{item.category}</small></span>{selectedId === item.id ? <Play size={14} fill="currentColor" /> : null}</button>)}</div>
        </aside>
        <section className="report-workspace" aria-label="Selected report" aria-busy={busy}>
          {error ? <EmptyState icon={RefreshCw} title="Report could not run" detail={error} action={<button className="button button-secondary" type="button" onClick={() => setRefresh((value) => value + 1)}>Try again</button>} /> : null}
          {busy || (!currentReport && !error) ? <LoadingBlock label="Running SQL report" /> : null}
          {currentReport ? <>
            <header className="report-header"><div><span className="report-category-label"><FileBarChart2 size={14} />{currentReport.category}</span><h2>{currentReport.title}</h2><p>{currentReport.description}</p><small className="report-purpose">{currentReport.purpose}</small></div><div className="report-actions"><Hint label="Run this report again"><button className="icon-button" type="button" onClick={() => setRefresh((value) => value + 1)} disabled={busy} aria-label="Refresh report">{busy ? <LoaderCircle className="spin" size={17} /> : <RefreshCw size={17} />}</button></Hint><button className="button button-secondary" type="button" onClick={() => exportCsv(`${currentReport.id}-cycle-${cycleId}.csv`, currentReport.rows)} disabled={!currentReport.rows.length}><Download size={16} />Export all</button></div></header>
            <div className="report-run-meta"><span><CalendarClock size={14} />Generated {formatDateTime(currentReport.generatedAt)}</span><span>{currentReport.rows.length} rows returned</span></div>
            {currentReport.visual !== 'table' && currentReport.rows.length ? <ChartBoundary key={currentReport.id}><ReportVisual report={currentReport} /></ChartBoundary> : null}
            <ResultTable key={currentReport.id} report={currentReport} />
          </> : null}
        </section>
      </Tabs.Content>
    </Tabs.Root>
  </div>;
}
