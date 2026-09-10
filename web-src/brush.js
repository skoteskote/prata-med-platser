/* ==========================================================================
 *  The brush.
 *
 *  Shared by the two places ink gets painted: the splat viewer, which stamps
 *  dabs as instanced quads in 3D, and the map, which stamps them straight onto
 *  a 2D canvas. The renderers have nothing in common; the brush does. Keeping
 *  the texture and the feel here is what stops the two drifting apart.
 * ========================================================================== */

/** How a stroke behaves. Sizes and colours are left to each caller, since a
 *  metre in a splat and a pixel on a map are not the same thing. */
export const INK = {
  /** Dab spacing along the stroke, as a fraction of the brush radius.
   *  Tight enough that the stamps read as one continuous mark. */
  spacing: 0.22,
  /** Dabs are stretched along the direction of travel, so consecutive stamps
   *  drag into each other instead of reading as a row of blots. */
  elongation: 1.3,

  /** Speed to width, in px per second: a brush loaded and moving slowly lays
   *  down its full width, and thins out as it is drawn faster. */
  speedFat: 140,
  speedThin: 1700,
  minWidth: 0.2,
  maxWidth: 1.0,

  /** Opacity once the brush has thinned right out. Very low on purpose: dabs
   *  overlap many deep, and anything near 0.3 still stacks to solid black. */
  dryAlpha: 0.08,

  /** Dabs the stroke takes to open up to full width, and to lift off. */
  taperDabs: 7,
  liftDabs: 4,
  /** Chance per dab of the fast brush skipping — the broken edge you get when
   *  a real brush runs out of ink. */
  skipChance: 0.22,
  /** Chance per dab of throwing a few specks. */
  spatterChance: 0.004,
};

/** One brush dab, drawn once onto a canvas: a loaded centre that falls away
 *  softly, with the rim bitten into so it reads as bristles rather than a
 *  circle, and streaks running along X so that consecutive stamps — which are
 *  rolled to face the direction of travel — line their gaps up into
 *  continuous dry-brush striations.
 *
 *  `color` is white for the 3D path, where the material tints it, and black
 *  for the 2D path, which draws the canvas as-is. */
export function makeDabCanvas({ size = 256, color = "255,255,255" } = {}) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  const mid = size / 2;

  // Hard almost to the rim. A soft gradient edge is what makes a stamp read as
  // airbrush; a brush leaves a definite boundary with ink right up to it.
  const grad = g.createRadialGradient(mid, mid, 0, mid, mid, mid);
  grad.addColorStop(0, `rgba(${color},1)`);
  grad.addColorStop(0.84, `rgba(${color},1)`);
  grad.addColorStop(0.95, `rgba(${color},0.88)`);
  grad.addColorStop(1, `rgba(${color},0)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);

  g.globalCompositeOperation = "destination-out";
  g.lineCap = "round";
  for (let i = 0; i < 6; i++) {
    const y = mid + (Math.random() * 2 - 1) * mid * 0.8;
    const x0 = Math.random() * size * 0.35;
    const x1 = size - Math.random() * size * 0.35;
    g.lineWidth = size * (0.004 + Math.random() * 0.013);
    g.strokeStyle = `rgba(0,0,0,${0.75 + Math.random() * 0.25})`;
    g.beginPath();
    g.moveTo(x0, y);
    g.quadraticCurveTo((x0 + x1) / 2, y + (Math.random() * 2 - 1) * size * 0.025, x1, y);
    g.stroke();
  }
  return c;
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** Brush width for a given pointer speed in px/second. Measured per second
 *  rather than per event, because event rate varies with the hardware. */
export function widthForSpeed(speed, ink = INK) {
  const t = clamp((speed - ink.speedFat) / (ink.speedThin - ink.speedFat), 0, 1);
  return ink.maxWidth + (ink.minWidth - ink.maxWidth) * Math.pow(t, 0.65);
}

/** Opacity for a dab of a given width. A thinned-out brush carries less ink,
 *  so the surface shows through it. Taper and lift-off ride on this too. */
export function alphaForWidth(width, ink = INK) {
  const load = clamp((width - ink.minWidth) / (ink.maxWidth - ink.minWidth), 0, 1);
  const a = ink.dryAlpha + (1 - ink.dryAlpha) * Math.pow(load, 0.35);
  return clamp(a * (0.9 + Math.random() * 0.2), 0.05, 1);
}

/** Catmull-Rom interpolation of one scalar. Pointer samples arrive far apart
 *  when the hand moves quickly; joining them with straight lines is what makes
 *  fast strokes come out as polygons. */
export function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return p0 * (-0.5 * t3 + t2 - 0.5 * t) +
    p1 * (1.5 * t3 - 2.5 * t2 + 1) +
    p2 * (-1.5 * t3 + 2 * t2 + 0.5 * t) +
    p3 * (0.5 * t3 - 0.5 * t2);
}

/* ==========================================================================
 *  Outline strokes.
 *
 *  The stamping brush above lays a texture down over and over along the path.
 *  It reads well small, but a stamp repeated at a fixed spacing gives the mark
 *  a regularly scalloped edge, and once you zoom in that periodicity is all
 *  the eye sees.
 *
 *  These build the stroke as a single shape instead: one variable-width
 *  outline around the path, filled once. Repetition stops being possible,
 *  because there is nothing to repeat — and the shape is resolution-free, so
 *  it stays crisp however far in you go, and can go into a PDF as real curves.
 * ========================================================================== */

/** Small deterministic PRNG, so every participant's screen — and the printed
 *  sheet — draw the same stroke the same way. */
export function makeRng(seed) {
  let a = seed || 1;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedFrom(id) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Smooth 1D value noise. Used to wobble the edge of a stroke: a brush drawn
 *  by hand never has a mathematically parallel edge, and this is what keeps
 *  the outline from looking like a machine part — without a repeat, since the
 *  noise runs along the stroke rather than being tiled. */
export function makeNoise(seed, size = 64) {
  const rnd = makeRng(seed);
  const table = new Float32Array(size);
  for (let i = 0; i < size; i++) table[i] = rnd() * 2 - 1;
  return (x) => {
    const i = Math.floor(x);
    const f = x - i;
    const a = table[((i % size) + size) % size];
    const b = table[(((i + 1) % size) + size) % size];
    return a + (b - a) * (f * f * (3 - 2 * f));   // smoothstep
  };
}

/** The pen chases the cursor through a spring rather than tracking it exactly.
 *  This is the single biggest thing that makes a stroke feel like it flows:
 *  the hand's jitter is absorbed, and what is left is the gesture. */
export function streamline(current, target, amount) {
  const k = 1 - amount;
  current.x += (target.x - current.x) * k;
  current.y += (target.y - current.y) * k;
  return current;
}

const easeOut = (t) => 1 - (1 - t) * (1 - t);

/**
 * Build the two sides of a stroke.
 *
 * `points` is a flat [x, y, width, …] array; `width` is a multiplier, and
 * `radius` scales it into whatever units the caller is drawing in. Taper
 * lengths are in those same units.
 *
 * Returns { left, right } — each an array of {x, y} running from the start of
 * the stroke to its end, ready to be traced out and back as one closed shape.
 */
export function strokeSides(points, {
  radius,
  taperStart = radius * 2.5,
  taperEnd = radius * 5,
  noiseAmount = 0.1,
  noiseScale = 1.4,
  seed = 1,
}) {
  const n = points.length / 3;
  if (n < 2) return null;

  // Arc length along the stroke, which is what the taper and the edge noise
  // are measured against — so they look the same however fast it was drawn.
  const dist = new Float32Array(n);
  for (let i = 1; i < n; i++) {
    const dx = points[i * 3] - points[(i - 1) * 3];
    const dy = points[i * 3 + 1] - points[(i - 1) * 3 + 1];
    dist[i] = dist[i - 1] + Math.hypot(dx, dy);
  }
  const total = dist[n - 1];
  if (total <= 0) return null;

  // Two octaves: a slow wander that keeps the stroke from being a machined
  // offset, and a finer chatter that only shows up close — which is exactly
  // where the old stamped brush gave itself away.
  const wobbleL = makeNoise(seed);
  const wobbleR = makeNoise(seed ^ 0x9e3779b9);
  const fineL = makeNoise(seed ^ 0x85ebca6b);
  const fineR = makeNoise(seed ^ 0xc2b2ae35);
  const step = Math.max(radius * noiseScale, 1e-6);
  const fineStep = step * 0.22;

  const left = [];
  const right = [];

  for (let i = 0; i < n; i++) {
    const x = points[i * 3];
    const y = points[i * 3 + 1];

    // Direction: averaged across the joint so corners do not pinch.
    let dx = 0, dy = 0;
    if (i > 0) {
      dx += x - points[(i - 1) * 3];
      dy += y - points[(i - 1) * 3 + 1];
    }
    if (i < n - 1) {
      dx += points[(i + 1) * 3] - x;
      dy += points[(i + 1) * 3 + 1] - y;
    }
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;

    // Taper: opens quickly at the press, runs out to a long point at the lift.
    const s = dist[i];
    const open = easeOut(Math.min(1, s / Math.max(taperStart, 1e-6)));
    const close = Math.min(1, (total - s) / Math.max(taperEnd, 1e-6));
    let r = radius * points[i * 3 + 2] * open * Math.pow(close, 0.7);

    const at = s / step;
    const fine = s / fineStep;
    const rl = Math.max(0, r * (1 + wobbleL(at) * noiseAmount
      + fineL(fine) * noiseAmount * 0.4));
    const rr = Math.max(0, r * (1 + wobbleR(at) * noiseAmount
      + fineR(fine) * noiseAmount * 0.4));

    left.push({ x: x + nx * rl, y: y + ny * rl });
    right.push({ x: x - nx * rr, y: y - ny * rr });
  }

  return { left, right };
}

/**
 * Walk the closed shape of a stroke, handing each segment to `emit`.
 *
 * Both renderers go through here, which is the point: the screen and the PDF
 * trace the identical shape, so what is printed is what was drawn rather than
 * a second implementation that has to be kept in step.
 *
 * `emit` takes { move, quad, close } in whatever coordinate space it likes —
 * the caller can transform on the way through.
 */
export function tracePath(sides, emit) {
  const { left, right } = sides;
  const backwards = right.slice().reverse();

  // Along one side, through the midpoints so joints never show as corners.
  const run = (side) => {
    for (let i = 1; i < side.length - 1; i++) {
      const mx = (side[i].x + side[i + 1].x) / 2;
      const my = (side[i].y + side[i + 1].y) / 2;
      emit.quad(side[i].x, side[i].y, mx, my);
    }
    const last = side[side.length - 1];
    emit.quad(last.x, last.y, last.x, last.y);
  };

  // A cap bulges out beyond the end of the path, so a lift reads as a brush
  // leaving the paper rather than a line stopping dead.
  const cap = (from, to) => {
    emit.quad(
      (from.x + to.x) / 2 + (from.y - to.y) * 0.35,
      (from.y + to.y) / 2 - (from.x - to.x) * 0.35,
      to.x, to.y);
  };

  emit.move(left[0].x, left[0].y);
  run(left);
  cap(left[left.length - 1], backwards[0]);
  run(backwards);
  cap(backwards[backwards.length - 1], left[0]);
  emit.close();
}
