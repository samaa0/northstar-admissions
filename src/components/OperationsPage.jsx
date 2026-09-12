import { useCallback, useEffect, useMemo, useState } from 'react';
import { Archive, BadgeDollarSign, CalendarDays, Edit3, LoaderCircle, Plus, RotateCcw, ShieldCheck, Users, X } from 'lucide-react';
import { api } from '../lib/api.js';
import { formatDate, titleCase } from '../lib/format.js';
import { useDialogFocus } from '../lib/useDialogFocus.js';
import { EmptyState, LoadingBlock, StatusBadge } from './Ui.jsx';

const tabs = [
  { id: 'cycles', label: 'Admission cycles', icon: CalendarDays },
  { id: 'programmes', label: 'Programmes', icon: CalendarDays },
  { id: 'staff', label: 'Admissions team', icon: Users },
  { id: 'scholarships', label: 'Scholarships', icon: BadgeDollarSign },
];

const blankForms = {
  cycles: { cycleYear: '', name: '', opensAt: '', closesAt: '', status: 'PLANNED' },
  programmes: { code: '', name: '', school: '', degreeLevel: 'UG' },
  staff: { name: '', email: '', role: 'REVIEWER' },
  scholarships: { code: '', name: '', amountHkd: '', minimumScore: '', places: '' },
};

function toForm(type, record) {
  if (!record) return { ...blankForms[type] };
  if (type === 'cycles') return { cycleYear: String(record.cycle_year), name: record.name, opensAt: record.opens_at, closesAt: record.closes_at, status: record.status };
  if (type === 'programmes') {
    return {
      code: record.code,
      name: record.name,
      school: record.school,
      degreeLevel: record.degree_level,
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
  const [tab, setTab] = useState('cycles');
  const [records, setRecords] = useState({ cycles: null, programmes: null, staff: null, scholarships: null });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [editor, setEditor] = useState(null);
  const [confirmRecord, setConfirmRecord] = useState(null);
  const [detailCycle, setDetailCycle] = useState(null);

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
    return [id, list ? list.filter((record) => id === 'cycles' ? record.status !== 'CLOSED' : record.active === 1).length : null];
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
        body: JSON.stringify(tab === 'cycles' ? { status: confirmRecord.status === 'CLOSED' ? 'PLANNED' : 'CLOSED' } : { active: nextActive }),
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
          <span className="eyebrow">Registry configuration · HKUST</span>
          <h1>Operations catalogue</h1>
          <p>Maintain the reference data used by application, assignment and award workflows.</p>
        </div>
        <button className="button button-primary" type="button" onClick={() => setEditor({ type: tab, record: null })}>
          <Plus size={16} />New {tab === 'staff' ? 'team member' : tab === 'cycles' ? 'admission cycle' : tab.slice(0, -1)}
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
                      onDetails={tab === 'cycles' ? () => setDetailCycle(record) : undefined}
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
                  onDetails={tab === 'cycles' ? () => setDetailCycle(record) : undefined}
                />
              ))}
            </div>
          </>
        ) : null}
      </section>

      {detailCycle ? <CycleDetail cycle={detailCycle} onClose={() => setDetailCycle(null)} onUpdated={(message) => { onUpdated(message); load('cycles'); }} /> : null}

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
  if (type === 'cycles') return 'Open, close and archive annual admission cycles used throughout the workspace.';
  if (type === 'programmes') return 'Capacity, deadlines and active choices available to applicant intake.';
  if (type === 'staff') return 'Admissions and reviewer references available for case assignment.';
  return 'Award thresholds, amounts and place limits used by decision workflows.';
}

function CatalogueHead({ type }) {
  if (type === 'cycles') return <tr><th>Cycle</th><th>Window</th><th>Applications</th><th>Offerings</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr>;
  if (type === 'programmes') return <tr><th>Programme</th><th>School</th><th>Level</th><th>Offerings</th><th>Applications</th><th>Choices</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr>;
  if (type === 'staff') return <tr><th>Team member</th><th>Role</th><th>Assigned</th><th>Historical usage</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr>;
  return <tr><th>Scholarship</th><th>Amount</th><th>Minimum score</th><th>Awards</th><th>Committed</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr>;
}

function CatalogueRow({ type, record, busy, onEdit, onToggle, onDetails }) {
  const active = type === 'cycles' ? record.status !== 'CLOSED' : record.active === 1;
  return (
    <tr className={active ? '' : 'inactive-row'}>
      {type === 'cycles' ? <><td><div className="catalogue-identity"><strong>{record.cycle_year}</strong><span>{record.name}</span></div></td><td>{formatDate(record.opens_at)} – {formatDate(record.closes_at)}</td><td>{record.application_count}</td><td>{record.active_offerings}</td></> : null}
      {type === 'programmes' ? (
        <>
          <td><div className="catalogue-identity"><strong>{record.code}</strong><span>{record.name}</span></div></td>
          <td>{record.school}</td><td>{record.degree_level}</td><td>{record.offering_count}</td><td>{record.application_count}</td><td>{record.choice_count}</td>
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
      <td><StatusBadge status={type === 'cycles' ? record.status : record.active === 1 ? 'ACTIVE' : 'ARCHIVED'} subtle /></td>
      <td><div className="row-actions">{onDetails ? <button className="icon-button" type="button" onClick={onDetails} aria-label={`Open details for ${record.name}`} title="Open cycle details"><CalendarDays size={15} /></button> : null}<button className="icon-button" type="button" onClick={onEdit} aria-label={`Edit ${record.name}`} title="Edit"><Edit3 size={15} /></button><button className="icon-button" type="button" onClick={onToggle} disabled={busy === `active-${record.id}`} aria-label={`${active ? 'Archive' : 'Restore'} ${record.name}`} title={active ? 'Archive' : 'Restore'}>{active ? <Archive size={15} /> : <RotateCcw size={15} />}</button></div></td>
    </tr>
  );
}

function CatalogueMobileItem({ type, record, onEdit, onToggle, onDetails }) {
  const active = type === 'cycles' ? record.status !== 'CLOSED' : record.active === 1;
  const meta = type === 'programmes'
    ? `${record.degree_level} · ${record.offering_count} offerings · ${record.application_count} applications · ${record.choice_count} choices`
    : type === 'cycles'
      ? `${record.application_count} applications · ${record.active_offerings} offerings`
      : type === 'staff'
      ? `${titleCase(record.role)} · ${record.assigned_count} assigned`
      : `HK$${record.amount_hkd.toLocaleString('en-HK')} · ${record.awarded_count}/${record.places} awarded`;
  return (
    <article className={`catalogue-mobile-item ${active ? '' : 'inactive-row'}`}>
      <div><strong>{record.code || record.name}</strong><span>{type === 'staff' ? record.email : record.name}</span><small>{meta}</small></div>
      <StatusBadge status={type === 'cycles' ? record.status : active ? 'ACTIVE' : 'ARCHIVED'} subtle />
      <div className="row-actions">{onDetails ? <button className="icon-button" type="button" onClick={onDetails} aria-label={`Open details for ${record.name}`}><CalendarDays size={15} /></button> : null}<button className="icon-button" type="button" onClick={onEdit} aria-label={`Edit ${record.name}`}><Edit3 size={15} /></button><button className="icon-button" type="button" onClick={onToggle} aria-label={`${active ? 'Archive' : 'Restore'} ${record.name}`}>{active ? <Archive size={15} /> : <RotateCcw size={15} />}</button></div>
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

  const singular = type === 'staff' ? 'team member' : type === 'cycles' ? 'admission cycle' : type.slice(0, -1);
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
  if (type === 'cycles') return <><Field label="Cycle year" name="cycleYear" value={form.cycleYear} error={errors.cycleYear} onChange={onChange} type="number" min="2020" max="2100" required /><Field label="Cycle name" name="name" value={form.name} error={errors.name} onChange={onChange} required wide /><Field label="Opens at" name="opensAt" value={form.opensAt} error={errors.opensAt} onChange={onChange} type="datetime-local" required /><Field label="Closes at" name="closesAt" value={form.closesAt} error={errors.closesAt} onChange={onChange} type="datetime-local" required /><SelectField label="Status" name="status" value={form.status} error={errors.status} onChange={onChange} options={[['PLANNED', 'Planned'], ['OPEN', 'Open'], ['CLOSED', 'Closed']]} wide /></>;
  if (type === 'programmes') return <><Field label="Programme code" name="code" value={form.code} error={errors.code} onChange={onChange} required /><Field label="Programme name" name="name" value={form.name} error={errors.name} onChange={onChange} required wide /><Field label="School" name="school" value={form.school} error={errors.school} onChange={onChange} required wide /><SelectField label="Degree level" name="degreeLevel" value={form.degreeLevel} error={errors.degreeLevel} onChange={onChange} options={[['UG', 'Undergraduate'], ['PG', 'Postgraduate']]} /> </>;
  if (type === 'staff') return <><Field label="Full name" name="name" value={form.name} error={errors.name} onChange={onChange} required wide /><Field label="Email address" name="email" value={form.email} error={errors.email} onChange={onChange} type="email" required wide /><SelectField label="Role" name="role" value={form.role} error={errors.role} onChange={onChange} wide options={[['ADMIN', 'Administrator'], ['ADMISSIONS', 'Admissions'], ['REVIEWER', 'Reviewer']]} /></>;
  return <><Field label="Scholarship code" name="code" value={form.code} error={errors.code} onChange={onChange} required /><Field label="Scholarship name" name="name" value={form.name} error={errors.name} onChange={onChange} required wide /><Field label="Amount (HKD)" name="amountHkd" value={form.amountHkd} error={errors.amountHkd} onChange={onChange} type="number" min="1" required /><Field label="Minimum score" name="minimumScore" value={form.minimumScore} error={errors.minimumScore} onChange={onChange} type="number" min="0" max="100" step="0.1" required /><Field label="Award places" name="places" value={form.places} error={errors.places} onChange={onChange} type="number" min="1" required /></>;
}

function Field({ label, name, value, error, onChange, wide, ...props }) {
  return <label className={`field ${wide ? 'full-field' : ''} ${error ? 'field-error' : ''}`}><span>{label}</span><input value={value} onChange={(event) => onChange(name, event.target.value)} {...props} />{error ? <small>{error}</small> : null}</label>;
}

function SelectField({ label, name, value, error, onChange, options, wide }) {
  return <label className={`field ${wide ? 'full-field' : ''} ${error ? 'field-error' : ''}`}><span>{label}</span><select value={value} onChange={(event) => onChange(name, event.target.value)}>{options.map(([optionValue, optionLabel]) => <option value={optionValue} key={optionValue}>{optionLabel}</option>)}</select>{error ? <small>{error}</small> : null}</label>;
}

function CycleDetail({ cycle, onClose, onUpdated }) {
  const [offerings, setOfferings] = useState([]);
  const [requirements, setRequirements] = useState([]);
  const [programmes, setProgrammes] = useState([]);
  const [offeringForm, setOfferingForm] = useState({ programmeId: '', capacity: '', applicationDeadline: '' });
  const [requirementForm, setRequirementForm] = useState({ degreeLevel: 'UG', documentType: 'ID', requiredByStatus: 'SCREENING' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    try {
      const [offeringRows, requirementRows, programmeRows] = await Promise.all([
        api(`/admin/offerings?cycleId=${cycle.id}`),
        api(`/admin/document-requirements?cycleId=${cycle.id}`),
        api('/admin/programmes'),
      ]);
      setOfferings(offeringRows);
      setRequirements(requirementRows);
      setProgrammes(programmeRows.filter(({ active }) => active === 1));
      setOfferingForm((current) => ({ ...current, programmeId: current.programmeId || String(programmeRows.find(({ active }) => active === 1)?.id || '') }));
    } catch (requestError) {
      setError(requestError.message);
    }
  }, [cycle.id]);

  useEffect(() => { load(); }, [load]);

  async function createOffering(event) {
    event.preventDefault();
    setBusy('new-offering');
    setError('');
    try {
      const result = await api('/admin/offerings', { method: 'POST', body: JSON.stringify({ ...offeringForm, programmeId: Number(offeringForm.programmeId), cycleId: cycle.id, capacity: Number(offeringForm.capacity) }) });
      await load();
      onUpdated(result.message);
      setOfferingForm((current) => ({ ...current, capacity: '', applicationDeadline: '' }));
    } catch (requestError) {
      setError(requestError.message);
    } finally { setBusy(''); }
  }

  async function saveOffering(offering) {
    setBusy(`offering-${offering.id}`);
    setError('');
    try {
      const result = await api(`/admin/offerings/${offering.id}`, { method: 'PATCH', body: JSON.stringify({ capacity: Number(offering.capacity), applicationDeadline: offering.application_deadline, active: offering.active === 1 }) });
      onUpdated(result.message);
      await load();
    } catch (requestError) { setError(requestError.message); } finally { setBusy(''); }
  }

  async function createRequirement(event) {
    event.preventDefault();
    setBusy('new-requirement');
    setError('');
    try {
      const result = await api('/admin/document-requirements', { method: 'POST', body: JSON.stringify({ ...requirementForm, cycleId: cycle.id }) });
      await load();
      onUpdated(result.message);
    } catch (requestError) { setError(requestError.message); } finally { setBusy(''); }
  }

  async function toggleRequirement(requirement) {
    setBusy(`requirement-${requirement.id}`);
    setError('');
    try {
      const result = await api(`/admin/document-requirements/${requirement.id}`, { method: 'PATCH', body: JSON.stringify({ active: requirement.active !== 1 }) });
      onUpdated(result.message);
      await load();
    } catch (requestError) { setError(requestError.message); } finally { setBusy(''); }
  }

  return <div className="cycle-detail-panel" role="region" aria-label={`${cycle.cycle_year} cycle details`}>
    <header className="cycle-detail-header"><div><span className="eyebrow">Cycle workspace</span><h2>{cycle.name}</h2><p>{formatDate(cycle.opens_at)} – {formatDate(cycle.closes_at)} · {cycle.status}</p></div><button className="icon-button" type="button" onClick={onClose} aria-label="Close cycle details"><X size={18} /></button></header>
    {error ? <div className="inline-alert" role="alert"><ShieldCheck size={16} /><span>{error}</span></div> : null}
    <div className="cycle-detail-grid">
      <section className="cycle-detail-section"><div className="section-heading"><div><span className="eyebrow">Programme × cycle</span><h3>Programme offerings</h3></div><span>{offerings.length} configured</span></div>
        <form className="inline-create-form" onSubmit={createOffering}><select aria-label="Offering programme" value={offeringForm.programmeId} onChange={(event) => setOfferingForm((current) => ({ ...current, programmeId: event.target.value }))}><option value="">Programme</option>{programmes.map((programme) => <option value={programme.id} key={programme.id}>{programme.code}</option>)}</select><input aria-label="Offering capacity" type="number" min="1" placeholder="Capacity" value={offeringForm.capacity} onChange={(event) => setOfferingForm((current) => ({ ...current, capacity: event.target.value }))} required /><input aria-label="Offering deadline" type="datetime-local" value={offeringForm.applicationDeadline} onChange={(event) => setOfferingForm((current) => ({ ...current, applicationDeadline: event.target.value }))} required /><button className="button button-secondary" type="submit" disabled={busy === 'new-offering'}><Plus size={15} />Add offering</button></form>
        <div className="cycle-offering-list">{offerings.map((offering) => <div className="cycle-offering-row" key={offering.id}><div><strong>{offering.code}</strong><span>{offering.degree_level} · {offering.first_choice_demand} first-choice demand · {offering.accepted_count} accepted · {offering.remaining_places} remaining</span></div><input aria-label={`${offering.code} capacity`} type="number" min="1" value={offering.capacity} onChange={(event) => setOfferings((current) => current.map((row) => row.id === offering.id ? { ...row, capacity: event.target.value } : row))} /><input aria-label={`${offering.code} deadline`} type="datetime-local" value={toLocalDateTime(offering.application_deadline)} onChange={(event) => setOfferings((current) => current.map((row) => row.id === offering.id ? { ...row, application_deadline: event.target.value } : row))} /><button className="icon-button" type="button" onClick={() => saveOffering(offering)} disabled={busy === `offering-${offering.id}`} aria-label={`Save ${offering.code} offering`} title="Save offering"><Edit3 size={15} /></button></div>)}</div>
      </section>
      <section className="cycle-detail-section"><div className="section-heading"><div><span className="eyebrow">Evidence policy</span><h3>Document requirements</h3></div><span>{requirements.filter(({ active }) => active === 1).length} active</span></div>
        <form className="inline-create-form requirement-form" onSubmit={createRequirement}><select aria-label="Requirement degree level" value={requirementForm.degreeLevel} onChange={(event) => setRequirementForm((current) => ({ ...current, degreeLevel: event.target.value }))}><option value="UG">UG</option><option value="PG">PG</option></select><select aria-label="Requirement document type" value={requirementForm.documentType} onChange={(event) => setRequirementForm((current) => ({ ...current, documentType: event.target.value }))}>{['ID', 'TRANSCRIPT', 'CV', 'PERSONAL_STATEMENT', 'REFERENCE'].map((value) => <option value={value} key={value}>{value}</option>)}</select><select aria-label="Requirement stage" value={requirementForm.requiredByStatus} onChange={(event) => setRequirementForm((current) => ({ ...current, requiredByStatus: event.target.value }))}>{['SUBMITTED', 'SCREENING', 'REVIEW', 'INTERVIEW', 'WAITLISTED', 'OFFERED'].map((value) => <option value={value} key={value}>{titleCase(value)}</option>)}</select><button className="button button-secondary" type="submit" disabled={busy === 'new-requirement'}><Plus size={15} />Add requirement</button></form>
        <div className="requirement-list">{requirements.map((requirement) => <div className={`requirement-row ${requirement.active === 1 ? '' : 'inactive-row'}`} key={requirement.id}><div><strong>{requirement.degree_level} · {requirement.document_type}</strong><span>Required by {titleCase(requirement.required_by_status)}</span></div><button className="icon-button" type="button" onClick={() => toggleRequirement(requirement)} disabled={busy === `requirement-${requirement.id}`} aria-label={`${requirement.active === 1 ? 'Archive' : 'Restore'} ${requirement.document_type} requirement`}>{requirement.active === 1 ? <Archive size={15} /> : <RotateCcw size={15} />}</button></div>)}</div>
      </section>
    </div>
  </div>;
}

function toLocalDateTime(value) {
  return value ? String(value).slice(0, 16) : '';
}

function ConfirmationDialog({ record, type, busy, onClose, onConfirm }) {
  const close = useCallback(() => onClose(), [onClose]);
  const dialogRef = useDialogFocus(close);
  const archiving = type === 'cycles' ? record.status !== 'CLOSED' : record.active === 1;
  const name = record.code || record.name;
  return (
    <div className="modal-layer confirmation-layer" role="presentation">
      <button className="modal-scrim" type="button" onClick={onClose} aria-label="Close confirmation" />
      <div ref={dialogRef} className="confirmation-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirmation-title" aria-describedby="confirmation-copy">
        <span className="confirmation-icon">{archiving ? <Archive size={20} /> : <RotateCcw size={20} />}</span>
        <h2 id="confirmation-title">{archiving ? 'Archive' : 'Restore'} {name}?</h2>
        <p id="confirmation-copy">{archiving ? `This ${type === 'staff' ? 'team member' : type === 'cycles' ? 'admission cycle' : type.slice(0, -1)} will no longer be available for new workflow actions. Historical records and reports remain intact.` : 'This record will become available for new workflow actions again.'}</p>
        <div><button data-dialog-initial className="button button-secondary" type="button" onClick={onClose}>Cancel</button><button className={`button ${archiving ? 'button-danger-quiet' : 'button-primary'}`} type="button" onClick={onConfirm} disabled={busy}>{busy ? <LoaderCircle className="spin" size={16} /> : null}{archiving ? 'Archive record' : 'Restore record'}</button></div>
      </div>
    </div>
  );
}
