import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Activity, AlertCircle, ArrowRight, ArrowUpRight, CalendarDays, ChevronRight, CircleCheck, Clock3, RefreshCw, Users } from 'lucide-react';
import { api } from '../lib/api.js';
import { formatDate, formatDateTime, titleCase } from '../lib/format.js';
import { AnimatedNumber, EmptyState, Hint, LoadingBlock, RecordAvatar, SectionHeader, StatusBadge } from './Ui.jsx';

const stageOrder = ['SUBMITTED', 'SCREENING', 'REVIEW', 'INTERVIEW', 'WAITLISTED', 'OFFERED', 'ACCEPTED'];

export default function DashboardPage({ cycleId, cycle, onOpenApplication, onViewAll }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [refreshedAt, setRefreshedAt] = useState(null);
  const [refresh, setRefresh] = useState(0);
  const [refreshing, setRefreshing] = useState(true);
  const [capacityMode, setCapacityMode] = useState('demand');

  useEffect(() => {
    const controller = new AbortController();
    setRefreshing(true);
    setError('');
    api(`/dashboard?cycleId=${cycleId}`, { signal: controller.signal }).then((result) => {
      if (!controller.signal.aborted) { setData(result); setRefreshedAt(new Date().toISOString()); }
    }).catch((requestError) => { if (!controller.signal.aborted) setError(requestError.message); })
      .finally(() => { if (!controller.signal.aborted) setRefreshing(false); });
    return () => controller.abort();
  }, [cycleId, refresh]);

  const pipeline = useMemo(() => {
    if (!data) return [];
    const values = Object.fromEntries(data.pipeline.map((item) => [item.status, item.count]));
    return stageOrder.map((status) => ({ status, count: values[status] || 0 }));
  }, [data]);

  if (error) {
    return <EmptyState icon={RefreshCw} title="Dashboard unavailable" detail={error} action={<button className="button button-secondary" type="button" onClick={() => setRefresh((value) => value + 1)}>Try again</button>} />;
  }
  if (!data) return <LoadingBlock label="Preparing admissions overview" />;

  const metricItems = [
    { label: 'Active applications', value: data.metrics.active, context: `${data.metrics.total} total records`, icon: Users, status: '' },
    { label: 'In academic review', value: data.metrics.in_review, context: `${data.metrics.flagged} need attention`, icon: Clock3, status: 'REVIEW' },
    { label: 'Offers issued', value: data.metrics.offers, context: `${data.metrics.accepted} accepted`, icon: CircleCheck, status: 'OFFERED' },
    { label: 'Offer yield', value: data.metrics.yieldRate, suffix: '%', context: 'Current admission cycle', icon: ArrowRight, status: 'ACCEPTED' },
  ];
  const attentionCount = data.attention.length;
  const cycleDeadline = new Date(cycle?.closes_at || data.currentCycle.closes_at);
  const now = new Date();
  const todayStart = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const deadlineStart = Date.UTC(cycleDeadline.getFullYear(), cycleDeadline.getMonth(), cycleDeadline.getDate());
  const daysRemaining = Math.max(0, Math.round((deadlineStart - todayStart) / 86400000));
  const todayLabel = new Intl.DateTimeFormat('en-HK', { weekday: 'long', day: 'numeric', month: 'long' }).format(now);
  const attentionSummary = attentionCount
    ? `${attentionCount} application${attentionCount === 1 ? '' : 's'} need${attentionCount === 1 ? 's' : ''} a closer look today.`
    : 'The exception queue is clear today.';
  const decisionReady = pipeline
    .filter((stage) => ['INTERVIEW', 'OFFERED'].includes(stage.status))
    .reduce((total, stage) => total + stage.count, 0);
  const exceptionRate = data.metrics.total ? Math.round((data.metrics.flagged / data.metrics.total) * 100) : 0;
  const priorityProgramme = data.capacity[0];
  const priorityDemand = priorityProgramme?.capacity
    ? Math.min(100, Math.round((priorityProgramme.demand / priorityProgramme.capacity) * 100))
    : 0;

  return (
    <div className="dashboard-page page-stack">
      <div className="page-intro dashboard-intro">
        <div>
          <span className="eyebrow">HKUST Admissions <span aria-hidden="true">/</span> {cycle?.cycle_year || data.currentCycle.cycle_year} cycle</span>
          <h1>Admissions overview</h1>
          <p>{attentionSummary} Your daily view of applications, decisions and programme capacity.</p>
        </div>
        <div className="overview-date-block"><span className="overview-date">{todayLabel}</span><div className="overview-actions"><Hint label="Refresh admissions data"><button type="button" className="icon-button" aria-label="Refresh overview" disabled={refreshing} onClick={() => setRefresh((value) => value + 1)}><RefreshCw size={17} className={refreshing ? 'spin' : ''} /></button></Hint><div className="deadline-chip"><CalendarDays size={17} /><div><span>Cycle closes · {formatDate(cycleDeadline)}</span><strong>{data.currentCycle.status === 'CLOSED' ? 'Cycle closed' : `${daysRemaining} days remaining`}</strong></div></div></div></div>
      </div>

      <section className="metric-strip" aria-label="Admission metrics">
        {metricItems.map(({ label, value, suffix, context, icon: Icon, status }, index) => (
          <motion.button type="button" className="metric" key={label} onClick={() => onViewAll(status)} aria-label={`Open ${label.toLowerCase()} in the application register`} initial={{ opacity: 0, y: 7 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.045 }} whileTap={{ scale: 0.99 }}>
            <div className="metric-label"><Icon size={16} /><span>{label}</span></div>
            <AnimatedNumber value={value} suffix={suffix} />
            <small>{context}</small>
            <ArrowUpRight className="metric-open" size={16} aria-hidden="true" />
          </motion.button>
        ))}
      </section>

      <section className="decision-pulse" aria-labelledby="decision-pulse-title">
        <div className="pulse-intro">
          <span className="pulse-marker" aria-hidden="true"><Activity size={18} /></span>
          <div>
            <span className="eyebrow">Decision pulse</span>
            <h2 id="decision-pulse-title">Queue health at a glance</h2>
            <p>{decisionReady} application{decisionReady === 1 ? '' : 's'} are ready for a decision. {attentionSummary}</p>
          </div>
        </div>
        <div className="pulse-stats">
          <div className="pulse-stat">
            <span>Decision-ready</span>
            <strong>{decisionReady}</strong>
            <small>interview or offer</small>
          </div>
          <div className="pulse-stat">
            <span>Exception rate</span>
            <strong>{exceptionRate}%</strong>
            <small>{data.metrics.flagged} of {data.metrics.total} records</small>
          </div>
          <div className="pulse-capacity">
            <div><span>Highest first-choice demand</span><strong>{priorityProgramme ? priorityProgramme.code : 'N/A'}</strong></div>
            <div className="pulse-progress" role="img" aria-label={priorityProgramme ? `${priorityProgramme.code}: ${priorityProgramme.demand} first-choice applications against ${priorityProgramme.capacity} places` : 'No programme demand data'}><span style={{ width: `${priorityDemand}%` }} /></div>
            <small>{priorityProgramme ? `${priorityProgramme.demand} demand · ${priorityProgramme.capacity} places` : 'No programme demand recorded'}</small>
          </div>
        </div>
      </section>

      <section className="pipeline-section">
        <SectionHeader eyebrow="Live pipeline" title="From submission to seat" action={<button type="button" className="text-button" onClick={() => onViewAll('')}>Open register <ArrowRight size={15} /></button>} />
        <div className="pipeline-ribbon">
          {pipeline.map((stage, index) => (
            <motion.button
              type="button"
              className={`pipeline-stage stage-${stage.status.toLowerCase()}`}
              key={stage.status}
              onClick={() => onViewAll(stage.status)}
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.985 }}
              aria-label={`Show ${stage.count} ${titleCase(stage.status)} applications`}
            >
              <span className="pipeline-index">{String(index + 1).padStart(2, '0')}</span>
              <strong>{stage.count}</strong>
              <span>{titleCase(stage.status)}</span>
              {index < pipeline.length - 1 ? <ChevronRight className="pipeline-chevron" size={17} /> : null}
            </motion.button>
          ))}
        </div>
      </section>

      <div className="dashboard-grid">
        <section className="queue-section">
          <SectionHeader eyebrow="Recently updated" title="Admissions queue" action={<button className="icon-button" type="button" onClick={() => onViewAll('')} aria-label="View all applications"><ArrowRight size={18} /></button>} />
          <div className="table-scroll">
            <table className="data-table queue-table">
              <thead><tr><th scope="col">Applicant</th><th scope="col">Programme</th><th scope="col">Stage</th><th scope="col">Score</th><th scope="col">Reviewer</th><th scope="col"><span className="sr-only">Open</span></th></tr></thead>
              <tbody>
                {data.recent.map((item) => (
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
                    <td><div className="person-cell"><RecordAvatar name={item.applicant} /><div><strong>{item.applicant}</strong><span>{item.application_no}</span></div></div></td>
                    <td><span className="programme-code">{item.programme}</span></td>
                    <td><StatusBadge status={item.status} subtle /></td>
                    <td><span className="score-value">{item.academic_score.toFixed(1)}</span></td>
                    <td>{item.reviewer}</td>
                    <td><ChevronRight size={16} /></td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mobile-queue-list" aria-label="Recently updated applications">
            {data.recent.map((item) => (
              <motion.button
                type="button"
                className="mobile-queue-item"
                key={item.id}
                onClick={() => onOpenApplication(item.id)}
                whileTap={{ scale: 0.995 }}
                aria-label={`Open ${item.applicant}, ${item.application_no}`}
              >
                <span className="mobile-queue-head">
                  <RecordAvatar name={item.applicant} />
                  <span><strong>{item.applicant}</strong><small>{item.application_no}</small></span>
                  <ChevronRight size={16} />
                </span>
                <span className="mobile-queue-facts">
                  <span><small>Programme</small><strong>{item.programme}</strong></span>
                  <span><small>Stage</small><StatusBadge status={item.status} subtle /></span>
                  <span><small>Score</small><strong>{item.academic_score.toFixed(1)}</strong></span>
                </span>
              </motion.button>
            ))}
          </div>
        </section>

        <aside className="attention-section">
          <SectionHeader eyebrow="Exceptions" title="Needs attention" action={<span className="count-dot">{data.attention.length}</span>} />
          <div className="attention-list">
            {data.attention.length ? data.attention.map((item) => (
              <button type="button" className="attention-item" key={item.id} onClick={() => onOpenApplication(item.id)}>
                <span className="attention-icon"><AlertCircle size={17} /></span>
                <span className="attention-copy"><strong>{item.applicant}</strong><span>{item.risk_flag === 'MISSING_DOCS' ? 'Core document missing' : item.risk_flag === 'DEADLINE' ? 'Deadline risk' : `${item.idle_days} days without update`}</span><small>{item.application_no} · {item.programme}</small></span>
                <ChevronRight size={16} />
              </button>
            )) : <EmptyState title="Queue is clear" detail="No applications require action." />}
          </div>
          <div className="capacity-watch">
            <div className="subsection-title"><span>Programme capacity</span><small>all programmes</small></div>
            <div className="capacity-controls" role="group" aria-label="Capacity measure"><button type="button" aria-pressed={capacityMode === 'demand'} onClick={() => setCapacityMode('demand')}>First choices</button><button type="button" aria-pressed={capacityMode === 'accepted'} onClick={() => setCapacityMode('accepted')}>Accepted</button></div>
            {data.capacity.map((item) => {
              const amount = Number(item[capacityMode] || 0);
              const ratio = item.capacity ? Math.min(100, Math.round((amount / item.capacity) * 100)) : 0;
              return (
                <div className="capacity-row" key={item.code}>
                  <div><strong>{item.code}</strong><span>{amount} / {item.capacity}</span></div>
                  <div className="progress-track" role="progressbar" aria-label={`${item.code} ${capacityMode === 'demand' ? 'first-choice demand' : 'accepted places'}`} aria-valuetext={`${amount} of ${item.capacity} places`} aria-valuemin="0" aria-valuemax="100" aria-valuenow={ratio}><motion.span initial={{ width: 0 }} animate={{ width: `${ratio}%` }} transition={{ duration: 0.3 }} /></div>
                </div>
              );
            })}
          </div>
        </aside>
      </div>

      <footer className="data-freshness" aria-live="polite"><span className="presence" />Live database · {refreshing ? 'Refreshing…' : `Last refreshed ${formatDateTime(refreshedAt)}`}</footer>
    </div>
  );
}
