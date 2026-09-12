import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, ArrowLeft, ArrowRight, Check, FileCheck2, GraduationCap, LoaderCircle, Plus, UserRound, X } from 'lucide-react';
import { api } from '../lib/api.js';
import { useDialogFocus } from '../lib/useDialogFocus.js';

const initialForm = {
  firstName: '', lastName: '', preferredName: '', email: '', phone: '', nationality: '', birthDate: '',
  institution: '', qualification: '', fieldOfStudy: '', grade: '', graduationYear: '2026', cycleId: '', degreeLevel: 'UG',
};

const steps = [
  { label: 'Identity', icon: UserRound },
  { label: 'Education', icon: GraduationCap },
  { label: 'Programme choices', icon: FileCheck2 },
];

function createChoice() {
  const clientId = globalThis.crypto?.randomUUID?.() || `choice-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return { clientId, offeringId: '', academicScore: '' };
}

export default function IntakeDialog({ programmes, cycles, initialCycleId, onClose, onCreated }) {
  const [form, setForm] = useState(() => ({ ...initialForm, cycleId: String(initialCycleId || '') }));
  const [offerings, setOfferings] = useState(programmes);
  const [choices, setChoices] = useState(() => [createChoice()]);
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const confirmationRef = useRef(null);

  const dirty = useMemo(() => Object.entries(form).some(([key, value]) => key !== 'graduationYear' && String(value).trim())
    || choices.some((choice) => choice.offeringId || choice.academicScore), [choices, form]);

  useEffect(() => {
    if (!form.cycleId) return;
    const controller = new AbortController();
    api(`/programmes?cycleId=${form.cycleId}`, { signal: controller.signal }).then((result) => {
      if (!controller.signal.aborted) setOfferings(result);
    }).catch(() => {});
    return () => controller.abort();
  }, [form.cycleId]);

  const requestClose = useCallback(() => {
    if (dirty) setConfirmClose(true);
    else onClose();
  }, [dirty, onClose]);
  const dialogRef = useDialogFocus(requestClose);

  useEffect(() => {
    if (!confirmClose) return;
    const frame = window.requestAnimationFrame(() => confirmationRef.current?.querySelector('[data-confirm-initial]')?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [confirmClose]);

  function updateField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
    if (key === 'cycleId' || key === 'degreeLevel') setChoices([createChoice()]);
    setErrors((current) => ({ ...current, [key]: undefined }));
    setMessage('');
  }

  function updateChoice(index, key, value) {
    setChoices((current) => current.map((choice, choiceIndex) => choiceIndex === index ? { ...choice, [key]: value } : choice));
    setErrors((current) => ({ ...current, choices: undefined, [`choices.${index}.${key}`]: undefined }));
    setMessage('');
  }

  function addChoice() {
    if (choices.length < 3) setChoices((current) => [...current, createChoice()]);
  }

  function removeChoice(index) {
    setChoices((current) => current.filter((_, choiceIndex) => choiceIndex !== index));
  }

  function validateStep(index) {
    const nextErrors = {};
    if (index === 0) {
      ['cycleId', 'degreeLevel', 'firstName', 'lastName', 'email', 'phone', 'nationality', 'birthDate'].forEach((key) => {
        if (!String(form[key]).trim()) nextErrors[key] = 'This field is required';
      });
      if (form.email && !/^\S+@\S+\.\S+$/.test(form.email)) nextErrors.email = 'Enter a valid email address';
    }
    if (index === 1) {
      ['institution', 'qualification', 'fieldOfStudy', 'grade', 'graduationYear'].forEach((key) => {
        if (!String(form[key]).trim()) nextErrors[key] = 'This field is required';
      });
    }
    if (index === 2) {
      choices.forEach((choice, choiceIndex) => {
        if (!choice.offeringId) nextErrors[`choices.${choiceIndex}.offeringId`] = 'Select a programme offering';
        if (choice.academicScore === '') nextErrors[`choices.${choiceIndex}.academicScore`] = 'Enter an academic score';
        else if (Number(choice.academicScore) < 0 || Number(choice.academicScore) > 100) nextErrors[`choices.${choiceIndex}.academicScore`] = 'Use a score from 0 to 100';
      });
      const ids = choices.map(({ offeringId }) => String(offeringId)).filter(Boolean);
      if (new Set(ids).size !== ids.length) nextErrors.choices = 'Programme choices must be unique';
    }
    setErrors((current) => ({ ...current, ...nextErrors }));
    if (Object.keys(nextErrors).length) {
      setMessage('Complete the highlighted fields before continuing.');
      window.setTimeout(() => dialogRef.current?.querySelector('.field-error input, .field-error select')?.focus(), 0);
      return false;
    }
    setMessage('');
    return true;
  }

  function nextStep() {
    if (step < 3 && validateStep(step)) setStep((current) => current + 1);
  }

  function goToStep(nextStep) {
    if (nextStep < step) setStep(nextStep);
  }

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setErrors({});
    setMessage('');
    try {
      const result = await api('/applicants', {
        method: 'POST',
        body: JSON.stringify({ ...form, choices: choices.map(({ offeringId, academicScore }) => ({ offeringId, academicScore })) }),
      });
      onCreated(result.message, result.applicationId);
    } catch (requestError) {
      const nextErrors = requestError.fields || {};
      setErrors(nextErrors);
      setMessage(requestError.message);
      const keys = Object.keys(nextErrors);
      if (keys.some((key) => key.startsWith('choices'))) setStep(2);
      else if (keys.some((key) => ['institution', 'qualification', 'fieldOfStudy', 'grade', 'graduationYear'].includes(key))) setStep(1);
      else setStep(0);
      window.setTimeout(() => dialogRef.current?.querySelector('.field-error input, .field-error select, .field-error textarea')?.focus(), 0);
    } finally {
      setBusy(false);
    }
  }

  const chosenIds = new Set(choices.map((choice) => String(choice.offeringId)).filter(Boolean));
  const availableOfferings = offerings.filter((offering) => offering.degree_level === form.degreeLevel
    && offering.active === 1 && offering.offering_active === 1 && new Date(offering.deadline) >= new Date());
  const selectedCycle = cycles.find(({ id }) => String(id) === String(form.cycleId));

  return (
    <motion.div className="modal-layer" role="presentation" initial="closed" animate="open" exit="closed">
      <motion.button className="modal-scrim" type="button" onClick={requestClose} aria-label="Close applicant intake" variants={{ closed: { opacity: 0 }, open: { opacity: 1 } }} />
      <motion.div
        ref={dialogRef}
        className="intake-dialog wizard-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="intake-title"
        aria-busy={busy}
        variants={{ closed: { opacity: 0, y: 10 }, open: { opacity: 1, y: 0 } }}
      >
        <header className="intake-header wizard-header" inert={confirmClose || undefined} aria-hidden={confirmClose || undefined}>
          <div><span className="eyebrow">{selectedCycle?.cycle_year || 'Admission'} cycle</span><h2 id="intake-title">New applicant</h2><p>Build a submitted application record in three short stages.</p></div>
          <button className="icon-button" type="button" onClick={requestClose} aria-label="Close applicant intake"><X size={19} /></button>
        </header>

        <nav className="wizard-steps" aria-label="Applicant intake progress" inert={confirmClose || undefined} aria-hidden={confirmClose || undefined}>
          {steps.map(({ label, icon: Icon }, index) => (
            <button type="button" key={label} className={step === index ? 'active' : step > index ? 'complete' : ''} onClick={() => goToStep(index)} disabled={index > step} aria-current={step === index ? 'step' : undefined}>
              <span>{step > index ? <Check size={14} /> : <Icon size={14} />}</span><strong>{index + 1}</strong><small>{label}</small>
            </button>
          ))}
          <button type="button" className={step === 3 ? 'active review-step' : 'review-step'} disabled={step < 3} aria-current={step === 3 ? 'step' : undefined}><span><FileCheck2 size={14} /></span><strong>Review</strong><small>Confirm record</small></button>
        </nav>

        {message ? <div className="form-alert" role="alert"><AlertTriangle size={16} /><span>{message}</span></div> : null}

        <form className="intake-form wizard-form" onSubmit={submit} inert={confirmClose || undefined} aria-hidden={confirmClose || undefined}>
          <div className="wizard-body">
            <AnimatePresence mode="wait" initial={false}>
              <motion.section key={step} className="wizard-panel" aria-labelledby={`wizard-panel-title-${step}`} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }}>
                {step === 0 ? (
                  <>
                    <PanelHeading icon={UserRound} title="Identity and contact" copy="Use the applicant's legal details and current contact information." id="wizard-panel-title-0" />
                    <div className="form-grid">
                      <label className={`field ${errors.cycleId ? 'field-error' : ''}`}><span>Admission cycle</span><select name="cycleId" value={form.cycleId} onChange={(event) => updateField('cycleId', event.target.value)} required data-dialog-initial>{cycles.filter(({ status }) => status === 'OPEN').map((cycle) => <option key={cycle.id} value={cycle.id}>{cycle.name}</option>)}</select>{errors.cycleId ? <small>{errors.cycleId}</small> : null}</label>
                      <label className={`field ${errors.degreeLevel ? 'field-error' : ''}`}><span>Degree level</span><select name="degreeLevel" value={form.degreeLevel} onChange={(event) => updateField('degreeLevel', event.target.value)} required><option value="UG">Undergraduate</option><option value="PG">Postgraduate</option></select>{errors.degreeLevel ? <small>{errors.degreeLevel}</small> : null}</label>
                      <Field label="First name" name="firstName" value={form.firstName} error={errors.firstName} onChange={updateField} required data-dialog-initial />
                      <Field label="Last name" name="lastName" value={form.lastName} error={errors.lastName} onChange={updateField} required />
                      <Field label="Preferred name" name="preferredName" value={form.preferredName} error={errors.preferredName} onChange={updateField} placeholder="Optional" />
                      <Field label="Date of birth" name="birthDate" value={form.birthDate} error={errors.birthDate} onChange={updateField} type="date" required />
                      <Field label="Email address" name="email" value={form.email} error={errors.email} onChange={updateField} type="email" required />
                      <Field label="Phone number" name="phone" value={form.phone} error={errors.phone} onChange={updateField} type="tel" placeholder="+852 5123 4567" required />
                      <Field label="Nationality" name="nationality" value={form.nationality} error={errors.nationality} onChange={updateField} required wide />
                    </div>
                  </>
                ) : null}

                {step === 1 ? (
                  <>
                    <PanelHeading icon={GraduationCap} title="Latest education" copy="Record the most relevant completed or current qualification." id="wizard-panel-title-1" />
                    <div className="form-grid">
                      <Field label="Institution" name="institution" value={form.institution} error={errors.institution} onChange={updateField} required wide data-dialog-initial />
                      <Field label="Qualification" name="qualification" value={form.qualification} error={errors.qualification} onChange={updateField} placeholder="Bachelor Degree" required />
                      <Field label="Field of study" name="fieldOfStudy" value={form.fieldOfStudy} error={errors.fieldOfStudy} onChange={updateField} required />
                      <Field label="Latest grade" name="grade" value={form.grade} error={errors.grade} onChange={updateField} placeholder="88% or A" required />
                      <Field label="Graduation year" name="graduationYear" value={form.graduationYear} error={errors.graduationYear} onChange={updateField} type="number" min="1950" max="2100" required />
                    </div>
                  </>
                ) : null}

                {step === 2 ? (
                  <>
                    <PanelHeading icon={FileCheck2} title="Rank programme choices" copy="Add up to three active programmes in preference order." id="wizard-panel-title-2" />
                    <div className="choice-editor-list wizard-choice-list">
                      {choices.map((choice, index) => (
                        <div className="choice-editor" key={choice.clientId}>
                          <span className="choice-rank">{index + 1}</span>
                          <label className={`field choice-programme ${errors[`choices.${index}.offeringId`] ? 'field-error' : ''}`}>
                            <span>Programme offering</span>
                            <select data-dialog-initial={index === 0 ? true : undefined} value={choice.offeringId} onChange={(event) => updateChoice(index, 'offeringId', event.target.value)} required>
                              <option value="">Select programme</option>
                              {availableOfferings.map((programme) => <option key={programme.offeringId} value={programme.offeringId} disabled={chosenIds.has(String(programme.offeringId)) && String(choice.offeringId) !== String(programme.offeringId)}>{programme.code} · {programme.name} · {programme.remaining_places} places remain</option>)}
                            </select>
                            {errors[`choices.${index}.offeringId`] ? <small>{errors[`choices.${index}.offeringId`]}</small> : null}
                          </label>
                          <label className={`field choice-score ${errors[`choices.${index}.academicScore`] ? 'field-error' : ''}`}><span>Academic score</span><div className="score-input"><input type="number" min="0" max="100" step="0.1" value={choice.academicScore} onChange={(event) => updateChoice(index, 'academicScore', event.target.value)} placeholder="0.0" required /><span>/100</span></div>{errors[`choices.${index}.academicScore`] ? <small>{errors[`choices.${index}.academicScore`]}</small> : null}</label>
                          {choices.length > 1 ? <button className="icon-button remove-choice" type="button" onClick={() => removeChoice(index)} aria-label={`Remove choice ${index + 1}`}><X size={16} /></button> : null}
                        </div>
                      ))}
                      {errors.choices ? <span className="inline-error">{errors.choices}</span> : null}
                    </div>
                    {choices.length < 3 ? <button className="text-button add-choice wizard-add-choice" type="button" onClick={addChoice}><Plus size={15} />Add another choice</button> : null}
                  </>
                ) : null}

                {step === 3 ? <ReviewPanel form={form} choices={choices} programmes={availableOfferings} cycle={selectedCycle} /> : null}
              </motion.section>
            </AnimatePresence>
          </div>

          <footer className="intake-footer wizard-footer">
            <button className="button button-secondary" type="button" onClick={step === 0 ? requestClose : () => setStep((current) => current - 1)}><ArrowLeft size={16} />{step === 0 ? 'Cancel' : 'Back'}</button>
            <span>Step {Math.min(step + 1, 3)} of 3{step === 3 ? ' · Ready to submit' : ''}</span>
            {step < 3 ? <button className="button button-primary" type="button" onClick={nextStep}>Continue<ArrowRight size={16} /></button> : <button className="button button-primary" type="submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />}Create application</button>}
          </footer>
        </form>

        {confirmClose ? (
          <div className="wizard-confirm-layer" role="presentation">
            <div ref={confirmationRef} className="confirmation-dialog" role="alertdialog" aria-modal="true" aria-labelledby="discard-title" aria-describedby="discard-copy">
              <span className="confirmation-icon"><AlertTriangle size={20} /></span>
              <h2 id="discard-title">Discard this applicant?</h2>
              <p id="discard-copy">The details entered in this wizard have not been saved.</p>
              <div><button data-confirm-initial className="button button-secondary" type="button" onClick={() => { setConfirmClose(false); window.requestAnimationFrame(() => dialogRef.current?.querySelector('.wizard-panel input, .wizard-panel select')?.focus()); }}>Keep editing</button><button className="button button-danger-quiet" type="button" onClick={onClose}>Discard draft</button></div>
            </div>
          </div>
        ) : null}
      </motion.div>
    </motion.div>
  );
}

function PanelHeading({ icon: Icon, title, copy, id }) {
  return <div className="wizard-panel-heading"><span><Icon size={18} /></span><div><h3 id={id}>{title}</h3><p>{copy}</p></div></div>;
}

function ReviewPanel({ form, choices, programmes, cycle }) {
  return (
    <div className="review-panel">
      <PanelHeading icon={Check} title="Review application" copy="Confirm the record before it enters the submitted queue." id="wizard-panel-title-3" />
      <div className="review-sections">
        <section><span>Identity</span><h4>{form.firstName} {form.lastName}</h4><p>{cycle?.name} · {form.degreeLevel}<br />{form.email}<br />{form.phone}<br />{form.nationality} · born {form.birthDate}</p></section>
        <section><span>Education</span><h4>{form.institution}</h4><p>{form.qualification} · {form.fieldOfStudy}<br />{form.grade} · {form.graduationYear}</p></section>
        <section><span>Programme choices</span>{choices.map((choice, index) => { const programme = programmes.find(({ offeringId }) => String(offeringId) === String(choice.offeringId)); return <div className="review-choice" key={choice.clientId}><strong>{index + 1}</strong><span><b>{programme?.code}</b>{programme?.name}</span><code>{Number(choice.academicScore).toFixed(1)}</code></div>; })}</section>
      </div>
      <div className="review-notice"><Check size={16} /><span>This creates linked applicant, education, application, choice and status history records in one transaction.</span></div>
    </div>
  );
}

function Field({ label, name, value, error, onChange, wide = false, ...inputProps }) {
  return (
    <label className={`field ${wide ? 'full-field' : ''} ${error ? 'field-error' : ''}`}>
      <span>{label}</span>
      <input name={name} value={value} onChange={(event) => onChange(name, event.target.value)} {...inputProps} />
      {error ? <small>{error}</small> : null}
    </label>
  );
}
