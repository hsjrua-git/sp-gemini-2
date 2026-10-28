import { Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import CompletionHub from './CompletionHub.jsx';
import { useReducedMotion } from '../lib/useReducedMotion.js';
import { hasWebGL } from '../lib/webgl.js';
import { lazyWithReload } from '../lib/lazyWithReload.js';

// The lone importer of three.js — kept behind a lazy boundary so the WebGL
// bundle (~150 KB gzip, its own "three" chunk) downloads only on the dashboard,
// and only for pointer users who haven't asked to reduce motion.
const CohortConstellation = lazyWithReload(() =>
  import('./CohortConstellation.jsx')
);

// Capability gate for the cohort hero. Reduced-motion, no WebGL, or the moment
// before the chunk lands → the verified 2D CompletionHub. jsdom has no WebGL, so
// the test suite always takes the fallback branch and keeps exercising the 2D
// hero unchanged. Both branches receive the same props (summary, field, stats,
// onSelect); the WebGL path carries its own visually-hidden control layer for
// screen-reader and keyboard users (CohortConstellation), so no separate summary
// element is needed here.
export default function CohortHero(props) {
  const reduced = useReducedMotion();
  const { t } = useTranslation(['reports', 'common']);
  const mode = props.mode ?? 'auto';
  const finePointer =
    typeof window === 'undefined' || !window.matchMedia
      ? true
      : window.matchMedia('(pointer: fine)').matches;
  const use3d =
    hasWebGL() &&
    mode !== '2d' &&
    (mode === '3d' || (finePointer && !reduced));

  if (!use3d) {
    return <CompletionHub {...props} />;
  }

  return (
    <Suspense fallback={<CompletionHub {...props} />}>
      <section className="cohort-hero" aria-label={t('cohort.heroLabel')}>
        <CohortConstellation {...props} autoRotate={Boolean(props.autoRotate) && !reduced} />
      </section>
    </Suspense>
  );
}
