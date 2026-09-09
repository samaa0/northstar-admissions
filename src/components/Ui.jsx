import { useEffect } from 'react';
import { motion, useReducedMotion, useSpring, useTransform } from 'motion/react';
import * as Tooltip from '@radix-ui/react-tooltip';
import { AlertTriangle, Check, X } from 'lucide-react';
import { titleCase } from '../lib/format.js';

export function StatusBadge({ status, subtle = false }) {
  return <motion.span layout className={`status-badge status-${String(status).toLowerCase()} ${subtle ? 'subtle' : ''}`}>{titleCase(status)}</motion.span>;
}

export function Avatar({ name, size = 'md' }) {
  const letters = String(name || '').split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase();
  return <span className={`avatar avatar-${size}`} aria-hidden="true">{letters}</span>;
}

export function RecordAvatar({ name }) {
  const letters = String(name || '').trim().split(/\s+/).filter(Boolean).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || '?';
  return <span className="record-avatar" aria-hidden="true"><span>{letters}</span></span>;
}

export function EmptyState({ icon: Icon, title, detail, action }) {
  return (
    <div className="empty-state">
      {Icon ? <Icon size={22} aria-hidden="true" /> : null}
      <strong>{title}</strong>
      <span>{detail}</span>
      {action}
    </div>
  );
}

export function LoadingBlock({ label = 'Loading' }) {
  return (
    <div className="loading-block" role="status" aria-label={label}>
      <div className="loading-skeleton" aria-hidden="true">
        <span className="skeleton-line skeleton-title" />
        <span className="skeleton-line skeleton-copy" />
        <span className="skeleton-metrics"><i /><i /><i /><i /></span>
        <span className="skeleton-row" /><span className="skeleton-row" /><span className="skeleton-row" />
      </div>
      <span className="loading-label">{label}</span>
    </div>
  );
}

export function Toast({ toast, onClose }) {
  if (!toast) return null;
  const Icon = toast.type === 'error' ? AlertTriangle : Check;
  return (
    <motion.div
      className={`toast toast-${toast.type || 'success'}`}
      role={toast.type === 'error' ? 'alert' : 'status'}
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.98 }}
    >
      <Icon size={18} />
      <span>{toast.message}</span>
      <button className="icon-button" type="button" onClick={onClose} aria-label="Dismiss notification"><X size={16} /></button>
    </motion.div>
  );
}

export function AnimatedNumber({ value, suffix = '' }) {
  const reducedMotion = useReducedMotion();
  const spring = useSpring(0, { stiffness: 260, damping: 32, mass: 0.55 });
  const display = useTransform(spring, (latest) => `${Math.round(latest).toLocaleString()}${suffix}`);

  useEffect(() => spring.set(Number(value) || 0), [spring, value]);

  return (
    <>
      {reducedMotion ? <strong aria-hidden="true">{Number(value).toLocaleString()}{suffix}</strong> : <motion.strong aria-hidden="true">{display}</motion.strong>}
      <span className="sr-only">{Number(value).toLocaleString()}{suffix}</span>
    </>
  );
}

export function Hint({ label, children }) {
  return <Tooltip.Provider delayDuration={350}><Tooltip.Root><Tooltip.Trigger asChild>{children}</Tooltip.Trigger><Tooltip.Portal><Tooltip.Content className="registry-tooltip" sideOffset={7} collisionPadding={12}>{label}<Tooltip.Arrow /></Tooltip.Content></Tooltip.Portal></Tooltip.Root></Tooltip.Provider>;
}

export function SectionHeader({ eyebrow, title, action, description }) {
  return (
    <div className="section-header">
      <div>
        {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
      {action}
    </div>
  );
}
