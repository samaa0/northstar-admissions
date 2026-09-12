import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  AlertTriangle,
  ArrowRight,
  Award,
  CalendarDays,
  BookOpen,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  Edit3,
  FileCheck2,
  FilePlus2,
  FileWarning,
  GraduationCap,
  LoaderCircle,
  Mail,
  MapPin,
  MessageSquarePlus,
  Phone,
  Save,
  Send,
  ShieldAlert,
  Sparkles,
  UserRound,
  X,
  XCircle,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { formatDate, formatDateTime, titleCase } from '../lib/format.js';
import { useDialogFocus } from '../lib/useDialogFocus.js';
import { EmptyState, LoadingBlock, StatusBadge } from './Ui.jsx';
import CaseBrief from './CaseBrief.jsx';

const requiredDocuments = ['ID', 'TRANSCRIPT', 'PERSONAL_STATEMENT'];
const documentTypes = ['ID', 'TRANSCRIPT', 'PERSONAL_STATEMENT', 'CV', 'REFERENCE'];
const caseStages = ['SUBMITTED', 'SCREENING', 'REVIEW', 'INTERVIEW', 'WAITLISTED', 'OFFERED', 'ACCEPTED'];
const tabs = [
  { id: 'summary', label: 'Summary', icon: UserRound },
  { id: 'evidence', label: 'Evidence', icon: ClipboardCheck },
  { id: 'interview', label: 'Interview', icon: CalendarDays },
  { id: 'decision', label: 'Decision', icon: Award },
  { id: 'activity', label: 'Activity', icon: Clock3 },
];

export default function ApplicationDrawer({ applicationId, onClose, onUpdated }) {
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('summary');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const [transitionNote, setTransitionNote] = useState('');
  const [editingProfile, setEditingProfile] = useState(false);
  const [profile, setProfile] = useState(null);
  const [profileErrors, setProfileErrors] = useState({});
  const [newDocument, setNewDocument] = useState({ documentType: '', fileName: '' });
  const close = useCallback(() => onClose(), [onClose]);
  const dialogRef = useDialogFocus(close);

  const load = useCallback(async () => {
    setError('');
    try {
      const nextData = await api(`/applicants/${applicationId}`);
      setData(nextData);
      const education = nextData.education[0] || {};
      setProfile({
        firstName: nextData.application.first_name,
        lastName: nextData.application.last_name,
        preferredName: nextData.application.preferred_name || '',
        email: nextData.application.email,
        phone: nextData.application.phone,
        nationality: nextData.application.nationality,
        birthDate: nextData.application.birth_date,
        institution: education.institution || '',
        qualification: education.qualification || '',
        fieldOfStudy: education.field_of_study || '',
        grade: education.grade || '',
        graduationYear: education.graduation_year || '',
      });
    } catch (requestError) {
      setError(requestError.message);
    }
  }, [applicationId]);

  useEffect(() => {
    setData(null);
    setTab('summary');
    setNote('');
    setTransitionNote('');
    setEditingProfile(false);
    load();
  }, [applicationId, load]);

  const documentProgress = useMemo(() => {
    if (!data) return { verified: 0, total: requiredDocuments.length, percent: 0 };
    const total = data.compliance?.required_count || data.requirements?.length || requiredDocuments.length;
    const verified = data.compliance?.verified_count || data.documents.filter((document) => requiredDocuments.includes(document.document_type) && document.verification_status === 'VERIFIED').length;
    return { verified, total, percent: total ? Math.round((verified / total) * 100) : 0 };
  }, [data]);

  const folioIndex = useMemo(() => {
    if (!data) return 0;
    const direct = caseStages.indexOf(data.application.status);
    if (direct >= 0) return direct;
    return Math.max(0, ...data.history.map(({ to_status: status }) => caseStages.indexOf(status)).filter((index) => index >= 0));
  }, [data]);

  async function perform(key, requestPath, options, after) {
    setBusy(key);
    setError('');
    try {
      const result = await api(requestPath, options);
      if (after) after();
      await load();
      onUpdated(result.message);
    } catch (requestError) {
      setError(requestError.message);
      if (key === 'profile') setProfileErrors(requestError.fields || {});
    } finally {
      setBusy('');
    }
  }

  function changeStatus(status) {
    perform(status, `/applications/${applicationId}/status`, {
      method: 'PATCH', body: JSON.stringify({ status, reason: transitionNote }),
    }, () => setTransitionNote(''));
  }

  function saveProfile(event) {
    event.preventDefault();
    setProfileErrors({});
    perform('profile', `/applicants/${data.application.applicant_id}`, {
      method: 'PATCH', body: JSON.stringify(profile),
    }, () => setEditingProfile(false));
  }

  function assignStaff(event) {
    perform('assignment', `/applications/${applicationId}/assignment`, {
      method: 'PATCH', body: JSON.stringify({ staffId: event.target.value }),
    });
  }

  function addDocument(event) {
    event.preventDefault();
    perform('document-new', `/applications/${applicationId}/documents`, {
      method: 'POST', body: JSON.stringify(newDocument),
    }, () => setNewDocument({ documentType: '', fileName: '' }));
  }

  function changeDocument(documentId, status) {
    perform(`document-${documentId}-${status}`, `/applications/${applicationId}/documents/${documentId}`, {
      method: 'PATCH', body: JSON.stringify({ status }),
    });
  }

  function nominate(scholarshipId) {
    perform(`nominate-${scholarshipId}`, `/applications/${applicationId}/scholarships`, {
      method: 'POST', body: JSON.stringify({ scholarshipId }),
    });
  }

  function changeNomination(nominationId, status) {
    perform(`nomination-${nominationId}-${status}`, `/applications/${applicationId}/scholarships/${nominationId}`, {
      method: 'PATCH', body: JSON.stringify({ status }),
    });
  }

  function addNote(event) {
    event.preventDefault();
    perform('note', `/applications/${applicationId}/notes`, {
      method: 'POST', body: JSON.stringify({ note }),
    }, () => setNote(''));
  }

  function moveTab(event, direction) {
    event.preventDefault();
    const index = tabs.findIndex(({ id }) => id === tab);
    const next = tabs[(index + direction + tabs.length) % tabs.length].id;
    setTab(next);
    event.currentTarget.parentElement?.querySelectorAll('[role="tab"]')[tabs.findIndex(({ id }) => id === next)]?.focus();
  }

  function openEvidence() {
    setTab('evidence');
    dialogRef.current?.querySelector('#case-tab-evidence')?.focus();
  }

  return (
    <motion.div className="drawer-layer" role="presentation" initial="closed" animate="open" exit="closed">
      <motion.button type="button" className="drawer-scrim" onClick={onClose} aria-label="Close application details" variants={{ closed: { opacity: 0 }, open: { opacity: 1 } }} />
      <motion.aside
        ref={dialogRef}
        className="application-drawer case-workspace"
        role="dialog"
        aria-modal="true"
        aria-label="Application details"
        aria-labelledby="application-title"
        aria-busy={Boolean(busy)}
        variants={{ closed: { opacity: 0, x: 28 }, open: { opacity: 1, x: 0 } }}
      >
        <div className="drawer-topbar case-topbar">
          <div><span>HKUST · Student Admission System</span><strong>Application case</strong></div>
          <button data-dialog-initial className="icon-button" type="button" onClick={onClose} aria-label="Close application details"><X size={19} /></button>
        </div>
        {error ? <div className="drawer-error" role="alert"><AlertTriangle size={16} />{error}<button type="button" onClick={() => setError('')} aria-label="Dismiss error"><X size={14} /></button></div> : null}
        {!data && !error ? <LoadingBlock label="Opening application case" /> : null}
        {data ? (
          <div className="case-layout">
            <header className="case-header">
              <div className="case-person">
                <div className="applicant-avatar">{data.application.first_name[0]}{data.application.last_name[0]}</div>
                <div><div className="applicant-status"><StatusBadge status={data.application.status} />{data.application.risk_flag !== 'NONE' ? <span className="risk-pill"><AlertTriangle size={12} />{titleCase(data.application.risk_flag)}</span> : null}</div><h2 id="application-title">{data.application.first_name} {data.application.last_name}</h2><span className="mono-value">{data.application.application_no} · {data.application.applicant_no}</span></div>
              </div>
              <div className="case-owner">
                <label><span>Case owner</span><select value={data.application.assigned_to || ''} onChange={assignStaff} disabled={busy === 'assignment'} aria-label="Assign case owner"><option value="" disabled>Unassigned</option>{data.activeStaff.map((staff) => <option key={staff.id} value={staff.id}>{staff.name} · {titleCase(staff.role)}</option>)}</select></label>
              </div>
            </header>

            <section className="folio-rail" aria-label={`Application stage: ${titleCase(data.application.status)}`}>
              <div className="folio-rail-heading"><span>Case folio</span><small>{data.application.risk_flag === 'NONE' ? 'No open exception' : titleCase(data.application.risk_flag)}</small></div>
              <ol>
                {caseStages.map((stage, index) => (
                  <li key={stage} className={index < folioIndex ? 'complete' : index === folioIndex ? 'current' : ''} aria-current={index === folioIndex ? 'step' : undefined}>
                    <span>{index < folioIndex ? <Check size={12} /> : index + 1}</span><strong>{titleCase(stage)}</strong>
                  </li>
                ))}
              </ol>
              {['DECLINED', 'WITHDRAWN'].includes(data.application.status) ? <div className="folio-outcome"><XCircle size={14} />{titleCase(data.application.status)} after {titleCase(caseStages[folioIndex])}</div> : null}
            </section>

            <div className="case-tabs" role="tablist" aria-label="Application record views">
              {tabs.map(({ id, label, icon: Icon }) => <button type="button" role="tab" id={`case-tab-${id}`} aria-controls={`case-panel-${id}`} aria-selected={tab === id} tabIndex={tab === id ? 0 : -1} className={tab === id ? 'active' : ''} key={id} onClick={() => setTab(id)} onKeyDown={(event) => { if (event.key === 'ArrowRight') moveTab(event, 1); if (event.key === 'ArrowLeft') moveTab(event, -1); }}><Icon size={15} />{label}{id === 'evidence' ? <small>{documentProgress.verified}/{documentProgress.total}</small> : id === 'activity' ? <small>{data.notes.length + data.history.length}</small> : null}</button>)}
            </div>

            <div className="case-panel-scroll">
              {tab === 'summary' && !editingProfile ? <CaseBrief data={data} onEvidence={openEvidence} /> : null}
              {tab === 'summary' ? <SummaryPanel data={data} editing={editingProfile} setEditing={setEditingProfile} profile={profile} setProfile={setProfile} errors={profileErrors} busy={busy} onSubmit={saveProfile} /> : null}
              {tab === 'evidence' ? <EvidencePanel data={data} progress={documentProgress} newDocument={newDocument} setNewDocument={setNewDocument} busy={busy} onAdd={addDocument} onChangeStatus={changeDocument} /> : null}
              {tab === 'interview' ? <InterviewPanel data={data} busy={busy} onUpdated={load} onError={setError} /> : null}
              {tab === 'decision' ? <DecisionPanel data={data} transitionNote={transitionNote} setTransitionNote={setTransitionNote} busy={busy} onStatus={changeStatus} onNominate={nominate} onNomination={changeNomination} /> : null}
              {tab === 'activity' ? <ActivityPanel data={data} note={note} setNote={setNote} busy={busy} onAddNote={addNote} /> : null}
            </div>
          </div>
        ) : null}
      </motion.aside>
    </motion.div>
  );
}

function SummaryPanel({ data, editing, setEditing, profile, setProfile, errors, busy, onSubmit }) {
  function update(key, value) {
    setProfile((current) => ({ ...current, [key]: value }));
  }
  return (
    <div id="case-panel-summary" className="case-panel summary-panel" role="tabpanel" aria-labelledby="case-tab-summary">
      <section className="case-section">
        <header className="case-section-heading"><div><UserRound size={17} /><div><h3>Applicant profile</h3><p>Identity and latest contact details</p></div></div>{editing ? <button className="icon-button" type="button" onClick={() => setEditing(false)} aria-label="Cancel profile editing" title="Cancel"><X size={16} /></button> : <button className="button button-secondary button-compact" type="button" onClick={() => setEditing(true)}><Edit3 size={15} />Edit profile</button>}</header>
        {editing ? (
          <form className="profile-form" onSubmit={onSubmit}>
            <div className="form-grid"><ProfileField label="First name" name="firstName" value={profile.firstName} error={errors.firstName} onChange={update} required /><ProfileField label="Last name" name="lastName" value={profile.lastName} error={errors.lastName} onChange={update} required /><ProfileField label="Preferred name" name="preferredName" value={profile.preferredName} error={errors.preferredName} onChange={update} /><ProfileField label="Date of birth" name="birthDate" value={profile.birthDate} error={errors.birthDate} onChange={update} type="date" required /><ProfileField label="Email" name="email" value={profile.email} error={errors.email} onChange={update} type="email" required /><ProfileField label="Phone" name="phone" value={profile.phone} error={errors.phone} onChange={update} required /><ProfileField label="Nationality" name="nationality" value={profile.nationality} error={errors.nationality} onChange={update} required wide /></div>
            <div className="profile-education-fields"><h4>Latest education</h4><div className="form-grid"><ProfileField label="Institution" name="institution" value={profile.institution} error={errors.institution} onChange={update} required wide /><ProfileField label="Qualification" name="qualification" value={profile.qualification} error={errors.qualification} onChange={update} required /><ProfileField label="Field of study" name="fieldOfStudy" value={profile.fieldOfStudy} error={errors.fieldOfStudy} onChange={update} required /><ProfileField label="Grade" name="grade" value={profile.grade} error={errors.grade} onChange={update} required /><ProfileField label="Graduation year" name="graduationYear" value={profile.graduationYear} error={errors.graduationYear} onChange={update} type="number" min="1950" max="2100" required /></div></div>
            <div className="form-actions"><button className="button button-secondary" type="button" onClick={() => setEditing(false)}>Cancel</button><button className="button button-primary" type="submit" disabled={busy === 'profile'}>{busy === 'profile' ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}Save profile</button></div>
          </form>
        ) : (
          <div className="profile-facts"><div><Mail size={15} /><span><small>Email</small><strong>{data.application.email}</strong></span></div><div><Phone size={15} /><span><small>Phone</small><strong>{data.application.phone}</strong></span></div><div><MapPin size={15} /><span><small>Nationality</small><strong>{data.application.nationality}</strong></span></div><div><UserRound size={15} /><span><small>Date of birth</small><strong>{formatDate(data.application.birth_date)}</strong></span></div></div>
        )}
      </section>

      {!editing ? <section className="case-section"><header className="case-section-heading"><div><GraduationCap size={17} /><div><h3>Programme choices</h3><p>{data.choices.length} ranked choices</p></div></div></header><div className="choice-list">{data.choices.map((choice) => <div className="choice-row" key={choice.id}><span className="choice-rank">{choice.preference_rank}</span><div className="choice-main"><strong>{choice.code}</strong><span>{choice.name}</span></div><div className="choice-score"><strong>{choice.academic_score.toFixed(1)}</strong><span>academic</span></div><StatusBadge status={choice.choice_status} subtle /></div>)}</div></section> : null}

      {!editing ? <section className="case-section"><header className="case-section-heading"><div><BookOpen size={17} /><div><h3>Education record</h3><p>Latest qualification first</p></div></div></header><div className="education-list">{data.education.map((record) => <article className="education-record" key={record.id}><strong>{record.institution}</strong><span>{record.qualification} · {record.field_of_study}</span><small>{record.grade} · Graduated {record.graduation_year}</small></article>)}</div></section> : null}
    </div>
  );
}

function EvidencePanel({ data, progress, newDocument, setNewDocument, busy, onAdd, onChangeStatus }) {
  const usedTypes = new Set(data.documents.map(({ document_type: type }) => type));
  return (
    <div id="case-panel-evidence" className="case-panel evidence-panel" role="tabpanel" aria-labelledby="case-tab-evidence">
      <section className="evidence-progress"><div><span><ClipboardCheck size={18} /></span><div><h3>Core evidence</h3><p>{progress.verified} of {progress.total} required documents verified</p></div></div><strong>{progress.percent}%</strong><div className="progress-track" role="progressbar" aria-label="Core document verification" aria-valuemin="0" aria-valuemax="100" aria-valuenow={progress.percent}><span style={{ width: `${progress.percent}%` }} /></div></section>
      <section className="case-section">
        <header className="case-section-heading"><div><FilePlus2 size={17} /><div><h3>Register document</h3><p>Add document type and filename metadata</p></div></div></header>
        <form className="document-register-form" onSubmit={onAdd}><label className="field"><span>Document type</span><select value={newDocument.documentType} onChange={(event) => setNewDocument((current) => ({ ...current, documentType: event.target.value }))} required><option value="">Select type</option>{documentTypes.map((type) => <option value={type} key={type} disabled={usedTypes.has(type)}>{titleCase(type)}{usedTypes.has(type) ? ' · registered' : ''}</option>)}</select></label><label className="field document-name-field"><span>Filename</span><input value={newDocument.fileName} onChange={(event) => setNewDocument((current) => ({ ...current, fileName: event.target.value }))} placeholder="transcript_2026.pdf" required /></label><button className="button button-primary" type="submit" disabled={busy === 'document-new'}>{busy === 'document-new' ? <LoaderCircle className="spin" size={16} /> : <PlusIcon />}Register</button></form>
      </section>
      <section className="case-section">
        <header className="case-section-heading"><div><FileCheck2 size={17} /><div><h3>Evidence register</h3><p>{progress.verified} verified · {progress.total - progress.verified} outstanding</p></div></div></header>
        <div className="document-register-list">{(data.requirements || []).map((requirement) => { const document = data.documents.find(({ document_type: type }) => type === requirement.document_type); const status = document?.verification_status || 'MISSING'; return <article key={requirement.id} className={`document-record document-${status.toLowerCase()}`}><span className="document-status-icon">{status === 'VERIFIED' ? <FileCheck2 size={17} /> : status === 'REJECTED' ? <ShieldAlert size={17} /> : <FileWarning size={17} />}</span><div><strong>{titleCase(requirement.document_type)}</strong><span className="mono-file">{document?.file_name || 'Not registered'}</span><small>Required by {titleCase(requirement.required_by_status)}{document?.reviewer ? ` · checked by ${document.reviewer}` : ''}</small></div><StatusBadge status={status} subtle />{document ? <div className="document-actions"><button className="icon-button action-verify" type="button" title="Verify document" aria-label={`Verify ${titleCase(requirement.document_type)}`} disabled={Boolean(busy)} onClick={() => onChangeStatus(document.id, 'VERIFIED')}><CheckCircle2 size={16} /></button><button className="icon-button action-reject" type="button" title="Reject document" aria-label={`Reject ${titleCase(requirement.document_type)}`} disabled={Boolean(busy)} onClick={() => onChangeStatus(document.id, 'REJECTED')}><XCircle size={16} /></button><button className="icon-button" type="button" title="Return to pending" aria-label={`Mark ${titleCase(requirement.document_type)} pending`} disabled={Boolean(busy)} onClick={() => onChangeStatus(document.id, 'PENDING')}><Clock3 size={16} /></button></div> : null}</article>; })}</div>
      </section>
    </div>
  );
}

function DecisionPanel({ data, transitionNote, setTransitionNote, busy, onStatus, onNominate, onNomination }) {
  return (
    <div id="case-panel-decision" className="case-panel decision-workspace" role="tabpanel" aria-labelledby="case-tab-decision">
      <section className="case-section decision-panel">
        <header className="case-section-heading"><div><ArrowRight size={17} /><div><h3>Application decision</h3><p>Current stage: {titleCase(data.application.status)}</p></div></div></header>
        {data.allowedTransitions.length ? <><label className="field full-field"><span>Decision note <small>required where marked by the workflow</small></span><textarea value={transitionNote} onChange={(event) => setTransitionNote(event.target.value)} placeholder="Record the rationale or next action" rows="3" maxLength="500" /></label><div className="transition-actions">{data.transitionRules?.map(({ status, requiresReason }) => <button type="button" key={status} className={`button ${['DECLINED', 'WITHDRAWN'].includes(status) ? 'button-danger-quiet' : ['ACCEPTED', 'OFFERED'].includes(status) ? 'button-primary' : 'button-secondary'}`} disabled={Boolean(busy) || (requiresReason && transitionNote.trim().length < 3)} onClick={() => onStatus(status)}>{busy === status ? <LoaderCircle className="spin" size={16} /> : ['ACCEPTED', 'OFFERED'].includes(status) ? <Check size={16} /> : <ArrowRight size={16} />}{titleCase(status)}</button>)}</div></> : <div className="terminal-status"><Check size={17} /><span>This application has reached a final status.</span></div>}
      </section>

      <section className="case-section scholarship-section">
        <header className="case-section-heading"><div><Sparkles size={17} /><div><h3>Scholarships</h3><p>Eligibility based on first-choice academic score</p></div></div></header>
        {data.nominations.length ? <div className="nomination-list">{data.nominations.map((item) => <article key={item.id}><span className="scholarship-mark"><Award size={17} /></span><div><strong>{item.name}</strong><span>{item.code} · HK${item.amount_hkd.toLocaleString('en-HK')}</span></div><StatusBadge status={item.status} subtle />{item.status === 'NOMINATED' ? <div><button className="button button-primary button-compact" type="button" disabled={Boolean(busy)} onClick={() => onNomination(item.id, 'AWARDED')}><Check size={14} />Award</button><button className="button button-danger-quiet button-compact" type="button" disabled={Boolean(busy)} onClick={() => onNomination(item.id, 'DECLINED')}><X size={14} />Decline</button></div> : item.status === 'AWARDED' ? <strong className="award-amount">HK${item.awarded_amount_hkd.toLocaleString('en-HK')}</strong> : null}</article>)}</div> : null}
        <div className="eligibility-list">{data.eligibleScholarships.map((item) => <article key={item.id} className={item.eligible ? 'eligible' : 'ineligible'}><div><strong>{item.name}</strong><span>{item.code} · minimum {item.minimum_score}</span></div><div className="eligibility-capacity"><strong>{item.available_places}</strong><small>places left</small></div>{item.nominated ? <span className="eligibility-note"><Check size={13} />Nominated</span> : item.eligible ? <button className="button button-secondary button-compact" type="button" disabled={Boolean(busy)} onClick={() => onNominate(item.id)}><Award size={14} />Nominate</button> : <span className="eligibility-note muted">Not eligible</span>}</article>)}</div>
      </section>
      {data.waitlist ? <section className="case-section waitlist-card"><header className="case-section-heading"><div><Award size={17} /><div><h3>Waitlist position</h3><p>Capacity-aware ranking for the first-choice offering</p></div></div><StatusBadge status={data.waitlist.status} subtle /></header><div className="waitlist-facts"><strong>#{data.waitlist.waitlist_rank || '—'}</strong><span>{data.waitlist.ranking_score || '—'} ranking score</span><span>{data.waitlist.remaining_places} places remaining</span></div></section> : null}
    </div>
  );
}

function InterviewPanel({ data, busy, onUpdated, onError }) {
  const [form, setForm] = useState({ applicationChoiceId: data.choices[0]?.id || '', scheduledAt: '', durationMinutes: '45', mode: 'ONLINE', location: 'Zoom admissions room', panelMemberIds: data.activeStaff.slice(0, 2).map(({ id }) => String(id)), chairId: String(data.activeStaff[0]?.id || '') });
  const [score, setScore] = useState({});
  const [saving, setSaving] = useState(false);
  async function create(event) {
    event.preventDefault();
    setSaving(true);
    try {
      await api(`/applications/${data.application.id}/interviews`, { method: 'POST', body: JSON.stringify(form) });
      await onUpdated();
      setForm((current) => ({ ...current, scheduledAt: '' }));
    } catch (error) { onError(error.message); } finally { setSaving(false); }
  }
  async function complete(interviewId) {
    const values = score[interviewId] || {};
    setSaving(true);
    try {
      await api(`/interviews/${interviewId}/complete`, { method: 'PATCH', body: JSON.stringify({ score: values.score, feedback: values.feedback }) });
      await onUpdated();
    } catch (error) { onError(error.message); } finally { setSaving(false); }
  }
  async function cancel(interviewId, status = 'CANCELLED') {
    setSaving(true);
    try { await api(`/interviews/${interviewId}/cancel`, { method: 'PATCH', body: JSON.stringify({ status }) }); await onUpdated(); }
    catch (error) { onError(error.message); } finally { setSaving(false); }
  }
  function togglePanel(id) {
    setForm((current) => ({ ...current, panelMemberIds: current.panelMemberIds.includes(String(id)) ? current.panelMemberIds.filter((value) => value !== String(id)) : [...current.panelMemberIds, String(id)] }));
  }
  return <div id="case-panel-interview" className="case-panel interview-panel" role="tabpanel" aria-labelledby="case-tab-interview">
    <section className="case-section"><header className="case-section-heading"><div><CalendarDays size={17} /><div><h3>Schedule interview</h3><p>Panel conflicts and completion rules are enforced by the database.</p></div></div></header>
      <form className="interview-form" onSubmit={create}><label className="field"><span>Choice</span><select value={form.applicationChoiceId} onChange={(event) => setForm((current) => ({ ...current, applicationChoiceId: event.target.value }))}>{data.choices.map((choice) => <option key={choice.id} value={choice.id}>{choice.code} · preference {choice.preference_rank}</option>)}</select></label><label className="field"><span>Scheduled at</span><input type="datetime-local" value={form.scheduledAt} onChange={(event) => setForm((current) => ({ ...current, scheduledAt: event.target.value ? new Date(event.target.value).toISOString() : '' }))} required /></label><label className="field"><span>Duration</span><input type="number" min="15" max="240" value={form.durationMinutes} onChange={(event) => setForm((current) => ({ ...current, durationMinutes: event.target.value }))} required /></label><label className="field"><span>Mode</span><select value={form.mode} onChange={(event) => setForm((current) => ({ ...current, mode: event.target.value }))}><option value="ONLINE">Online</option><option value="IN_PERSON">In person</option><option value="HYBRID">Hybrid</option></select></label><label className="field full-field"><span>Location</span><input value={form.location} onChange={(event) => setForm((current) => ({ ...current, location: event.target.value }))} required /></label><fieldset className="panel-picker"><legend>Panel members</legend>{data.activeStaff.map((staff) => <label key={staff.id}><input type="checkbox" checked={form.panelMemberIds.includes(String(staff.id))} onChange={() => togglePanel(staff.id)} /><span>{staff.name}</span><select value={String(form.chairId) === String(staff.id) ? 'CHAIR' : 'MEMBER'} onChange={(event) => setForm((current) => ({ ...current, chairId: event.target.value === 'CHAIR' ? String(staff.id) : current.chairId }))}><option value="MEMBER">Member</option><option value="CHAIR">Chair</option></select></label>)}</fieldset><button className="button button-primary" type="submit" disabled={saving || !form.scheduledAt}><Plus size={15} />Schedule interview</button></form>
    </section>
    <section className="case-section"><header className="case-section-heading"><div><ClipboardCheck size={17} /><div><h3>Interview sessions</h3><p>{data.interviews.length} scheduled or historical sessions</p></div></div></header>{data.interviews.length ? <div className="interview-list">{data.interviews.map((interview) => <article className="interview-record" key={interview.id}><div><strong>{interview.code} · {titleCase(interview.status)}</strong><span>{formatDateTime(interview.scheduled_at)} · {interview.duration_minutes} min · {interview.mode}</span><small>{interview.location} · {interview.panel || 'No panel assigned'}</small></div><StatusBadge status={interview.status} subtle />{interview.status === 'SCHEDULED' ? <div className="interview-actions"><button className="button button-secondary button-compact" type="button" onClick={() => cancel(interview.id, 'NO_SHOW')} disabled={saving}>No-show</button><button className="button button-danger-quiet button-compact" type="button" onClick={() => cancel(interview.id)} disabled={saving}>Cancel</button><div className="interview-complete-fields"><input aria-label="Interview score" type="number" min="0" max="100" placeholder="Score" value={score[interview.id]?.score || ''} onChange={(event) => setScore((current) => ({ ...current, [interview.id]: { ...current[interview.id], score: event.target.value } }))} /><input aria-label="Interview feedback" placeholder="Feedback" value={score[interview.id]?.feedback || ''} onChange={(event) => setScore((current) => ({ ...current, [interview.id]: { ...current[interview.id], feedback: event.target.value } }))} /><button className="button button-primary button-compact" type="button" onClick={() => complete(interview.id)} disabled={saving}>Complete</button></div></div> : interview.status === 'COMPLETED' ? <strong className="score-value">{Number(interview.score).toFixed(1)}</strong> : null}</article>)}</div> : <EmptyState title="No interview sessions" detail="Schedule a session when an application reaches the interview stage." />}</section>
  </div>;
}

function ActivityPanel({ data, note, setNote, busy, onAddNote }) {
  const activity = [...data.notes.map((item) => ({ ...item, kind: 'note', at: item.created_at })), ...data.history.map((item) => ({ ...item, kind: 'status', at: item.changed_at }))].sort((a, b) => new Date(b.at) - new Date(a.at));
  return (
    <div id="case-panel-activity" className="case-panel activity-panel" role="tabpanel" aria-labelledby="case-tab-activity">
      <section className="case-section">
        <header className="case-section-heading"><div><MessageSquarePlus size={17} /><div><h3>Internal note</h3><p>Notes become part of the case audit record</p></div></div></header>
        <form className="note-composer" onSubmit={onAddNote}><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Add an internal review note" minLength="2" maxLength="1000" required /><button className="button button-primary" type="submit" disabled={busy === 'note' || note.trim().length < 2}>{busy === 'note' ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />}Add note</button></form>
      </section>
      <section className="case-section"><header className="case-section-heading"><div><Clock3 size={17} /><div><h3>Audit activity</h3><p>{activity.length} recorded events</p></div></div></header>{activity.length ? <div className="activity-timeline">{activity.map((item) => <div className="activity-item" key={`${item.kind}-${item.id}`}><span className={`activity-marker ${item.kind}`} /><div>{item.kind === 'note' ? <p>{item.note}</p> : <p><strong>{titleCase(item.to_status)}</strong>{item.note ? ` · ${item.note}` : ''}</p>}<span>{item.kind === 'note' ? item.author : item.changed_by_name} · {formatDateTime(item.at)}</span></div></div>)}</div> : <EmptyState title="No activity" detail="No audit events have been recorded." />}</section>
    </div>
  );
}

function ProfileField({ label, name, value, error, onChange, wide, ...props }) {
  return <label className={`field ${wide ? 'full-field' : ''} ${error ? 'field-error' : ''}`}><span>{label}</span><input value={value} onChange={(event) => onChange(name, event.target.value)} {...props} />{error ? <small>{error}</small> : null}</label>;
}

function PlusIcon() {
  return <FilePlus2 size={16} />;
}
