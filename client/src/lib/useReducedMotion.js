import { useEffect, useState } from 'react';

// Watches the reduced-motion preference live, so a mid-session change is
// respected. Extracted from CountUp so the 3D hero shares one source of truth:
// under prefers-reduced-motion the constellation drops its WebGL canvas for the
// static 2D hero, exactly as the count-up shows its final value at once.
//
// The initial read and the effect both guard `matchMedia` — jsdom (the test
// runner) doesn't implement it, and treating "no matchMedia" as "no reduction"
// keeps components mountable there without a polyfill.
export function useReducedMotion() {
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  );
  useEffect(() => {
    const query = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!query) return undefined;
    const update = () => setReduced(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return reduced;
}
