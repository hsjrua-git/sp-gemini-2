import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Navigate, Route, Routes, matchPath, useLocation } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import Layout from './components/Layout.jsx';
import RequireAuth from './components/RequireAuth.jsx';
import RequirePermission from './components/RequirePermission.jsx';
import ConnectionBanner from './components/ConnectionBanner.jsx';
import { useAuth } from './auth/AuthContext.jsx';
import { firstAllowedPath } from './lib/navigation.js';
import { lazyWithReload } from './lib/lazyWithReload.js';
import {
  MOTION,
  sectionRole,
  zoneOf,
  resolveDirection,
  exitKeyframes,
  enterKeyframes,
  microKind,
  microKeyframes,
  exitDelay,
  enterDelay,
} from './lib/pageTransition.js';

// LoginPage stays eagerly imported: it is the first thing a signed-out visitor
// sees, so we don't want to make them wait for a second network round-trip
// before they can even log in. Every page behind auth is code-split with
// lazyWithReload() so its JavaScript is only downloaded when the user first
// navigates there — this keeps the initial download small, and a stale-chunk
// fetch after a redeploy self-heals with one reload instead of blanking the
// app. The <Suspense> boundary that covers these lives in Layout, around
// the <Outlet />.
import LoginPage from './pages/LoginPage.jsx';

const DashboardPage = lazyWithReload(() => import('./pages/DashboardPage.jsx'));
const StudentsPage = lazyWithReload(() => import('./pages/StudentsPage.jsx'));
const StudentDetailPage = lazyWithReload(() => import('./pages/StudentDetailPage.jsx'));
const EvaluatePage = lazyWithReload(() => import('./pages/EvaluatePage.jsx'));
const ParametersPage = lazyWithReload(() => import('./pages/ParametersPage.jsx'));
const ResultsPage = lazyWithReload(() => import('./pages/ResultsPage.jsx'));
const ExportPage = lazyWithReload(() => import('./pages/ExportPage.jsx'));
const ImportStudentsPage = lazyWithReload(() => import('./pages/ImportStudentsPage.jsx'));
const ImportScoresPage = lazyWithReload(() => import('./pages/ImportScoresPage.jsx'));
const UsersPage = lazyWithReload(() => import('./pages/UsersPage.jsx'));
const RolesPage = lazyWithReload(() => import('./pages/RolesPage.jsx'));
const GroupsPage = lazyWithReload(() => import('./pages/GroupsPage.jsx'));
const FieldsPage = lazyWithReload(() => import('./pages/FieldsPage.jsx'));
const TeachersPage = lazyWithReload(() => import('./pages/TeachersPage.jsx'));
const SchedulePage = lazyWithReload(() => import('./pages/SchedulePage.jsx'));
const SessionsPage = lazyWithReload(() => import('./pages/SessionsPage.jsx'));
const TaskTemplatesPage = lazyWithReload(() => import('./pages/TaskTemplatesPage.jsx'));
const CafeProductsPage = lazyWithReload(() => import('./pages/CafeProductsPage.jsx'));
const CafeSalesPage = lazyWithReload(() => import('./pages/CafeSalesPage.jsx'));
const CafePurchasesPage = lazyWithReload(() => import('./pages/CafePurchasesPage.jsx'));
const CafeInventoryPage = lazyWithReload(() => import('./pages/CafeInventoryPage.jsx'));
const CafeReportsPage = lazyWithReload(() => import('./pages/CafeReportsPage.jsx'));
const AccountingJournalPage = lazyWithReload(() => import('./pages/AccountingJournalPage.jsx'));
const AccountingAccountsPage = lazyWithReload(() => import('./pages/AccountingAccountsPage.jsx'));
const AccountingPeriodsPage = lazyWithReload(() => import('./pages/AccountingPeriodsPage.jsx'));
const AccountingReportsPage = lazyWithReload(() => import('./pages/AccountingReportsPage.jsx'));
const AgentPage = lazyWithReload(() => import('./pages/AgentPage.jsx'));
const AgentTranscriptsPage = lazyWithReload(() => import('./pages/AgentTranscriptsPage.jsx'));
const PreferencesPage = lazyWithReload(() => import('./pages/PreferencesPage.jsx'));
const ChangePasswordPage = lazyWithReload(() => import('./pages/ChangePasswordPage.jsx'));
const AuditPage = lazyWithReload(() => import('./pages/AuditPage.jsx'));
const NotFoundPage = lazyWithReload(() => import('./pages/NotFoundPage.jsx'));

// Path pattern → the lazy page that renders it, most specific first. Used to
// preload a route's code chunk *before* navigating (see AnimatedRoutes), so the
// view transition snapshots the real page instead of the Suspense loader.
// Order matters: matchPath tests each in turn and '/students/:id' would
// otherwise swallow '/students/import'.
const ROUTE_PRELOADS = [
  ['/dashboard', DashboardPage],
  ['/students/import', ImportStudentsPage],
  ['/students/:id', StudentDetailPage],
  ['/students', StudentsPage],
  ['/evaluate/import', ImportScoresPage],
  ['/evaluate', EvaluatePage],
  ['/parameters', ParametersPage],
  ['/results', ResultsPage],
  ['/export', ExportPage],
  ['/users', UsersPage],
  ['/roles', RolesPage],
  ['/groups', GroupsPage],
  ['/fields', FieldsPage],
  ['/teachers', TeachersPage],
  ['/schedule', SchedulePage],
  ['/sessions', SessionsPage],
  ['/task-templates', TaskTemplatesPage],
  ['/cafe', CafeSalesPage],
  ['/cafe/products', CafeProductsPage],
  ['/cafe/purchases', CafePurchasesPage],
  ['/cafe/inventory', CafeInventoryPage],
  ['/cafe/reports', CafeReportsPage],
  ['/accounting/journal', AccountingJournalPage],
  ['/accounting/accounts', AccountingAccountsPage],
  ['/accounting/periods', AccountingPeriodsPage],
  ['/accounting/reports', AccountingReportsPage],
  ['/agent', AgentPage],
  ['/agent/transcripts', AgentTranscriptsPage],
  ['/preferences', PreferencesPage],
  ['/change-password', ChangePasswordPage],
  ['/audit', AuditPage],
];

// Kick off (and share) the code-chunk download for whichever page owns this
// path. Returns the import promise, or undefined for paths with no lazy page
// (e.g. '/', or an unknown path that will fall through to NotFound).
function preloadRoute(pathname) {
  for (const [pattern, Component] of ROUTE_PRELOADS) {
    if (matchPath(pattern, pathname)) return Component.preload?.();
  }
  return undefined;
}

// --- live-DOM route choreography --------------------------------------------
// The route transition (see AnimatedRoutes) animates the real DOM with the Web
// Animations API rather than snapshotting the page: the outgoing sections clear
// out, the page swaps, and the incoming sections rebuild — each moving on its
// own terms by position and type. The pure geometry→motion mapping lives in
// lib/pageTransition.js; the helpers here do the DOM reads and drive the
// animations.

// A page renders a single root element (its <main>) inside #main-content whose
// children are the sections we animate; step into that wrapper, falling back to
// the host's own children when a page isn't wrapped (or we catch it mid-load).
function pageRoot(host) {
  if (!host) return null;
  const mainEl = host.querySelector(':scope > main');
  if (mainEl) return mainEl;
  if (host.children.length === 1 && host.children[0].children.length > 0) {
    return host.children[0];
  }
  return host;
}

function sectionsOf(host) {
  const root = pageRoot(host);
  if (!root || root.classList?.contains('page-loading')) return [];
  return Array.from(root.children).filter(
    (el) => el.nodeType === 1 && !el.classList?.contains('page-loading'),
  );
}

function descriptorOf(el) {
  return {
    tagName: el.tagName,
    className: typeof el.className === 'string' ? el.className : '',
  };
}

function cancelAll(anims) {
  anims.forEach((a) => {
    try {
      a.cancel();
    } catch {
      /* already gone */
    }
  });
}

// Give an entering section's own buttons and fields a small, bounded, staggered
// entrance layered just after the section itself. Capped per section so a large
// form/table stays cheap.
function playMicro(section, baseDelay, sink) {
  const accents = section.querySelectorAll(
    'button, .btn, [role="button"], input, select, textarea, .field',
  );
  const limit = Math.min(accents.length, MOTION.micro.max);
  for (let i = 0; i < limit; i++) {
    const el = accents[i];
    const kind = microKind({
      tagName: el.tagName,
      className: typeof el.className === 'string' ? el.className : '',
      role: el.getAttribute?.('role') || '',
    });
    if (!kind) continue;
    const anim = el.animate(microKeyframes(kind), {
      duration: MOTION.micro.duration,
      easing: MOTION.micro.easing,
      delay: baseDelay + MOTION.micro.lead + i * MOTION.micro.stagger,
      fill: 'both',
    });
    anim.finished.then(() => {
      try {
        anim.cancel();
      } catch {
        /* already gone */
      }
    }, () => {});
    sink.push(anim);
  }
}

function playExit(host) {
  const container = host.getBoundingClientRect();
  const anims = [];
  sectionsOf(host).forEach((el, i) => {
    const zone = zoneOf(el.getBoundingClientRect(), container);
    const direction = resolveDirection(sectionRole(descriptorOf(el)), zone);
    anims.push(
      el.animate(exitKeyframes(direction), {
        duration: MOTION.exit.duration,
        easing: MOTION.exit.easing,
        delay: exitDelay(i),
        fill: 'forwards',
      }),
    );
  });
  return anims;
}

function cancelReveals(el) {
  if (!el || typeof el.getAnimations !== 'function') return;
  let running;
  try {
    running = el.getAnimations({ subtree: true });
  } catch {
    return;
  }
  running.forEach((anim) => {
    if (anim.animationName === 'card-rise') {
      try {
        anim.cancel();
      } catch {
        /* already gone */
      }
    }
  });
}

function animateSectionIn(el, containerRect, order, sink) {
  const zone = zoneOf(el.getBoundingClientRect(), containerRect);
  const direction = resolveDirection(sectionRole(descriptorOf(el)), zone);
  cancelReveals(el);
  const base = enterDelay(order);
  el.style.willChange = 'transform, opacity';
  const anim = el.animate(enterKeyframes(direction), {
    duration: MOTION.enter.duration,
    easing: MOTION.enter.easing,
    delay: base,
    fill: 'both',
  });
  anim.finished.then(() => {
    try {
      el.style.willChange = '';
      anim.cancel();
    } catch {
      /* already gone */
    }
  }, () => {});
  sink.push(anim);
  playMicro(el, base, sink);
}

// Rebuild the incoming page: observe `host` across subtree mutations so even when
// <PageLoader /> unmounts and <main> mounts on a first visit, or when async data
// sections mount inside <main>, every top-level section receives its entrance
// animation cleanly without lag.
function playEnter(host) {
  const anims = [];
  const animated = new WeakSet();

  const scanAndAnimate = () => {
    const currentSections = sectionsOf(host);
    const fresh = currentSections.filter((el) => !animated.has(el));
    if (fresh.length === 0) return false;
    const containerRect = host.getBoundingClientRect();
    fresh.forEach((el, i) => {
      animated.add(el);
      animateSectionIn(el, containerRect, i, anims);
    });
    return true;
  };

  scanAndAnimate();

  let stopped = false;
  let quietTimer = null;
  const startedAt = Date.now();
  const stop = () => {
    if (stopped) return;
    stopped = true;
    observer?.disconnect();
    if (quietTimer) window.clearTimeout(quietTimer);
  };
  const bump = () => {
    if (quietTimer) window.clearTimeout(quietTimer);
    const remaining = MOTION.lateCap - (Date.now() - startedAt);
    quietTimer = window.setTimeout(stop, Math.max(0, Math.min(MOTION.lateWindow, remaining)));
  };

  const observer =
    host && typeof MutationObserver === 'function'
      ? new MutationObserver(() => {
          if (stopped) return;
          if (scanAndAnimate()) {
            bump();
          }
        })
      : null;
  if (observer) {
    observer.observe(host, { childList: true, subtree: true });
    bump();
  }

  return () => {
    stop();
    cancelAll(anims);
  };
}

function settleThenEnter(host, isFetching, superseded) {
  let cancelled = false;
  let enterCleanup = null;
  let rafId = 0;
  let capTimer = 0;
  let sawFetch = false;
  const startedAt = Date.now();
  let lastActivityAt = startedAt;

  host.style.visibility = 'hidden';

  const observer =
    typeof MutationObserver === 'function'
      ? new MutationObserver(() => {
          lastActivityAt = Date.now();
        })
      : null;
  observer?.observe(host, { childList: true, subtree: true });

  const teardown = () => {
    observer?.disconnect();
    if (rafId) window.cancelAnimationFrame(rafId);
    if (capTimer) window.clearTimeout(capTimer);
    document.removeEventListener('visibilitychange', onHide);
  };

  const reveal = (animate) => {
    teardown();
    host.style.visibility = '';
    if (cancelled || superseded()) return;
    if (animate) enterCleanup = playEnter(host);
  };

  function onHide() {
    if (document.hidden) reveal(false);
  }
  document.addEventListener('visibilitychange', onHide);

  capTimer = window.setTimeout(() => reveal(!document.hidden), MOTION.settleCap);

  const tick = () => {
    rafId = 0;
    if (cancelled || superseded()) {
      teardown();
      host.style.visibility = '';
      return;
    }
    if (document.hidden) {
      reveal(false);
      return;
    }
    const now = Date.now();
    let fetching;
    try {
      fetching = isFetching();
    } catch {
      fetching = 0;
    }
    const hasLoader = host.querySelector('.page-loading') !== null;
    if (fetching > 0 || hasLoader) {
      sawFetch = true;
      lastActivityAt = now;
    }
    const dataReady =
      !hasLoader &&
      fetching === 0 &&
      (sawFetch || now - startedAt >= MOTION.settleGrace);
    const quiet = now - lastActivityAt >= MOTION.settleQuiet;
    if (dataReady && quiet) {
      reveal(true);
      return;
    }
    rafId = window.requestAnimationFrame(tick);
  };
  rafId = window.requestAnimationFrame(tick);

  return () => {
    cancelled = true;
    teardown();
    host.style.visibility = '';
    enterCleanup?.();
  };
}

function LandingRedirect() {
  const { can } = useAuth();
  return <Navigate to={firstAllowedPath(can)} replace />;
}

function App() {
  // Warm all route code chunks during browser idle time so first-time visits
  // to any page never stall waiting on a network bundle download.
  useEffect(() => {
    let cancelled = false;
    const warm = () => {
      ROUTE_PRELOADS.forEach(([, Component], idx) => {
        window.setTimeout(() => {
          if (!cancelled) Component.preload?.()?.catch?.(() => {});
        }, idx * 45);
      });
    };
    const timer = window.setTimeout(warm, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  return (
    <>
      <ConnectionBanner />
      <AnimatedRoutes />
    </>
  );
}

function AnimatedRoutes() {
  const location = useLocation();
  const [displayed, setDisplayed] = useState(location);
  const queryClient = useQueryClient();
  const cleanupRef = useRef(null);
  const runIdRef = useRef(0);
  const startedKeyRef = useRef(null);
  const initialPlayedRef = useRef(false);

  const changed = location.key !== displayed.key;
  const canAnimate =
    typeof document !== 'undefined' &&
    typeof Element !== 'undefined' &&
    typeof Element.prototype.animate === 'function' &&
    document.getElementById('main-content') !== null;
  const prefersReduced =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isLoginTransition =
    location.pathname === '/login' || displayed.pathname === '/login';
  const animate = changed && canAnimate && !prefersReduced && !isLoginTransition;

  if (changed && !animate) {
    setDisplayed(location);
  }

  // Ensure initial page mount also plays the smooth entrance choreography once
  // #main-content mounts.
  useEffect(() => {
    if (initialPlayedRef.current || prefersReduced || location.pathname === '/login') {
      return undefined;
    }
    const host = document.getElementById('main-content');
    if (!host || typeof Element === 'undefined' || typeof Element.prototype.animate !== 'function') {
      return undefined;
    }
    initialPlayedRef.current = true;
    const pending = preloadRoute(location.pathname);
    if (pending && typeof pending.then === 'function') {
      pending.catch(() => {});
    }
    cleanupRef.current = playEnter(host);
    return undefined;
  }, [location.pathname, prefersReduced]);

  useEffect(() => {
    if (!animate) return undefined;
    if (startedKeyRef.current === location.key) return undefined;
    startedKeyRef.current = location.key;

    cleanupRef.current?.();
    cleanupRef.current = null;
    const runId = ++runIdRef.current;
    const superseded = () => runId !== runIdRef.current;

    const host = document.getElementById('main-content');
    if (!host) {
      const raf = window.requestAnimationFrame(() => {
        if (!superseded()) setDisplayed(location);
      });
      return () => window.cancelAnimationFrame(raf);
    }

    const exitAnims = playExit(host);
    const exitDone =
      exitAnims.length > 0
        ? Promise.allSettled(exitAnims.map((a) => a.finished))
        : Promise.resolve();

    const pending = preloadRoute(location.pathname);
    const chunkReady =
      pending && typeof pending.then === 'function'
        ? pending.catch(() => {})
        : Promise.resolve();

    let done = false;
    const swap = () => {
      if (done || superseded()) return;
      done = true;
      cancelAll(exitAnims);
      flushSync(() => setDisplayed(location));
      if (superseded()) return;
      const incomingHost = document.getElementById('main-content') ?? host;
      cleanupRef.current = settleThenEnter(
        incomingHost,
        () => queryClient.isFetching(),
        superseded
      );
    };

    Promise.all([exitDone, chunkReady]).then(swap);
    const timer = window.setTimeout(swap, MOTION.swapCap);

    return () => {
      window.clearTimeout(timer);
      if (!done) cancelAll(exitAnims);
    };
  }, [animate, location, queryClient]);

  useEffect(() => () => cleanupRef.current?.(), []);

  return (
    <Routes location={displayed}>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<Layout />}>
          <Route element={<RequirePermission />}>
            <Route path="/" element={<LandingRedirect />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/students" element={<StudentsPage />} />
            <Route path="/students/:id" element={<StudentDetailPage />} />
            <Route path="/evaluate" element={<EvaluatePage />} />
            <Route path="/parameters" element={<ParametersPage />} />
            <Route path="/results" element={<ResultsPage />} />
            <Route path="/export" element={<ExportPage />} />
            <Route path="/students/import" element={<ImportStudentsPage />} />
            <Route path="/evaluate/import" element={<ImportScoresPage />} />
            <Route path="/users" element={<UsersPage />} />
            <Route path="/roles" element={<RolesPage />} />
            <Route path="/groups" element={<GroupsPage />} />
            <Route path="/fields" element={<FieldsPage />} />
            <Route path="/teachers" element={<TeachersPage />} />
            <Route path="/schedule" element={<SchedulePage />} />
            <Route path="/sessions" element={<SessionsPage />} />
            <Route path="/task-templates" element={<TaskTemplatesPage />} />
            <Route path="/cafe" element={<CafeSalesPage />} />
            <Route path="/cafe/products" element={<CafeProductsPage />} />
            <Route path="/cafe/purchases" element={<CafePurchasesPage />} />
            <Route path="/cafe/inventory" element={<CafeInventoryPage />} />
            <Route path="/cafe/reports" element={<CafeReportsPage />} />
            <Route path="/accounting/journal" element={<AccountingJournalPage />} />
            <Route path="/accounting/accounts" element={<AccountingAccountsPage />} />
            <Route path="/accounting/periods" element={<AccountingPeriodsPage />} />
            <Route path="/accounting/reports" element={<AccountingReportsPage />} />
            <Route path="/agent" element={<AgentPage />} />
            <Route path="/agent/transcripts" element={<AgentTranscriptsPage />} />
            <Route path="/preferences" element={<PreferencesPage />} />
            <Route path="/change-password" element={<ChangePasswordPage />} />
            <Route path="/audit" element={<AuditPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Route>
      </Route>
    </Routes>
  );
}

export default App;
