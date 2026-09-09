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

  useEffect(() => {
    api('/programmes').then(setProgrammes).catch(() => setToast({ type: 'error', message: 'Could not load programme data' }));
  }, []);

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
    api('/programmes').then(setProgrammes).catch(() => {});
  }

  return (
    <MotionConfig reducedMotion="user" transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}>
    <div className="app-shell university-workspace">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <aside className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`}>
        <div className="brand-lockup">
          <div className="university-identity" aria-label="Northstar Academic Registry">
            <div className="registry-mark" aria-hidden="true">N</div>
            <span className="university-name">Academic Registry<br />Admissions workspace</span>
          </div>
          <button className="icon-button mobile-only sidebar-close" type="button" onClick={() => setMobileNav(false)} aria-label="Close navigation"><X size={18} /></button>
        </div>
        <div className="workspace-identity"><strong>Academic Registry</strong><span>Student admissions workspace</span></div>
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
          <div><span>Demonstration cycle</span><strong>2027 intake</strong><small>Closes 15 Oct 2026</small></div>
        </div>
        <div className="sidebar-project" aria-label="Demo workspace">
          <span>NORTHSTAR · DEMO</span>
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
            <span className="workspace-context"><span className="context-university-name">NORTHSTAR</span><span className="compact-registry-mark" aria-hidden="true">N</span><span className="context-divider" aria-hidden="true">/</span><span className="context-project-name">Academic Registry</span><span className="context-project-short">Registry</span></span>
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
                {view === 'dashboard' ? <DashboardPage key={`d-${refreshKey}`} onOpenApplication={setSelectedApplication} onViewAll={navigateApplications} /> : null}
                {view === 'applications' ? <ApplicationsPage key={`a-${refreshKey}`} programmes={programmes} initialStatus={applicationStatus} focusSearchRequest={searchRequest} onOpenApplication={setSelectedApplication} onNewApplicant={() => setIntakeOpen(true)} /> : null}
                {view === 'operations' ? <OperationsPage onUpdated={handleUpdated} /> : null}
                {view === 'reports' ? <ReportsPage /> : null}
                {view === 'model' ? <DataModelPage /> : null}
              </Suspense>
            </motion.div>
          </AnimatePresence>
          <footer className="project-notice">
            <span>Northstar <span aria-hidden="true">·</span> Student admissions system</span>
            <span className="project-author">Demonstration workspace</span>
            <span>Fictional records for demonstration. Not an official service.</span>
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
        {intakeOpen ? <IntakeDialog programmes={programmes} onClose={() => setIntakeOpen(false)} onCreated={handleCreated} /> : null}
      </AnimatePresence>
      <AnimatePresence><Toast toast={toast} onClose={() => setToast(null)} /></AnimatePresence>
    </div>
    </MotionConfig>
  );
}
