import { useEffect, useMemo, useState } from 'react';
import { Braces, CheckCircle2, ChevronRight, Columns3, Copy, Database, KeyRound, Link2, Rows3, ShieldCheck, Table2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { titleCase } from '../lib/format.js';
import { EmptyState, LoadingBlock } from './Ui.jsx';

const businessRules = [
  ['One application per intake', 'An applicant may submit only one application for a given intake year.'],
  ['Ranked choices are unique', 'Each application may rank one to three active programmes, with no duplicate rank or programme.'],
  ['Scores stay comparable', 'Academic and interview scores must be numeric values between 0 and 100.'],
  ['Status changes are controlled', 'Applications can only move through the documented transition path; final states cannot reopen.'],
  ['Reasons support adverse outcomes', 'Decline and withdrawal actions require a recorded reason of at least five characters.'],
  ['Core documents are traceable', 'ID, transcript and personal statement are unique per application and carry a verification state.'],
  ['Programme capacity is positive', 'Every active programme has a positive seat capacity and a stated deadline.'],
  ['Decisions have ownership', 'Every offer, rejection or waitlist decision records the responsible staff member and timestamp.'],
  ['Scholarships respect eligibility', 'Scholarship definitions include a score threshold, available places and a positive amount.'],
  ['History is append-only', 'Every workflow change creates a separate status-history row for auditability.'],
];

const relationLines = [
  ['Applicants', '1', 'Applications', '0..*'],
  ['Applicants', '1', 'Education records', '0..*'],
  ['Applications', '1', 'Programme choices', '1..3'],
  ['Programmes', '1', 'Programme choices', '0..*'],
  ['Applications', '1', 'Documents', '0..*'],
  ['Applications', '1', 'Status history', '1..*'],
  ['Applications', '1', 'Review notes', '0..*'],
  ['Staff users', '1', 'Applications', '0..*'],
  ['Programme choices', '1', 'Decisions', '0..1'],
  ['Applications', '1', 'Scholarship applications', '0..*'],
  ['Scholarships', '1', 'Scholarship applications', '0..*'],
];

export default function DataModelPage() {
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('schema');
  const [selectedTable, setSelectedTable] = useState('applications');
  const [copied, setCopied] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api('/model').then(setData).catch((requestError) => setError(requestError.message));
  }, []);

  const currentTable = useMemo(() => data?.tables.find((table) => table.name === selectedTable), [data, selectedTable]);

  function copySql(id, sql) {
    navigator.clipboard?.writeText(sql);
    setCopied(id);
    window.setTimeout(() => setCopied(''), 1600);
  }

  function moveTab(event, direction) {
    const tabIds = ['schema', 'rules', 'queries'];
    const index = tabIds.indexOf(tab);
    const nextTab = tabIds[(index + direction + tabIds.length) % tabIds.length];
    setTab(nextTab);
    event.currentTarget.parentElement?.querySelectorAll('[role="tab"]')[tabIds.indexOf(nextTab)]?.focus();
  }

  return (
    <div className="model-page page-stack">
      <div className="page-intro model-intro">
        <div><span className="eyebrow">3NF relational design</span><h1>Data model and SQL</h1><p>Inspect entities, cardinalities, keys, constraints, business rules and every report query.</p></div>
        <div className="model-summary"><Database size={18} /><div><strong>{data?.tables.length ?? 12} relations</strong><span>Foreign keys enforced</span></div></div>
      </div>

      <div className="model-tabs" role="tablist" aria-label="Data model views">
        <button type="button" role="tab" id="model-tab-schema" aria-controls="model-panel-schema" tabIndex={tab === 'schema' ? 0 : -1} aria-selected={tab === 'schema'} className={tab === 'schema' ? 'active' : ''} onClick={() => setTab('schema')} onKeyDown={(event) => { if (event.key === 'ArrowRight') moveTab(event, 1); if (event.key === 'ArrowLeft') moveTab(event, -1); }}><Columns3 size={16} />Schema</button>
        <button type="button" role="tab" id="model-tab-rules" aria-controls="model-panel-rules" tabIndex={tab === 'rules' ? 0 : -1} aria-selected={tab === 'rules'} className={tab === 'rules' ? 'active' : ''} onClick={() => setTab('rules')} onKeyDown={(event) => { if (event.key === 'ArrowRight') moveTab(event, 1); if (event.key === 'ArrowLeft') moveTab(event, -1); }}><ShieldCheck size={16} />Business rules</button>
        <button type="button" role="tab" id="model-tab-queries" aria-controls="model-panel-queries" tabIndex={tab === 'queries' ? 0 : -1} aria-selected={tab === 'queries'} className={tab === 'queries' ? 'active' : ''} onClick={() => setTab('queries')} onKeyDown={(event) => { if (event.key === 'ArrowRight') moveTab(event, 1); if (event.key === 'ArrowLeft') moveTab(event, -1); }}><Braces size={16} />SQL library</button>
      </div>

      {error ? <EmptyState icon={Database} title="Data model unavailable" detail={error} /> : null}
      {!data && !error ? <LoadingBlock label="Inspecting relational schema" /> : null}

      {data && tab === 'schema' ? (
        <div id="model-panel-schema" className="schema-layout" role="tabpanel" aria-labelledby="model-tab-schema">
          <section className="relationship-map">
            <div className="map-heading"><div><span className="eyebrow">Conceptual model</span><h2>Entity relationship map</h2></div><span className="normal-form-badge"><CheckCircle2 size={14} />All relations in 3NF</span></div>
            <div className="relation-list">
              {relationLines.map(([left, leftCardinality, right, rightCardinality]) => (
                <div className="relation-row" key={`${left}-${right}`}>
                  <button type="button" onClick={() => setSelectedTable(toTableName(left))}>{left}</button>
                  <span className="relation-cardinality">{leftCardinality}</span>
                  <span className="relation-connector"><i /><Link2 size={13} /><i /></span>
                  <span className="relation-cardinality">{rightCardinality}</span>
                  <button type="button" onClick={() => setSelectedTable(toTableName(right))}>{right}</button>
                </div>
              ))}
            </div>
          </section>

          <aside className="table-inspector">
            <div className="table-index">
              <div className="table-index-title"><Table2 size={16} /><span>Relations</span></div>
              {data.tables.map((table) => <button type="button" className={selectedTable === table.name ? 'active' : ''} key={table.name} onClick={() => setSelectedTable(table.name)}><span>{table.name}</span><small>{table.rowCount}</small><ChevronRight size={14} /></button>)}
            </div>
            {currentTable ? (
              <div className="table-detail">
                <div className="table-detail-header"><div><span className="eyebrow">Relation</span><h3>{currentTable.name}</h3></div><span><Rows3 size={14} />{currentTable.rowCount} rows</span></div>
                <div className="column-list">
                  <div className="column-list-head"><span>Attribute</span><span>Type</span><span>Constraint</span></div>
                  {currentTable.columns.map((column) => {
                    const foreignKey = currentTable.foreignKeys.find((key) => key.from === column.name);
                    return <div className="column-row" key={column.name}><span>{column.pk ? <KeyRound size={12} /> : foreignKey ? <Link2 size={12} /> : null}{column.name}</span><code>{column.type || 'ANY'}</code><small>{column.pk ? 'PK' : foreignKey ? `FK → ${foreignKey.table}.${foreignKey.to}` : column.notnull ? 'NOT NULL' : 'nullable'}</small></div>;
                  })}
                </div>
              </div>
            ) : null}
          </aside>
        </div>
      ) : null}

      {data && tab === 'rules' ? (
        <section id="model-panel-rules" className="rules-section" role="tabpanel" aria-labelledby="model-tab-rules">
          <div className="rules-heading"><div><span className="eyebrow">Integrity layer</span><h2>Enforced business rules</h2><p>Database constraints and server validation protect the same operational rules.</p></div><span className="rule-count">10 documented rules</span></div>
          <div className="rules-grid">
            {businessRules.map(([title, description], index) => (
              <article className="rule-item" key={title}><span>{String(index + 1).padStart(2, '0')}</span><div><h3>{title}</h3><p>{description}</p></div><CheckCircle2 size={17} /></article>
            ))}
          </div>
        </section>
      ) : null}

      {data && tab === 'queries' ? (
        <section id="model-panel-queries" className="query-library" role="tabpanel" aria-labelledby="model-tab-queries">
          <div className="query-heading"><div><span className="eyebrow">Configuration specification</span><h2>Managerial SQL library</h2><p>Every statement is read-only, named by purpose and available through the Reports screen.</p></div><span className="rule-count">{data.reports.length} statements</span></div>
          <div className="query-list">
            {data.reports.map((report, index) => (
              <details key={report.id} open={index === 0}>
                <summary><span className="query-number">Q{String(index + 1).padStart(2, '0')}</span><span><strong>{report.title}</strong><small>{report.description}</small></span><ChevronRight size={17} /></summary>
                <div className="sql-block"><button className="copy-button" type="button" onClick={() => copySql(report.id, report.sql)}>{copied === report.id ? <CheckCircle2 size={14} /> : <Copy size={14} />}{copied === report.id ? 'Copied' : 'Copy SQL'}</button><pre><code>{report.sql}</code></pre></div>
              </details>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function toTableName(label) {
  const map = {
    'Applicants': 'applicants',
    'Applications': 'applications',
    'Education records': 'education_records',
    'Programme choices': 'application_choices',
    'Programmes': 'programmes',
    'Documents': 'documents',
    'Status history': 'status_history',
    'Review notes': 'review_notes',
    'Staff users': 'staff_users',
    'Decisions': 'decisions',
    'Scholarship applications': 'scholarship_applications',
    'Scholarships': 'scholarships',
  };
  return map[label] || label.toLowerCase().replaceAll(' ', '_');
}
