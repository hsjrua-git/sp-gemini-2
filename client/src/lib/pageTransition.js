// Pure choreography for the route-to-route transition.
//
// The page change is driven on the LIVE DOM (see App.jsx / AnimatedRoutes) with
// the Web Animations API rather than the View Transitions API: a short clear-out
// of the outgoing page, then a longer, staggered rebuild of the incoming one.
// Each top-level section animates on its OWN terms, chosen from two signals:
//   - its POSITION in the content area — a section on the right slides and fades
//     to the right, one at the top lifts to the top, one in the centre collapses
//     in place, and so on;
//   - its TYPE — a heading lifts, a toolbar/control strip slides aside, cards and
//     panels follow their position; and inside an entering section its own
//     buttons and fields get a small staggered entrance of their own.
//
// Everything here is pure (geometry in, keyframes/timing out) so it can be unit
// tested without a browser; App.jsx does the DOM reads and hands the results to
// element.animate(). All durations are in milliseconds.

export const MOTION = {
  // The outgoing page clears quickly so navigation feels immediate.
  exit: {
    duration: 180,
    stagger: 20,
    maxStep: 5,
    easing: 'cubic-bezier(0.4, 0, 0.7, 0.25)',
  },
  // The incoming page rebuilds smoothly and snappily, section by section.
  enter: {
    duration: 320,
    stagger: 45,
    maxStep: 6,
    easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
  },
  // Buttons and fields inside an entering section, after the section itself.
  micro: {
    duration: 220,
    lead: 60,
    stagger: 22,
    max: 8,
    easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
  },
  swapCap: 450, // longest we'll wait for the target chunk before swapping anyway
  settleGrace: 40, // if no fetch has started within this, treat the page as static
  settleQuiet: 35, // required DOM-quiet beat after the last fetch drains
  settleCap: 360, // never hold the entrance longer than this
  lateWindow: 650, // quiet period (ms) after the last late section before we stop
  lateCap: 1800, // absolute ceiling (ms) on how long we keep watching
};

// How far sliding/rising sections travel. Kept modest so a slow clock reads as a
// glide rather than a dart.
const DIST = { x: 96, up: 40, down: 46 };

// Classify one top-level section from its tag + class names. Order matters:
// headings and control bars are recognised before the catch-all panel. Accepts a
// plain { tagName, className } descriptor so it's testable without a real node.
export function sectionRole({ tagName = '', className = '' } = {}) {
  const tag = String(tagName).toUpperCase();
  const cls = typeof className === 'string' ? className : String(className ?? '');
  if (
    tag === 'H1' ||
    tag === 'H2' ||
    /\b(page-head|page-header|page-heading|hint|summary-line)\b/.test(cls)
  )
    return 'head';
  if (/\b(toolbar|views-bar|filters?|controls|actions|tabs)\b/.test(cls)) return 'bar';
  if (/\b(section-card|stat-grid|param-grid|bento)\b/.test(cls) || tag === 'SECTION')
    return 'card';
  return 'panel';
}

// Where a section sits in the content area, from its centre relative to the
// container box. Full-width sections (most of the app) centre horizontally and so
// are placed by their vertical band; genuinely side-set elements go left/right.
export function zoneOf(rect, container) {
  const cw = container.width || 1;
  const ch = container.height || 1;
  const fx = ((rect.left + rect.right) / 2 - container.left) / cw;
  const fy = ((rect.top + rect.bottom) / 2 - container.top) / ch;
  if (fx > 0.66) return 'right';
  if (fx < 0.34) return 'left';
  if (fy < 0.4) return 'top';
  if (fy > 0.66) return 'bottom';
  return 'center';
}

// Resolve a section's motion from its type and position. Headings always lift to
// the top; control bars always slide aside; cards and panels follow their zone
// (right→right, left→left, top→up, bottom→down, centre→collapse in place).
export function resolveDirection(role, zone) {
  if (role === 'head') return 'up';
  if (role === 'bar') return zone === 'left' ? 'left' : 'right';
  switch (zone) {
    case 'right':
      return 'right';
    case 'left':
      return 'left';
    case 'top':
      return 'up';
    case 'bottom':
      return 'down';
    default:
      return 'collapse';
  }
}

// The "gone" transform for a direction — where a section rests when hidden. Exit
// animates from resting to this; enter animates from this back to resting, so a
// section leaves and returns along the same line.
//
// Deliberately transform + opacity only, NO `filter: blur()`. A `filter` on a
// section container turns it into a "backdrop root", which stops any frosted
// descendant (`.stat-card`, `.param-card`, `.panel` — all `backdrop-filter`)
// from sampling the page behind it, so the frost visibly drops out for the whole
// animation. Confirmed in-browser: transform/opacity leave the frost intact; a
// blur on the container kills it. Do not add a filter here.
function goneTransform(direction) {
  switch (direction) {
    case 'right':
      return `translateX(${DIST.x}px)`;
    case 'left':
      return `translateX(${-DIST.x}px)`;
    case 'up':
      return `translateY(${-DIST.up}px)`;
    case 'down':
      return `translateY(${DIST.down}px)`;
    case 'collapse':
    default:
      return 'scale(0.9) translateY(10px)';
  }
}

export function exitKeyframes(direction) {
  return [
    { opacity: 1, transform: 'none', offset: 0 },
    { opacity: 0, transform: goneTransform(direction), offset: 1 },
  ];
}

export function enterKeyframes(direction) {
  return [
    { opacity: 0, transform: goneTransform(direction), offset: 0 },
    { opacity: 1, transform: 'none', offset: 1 },
  ];
}

// Inner accents that get their own micro-entrance: buttons pop, fields rise.
// Anything else returns null (left to its section's block motion).
export function microKind({ tagName = '', className = '', role = '' } = {}) {
  const tag = String(tagName).toUpperCase();
  const cls = typeof className === 'string' ? className : '';
  if (tag === 'BUTTON' || role === 'button' || /\bbtn\b/.test(cls)) return 'button';
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || /\bfield\b/.test(cls))
    return 'field';
  return null;
}

export function microKeyframes(kind) {
  if (kind === 'button')
    return [
      { opacity: 0, transform: 'scale(0.9)', offset: 0 },
      { opacity: 1, transform: 'none', offset: 1 },
    ];
  return [
    { opacity: 0, transform: 'translateY(8px)', offset: 0 },
    { opacity: 1, transform: 'none', offset: 1 },
  ];
}

// --- timing (pure) ---------------------------------------------------------
export function exitDelay(order) {
  return Math.min(order, MOTION.exit.maxStep) * MOTION.exit.stagger;
}

export function enterDelay(order) {
  return Math.min(order, MOTION.enter.maxStep) * MOTION.enter.stagger;
}

// How long to let the whole clear-out run before swapping, even if a promise is
// slow to settle: the last section's start plus its duration plus a little slack.
export function exitBudget(count) {
  return MOTION.exit.duration + exitDelay(Math.max(0, count - 1)) + 80;
}
