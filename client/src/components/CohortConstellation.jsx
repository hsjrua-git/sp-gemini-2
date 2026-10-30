import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import * as THREE from 'three';
import {
  spherePoints,
  nodeAppearance,
  satelliteAppearance,
  orbitLayout,
} from '../lib/constellation.js';

const CORE_R = 0.20; // core sphere radius — a tiny nucleus the rings encircle
const CORE_OPACITY = 0.5; // soft, semi-translucent nucleus (still dims its far side)
const CAGE_R = 0.32; // wireframe cage, hugging the core just above its surface
// Parameter rings: flat, camera-facing circles drawn concentrically around the
// core (not 3D hoops). They fan out between the cage and the student-node shell,
// one ring per in-use parameter. Each ring is baked to a soft-edged canvas texture
// (blurred stroke, no hard rim) so the rings melt into the moving ripples: a faded
// full-circle *track* with a brighter *arc* swept over it from the top, the arc's
// length that parameter's coverage (share of the class measured this period). So
// progress reads as a different colour over an arc — never as the track's opacity.
// Radius is just position in the fan, not a magnitude. All rings share two fixed
// blues that stay blue whatever the palette --brand is.
const RING_WORLD_THICK = 0.035; // thin bands separated by a fixed 0.2 world-unit gap
const RING_HALF = RING_WORLD_THICK / 2; // half-thickness, for the analytic hover pick
const RING_FACE_FRAC = 0.38; // ring radius as a fraction of its square texture (blur margin)
const RING_TRACK_COLOR = '#4f93f7'; // faded full-circle track (fixed blue-ish)
const RING_ARC_COLOR = '#79c0ff'; // arc that sweeps the coverage amount (fixed blue)
const RING_TRACK_ALPHA = 0.22; // track alpha baked into the texture, relative to the arc
const RING_REST_OPACITY = 0.5; // whole-ring material opacity at rest (arc ≈ this)
const RING_HOVER_OPACITY = 0.82; // whole-ring material opacity while hovered
const RING_PICK_PAD = 0.045; // forgiving hover without overlapping adjacent bands

// Ripples: a few faint, camera-facing wavefronts that expand from the core out to
// the outermost ring and fade as they travel, so the rings sit inside a slow-moving
// pool of light. They live in the (billboarded) ring group, drawn under the rings,
// and keep moving even while a hover holds the spin. Very, very nearly transparent.
const RIPPLE_COUNT = 3; // overlapping wavefronts in flight at once
const RIPPLE_MIN_R = 0.12; // born just inside the core surface
const RIPPLE_PERIOD = 6; // seconds for one wavefront to travel out (slow)
const RIPPLE_FACE_FRAC = 0.36; // ripple radius as a fraction of its texture
const RIPPLE_OPACITY = 0.05; // peak opacity — almost transparent
const RIPPLE_COLOR = '#6fb4f7'; // same blue family as the rings

// A soft radial dot drawn once to a canvas, reused as the texture for the core
// glow halo and the filled student nodes. Drawn white so a SpriteMaterial can
// tint each instance to the live palette.
function makeDotTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2
  );
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// A hollow ring for "not measured" nodes — shape (not colour alone) marks them
// as empty, mirroring the 2D field's hollow dots.
function makeRingTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.strokeStyle = 'rgba(255,255,255,1)';
  ctx.lineWidth = 12;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 12, 0, Math.PI * 2);
  ctx.stroke();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// A parameter ring baked to a canvas: a faint full-circle *track* plus a brighter
// *arc* swept from 12 o'clock over `coverage` of the turn, both stroked with a blur
// so their edges are soft (no hard rim) and blend into the moving ripples. Colours
// are baked in (rings use fixed blues, not the palette); the plane's material
// opacity dials the whole ring up on hover. The stroke width scales inversely with
// the ring's world `radius` so every ring is ~the same thickness once its plane is
// scaled out to that radius.
function makeParamRingTexture(coverage, radius) {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const c = size / 2;
  const rr = size * RING_FACE_FRAC; // ring radius within the canvas
  const scale = radius / RING_FACE_FRAC; // world units the plane is scaled to
  const lw = Math.max(2, (RING_WORLD_THICK / scale) * size);
  ctx.lineCap = 'round';
  ctx.shadowBlur = lw * 0.7;
  // Faded full-circle track, baked at a low relative alpha.
  ctx.strokeStyle = RING_TRACK_COLOR;
  ctx.shadowColor = RING_TRACK_COLOR;
  ctx.globalAlpha = RING_TRACK_ALPHA;
  ctx.lineWidth = lw;
  ctx.beginPath();
  ctx.arc(c, c, rr, 0, Math.PI * 2);
  ctx.stroke();
  // Brighter coverage arc from the top (canvas y is down, so −90° is 12 o'clock).
  if (coverage > 0) {
    ctx.strokeStyle = RING_ARC_COLOR;
    ctx.shadowColor = RING_ARC_COLOR;
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(c, c, rr, -Math.PI / 2, -Math.PI / 2 + coverage * Math.PI * 2);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// A single soft-edged ring stroke on a transparent canvas, drawn white so a
// material can tint it. Reused (scaled + faded per frame) for every ripple.
function makeRippleTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.strokeStyle = 'rgba(255,255,255,1)';
  ctx.shadowColor = 'rgba(255,255,255,1)';
  ctx.shadowBlur = 10;
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size * RIPPLE_FACE_FRAC, 0, Math.PI * 2);
  ctx.stroke();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
// scene tracks the active palette + light/dark theme instead of hard-coding hex.
function readColor(el, name, fallback) {
  const raw = getComputedStyle(el).getPropertyValue(name).trim();
  try {
    return new THREE.Color(raw || fallback);
  } catch {
    return new THREE.Color(fallback);
  }
}

// Unique corners of a (non-indexed) polyhedron geometry, each listed once. These
// are the cage vertices student nodes get tethered to; dedup so a corner shared
// by several faces isn't counted (and pulled toward) many times.
function uniqueVertices(geometry) {
  const pos = geometry.attributes.position;
  const seen = new Set();
  const out = [];
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const key = `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(new THREE.Vector3(x, y, z));
    }
  }
  return out;
}

// The accessible label for a student's jump button — mirrors the 3D node's hover
// title, plus the affordance that activating it opens that student's drawer.
function nodeLabel(t, student) {
  const base =
    student.state === 'full'
      ? t('cohort.stateFull', { name: student.fullName })
      : student.state === 'partial'
        ? t('cohort.statePartial', {
            name: student.fullName,
            measured: student.measured,
            inUse: student.inUse,
          })
        : t('cohort.stateNone', { name: student.fullName });
  return `${base}${t('cohort.openDetails')}`;
}

// The screen-reader description of the hero as a whole — the headline completion
// and the roster split — read once before the jump lists. The WebGL canvas is
// aria-hidden, so this paragraph (and the buttons under it) carry the meaning the
// glowing object conveys visually.
function summaryText(t, summary) {
  if (!summary) return t('cohort.heroLabel');
  const {
    completion,
    students,
    studentsComplete,
    studentsPartial,
    studentsNone,
  } = summary;
  const head =
    completion === null
      ? t('cohort.nothingYet')
      : t('cohort.headRecorded', { completion });
  const who = t('cohort.who', {
    count: students,
    full: studentsComplete,
    partial: studentsPartial,
    none: studentsNone,
  });
  return `${t('cohort.heroLabel')}. ${head} ${who}`;
}

// The 3D cohort hero: a small spinning core sphere (glow ∝ completion) encircled
// by parameter rings — flat faded hoops, each with a brighter arc whose length is
// that parameter's coverage — and wrapped in a shell of student nodes that revolve
// rigidly with it. Each node is coloured by state — full = --ok, partial = --brand-2,
// none = a hollow --ink-faint ring — and a partial node's brightness scales with how
// close it is to fully measured. The core is a soft, semi-translucent nucleus that
// still dims whatever is on its far side, faint ripples pulse outward from it through
// the rings, and a gentle depth-fade dims the nodes swinging behind it. Hovering a
// node reveals its name and measured/total; hovering a ring reveals its coverage. Only
// ever mounted when motion is allowed AND WebGL is available (see CohortHero), so
// jsdom stays on the 2D path.
export default function CohortConstellation({
  summary,
  field = [],
  stats = [],
  onSelect,
  autoRotate = true,
}) {
  const { t } = useTranslation(['reports', 'common']);
  const hostRef = useRef(null);
  const sceneRef = useRef(null);
  const pctRef = useRef(summary?.completion ?? null);
  const autoRotateRef = useRef(autoRotate);
  // The mount effect below runs once; mirror the latest onSelect into a ref so its
  // pointer handlers can call the current callback without re-running (and tearing
  // the whole scene down) whenever the parent re-renders with a new function.
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);
  useEffect(() => {
    autoRotateRef.current = autoRotate;
  }, [autoRotate]);
  const completion = summary?.completion ?? null;

  // --- Scene scaffolding: built once, torn down on unmount. ---
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 0, 4.0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    host.appendChild(renderer.domElement);

    // The core sphere (MeshStandardMaterial) is the ONLY lit object — nodes,
    // rings, ripples, cage, glow are all unlit — so these lights tune the core's
    // brightness alone. Kept gentle so the nucleus stays soft, not a vivid ball.
    scene.add(new THREE.AmbientLight(0xffffff, 0.4));
    const key = new THREE.DirectionalLight(0xffffff, 0.85);
    key.position.set(2, 2.5, 3);
    scene.add(key);

    const assembly = new THREE.Group();
    assembly.rotation.x = 0.28; // a fixed tilt so the spin reads as 3D depth
    scene.add(assembly);

    const coreMat = new THREE.MeshStandardMaterial({
      roughness: 0.5,
      metalness: 0.1,
      transparent: true,
      opacity: CORE_OPACITY, // softer, semi-translucent — keeps depthWrite so it
      // still occludes its far side even though it's see-through.
    });
    const coreGeo = new THREE.SphereGeometry(CORE_R, 48, 48);
    const core = new THREE.Mesh(coreGeo, coreMat);
    assembly.add(core);

    // A thin geodesic wireframe cage just outside the core (the "thing" from
    // phase 1), plus the list of its corners. Cage and student nodes both live in
    // the assembly, so the tether lines drawn between them are fixed in
    // assembly-space and simply revolve with everything — no per-frame recompute.
    const cageGeo = new THREE.IcosahedronGeometry(CAGE_R, 1);
    const cageMat = new THREE.LineBasicMaterial({
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
    });
    const cage = new THREE.LineSegments(
      new THREE.WireframeGeometry(cageGeo),
      cageMat
    );
    assembly.add(cage);
    const cageVerts = uniqueVertices(cageGeo);
    const tetherMat = new THREE.LineBasicMaterial({
      transparent: true,
      opacity: 0.08,
      depthWrite: false,
    });

    const dotTex = makeDotTexture();
    const ringTex = makeRingTexture();

    const glowMat = new THREE.SpriteMaterial({
      map: dotTex,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const glow = new THREE.Sprite(glowMat);
    scene.add(glow); // billboard behind the core; never spins

    // Flat parameter rings live in their own group in the scene (NOT the
    // assembly), so they don't tumble with the 3D spin. The render loop points
    // this group at the camera every frame, so its concentric rings read as flat
    // 2D circles around the core. Centred at the origin, exactly like the core.
    const ringGroup = new THREE.Group();
    scene.add(ringGroup);

    // One unit plane shared by every ring and ripple (each mesh just scales it).
    const unitPlane = new THREE.PlaneGeometry(1, 1);

    // A small pool of expanding wavefronts, drawn under the rings in the same
    // billboarded group. Each keeps its own material (they fade independently) but
    // shares the plane + texture; the render loop scales + fades them every frame.
    const rippleTex = makeRippleTexture();
    const rippleColor = new THREE.Color(RIPPLE_COLOR);
    const ripples = [];
    for (let i = 0; i < RIPPLE_COUNT; i += 1) {
      const mat = new THREE.MeshBasicMaterial({
        map: rippleTex,
        color: rippleColor,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(unitPlane, mat);
      mesh.renderOrder = 0; // beneath the rings (1) and the near nodes (2)
      ringGroup.add(mesh);
      ripples.push({ mesh, mat });
    }

    const tooltip = document.createElement('div');
    tooltip.className = 'cohort-tooltip';
    tooltip.hidden = true;
    host.appendChild(tooltip);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const size = { w: 1, h: 1 };

    // One mutable bag so the field effect and the render loop share the live
    // scene objects without re-running this mount effect.
    const bag = {
      host,
      scene,
      camera,
      renderer,
      assembly,
      ringGroup,
      unitPlane,
      ripples,
      core,
      dotTex,
      ringTex,
      tooltip,
      raycaster,
      pointer,
      size,
      cageMat,
      cageVerts,
      tetherMat,
      tethers: null,
      sprites: [],
      rings: [],
      pickables: [core],
      pointerActive: false,
      hovered: null,
      hoverPoint: null,
      paused: false,
      dragging: false,
      layout: orbitLayout(0),
    };
    sceneRef.current = bag;

    // Recolour + reglow the core from the live palette and completion %.
    const applyCore = (pct) => {
      const brand = readColor(host, '--brand', '#cf4c0d');
      coreMat.color.copy(brand).multiplyScalar(0.72); // darkened so the lit sphere reads soft, not vivid
      coreMat.emissive.copy(brand);
      glowMat.color.copy(brand);
      const f = pct === null ? 0 : Math.min(1, Math.max(0, pct / 100));
      coreMat.emissiveIntensity = 0.05 + 0.28 * f; // dimmer glow-from-within
      glowMat.opacity = 0.08 + 0.24 * f; // fainter halo around the core
      // Keep the halo tight around the core so its glow never washes out the
      // parameter rings that sit just outside the core.
      const s = CORE_R * (1.5 + 0.7 * f);
      glow.scale.set(s, s, 1);
    };
    bag.applyCore = applyCore;
    applyCore(pctRef.current);

    // Recolour palette-driven objects live: each sprite from its state token, and
    // the cage + tether lines both on the faint-ink hue (cage matches its tethers).
    // The parameter rings keep their own fixed blues (track + arc), so they don't
    // follow the palette --brand and aren't touched here.
    const applyColors = () => {
      for (const s of bag.sprites) {
        s.material.color.copy(readColor(host, s.colorVar, '#888888'));
      }
      const faint = readColor(host, '--ink-faint', '#6b7079');
      cageMat.color.copy(faint);
      tetherMat.color.copy(faint);
      // Parameter rings keep their own fixed blues (set when they're built): a faded
      // track and a brighter coverage arc. They intentionally don't follow --brand.
    };
    bag.applyColors = applyColors;
    applyColors();

    // Track palette/theme swaps on <html> and recolour live.
    const observer = new MutationObserver(() => {
      applyCore(pctRef.current);
      applyColors();
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'class', 'data-palette'],
    });

    const resize = () => {
      size.w = host.clientWidth || 1;
      size.h = host.clientHeight || 1;
      renderer.setSize(size.w, size.h, false);
      camera.aspect = size.w / size.h;
      const halfFov = Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * Math.min(1, camera.aspect));
      camera.position.z = (bag.layout.shell + 0.16) / Math.sin(halfFov);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      bag.syncLoop?.();
    };
    bag.resize = resize;
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    // Reusable scratch geometry for the per-frame hover/pick math and the render
    // loop. Declared here so the pointer handlers (setPointer, pickTarget) share the
    // same objects the loop uses.
    const world = new THREE.Vector3();
    const projected = new THREE.Vector3();
    // The rings all lie in one plane through the origin, normal = the camera's
    // forward direction (see updateHover / pickTarget for the analytic ring pick).
    const planeNormal = new THREE.Vector3();
    const planeHit = new THREE.Vector3();
    const ORIGIN = new THREE.Vector3(0, 0, 0);
    const ringPlane = new THREE.Plane();
    const fwd = new THREE.Vector3(); // camera forward, refreshed each frame
    const timer = new THREE.Timer(); // drives the ripple wavefronts
    timer.connect(document);

    const el = renderer.domElement;
    el.style.cursor = 'grab';

    // Map a client point to −1..1 normalized device coords for the raycaster, and
    // mark the pointer live so the hover pass runs.
    const setPointer = (clientX, clientY) => {
      const rect = el.getBoundingClientRect();
      pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      bag.pointerActive = true;
    };

    // Resolve what a click lands on, merging the two picks by camera distance the
    // same way updateHover does: node/core come from a raycast, rings from the
    // analytic plane pick. Returns the unified selection target, or null over empty
    // space. core → cohort, node → that student, ring → that parameter.
    const pickTarget = () => {
      raycaster.setFromCamera(pointer, camera);
      const nodeHit = bag.pickables.length
        ? raycaster.intersectObjects(bag.pickables, false)[0] || null
        : null;
      let ringHit = null;
      if (bag.rings.length) {
        camera.getWorldDirection(planeNormal);
        ringPlane.setFromNormalAndCoplanarPoint(planeNormal, ORIGIN);
        const p = raycaster.ray.intersectPlane(ringPlane, planeHit);
        if (p) {
          const rho = p.length();
          let best = null;
          let bestDelta = Infinity;
          for (const r of bag.rings) {
            const delta = Math.abs(r.radius - rho);
            if (delta <= r.half + RING_PICK_PAD && delta < bestDelta) {
              bestDelta = delta;
              best = r;
            }
          }
          if (best) ringHit = { ring: best, dist: camera.position.distanceTo(p) };
        }
      }
      const nodeWins = nodeHit && (!ringHit || nodeHit.distance <= ringHit.dist);
      if (nodeWins) {
        if (nodeHit.object === core) return { type: 'cohort' };
        const d = nodeHit.object.userData;
        return d.kind === 'node' ? { type: 'student', id: d.student.id } : null;
      }
      if (ringHit) return { type: 'parameter', id: ringHit.ring.paramId };
      return null;
    };

    // Pointer interaction: hover (via setPointer + the loop's updateHover), plus
    // drag-to-orbit vs click-to-open resolved by a movement threshold. A press that
    // moves past DRAG_THRESHOLD becomes an orbit drag (yaw on x, clamped tilt on y)
    // and suppresses the click; a press that stays put opens the drawer for whatever
    // it's over. pointercancel (e.g. the browser claiming the gesture for a scroll)
    // clears the press WITHOUT selecting, so scrolling over the canvas on touch
    // never opens a drawer.
    const DRAG_THRESHOLD = 5; // px before a press counts as a drag, not a click
    const ORBIT_SENS = 0.008; // radians of rotation per px dragged
    const TILT_MIN = -0.5; // clamp tilt so the assembly never rolls past the poles
    const TILT_MAX = 0.9;
    let press = null; // { x, y, lastX, lastY, dragged } while the pointer is down

    const onMove = (e) => {
      setPointer(e.clientX, e.clientY);
      if (!press) return;
      if (
        !press.dragged &&
        Math.hypot(e.clientX - press.x, e.clientY - press.y) > DRAG_THRESHOLD
      ) {
        press.dragged = true;
        bag.dragging = true;
      }
      if (press.dragged) {
        assembly.rotation.y += (e.clientX - press.lastX) * ORBIT_SENS;
        assembly.rotation.x = Math.max(
          TILT_MIN,
          Math.min(
            TILT_MAX,
            assembly.rotation.x + (e.clientY - press.lastY) * ORBIT_SENS
          )
        );
        press.lastX = e.clientX;
        press.lastY = e.clientY;
      }
    };
    const onDown = (e) => {
      setPointer(e.clientX, e.clientY);
      press = {
        x: e.clientX,
        y: e.clientY,
        lastX: e.clientX,
        lastY: e.clientY,
        dragged: false,
      };
      try {
        el.setPointerCapture(e.pointerId);
      } catch { /* ignore — capture is best-effort */ }
    };
    const onUp = (e) => {
      setPointer(e.clientX, e.clientY);
      try {
        el.releasePointerCapture(e.pointerId);
      } catch { /* ignore */ }
      const wasDrag = press?.dragged;
      press = null;
      bag.dragging = false;
      if (!wasDrag) {
        const target = pickTarget();
        if (target) onSelectRef.current?.(target);
      }
    };
    const onCancel = (e) => {
      try {
        el.releasePointerCapture(e.pointerId);
      } catch { /* ignore */ }
      press = null;
      bag.dragging = false;
    };
    const onLeave = () => {
      bag.pointerActive = false;
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onCancel);
    el.addEventListener('pointerleave', onLeave);

    // Ring hover feedback: dial the whole (baked) ring up and nudge its radius on
    // hover, restore on leave. Cheap material/scale tweaks, no texture rebuild.
    const setRingRest = (r) => {
      r.mat.opacity = RING_REST_OPACITY;
      r.mesh.scale.set(r.baseS, r.baseS, 1);
    };
    const setRingHover = (r) => {
      r.mat.opacity = RING_HOVER_OPACITY;
      r.mesh.scale.set(r.baseS, r.baseS, 1);
    };

    // What the pointer is over, resolved in two ways and merged by depth:
    //  • Nodes + core are real geometry, so raycast them; the nearest is the
    //    closest opaque thing under the cursor.
    //  • Rings are too thin to raycast reliably and are often hidden behind the
    //    spinning node sprites, so pick them analytically: every ring lies in one
    //    plane through the origin whose normal is the camera's forward direction
    //    (the ring group is billboarded to face the camera). Intersect the pointer
    //    ray with that plane, take the hit's distance from the centre, and match the
    //    nearest ring band. This stays correct while orbiting (phase 4).
    // The two candidates are merged by distance to the camera, so a node in front of
    // a ring occludes it but a node behind it does not. Any hit holds the spin.
    const updateHover = () => {
      if (bag.dragging) {
        // Mid-orbit: drop any hover emphasis + tooltip and don't re-pick, so a drag
        // feels like grabbing the whole object rather than brushing its parts.
        if (bag.hovered) {
          if (bag.hovered.userData.kind === 'node') {
            bag.hovered.scale.setScalar(bag.hovered.userData.baseScale);
          } else if (bag.hovered.userData.ring) {
            setRingRest(bag.hovered.userData.ring);
          }
          bag.hovered = null;
        }
        tooltip.hidden = true;
        el.style.cursor = 'grabbing';
        return;
      }
      let next = null;
      let hitPoint = null;
      let overAssembly = false;
      if (bag.pointerActive) {
        raycaster.setFromCamera(pointer, camera);

        let nodeHit = null;
        if (bag.pickables.length) {
          nodeHit = raycaster.intersectObjects(bag.pickables, false)[0] || null;
        }

        let ringHit = null;
        if (bag.rings.length) {
          camera.getWorldDirection(planeNormal);
          ringPlane.setFromNormalAndCoplanarPoint(planeNormal, ORIGIN);
          const p = raycaster.ray.intersectPlane(ringPlane, planeHit);
          if (p) {
            const rho = p.length(); // radial distance from the core, in the ring plane
            let best = null;
            let bestDelta = Infinity;
            for (const r of bag.rings) {
              const delta = Math.abs(r.radius - rho);
              if (delta <= r.half + RING_PICK_PAD && delta < bestDelta) {
                bestDelta = delta;
                best = r;
              }
            }
            if (best) {
              ringHit = {
                ring: best,
                point: p.clone(),
                dist: camera.position.distanceTo(p),
              };
            }
          }
        }

        const nodeWins =
          nodeHit && (!ringHit || nodeHit.distance <= ringHit.dist);
        if (nodeWins) {
          overAssembly = true;
          if (nodeHit.object !== core) {
            next = nodeHit.object;
            hitPoint = nodeHit.point.clone();
          }
        } else if (ringHit) {
          overAssembly = true;
          next = ringHit.ring.mesh; // the baked ring plane stands in for the ring
          hitPoint = ringHit.point;
        }
      }
      bag.paused = overAssembly;
      if (next !== bag.hovered) {
        if (bag.hovered) {
          if (bag.hovered.userData.kind === 'node') {
            bag.hovered.scale.setScalar(bag.hovered.userData.baseScale);
          } else if (bag.hovered.userData.ring) {
            setRingRest(bag.hovered.userData.ring);
          }
        }
        bag.hovered = next;
        if (next) {
          const d = next.userData;
          if (d.kind === 'node') {
            // A student node is a small dot, so growing its radius reads as emphasis.
            next.scale.setScalar(d.baseScale * 1.6);
            tooltip.textContent = `${d.student.fullName} · ${d.student.measured}/${d.student.inUse}`;
          } else {
            setRingHover(d.ring);
            tooltip.textContent = `${d.name} · ${Math.round(d.coverage * 100)}%`;
          }
          tooltip.hidden = false;
        } else {
          tooltip.hidden = true;
        }
      }
      // Pin the tooltip to the live hit point (on the ring's rim or the node) rather
      // than the object's centre — a ring is centred on the core, so its centre would
      // drop the label in the middle of the sphere. Refreshed every frame so a ring
      // label tracks the cursor as it slides round the hoop.
      bag.hoverPoint = next ? hitPoint : null;
      if (bag.hovered) {
        if (bag.hoverPoint) world.copy(bag.hoverPoint);
        else bag.hovered.getWorldPosition(world);
        projected.copy(world).project(camera);
        tooltip.style.left = `${(projected.x * 0.5 + 0.5) * size.w}px`;
        tooltip.style.top = `${(-projected.y * 0.5 + 0.5) * size.h}px`;
      }
      // A hit is clickable (opens a drawer); empty space over the stage still drags.
      el.style.cursor = bag.hovered ? 'pointer' : 'grab';
    };

    let lastFrame = -Infinity;
    const renderFrame = timestamp => {
      // The ambient scene needs only 30 fps. Hidden/offscreen scenes stop their
      // loop entirely, especially important when both dimensions are displayed.
      if (timestamp - lastFrame < 1000 / 30) return;
      lastFrame = timestamp;
      timer.update(timestamp);
      if (autoRotateRef.current && !bag.paused && !bag.dragging) assembly.rotation.y += Math.min(timer.getDelta(), 0.05) * 0.27;
      assembly.updateMatrixWorld(true);
      // Keep the flat rings facing the camera (so they read as 2D circles) while
      // pinned at the origin — i.e. exactly at the core's centre depth. Because the
      // rings are transparent, the far/near ordering against the node sprites is
      // decided by render order below, not the depth buffer.
      ringGroup.quaternion.copy(camera.quaternion);
      camera.getWorldDirection(fwd);
      // Ripples: expand each wavefront from the core out to the last ring and fade it
      // in-and-out over its trip (sin → zero at both ends, so it's invisible at the
      // core and as it reaches the edge). They keep moving even while a hover holds
      // the spin — ambient, not part of the assembly.
      const rt = timer.getElapsed();
      for (let i = 0; i < bag.ripples.length; i += 1) {
        const rp = bag.ripples[i];
        const phase = ((rt / RIPPLE_PERIOD) + i / RIPPLE_COUNT) % 1;
        const rad = RIPPLE_MIN_R + (bag.layout.outer - RIPPLE_MIN_R) * phase;
        const sc = rad / RIPPLE_FACE_FRAC;
        rp.mesh.scale.set(sc, sc, 1);
        rp.mat.opacity = autoRotateRef.current ? RIPPLE_OPACITY * Math.sin(Math.PI * phase) : 0;
      }
      // Depth-fade + front/behind ordering. A node's signed distance along the view
      // axis from the ring plane (through the origin, normal = camera forward) tells
      // us whether it sits between us and the rings or behind them:
      //   • fade — brightest at the front, dimming toward the back, so the spin reads
      //     as depth on top of the core's hard occlusion of its far side. Only nodes
      //     fade; the rings stay equally faint at every radius (coverage is the arc).
      //   • renderOrder — nodes in front of the ring plane paint over the rings (2),
      //     nodes behind paint under them (0), rings sit between (1). So a node
      //     visibly passes behind the rings and then in front as it orbits, even
      //     though every mark here is transparent.
      for (const s of bag.sprites) {
        s.sprite.getWorldPosition(world);
        const frontness = -world.dot(fwd); // + toward camera, − away behind the plane
        const depth = (frontness + s.fadeR) / (2 * s.fadeR); // 0 (back) .. 1 (front)
        s.material.opacity = s.baseOpacity * (0.35 + 0.65 * Math.max(0, Math.min(1, depth)));
        s.sprite.renderOrder = frontness >= 0 ? 2 : 0;
      }
      updateHover();
      renderer.render(scene, camera);
    };
    let inView = true;
    const syncLoop = () => {
      timer.reset();
      lastFrame = -Infinity;
      const active = inView && !document.hidden;
      host.dataset.renderActive = String(active);
      renderer.setAnimationLoop(active ? renderFrame : null);
    };
    bag.syncLoop = syncLoop;
    const visibilityObserver = new IntersectionObserver(entries => {
      inView = entries.at(-1).isIntersecting;
      syncLoop();
    });
    visibilityObserver.observe(host);
    document.addEventListener('visibilitychange', syncLoop);
    syncLoop();

    return () => {
      renderer.setAnimationLoop(null);
      visibilityObserver.disconnect();
      document.removeEventListener('visibilitychange', syncLoop);
      timer.dispose();
      ro.disconnect();
      observer.disconnect();
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onCancel);
      el.removeEventListener('pointerleave', onLeave);
      for (const s of bag.sprites) s.material.dispose();
      for (const r of bag.rings) {
        ringGroup.remove(r.mesh);
        r.mat.dispose();
        r.tex.dispose();
      }
      for (const rp of ripples) {
        ringGroup.remove(rp.mesh);
        rp.mat.dispose();
      }
      unitPlane.dispose();
      rippleTex.dispose();
      scene.remove(ringGroup);
      if (bag.tethers) {
        assembly.remove(bag.tethers);
        bag.tethers.geometry.dispose();
      }
      cage.geometry.dispose();
      cageGeo.dispose();
      cageMat.dispose();
      tetherMat.dispose();
      coreGeo.dispose();
      coreMat.dispose();
      glowMat.dispose();
      dotTex.dispose();
      ringTex.dispose();
      renderer.dispose();
      if (tooltip.parentNode === host) host.removeChild(tooltip);
      if (renderer.domElement.parentNode === host) {
        host.removeChild(renderer.domElement);
      }
      sceneRef.current = null;
    };
  }, []);

  // --- Student nodes + node→cage tethers + parameter rings, rebuilt whenever the
  // roster / period / group / coverage changes. ---
  useEffect(() => {
    const bag = sceneRef.current;
    if (!bag) return undefined;
    const { assembly } = bag;
    const params = stats.filter(stat => stat.parameter?.inUse);
    bag.layout = orbitLayout(params.length);
    bag.resize();

    for (const s of bag.sprites) {
      assembly.remove(s.sprite);
      s.material.dispose();
    }
    bag.sprites = [];
    for (const r of bag.rings) {
      bag.ringGroup.remove(r.mesh);
      r.mat.dispose();
      r.tex.dispose();
    }
    bag.rings = [];
    if (bag.tethers) {
      assembly.remove(bag.tethers);
      bag.tethers.geometry.dispose();
      bag.tethers = null;
    }
    if (bag.hovered) {
      bag.hovered = null;
      bag.hoverPoint = null;
      bag.paused = false;
      bag.tooltip.hidden = true;
    }

    // Student nodes on the outer shell, each tethered to its nearest cage corner.
    const points = spherePoints(field.length);
    const tetherPairs = [];
    const nodePos = new THREE.Vector3();
    field.forEach((student, i) => {
      const look = nodeAppearance({
        state: student.state,
        measured: student.measured,
        inUse: student.inUse,
      });
      const material = new THREE.SpriteMaterial({
        map: look.hollow ? bag.ringTex : bag.dotTex,
        transparent: true,
        depthWrite: false,
        blending: THREE.NormalBlending,
      });
      const sprite = new THREE.Sprite(material);
      const p = points[i];
      nodePos.set(p.x * bag.layout.shell, p.y * bag.layout.shell, p.z * bag.layout.shell);
      sprite.position.copy(nodePos);
      const baseScale =
        look.hollow ? 0.12 : student.state === 'full' ? 0.17 : 0.13;
      sprite.scale.setScalar(baseScale);
      sprite.userData = { kind: 'node', student, baseScale };
      assembly.add(sprite);
      bag.sprites.push({
        sprite,
        material,
        colorVar: look.colorVar,
        baseOpacity: look.hollow ? 0.5 : look.glow,
        fadeR: bag.layout.shell,
      });

      // Tether this node to its nearest cage corner — a thin line, fixed in
      // assembly-space, that revolves rigidly with the whole assembly.
      let nearest = null;
      let best = Infinity;
      for (const v of bag.cageVerts) {
        const d = nodePos.distanceToSquared(v);
        if (d < best) {
          best = d;
          nearest = v;
        }
      }
      if (nearest) {
        tetherPairs.push(
          nodePos.x, nodePos.y, nodePos.z,
          nearest.x, nearest.y, nearest.z
        );
      }
    });

    // One merged line-segment mesh for every tether (built once per rebuild).
    if (tetherPairs.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(tetherPairs, 3)
      );
      bag.tethers = new THREE.LineSegments(geo, bag.tetherMat);
      assembly.add(bag.tethers);
    }

    // CohortHero pages the chosen parameters. Never shrink the spacing as the
    // selection grows; grow the student shell and fit the camera instead.
    params.forEach((stat, i) => {
      const { coverage } = satelliteAppearance({
        count: stat.answeredCount ?? stat.count,
        total: field.length,
      });
      const radius = bag.layout.radii[i];

      // Bake track + arc to a soft-edged texture on one plane; the material opacity
      // dials the whole ring (dimmed by RING_TRACK_ALPHA for the track) up on hover.
      const tex = makeParamRingTexture(coverage, radius);
      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        opacity: RING_REST_OPACITY,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(bag.unitPlane, mat);
      // Scale the unit plane so its baked ring lands at this ring's world radius.
      const baseS = radius / RING_FACE_FRAC;
      mesh.scale.set(baseS, baseS, 1);
      // Rings sit between the far nodes (renderOrder 0) and the near nodes
      // (renderOrder 2), so nodes visibly pass behind then in front of them.
      mesh.renderOrder = 1;

      const ring = {
        mesh,
        mat,
        tex,
        baseS,
        coverage,
        radius,
        half: RING_HALF,
        name: stat.parameter.name,
        paramId: stat.parameter.id,
      };
      mesh.userData = {
        kind: 'satellite',
        name: stat.parameter.name,
        coverage,
        ring,
      };
      bag.ringGroup.add(mesh);
      bag.rings.push(ring);
    });

    // Rings are picked analytically (see updateHover), so they stay out of the
    // raycast pickables — only the core and node sprites are raycast targets.
    bag.pickables = [bag.core, ...bag.sprites.map((s) => s.sprite)];
    bag.applyColors?.();
    return undefined;
  }, [field, stats]);

  // Scene setup is mount-only; the completion glow updates here on its own.
  useEffect(() => {
    pctRef.current = completion;
    sceneRef.current?.applyCore?.(completion);
  }, [completion]);

  // The 3D canvas is aria-hidden decoration; this control layer is what assistive
  // tech and keyboard users actually operate. Each button opens the same drawer a
  // click on the corresponding 3D mark would, so every target — the class summary,
  // each in-use parameter, each student — is reachable without the WebGL render.
  const jumpStats = stats.filter((s) => s.parameter?.inUse);
  const rosterTotal = field.length;

  function handleControlsKeyDown(event) {
    const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    const buttons = Array.from(
      event.currentTarget.querySelectorAll('button.cohort-jump')
    );
    if (buttons.length === 0) return;
    const index = buttons.indexOf(document.activeElement);
    if (index === -1) return;
    event.preventDefault();
    let nextIndex = index;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextIndex = (index + 1) % buttons.length;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex = (index - 1 + buttons.length) % buttons.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = buttons.length - 1;
    }
    buttons[nextIndex]?.focus();
  }

  return (
    <>
      <div ref={hostRef} className="cohort-canvas" aria-hidden="true" />
      <div className="cohort-controls" onKeyDown={handleControlsKeyDown}>
        <p className="sr-only">{summaryText(t, summary)}</p>
        <button
          type="button"
          className="cohort-jump"
          aria-haspopup="dialog"
          onClick={() => onSelect?.({ type: 'cohort' })}
        >
          {t('cohort.classSummary')}
        </button>
        {jumpStats.length > 0 && (
          <ul className="cohort-jump-list">
            {jumpStats.map((stat) => {
              const pct =
                rosterTotal > 0
                  ? Math.round(((stat.answeredCount ?? stat.count) / rosterTotal) * 100)
                  : 0;
              return (
                <li key={stat.parameter.id}>
                  <button
                    type="button"
                    className="cohort-jump"
                    aria-haspopup="dialog"
                    onClick={() =>
                      onSelect?.({ type: 'parameter', id: stat.parameter.id })
                    }
                  >
                    {t('cohort.paramMeasured', {
                      name: stat.parameter.name,
                      pct,
                    })}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {rosterTotal > 0 && (
          <ul className="cohort-jump-list">
            {field.map((student) => (
              <li key={student.id}>
                <button
                  type="button"
                  className="cohort-jump"
                  aria-haspopup="dialog"
                  onClick={() => onSelect?.({ type: 'student', id: student.id })}
                >
                  {nodeLabel(t, student)}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
