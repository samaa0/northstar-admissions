import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronLeft, ChevronRight, Filter, List, Plus, RefreshCw, Rows3, Search, SlidersHorizontal, UserRoundSearch, X } from 'lucide-react';
import { api } from '../lib/api.js';
import { formatDate, titleCase } from '../lib/format.js';
import { EmptyState, Hint, LoadingBlock, RecordAvatar, StatusBadge } from './Ui.jsx';

const statusOptions = ['DRAFT', 'SUBMITTED', 'SCREENING', 'REVIEW', 'INTERVIEW', 'WAITLISTED', 'OFFERED', 'ACCEPTED', 'DECLINED', 'WITHDRAWN'];

export default function ApplicationsPage({ cycleId, cycle, programmes, initialStatus = '', focusSearchRequest = 0, onOpenApplication, onNewApplicant }) {
  const [filters, setFilters] = useState({ q: '', status: initialStatus, programme: '', page: 1 });
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [mobileFilters, setMobileFilters] = useState(false);
  const [loading, setLoading] = useState(true);
  const [density, setDensity] = useState('comfortable');
  const [retry, setRetry] = useState(0);
  const searchRef = useRef(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setResult(null);
    setError('');
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([key, value]) => value && params.set(key, value));
      params.set('cycleId', cycleId);
      api(`/applicants?${params}`, { signal: controller.signal })
        .then((response) => !controller.signal.aborted && setResult(response))
        .catch((requestError) => !controller.signal.aborted && setError(requestError.message))
        .finally(() => !controller.signal.aborted && setLoading(false));
    }, filters.q ? 220 : 0);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [cycleId, filters, retry]);

  useEffect(() => {
    function focusSearch(event) {
      const target = event.target;
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || target?.closest?.('input, textarea, select, [contenteditable="true"], [role="dialog"]') || document.querySelector('[role="dialog"]')) return;
      event.preventDefault();
      searchRef.current?.focus();
    }
    document.addEventListener('keydown', focusSearch);
    return () => document.removeEventListener('keydown', focusSearch);
  }, []);

  useEffect(() => {
    if (focusSearchRequest) window.requestAnimationFrame(() => searchRef.current?.focus());
  }, [focusSearchRequest]);

  useEffect(() => {
    setFilters((current) => (current.status === initialStatus ? current : { ...current, status: initialStatus, page: 1 }));
  }, [initialStatus]);

  useEffect(() => {
    if (focusSearchRequest) {
      setFilters((current) => (current.status ? { ...current, status: '', page: 1 } : current));
    }
  }, [focusSearchRequest]);

  const hasFilters = Boolean(filters.q || filters.status || filters.programme);
  const summary = useMemo(() => {
    if (!result) return '';
    const start = result.total ? (result.page - 1) * 12 + 1 : 0;
    const end = Math.min(result.page * 12, result.total);
    return `${start}-${end} of ${result.total}`;
  }, [result]);

  function updateFilter(key, value) {
    setFilters((current) => ({ ...current, [key]: value, page: key === 'page' ? value : 1 }));
  }

  function clearFilters() {
    setFilters({ q: '', status: '', programme: '', page: 1 });
  }

  return (
    <div className={`applications-page page-stack register-refined density-${density}`}>
      <div className="page-intro register-intro">
        <div><span className="eyebrow">{cycle?.cycle_year || 'Admission'} cycle · live register</span><h1>Application register</h1><p>Review progress, programme choice, ownership and exceptions from one operational queue.</p></div>
        <button className="button button-primary desktop-intake" type="button" onClick={onNewApplicant}><Plus size={17} />Add applicant</button>
      </div>

      <div className="register-viewbar">
        <div className="register-quick-views" role="group" aria-label="Quick stage filters">
          {[['', 'All applications'], ['SUBMITTED', 'New submissions'], ['REVIEW', 'Academic review'], ['INTERVIEW', 'Interview'], ['WAITLISTED', 'Waitlist'], ['OFFERED', 'Offers']].map(([value, label]) => <button key={value} type="button" aria-pressed={filters.status === value} onClick={() => updateFilter('status', value)}>{value ? <span className={`stage-dot stage-dot-${value.toLowerCase()}`} aria-hidden="true" /> : <List size={15} />}{label}</button>)}
        </div>
        <Hint label="Reload the current register"><button type="button" className="icon-button" aria-label="Refresh register" disabled={loading} onClick={() => setRetry((value) => value + 1)}><RefreshCw size={16} className={loading ? 'spin' : ''} /></button></Hint>
      </div>

      <div className="register-toolbar">
        <label className="search-field">
          <Search size={17} />
          <span className="sr-only">Search applications</span>
          <input ref={searchRef} value={filters.q} onChange={(event) => updateFilter('q', event.target.value)} placeholder="Search name, email or application ID" />
          {!filters.q ? <kbd className="search-key-hint" aria-hidden="true">/</kbd> : null}
          {filters.q ? <button type="button" onClick={() => updateFilter('q', '')} aria-label="Clear search"><X size={15} /></button> : null}
        </label>
        <div id="application-filters" className={`filter-controls ${mobileFilters ? 'filter-controls-open' : ''}`}>
          <label><span className="sr-only">Filter by status</span><select value={filters.status} onChange={(event) => updateFilter('status', event.target.value)}><option value="">All stages</option>{statusOptions.map((status) => <option value={status} key={status}>{titleCase(status)}</option>)}</select></label>
          <label><span className="sr-only">Filter by programme</span><select value={filters.programme} onChange={(event) => updateFilter('programme', event.target.value)}><option value="">All programmes</option>{programmes.map((programme) => <option value={programme.code} key={programme.id}>{programme.code}</option>)}</select></label>
          {hasFilters ? <button className="text-button clear-filters" type="button" onClick={clearFilters}>Clear filters</button> : null}
        </div>
        <button className="button button-secondary mobile-filter-button" type="button" aria-expanded={mobileFilters} aria-controls="application-filters" onClick={() => setMobileFilters((open) => !open)}><SlidersHorizontal size={16} />Filters</button>
      </div>

      <AnimatePresence>
        {hasFilters ? (
          <motion.div className="active-filter-strip" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} aria-label="Active filters">
            <span>Showing</span>
            {filters.q ? <button type="button" onClick={() => updateFilter('q', '')}>Search: {filters.q}<X size={13} /></button> : null}
            {filters.status ? <button type="button" onClick={() => updateFilter('status', '')}>Stage: {titleCase(filters.status)}<X size={13} /></button> : null}
            {filters.programme ? <button type="button" onClick={() => updateFilter('programme', '')}>Programme: {filters.programme}<X size={13} /></button> : null}
            <button className="clear-all-filters" type="button" onClick={clearFilters}>Clear all</button>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <div className={`register-loading-track ${loading ? 'is-loading' : ''}`} aria-hidden="true"><span /></div>

      <div className="register-meta" aria-live="polite" aria-busy={loading}>
        <div><strong>{result?.total ?? '—'} application{result?.total === 1 ? '' : 's'}</strong>{loading ? <span>updating results</span> : hasFilters ? <span>matching current filters</span> : <span>across all stages</span>}</div>
        <div className="register-display-options"><span className="register-range">{summary}</span><div className="density-toggle" role="group" aria-label="Row density"><Hint label="Comfortable rows"><button type="button" aria-label="Comfortable rows" aria-pressed={density === 'comfortable'} onClick={() => setDensity('comfortable')}><Rows3 size={16} /></button></Hint><Hint label="Compact rows"><button type="button" aria-label="Compact rows" aria-pressed={density === 'compact'} onClick={() => setDensity('compact')}><List size={16} /></button></Hint></div></div>
      </div>

      {error ? <EmptyState icon={UserRoundSearch} title="Register unavailable" detail={error} action={<button type="button" className="button button-secondary" onClick={() => setRetry((value) => value + 1)}>Try again</button>} /> : null}
      {!result && !error ? <LoadingBlock label="Loading application register" /> : null}
      {result ? (
        result.items.length ? (
          <>
          <div className="register-table-wrap">
            <table className="data-table register-table">
              <thead><tr><th scope="col">Applicant</th><th scope="col">Application</th><th scope="col">First choice</th><th scope="col">Stage</th><th scope="col">Academic</th><th scope="col">Reviewer</th><th scope="col">Updated</th><th scope="col"><span className="sr-only">Open</span></th></tr></thead>
              <tbody>
                {result.items.map((item) => (
                  <motion.tr
                    key={item.id}
                    onClick={() => onOpenApplication(item.id)}
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        onOpenApplication(item.id);
                      }
                    }}
                    whileHover={{ x: 2 }}
                    aria-label={`Open ${item.applicant}, ${item.application_no}`}
                  >
                    <td data-label="Applicant"><div className="person-cell"><RecordAvatar name={item.applicant} /><div><strong>{item.applicant}</strong><span>{item.email}</span></div></div></td>
                    <td data-label="Application"><strong className="mono-value">{item.application_no}</strong><span className="cell-subline">{item.nationality}</span></td>
                    <td data-label="First choice"><span className="programme-code">{item.programme}</span><span className="cell-subline programme-name">{item.programme_name}</span></td>
                    <td data-label="Stage"><StatusBadge status={item.status} subtle />{item.risk_flag !== 'NONE' ? <span className="risk-marker" role="img" aria-label={`Risk flag: ${titleCase(item.risk_flag)}`} title={titleCase(item.risk_flag)}><Filter size={11} aria-hidden="true" /></span> : null}</td>
                    <td data-label="Academic"><span className="score-value">{item.academic_score.toFixed(1)}</span><span className="cell-subline">/ 100</span></td>
                    <td data-label="Reviewer">{item.reviewer || <span className="unassigned-label">Unassigned</span>}</td>
                    <td data-label="Updated">{formatDate(item.last_updated, { year: false })}</td>
                    <td><ChevronRight size={16} /></td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mobile-register-list">
            {result.items.map((item) => (
              <button type="button" className="mobile-register-item" key={item.id} onClick={() => onOpenApplication(item.id)}>
                <span className="mobile-record-head">
                  <RecordAvatar name={item.applicant} />
                  <span><strong>{item.applicant}</strong><small>{item.application_no}</small></span>
                  <StatusBadge status={item.status} subtle />
                </span>
                <span className="mobile-record-facts">
                  <span><small>First choice</small><strong>{item.programme}</strong></span>
                  <span><small>Academic</small><strong>{item.academic_score.toFixed(1)}</strong></span>
                  <span><small>Reviewer</small><strong>{item.reviewer || 'Unassigned'}</strong></span>
                  <ChevronRight size={16} />
                </span>
                {item.risk_flag !== 'NONE' ? <span className="mobile-record-exception"><Filter size={12} />{titleCase(item.risk_flag)}</span> : null}
              </button>
            ))}
          </div>
          </>
        ) : <EmptyState icon={UserRoundSearch} title="No matching applications" detail="Adjust the search or filters to see more records." action={<button className="button button-secondary" type="button" onClick={clearFilters}>Clear filters</button>} />
      ) : null}

      {result && result.pages > 1 ? (
        <div className="pagination">
          <button className="button button-secondary" type="button" disabled={loading || result.page <= 1} onClick={() => updateFilter('page', result.page - 1)} aria-label="Previous page"><ChevronLeft size={16} />Previous</button>
          <span>Page <strong>{result.page}</strong> of {result.pages}</span>
          <button className="button button-secondary" type="button" disabled={loading || result.page >= result.pages} onClick={() => updateFilter('page', result.page + 1)} aria-label="Next page">Next<ChevronRight size={16} /></button>
        </div>
      ) : null}
    </div>
  );
}
