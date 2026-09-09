import { useCallback, useEffect, useMemo, useState } from 'react';
import { Archive, BadgeDollarSign, CalendarDays, Edit3, LoaderCircle, Plus, RotateCcw, ShieldCheck, Users, X } from 'lucide-react';
import { api } from '../lib/api.js';
import { formatDate, titleCase } from '../lib/format.js';
import { useDialogFocus } from '../lib/useDialogFocus.js';
import { EmptyState, LoadingBlock, StatusBadge } from './Ui.jsx';

const tabs = [
  { id: 'programmes', label: 'Programmes', icon: CalendarDays },
  { id: 'staff', label: 'Admissions team', icon: Users },
  { id: 'scholarships', label: 'Scholarships', icon: BadgeDollarSign },
];

const blankForms = {
  programmes: { code: '', name: '', school: '', degreeLevel: 'UG', capacity: '', deadline: '' },
  staff: { name: '', email: '', role: 'REVIEWER' },
  scholarships: { code: '', name: '', amountHkd: '', minimumScore: '', places: '' },
};

function toForm(type, record) {
  if (!record) return { ...blankForms[type] };
  if (type === 'programmes') {
    return {
      code: record.code,
      name: record.name,
      school: record.school,
      degreeLevel: record.degree_level,
      capacity: String(record.capacity),
      deadline: record.deadline,
    };
  }
  if (type === 'staff') return { name: record.name, email: record.email, role: record.role };
  return {
    code: record.code,
    name: record.name,
    amountHkd: String(record.amount_hkd),
    minimumScore: String(record.minimum_score),
    places: String(record.places),
  };
}

export default function OperationsPage({ onUpdated }) {
  const [tab, setTab] = useState('programmes');
  const [records, setRecords] = useState({ programmes: null, staff: null, scholarships: null });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [editor, setEditor] = useState(null);
  const [confirmRecord, setConfirmRecord] = useState(null);

  const load = useCallback(async (type) => {
    setError('');
    try {
      const result = await api(`/admin/${type}`);
      setRecords((current) => ({ ...current, [type]: result }));
    } catch (requestError) {
      setError(requestError.message);
    }
  }, []);

  useEffect(() => {
    if (!records[tab]) load(tab);
  }, [load, records, tab]);

  const counts = useMemo(() => Object.fromEntries(tabs.map(({ id }) => {
    const list = records[id];
    return [id, list ? list.filter(({ active }) => active === 1).length : null];
  })), [records]);

  function moveTab(event, direction) {
    const index = tabs.findIndex(({ id }) => id === tab);
    const next = tabs[(index + direction + tabs.length) % tabs.length].id;
    setTab(next);
    event.currentTarget.parentElement?.querySelectorAll('[role="tab"]')[tabs.findIndex(({ id }) => id === next)]?.focus();
  }

  async function toggleActive() {
    if (!confirmRecord) return;
    const nextActive = confirmRecord.active !== 1;
    setBusy(`active-${confirmRecord.id}`);
    try {
      const result = await api(`/admin/${tab}/${confirmRecord.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ active: nextActive }),
      });
      setConfirmRecord(null);
      await load(tab);
      onUpdated(result.message);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy('');
    }
  }

  const currentRecords = records[tab];
  const activeTab = tabs.find(({ id }) => id === tab);

  return (
    <div className="operations-page page-stack">
      <div className="page-intro registry-page-intro">
        <div>
          <span className="eyebrow">Registry configuration</span>
          <h1>Operations catalogue</h1>
          <p>Maintain the reference data used by application, assignment and award workflows.</p>
        </div>
        <button className="button button-primary" type="button" onClick={() => setEditor({ type: tab, record: null })}>
          <Plus size={16} />New {tab === 'staff' ? 'team member' : tab.slice(0, -1)}
        </button>
      </div>

      <div className="operations-tabs" role="tablist" aria-label="Operations catalogues">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            type="button"
            role="tab"
            id={`operations-tab-${id}`}
            aria-controls="operations-panel"
            aria-selected={tab === id}
            tabIndex={tab === id ? 0 : -1}
            className={tab === id ? 'active' : ''}
            key={id}
            onClick={() => setTab(id)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight') moveTab(event, 1);
              if (event.key === 'ArrowLeft') moveTab(event, -1);
            }}
          >
            <Icon size={16} />
            <span>{label}</span>
            {counts[id] !== null ? <small>{counts[id]}</small> : null}
          </button>
        ))}
      </div>

      <section id="operations-panel" className="catalogue-panel" role="tabpanel" aria-labelledby={`operations-tab-${tab}`}>
        <header className="catalogue-heading">
          <div>
            <activeTab.icon size={18} />
            <div><h2>{activeTab.label}</h2><p>{catalogueDescription(tab)}</p></div>
          </div>
          {currentRecords ? <span>{currentRecords.length} records · {counts[tab]} active</span> : null}
        </header>

        {error ? <div className="inline-alert" role="alert"><ShieldCheck size={16} /><span>{error}</span></div> : null}
        {!currentRecords && !error ? <LoadingBlock label={`Loading ${activeTab.label.toLowerCase()}`} /> : null}
        {currentRecords?.length === 0 ? <EmptyState title={`No ${activeTab.label.toLowerCase()}`} detail="Create the first catalogue record to begin." /> : null}
        {currentRecords?.length ? (
          <>
            <div className="catalogue-table-wrap">
              <table className="data-table catalogue-table">
                <thead><CatalogueHead type={tab} /></thead>
                <tbody>
                  {currentRecords.map((record) => (
                    <CatalogueRow
                      key={record.id}
                      type={tab}
                      record={record}
                      busy={busy}
                      onEdit={() => setEditor({ type: tab, record })}
                      onToggle={() => setConfirmRecord(record)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            <div className="catalogue-mobile-list">
              {currentRecords.map((record) => (
                <CatalogueMobileItem
                  key={record.id}
                  type={tab}
                  record={record}
                  onEdit={() => setEditor({ type: tab, record })}
                  onToggle={() => setConfirmRecord(record)}
                />
              ))}
            </div>
          </>
        ) : null}
      </section>

      {editor ? (
        <CatalogueEditor
          type={editor.type}
          record={editor.record}
          onClose={() => setEditor(null)}
          onSaved={async (message) => {
            setEditor(null);
            await load(tab);
            onUpdated(message);
          }}
        />
      ) : null}

      {confirmRecord ? (
        <ConfirmationDialog
          record={confirmRecord}
          type={tab}
          busy={Boolean(busy)}
          onClose={() => setConfirmRecord(null)}
          onConfirm={toggleActive}
        />
      ) : null}
    </div>
  );
}

function catalogueDescription(type) {
  if (type === 'programmes') return 'Capacity, deadlines and active choices available to applicant intake.';
  if (type === 'staff') return 'Admissions and reviewer references available for case assignment.';
  return 'Award thresholds, amounts and place limits used by decision workflows.';
}

function CatalogueHead({ type }) {
  if (type === 'programmes') return <tr><th>Programme</th><th>School</th><th>Level</th><th>Capacity</th><th>Deadline</th><th>Usage</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr>;
  if (type === 'staff') return <tr><th>Team member</th><th>Role</th><th>Assigned</th><th>Historical usage</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr>;
  return <tr><th>Scholarship</th><th>Amount</th><th>Minimum score</th><th>Awards</th><th>Committed</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr>;
}

function CatalogueRow({ type, record, busy, onEdit, onToggle }) {
  return (
    <tr className={record.active === 1 ? '' : 'inactive-row'}>
      {type === 'programmes' ? (
        <>
          <td><div className="catalogue-identity"><strong>{record.code}</strong><span>{record.name}</span></div></td>
          <td>{record.school}</td><td>{record.degree_level}</td><td>{record.capacity}</td><td>{formatDate(record.deadline)}</td><td>{record.usage_count}</td>
        </>
      ) : null}
      {type === 'staff' ? (
        <>
          <td><div className="catalogue-identity"><strong>{record.name}</strong><span>{record.email}</span></div></td>
          <td>{titleCase(record.role)}</td><td>{record.assigned_count}</td><td>{record.usage_count}</td>
        </>
      ) : null}
      {type === 'scholarships' ? (
        <>
          <td><div className="catalogue-identity"><strong>{record.code}</strong><span>{record.name}</span></div></td>
          <td>HK${record.amount_hkd.toLocaleString('en-HK')}</td><td>{record.minimum_score}</td><td>{record.awarded_count} / {record.places}</td><td>HK${record.committed_hkd.toLocaleString('en-HK')}</td>
        </>
      ) : null}
      <td><StatusBadge status={record.active === 1 ? 'ACTIVE' : 'ARCHIVED'} subtle /></td>
      <td><div className="row-actions"><button className="icon-button" type="button" onClick={onEdit} aria-label={`Edit ${record.name}`} title="Edit"><Edit3 size={15} /></button><button className="icon-button" type="button" onClick={onToggle} disabled={busy === `active-${record.id}`} aria-label={`${record.active === 1 ? 'Archive' : 'Restore'} ${record.name}`} title={record.active === 1 ? 'Archive' : 'Restore'}>{record.active === 1 ? <Archive size={15} /> : <RotateCcw size={15} />}</button></div></td>
    </tr>
  );
}

function CatalogueMobileItem({ type, record, onEdit, onToggle }) {
  const meta = type === 'programmes'
    ? `${record.degree_level} · ${record.capacity} places · ${record.usage_count} choices`
    : type === 'staff'
      ? `${titleCase(record.role)} · ${record.assigned_count} assigned`
      : `HK$${record.amount_hkd.toLocaleString('en-HK')} · ${record.awarded_count}/${record.places} awarded`;
  return (
    <article className={`catalogue-mobile-item ${record.active === 1 ? '' : 'inactive-row'}`}>
      <div><strong>{record.code || record.name}</strong><span>{type === 'staff' ? record.email : record.name}</span><small>{meta}</small></div>
      <StatusBadge status={record.active === 1 ? 'ACTIVE' : 'ARCHIVED'} subtle />
      <div className="row-actions"><button className="icon-button" type="button" onClick={onEdit} aria-label={`Edit ${record.name}`}><Edit3 size={15} /></button><button className="icon-button" type="button" onClick={onToggle} aria-label={`${record.active === 1 ? 'Archive' : 'Restore'} ${record.name}`}>{record.active === 1 ? <Archive size={15} /> : <RotateCcw size={15} />}</button></div>
    </article>
  );
}

function CatalogueEditor({ type, record, onClose, onSaved }) {
  const [form, setForm] = useState(() => toForm(type, record));
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const close = useCallback(() => onClose(), [onClose]);
  const dialogRef = useDialogFocus(close);

  function updateField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  }

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setErrors({});
    setMessage('');
    try {
      const result = await api(`/admin/${type}${record ? `/${record.id}` : ''}`, {
        method: record ? 'PATCH' : 'POST',
        body: JSON.stringify(form),
      });
      await onSaved(result.message);
    } catch (requestError) {
      setErrors(requestError.fields || {});
      setMessage(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  const singular = type === 'staff' ? 'team member' : type.slice(0, -1);
  return (
    <div className="modal-layer operations-modal-layer" role="presentation">
      <button className="modal-scrim" type="button" onClick={onClose} aria-label="Close editor" />
      <div ref={dialogRef} className="catalogue-dialog" role="dialog" aria-modal="true" aria-labelledby="catalogue-editor-title" aria-busy={busy}>
        <header><div><span className="eyebrow">Operations catalogue</span><h2 id="catalogue-editor-title">{record ? 'Edit' : 'New'} {singular}</h2></div><button data-dialog-initial className="icon-button" type="button" onClick={onClose} aria-label="Close editor"><X size={18} /></button></header>
        {message ? <div className="form-alert" role="alert">{message}</div> : null}
        <form onSubmit={submit}>
          <div className="catalogue-form-grid"><CatalogueFields type={type} form={form} errors={errors} onChange={updateField} /></div>
          <footer><button className="button button-secondary" type="button" onClick={onClose}>Cancel</button><button className="button button-primary" type="submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={16} /> : null}{record ? 'Save changes' : `Create ${singular}`}</button></footer>
        </form>
      </div>
    </div>
  );
}

function CatalogueFields({ type, form, errors, onChange }) {
  if (type === 'programmes') return <><Field label="Programme code" name="code" value={form.code} error={errors.code} onChange={onChange} required /><Field label="Programme name" name="name" value={form.name} error={errors.name} onChange={onChange} required wide /><Field label="School" name="school" value={form.school} error={errors.school} onChange={onChange} required wide /><SelectField label="Degree level" name="degreeLevel" value={form.degreeLevel} error={errors.degreeLevel} onChange={onChange} options={[['UG', 'Undergraduate'], ['PG', 'Postgraduate']]} /><Field label="Capacity" name="capacity" value={form.capacity} error={errors.capacity} onChange={onChange} type="number" min="1" required /><Field label="Deadline" name="deadline" value={form.deadline} error={errors.deadline} onChange={onChange} type="date" required /></>;
  if (type === 'staff') return <><Field label="Full name" name="name" value={form.name} error={errors.name} onChange={onChange} required wide /><Field label="Email address" name="email" value={form.email} error={errors.email} onChange={onChange} type="email" required wide /><SelectField label="Role" name="role" value={form.role} error={errors.role} onChange={onChange} wide options={[['ADMIN', 'Administrator'], ['ADMISSIONS', 'Admissions'], ['REVIEWER', 'Reviewer']]} /></>;
  return <><Field label="Scholarship code" name="code" value={form.code} error={errors.code} onChange={onChange} required /><Field label="Scholarship name" name="name" value={form.name} error={errors.name} onChange={onChange} required wide /><Field label="Amount (HKD)" name="amountHkd" value={form.amountHkd} error={errors.amountHkd} onChange={onChange} type="number" min="1" required /><Field label="Minimum score" name="minimumScore" value={form.minimumScore} error={errors.minimumScore} onChange={onChange} type="number" min="0" max="100" step="0.1" required /><Field label="Award places" name="places" value={form.places} error={errors.places} onChange={onChange} type="number" min="1" required /></>;
}

function Field({ label, name, value, error, onChange, wide, ...props }) {
  return <label className={`field ${wide ? 'full-field' : ''} ${error ? 'field-error' : ''}`}><span>{label}</span><input value={value} onChange={(event) => onChange(name, event.target.value)} {...props} />{error ? <small>{error}</small> : null}</label>;
}

function SelectField({ label, name, value, error, onChange, options, wide }) {
  return <label className={`field ${wide ? 'full-field' : ''} ${error ? 'field-error' : ''}`}><span>{label}</span><select value={value} onChange={(event) => onChange(name, event.target.value)}>{options.map(([optionValue, optionLabel]) => <option value={optionValue} key={optionValue}>{optionLabel}</option>)}</select>{error ? <small>{error}</small> : null}</label>;
}

function ConfirmationDialog({ record, type, busy, onClose, onConfirm }) {
  const close = useCallback(() => onClose(), [onClose]);
  const dialogRef = useDialogFocus(close);
  const archiving = record.active === 1;
  const name = record.code || record.name;
  return (
    <div className="modal-layer confirmation-layer" role="presentation">
      <button className="modal-scrim" type="button" onClick={onClose} aria-label="Close confirmation" />
      <div ref={dialogRef} className="confirmation-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirmation-title" aria-describedby="confirmation-copy">
        <span className="confirmation-icon">{archiving ? <Archive size={20} /> : <RotateCcw size={20} />}</span>
        <h2 id="confirmation-title">{archiving ? 'Archive' : 'Restore'} {name}?</h2>
        <p id="confirmation-copy">{archiving ? `This ${type === 'staff' ? 'team member' : type.slice(0, -1)} will no longer be available for new workflow actions. Historical records and reports remain intact.` : 'This record will become available for new workflow actions again.'}</p>
        <div><button data-dialog-initial className="button button-secondary" type="button" onClick={onClose}>Cancel</button><button className={`button ${archiving ? 'button-danger-quiet' : 'button-primary'}`} type="button" onClick={onConfirm} disabled={busy}>{busy ? <LoaderCircle className="spin" size={16} /> : null}{archiving ? 'Archive record' : 'Restore record'}</button></div>
      </div>
    </div>
  );
}
