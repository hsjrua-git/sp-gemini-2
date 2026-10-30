import { useEffect, useRef, useState } from 'react';
import { getRememberedCustomCursor } from '../lib/theme.js';

function useCursorEnabled() {
  const evaluate = () =>
    typeof window !== 'undefined' &&
    getRememberedCustomCursor() &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: fine)').matches &&
    window.matchMedia('(hover: hover)').matches &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const [enabled, setEnabled] = useState(evaluate);

  useEffect(() => {
    const queries = [
      window.matchMedia('(pointer: fine)'),
      window.matchMedia('(hover: hover)'),
      window.matchMedia('(prefers-reduced-motion: reduce)'),
    ];
    const update = () => setEnabled(evaluate());
    queries.forEach((q) => q.addEventListener('change', update));
    window.addEventListener('custom-cursor-change', update);
    return () => {
      queries.forEach((q) => q.removeEventListener('change', update));
      window.removeEventListener('custom-cursor-change', update);
    };
  }, []);

  return enabled;
}

const CLICK_SELECTOR =
  'a[href], button, summary, label, select, [role="button"], .btn, ' +
  'input[type="button"], input[type="submit"], input[type="reset"], ' +
  'input[type="checkbox"], input[type="radio"], [data-cursor="interactive"]';
const TEXT_SELECTOR =
  'input:not([type="button"]):not([type="submit"]):not([type="reset"])' +
  ':not([type="checkbox"]):not([type="radio"]):not([type="range"])' +
  ':not([type="color"]):not([type="file"]):not([type="image"]):not([type="hidden"]), ' +
  'textarea, [contenteditable="true"], [contenteditable=""]';

// Continuous rippling waves around the center dot: staggered negative delays
// create an ever-going concentric wave radiating outward at rest, while each
// ring also trails slightly behind pointer motion.
const WAVES = [
  { size: 36, ease: 0.28, opacity: 0.55, delay: '0s' },
  { size: 42, ease: 0.21, opacity: 0.42, delay: '-0.6s' },
  { size: 48, ease: 0.15, opacity: 0.3, delay: '-1.2s' },
  { size: 54, ease: 0.1, opacity: 0.2, delay: '-1.8s' },
];

function Cursor() {
  const layerRef = useRef(null);
  const dotRef = useRef(null);

  useEffect(() => {
    const layer = layerRef.current;
    const dot = dotRef.current;
    if (!layer || !dot) return undefined;

    const root = document.documentElement;
    root.classList.add('cursor-active');

    let targetX = 0;
    let targetY = 0;
    let placed = false;
    let visible = false;
    let rafId = 0;

    const waves = Array.from(layer.querySelectorAll('.cursor-wave'));
    const wavePos = WAVES.map(() => ({ x: 0, y: 0 }));

    const drawRing = () => {
      rafId = 0;
      let moving = false;

      for (let i = 0; i < WAVES.length; i += 1) {
        const p = wavePos[i];
        const dx = targetX - p.x;
        const dy = targetY - p.y;
        if (Math.abs(dx) < 0.4 && Math.abs(dy) < 0.4) {
          p.x = targetX;
          p.y = targetY;
        } else {
          p.x += dx * WAVES[i].ease;
          p.y += dy * WAVES[i].ease;
          moving = true;
        }
        waves[i].style.transform = `translate3d(${p.x}px, ${p.y}px, 0)`;
      }

      if (moving) rafId = requestAnimationFrame(drawRing);
    };

    const onMove = (e) => {
      targetX = e.clientX;
      targetY = e.clientY;
      dot.style.transform = `translate3d(${targetX}px, ${targetY}px, 0)`;
      if (!placed) {
        for (let i = 0; i < WAVES.length; i += 1) {
          wavePos[i].x = targetX;
          wavePos[i].y = targetY;
          waves[i].style.transform = `translate3d(${targetX}px, ${targetY}px, 0)`;
        }
        placed = true;
      }
      if (!visible) {
        layer.classList.add('is-visible');
        visible = true;
      }
      if (!rafId) rafId = requestAnimationFrame(drawRing);
    };

    const onOver = (e) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      const overText = Boolean(t.closest(TEXT_SELECTOR));
      layer.classList.toggle('is-text', overText);
      layer.classList.toggle(
        'is-interactive',
        !overText && Boolean(t.closest(CLICK_SELECTOR)),
      );
    };

    const onDown = () => layer.classList.add('is-pressed');
    const onUp = () => layer.classList.remove('is-pressed');

    const hide = () => {
      layer.classList.remove('is-visible');
      visible = false;
    };
    const onOut = (e) => {
      if (!e.relatedTarget) hide();
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerover', onOver, { passive: true });
    window.addEventListener('pointerdown', onDown, { passive: true });
    window.addEventListener('pointerup', onUp, { passive: true });
    window.addEventListener('pointerout', onOut, { passive: true });
    window.addEventListener('blur', hide);

    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerover', onOver);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointerout', onOut);
      window.removeEventListener('blur', hide);
      if (rafId) cancelAnimationFrame(rafId);
      root.classList.remove('cursor-active');
    };
  }, []);

  return (
    <div className="cursor-layer" ref={layerRef} aria-hidden="true">
      {WAVES.map((w) => (
        <div
          className="cursor-wave"
          key={w.delay}
          style={{
            '--r-size': `${w.size}px`,
            '--r-o': w.opacity,
            '--r-delay': w.delay,
          }}
        >
          <i />
        </div>
      ))}
      <div className="cursor-dot" ref={dotRef}>
        <i />
      </div>
    </div>
  );
}

export default function CustomCursor() {
  const enabled = useCursorEnabled();
  return enabled ? <Cursor /> : null;
}
