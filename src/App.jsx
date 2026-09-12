import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import {
  BarChart3,
  BriefcaseBusiness,
  Database,
  FileClock,
  LayoutDashboard,
  Menu,
  Plus,
  Search,
  Users,
  X,
} from 'lucide-react';
import { api } from './lib/api.js';
import { Avatar, Hint, LoadingBlock, Toast } from './components/Ui.jsx';
import DashboardPage from './components/DashboardPage.jsx';
import ApplicationsPage from './components/ApplicationsPage.jsx';
import ApplicationDrawer from './components/ApplicationDrawer.jsx';
import IntakeDialog from './components/IntakeDialog.jsx';

const ReportsPage = lazy(() => import('./components/ReportsPage.jsx'));
const DataModelPage = lazy(() => import('./components/DataModelPage.jsx'));
const OperationsPage = lazy(() => import('./components/OperationsPage.jsx'));

const navigation = [
  { id: 'dashboard', label: 'Overview', icon: LayoutDashboard },
  { id: 'applications', label: 'Applications', icon: Users },
  { id: 'operations', label: 'Operations', icon: BriefcaseBusiness },
  { id: 'reports', label: 'Reports', icon: BarChart3 },
  { id: 'model', label: 'Data model', icon: Database },
];

const pageTitles = {
  dashboard: 'Admissions overview',
  applications: 'Application register',
  operations: 'Registry operations',
  reports: 'Managerial reports',
  model: 'Data model and SQL',
};

export default function App() {
  const [view, setView] = useState('dashboard');
  const [mobileNav, setMobileNav] = useState(false);
  const [selectedApplication, setSelectedApplication] = useState(null);
  const [intakeOpen, setIntakeOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [programmes, setProgrammes] = useState([]);
  const [toast, setToast] = useState(null);
  const [applicationStatus, setApplicationStatus] = useState('');
  const [searchRequest, setSearchRequest] = useState(0);
  const [cycles, setCycles] = useState([]);
  const [cycleId, setCycleId] = useState('');

  useEffect(() => {
    api('/cycles').then((records) => {
      setCycles(records);
      setCycleId((current) => current || String(records.find(({ status }) => status === 'OPEN')?.id || records[0]?.id || ''));
    }).catch(() => setToast({ type: 'error', message: 'Could not load admission cycles' }));
  }, []);

  useEffect(() => {
    if (!cycleId) return;
    api(`/programmes?cycleId=${cycleId}`).then(setProgrammes).catch(() => setToast({ type: 'error', message: 'Could not load programme data' }));
  }, [cycleId]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 4500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const activeNav = useMemo(() => navigation.find((item) => item.id === view), [view]);

  function navigate(id) {
    setView(id);
    setMobileNav(false);
  }

  function navigateApplications(status = '') {
    setApplicationStatus(status);
    navigate('applications');
  }

  function openApplicationSearch() {
    setApplicationStatus('');
    setSearchRequest((request) => request + 1);
    navigate('applications');
  }

  function handleCreated(message, applicationId) {
    setIntakeOpen(false);
    setRefreshKey((key) => key + 1);
    setToast({ type: 'success', message });
    setApplicationStatus('');
    setView('applications');
    if (applicationId) setSelectedApplication(applicationId);
  }

  function handleUpdated(message) {
    setRefreshKey((key) => key + 1);
    setToast({ type: 'success', message });
    if (cycleId) api(`/programmes?cycleId=${cycleId}`).then(setProgrammes).catch(() => {});
  }

  const currentCycle = cycles.find(({ id }) => String(id) === String(cycleId));

  return (
    <MotionConfig reducedMotion="user" transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}>
    <div className="app-shell university-workspace">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <aside className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`}>
        <div className="brand-lockup">
          <div className="university-identity" aria-label="The Hong Kong University of Science and Technology">
            <img className="hkust-logo hkust-logo-reversed" src="/hkust-logo-white.svg" alt="HKUST logo" />
            <span className="university-name">香港科技大學<br />Student Admission System</span>
          </div>
          <button className="icon-button mobile-only sidebar-close" type="button" onClick={() => setMobileNav(false)} aria-label="Close navigation"><X size={18} /></button>
        </div>
        <div className="workspace-identity"><strong>HKUST</strong><span>Student Admission System</span></div>
        <nav className="primary-nav" aria-label="Main navigation">
          <span className="nav-label">Workspace</span>
          {navigation.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" className={view === id ? 'active' : ''} onClick={() => navigate(id)} aria-current={view === id ? 'page' : undefined}>
              {view === id ? <motion.span className="nav-active-surface" layoutId="desktop-nav-active" /> : null}
              <span className="nav-item-icon" aria-hidden="true"><Icon size={17} strokeWidth={1.8} /></span>
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="cycle-block">
          <div className="cycle-icon"><FileClock size={18} /></div>
          <label><span>Admission cycle</span><select aria-label="Current admission cycle" value={cycleId} onChange={(event) => setCycleId(event.target.value)}>{cycles.map((cycle) => <option key={cycle.id} value={cycle.id}>{cycle.cycle_year} · {cycle.status}</option>)}</select><small>{currentCycle ? `${currentCycle.application_count} applications` : 'Loading cycles'}</small></label>
        </div>
        <div className="sidebar-project" aria-label="Demo workspace">
          <span>HKUST · COURSEWORK DEMO</span>
          <strong>Admissions workspace</strong>
          <small>Fictional records</small>
        </div>
        <div className="user-block">
          <Avatar name="Alex Morgan" size="sm" />
          <div><strong>Alex Morgan</strong><span>Admissions admin</span></div>
          <span className="presence" aria-label="Online" />
        </div>
      </aside>

      {mobileNav ? <button className="nav-scrim" type="button" onClick={() => setMobileNav(false)} aria-label="Close navigation" /> : null}

      <div className="main-column">
        <header className="topbar">
          <div className="topbar-title">
            <button className="icon-button mobile-only" type="button" onClick={() => setMobileNav(true)} aria-label="Open navigation"><Menu size={20} /></button>
            <div className="workspace-heading">
            <span className="workspace-context"><span className="context-university-name">HKUST</span><img className="compact-hkust-logo" src="/hkust-logo-color.svg" alt="" aria-hidden="true" /><span className="context-divider" aria-hidden="true">/</span><span className="context-project-name">Student Admission System</span><span className="context-project-short">Admissions</span></span>
            <AnimatePresence mode="wait" initial={false}>
              <motion.div className="topbar-current" key={view} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 6 }}>
                <activeNav.icon size={18} className="title-icon" />
                <span>{pageTitles[view]}</span>
              </motion.div>
            </AnimatePresence>
            </div>
          </div>
          <div className="topbar-actions">
            <Hint label="Find an applicant in the register"><button className="icon-button search-button" type="button" aria-label="Search applications" onClick={openApplicationSearch}><Search size={18} /></button></Hint>
            <span className="topbar-divider" />
            <button className="button button-primary" type="button" onClick={() => setIntakeOpen(true)} aria-label="New applicant" title="New applicant"><Plus size={17} /><span>New applicant</span></button>
          </div>
        </header>

        <main id="main-content" className="page-content" tabIndex="-1">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div className="page-motion" key={view} initial={{ opacity: 0, y: 9 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }}>
              <Suspense fallback={<LoadingBlock label="Opening workspace" />}>
                {view === 'dashboard' ? <DashboardPage key={`d-${refreshKey}-${cycleId}`} cycleId={cycleId} cycle={currentCycle} onOpenApplication={setSelectedApplication} onViewAll={navigateApplications} /> : null}
                {view === 'applications' ? <ApplicationsPage key={`a-${refreshKey}-${cycleId}`} cycleId={cycleId} cycle={currentCycle} programmes={programmes} initialStatus={applicationStatus} focusSearchRequest={searchRequest} onOpenApplication={setSelectedApplication} onNewApplicant={() => setIntakeOpen(true)} /> : null}
                {view === 'operations' ? <OperationsPage cycles={cycles} cycleId={cycleId} onCycleChange={setCycleId} onUpdated={handleUpdated} /> : null}
                {view === 'reports' ? <ReportsPage cycles={cycles} cycleId={cycleId} onCycleChange={setCycleId} /> : null}
                {view === 'model' ? <DataModelPage /> : null}
              </Suspense>
            </motion.div>
          </AnimatePresence>
          <footer className="project-notice">
            <span>HKUST Student Admission System</span>
            <span className="project-author">ISOM5260 demonstration</span>
            <span>Student coursework demonstration. Fictional records. Not an official HKUST service.</span>
          </footer>
        </main>
      </div>

      <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
        {navigation.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" className={view === id ? 'active' : ''} onClick={() => navigate(id)} aria-current={view === id ? 'page' : undefined}>
            {view === id ? <motion.span className="mobile-nav-active" layoutId="mobile-nav-active" /> : null}
            <span className="mobile-nav-icon" aria-hidden="true"><Icon size={18} /></span><span>{label}</span>
          </button>
        ))}
      </nav>

      <AnimatePresence>
        {selectedApplication ? (
          <ApplicationDrawer applicationId={selectedApplication} onClose={() => setSelectedApplication(null)} onUpdated={handleUpdated} />
        ) : null}
      </AnimatePresence>
      <AnimatePresence>
        {intakeOpen ? <IntakeDialog programmes={programmes} cycles={cycles} initialCycleId={cycleId} onClose={() => setIntakeOpen(false)} onCreated={handleCreated} /> : null}
      </AnimatePresence>
      <AnimatePresence><Toast toast={toast} onClose={() => setToast(null)} /></AnimatePresence>
    </div>
    </MotionConfig>
  );
}
