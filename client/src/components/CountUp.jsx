import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from '../lib/useReducedMotion.js';

// The "information reveal" beat from the data-viz reference: a headline number
// counts up from 0 on first paint (and animates between values when the period
// changes), on a calm, slow easeOutCubic to match the app-wide slow motion.
// Purely presentational — it renders an integer plus an optional suffix (e.g.
// "%"). Under prefers-reduced-motion it shows the final value immediately, with
// no animation.
function CountUp({ value, suffix = '', duration = 1400 }) {
  const reduced = useReducedMotion();
  // `display` drives the animation only; under reduced motion we render `value`
  // directly (below) and leave this untouched, so there's no synchronous
  // setState in the effect.
  const [display, setDisplay] = useState(0);
  const fromRef = useRef(0);

  useEffect(() => {
    if (reduced) return undefined;
    const from = fromRef.current;
    const to = value;
    if (from === to) return undefined;

    let frame = 0;
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - t) ** 3;
      setDisplay(Math.round(from + (to - from) * eased));
      if (t < 1) {
        frame = requestAnimationFrame(tick);
      } else {
        fromRef.current = to;
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, duration, reduced]);

  const shown = reduced ? value : display;
  return (
    <>
      {shown}
      {suffix}
    </>
  );
}

export default CountUp;
