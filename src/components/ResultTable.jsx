import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, Download, Search } from 'lucide-react';
import { filterAndSortRows } from '../lib/reportData.js';
import { exportCsv, titleCase } from '../lib/format.js';
import { EmptyState } from './Ui.jsx';

export default function ResultTable({ report }) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState(null);
  const rows = useMemo(() => filterAndSortRows(report.rows, query, sort), [report.rows, query, sort]);
  const columns = Object.keys(report.rows[0] || {});
  function toggleSort(key) {
    setSort((current) => ({ key, direction: current?.key === key && current.direction === 'asc' ? 'desc' : 'asc' }));
  }
  return <section className="report-table-section">
    <div className="result-toolbar"><div><h3>Result set</h3><span aria-live="polite">{rows.length} of {report.rows.length} records</span></div><label className="result-search"><Search size={16} /><input type="search" aria-label="Search result set" placeholder="Find in results…" value={query} onChange={(event) => setQuery(event.target.value)} /></label><button type="button" className="button button-secondary" disabled={!rows.length} onClick={() => exportCsv(`${report.id}-filtered.csv`, rows)}><Download size={15} />Export visible</button></div>
    {rows.length ? <div className="table-scroll" role="region" aria-label="Report results; scroll horizontally for more columns" tabIndex={0}><table className="data-table report-table"><caption className="sr-only">{report.title}; select a column heading to sort</caption><thead><tr>{columns.map((key) => { const active = sort?.key === key; const Icon = active ? sort.direction === 'asc' ? ArrowUp : ArrowDown : ArrowUpDown; return <th scope="col" key={key} aria-sort={active ? sort.direction === 'asc' ? 'ascending' : 'descending' : 'none'}><button type="button" className="table-sort" onClick={() => toggleSort(key)}>{titleCase(key)}<Icon size={13} /></button></th>; })}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{columns.map((key) => <td key={key} className={typeof row[key] === 'number' ? 'numeric-cell' : ''}>{typeof row[key] === 'number' ? row[key].toLocaleString('en-HK') : row[key] ?? '—'}</td>)}</tr>)}</tbody></table></div> : <EmptyState title={report.rows.length ? 'No matching results' : 'No rows returned'} detail={report.rows.length ? 'Try another name or clear your search.' : 'The query completed without matching records.'} action={query ? <button type="button" className="button button-secondary" onClick={() => setQuery('')}>Clear search</button> : null} />}
  </section>;
}
