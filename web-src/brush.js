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
