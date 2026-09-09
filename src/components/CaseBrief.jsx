import { ArrowUpRight, ClipboardCheck, GraduationCap } from 'lucide-react';

const coreTypes = ['ID', 'TRANSCRIPT', 'PERSONAL_STATEMENT'];

export default function CaseBrief({ data, onEvidence }) {
  const verified = coreTypes.filter((type) => data.documents.some((document) => document.document_type === type && document.verification_status === 'VERIFIED')).length;
  const firstChoice = data.choices.find((choice) => choice.preference_rank === 1);
  const complete = verified === coreTypes.length;
  return <section className="case-brief" aria-label="Case at a glance">
    <div className="case-brief-academic"><GraduationCap size={18} /><div><span>First-choice academic score</span><strong>{firstChoice?.academic_score == null ? 'Not recorded' : <>{firstChoice.academic_score.toFixed(1)}<small> / 100</small></>}</strong><p>{firstChoice?.code || 'No first choice recorded'}</p></div></div>
    <button type="button" className={`case-brief-evidence ${complete ? 'is-complete' : ''}`} onClick={onEvidence}><ClipboardCheck size={18} /><span><span>Core evidence</span><strong>{verified} of 3 verified</strong><small>{complete ? 'View verified documents' : `${3 - verified} ${verified === 2 ? 'document needs' : 'documents need'} attention`}</small></span><ArrowUpRight size={17} /></button>
  </section>;
}
