/* ==========================================================================
 *  Karta — a shared sheet to paint on.
 *
 *  The physical workshops hand out an A2 map and a brush. This is the same
 *  thing for the sessions that have to run online: one map, everyone drawing
 *  on it at once, and a PDF at the end that can be printed at the same size.
 *
 *  Coordinates are stored normalised against the map's *width*, not its
 *  bounding box, so a stroke keeps its shape and its thickness on any screen
 *  and at print resolution. Strokes, not pixels, are what travels over the
 *  network and what the PDF is rebuilt from.
 * ========================================================================== */
import { INK, makeDabCanvas, widthForSpeed, alphaForWidth, catmullRom } from "../brush.js";
import { createSync } from "./sync.js";
import printMapUrl from "../assets/map/karta-fb-print.jpg";

const CONFIG = {
  /** Brush diameter as a fraction of the map's width, so it is the same mark
   *  relative to the map whatever size it is drawn at. */
  brushSize: 0.011,
  /** The sheet is A2 landscape, matching the printed map. */
  page: { widthMm: 594, heightMm: 420 },
  /** Print canvas width in pixels — 4200 over 594 mm is 180 dpi, plenty for a
   *  line map, and well inside what browsers will allocate as one canvas. */
  printWidth: 4200,
  /** How often a stroke in progress is pushed to the others, in ms. */
  streamEveryMs: 120,
};

const mapImg = document.getElementById("map");
const canvas = document.getElementById("ink");
const ctx = canvas.getContext("2d");
const undoButton = document.getElementById("undo");
const clearButton = document.getElementById("clear");
const saveButton = document.getElementById("save");
const statusEl = document.getElementById("status");
const overlay = document.getElementById("overlay");

const dabCanvas = makeDabCanvas({ color: "0,0,0" });

/* -------------------------------------------------------------------------- *
 *  Deterministic randomness.
 *
 *  The brush jitters — dry skips, specks, the load on each dab. If that came
 *  from Math.random every client would render the same stroke differently.
 *  Seeding per stroke id means everyone's screen, and the PDF, agree.
 * -------------------------------------------------------------------------- */
function seedFrom(id) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function makeRng(seed) {
  let a = seed || 1;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* -------------------------------------------------------------------------- *
 *  Strokes
 *
 *  A stroke is a flat list of x, y, width triples in map-width units. `drawn`
 *  is how many spans have already been stamped, so a stroke that is still
 *  arriving from someone else only ever paints its new part.
 * -------------------------------------------------------------------------- */
const strokes = new Map();      // id -> stroke
let myStrokeIds = [];           // for undo: only ever my own

function newStroke(id) {
  return { id, pts: [], drawn: 0, carry: 0, dabs: 0, rng: makeRng(seedFrom(id)) };
}

function pointCount(stroke) {
  return stroke.pts.length / 3;
}

/** A point of the stroke, clamped at the ends so the curve has controls to
 *  work with at the very start and finish. */
function at(stroke, i, out) {
  const n = pointCount(stroke);
  const k = Math.max(0, Math.min(n - 1, i)) * 3;
  out.x = stroke.pts[k];
  out.y = stroke.pts[k + 1];
  out.w = stroke.pts[k + 2];
  return out;
}

const p0 = { x: 0, y: 0, w: 0 }, p1 = { x: 0, y: 0, w: 0 };
const p2 = { x: 0, y: 0, w: 0 }, p3 = { x: 0, y: 0, w: 0 };

/** Stamp one dab. Positions are in map-width units; `scale` turns them into
 *  pixels on whichever canvas is being drawn to. */
function dab(target, scale, x, y, width, angle, rng) {
  const size = CONFIG.brushSize * scale * width;
  if (size < 0.2) return;
  target.save();
  target.globalAlpha = alphaForWidth(width, INK, rng);
  target.translate(x * scale, y * scale);
  target.rotate(angle);
  target.drawImage(dabCanvas,
    (-size * INK.elongation) / 2, -size / 2, size * INK.elongation, size);
  target.restore();
}

function spatter(target, scale, x, y, width, angle, rng) {
  const n = 1 + Math.floor(rng() * 3);
  for (let i = 0; i < n; i++) {
    const spread = CONFIG.brushSize * width * (1.4 + rng() * 3.2);
    const a = rng() * Math.PI * 2;
    dab(target, scale, x + Math.cos(a) * spread, y + Math.sin(a) * spread,
      width * (0.1 + rng() * 0.2), angle, rng);
  }
}

/** Lay dabs along the curved span from point i to point i+1. */
function paintSpan(target, scale, stroke, i) {
  at(stroke, i - 1, p0); at(stroke, i, p1);
  at(stroke, i + 1, p2); at(stroke, i + 2, p3);

  const chord = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  if (chord < 1e-7) return;

  const width = p1.w;
  const step = Math.max(CONFIG.brushSize * INK.spacing * width, 1e-5);
  const sub = Math.max(6, Math.min(64, Math.ceil((chord / step) * 3)));

  let px = p1.x, py = p1.y;
  for (let k = 1; k <= sub; k++) {
    const t = k / sub;
    const cx = catmullRom(p0.x, p1.x, p2.x, p3.x, t);
    const cy = catmullRom(p0.y, p1.y, p2.y, p3.y, t);
    const cw = catmullRom(p0.w, p1.w, p2.w, p3.w, t);
    const len = Math.hypot(cx - px, cy - py);
    if (len > 1e-9) {
      const dx = (cx - px) / len, dy = (cy - py) / len;
      const angle = Math.atan2(dy, dx);
      let travelled = step - stroke.carry;
      while (travelled <= len) {
        const open = Math.min(1, stroke.dabs / INK.taperDabs);
        const w = Math.max(0.02, cw * (0.4 + 0.6 * open) * (0.9 + stroke.rng() * 0.2));
        const dry = cw < 0.62 && stroke.rng() < INK.skipChance;
        if (!dry) {
          const x = px + dx * travelled, y = py + dy * travelled;
          dab(target, scale, x, y, w, angle, stroke.rng);
          if (stroke.rng() < INK.spatterChance) {
            spatter(target, scale, x, y, w, angle, stroke.rng);
          }
        }
        stroke.dabs += 1;
        travelled += step;
      }
      stroke.carry = len - (travelled - step);
    }
    px = cx; py = cy;
  }
}

/** Paint whatever of this stroke has not been painted yet. */
function paintPending(stroke) {
  const spans = pointCount(stroke) - 2;   // the span with a neighbour each side
  for (let i = stroke.drawn; i < spans; i++) paintSpan(ctx, canvas.width, stroke, i);
  if (spans > stroke.drawn) stroke.drawn = spans;
}

/** Paint a stroke from scratch onto any context — used for redraws, for
 *  replaying what was already on the sheet, and for the PDF. */
function paintWhole(target, scale, stroke) {
  const replay = { ...stroke, carry: 0, dabs: 0, rng: makeRng(seedFrom(stroke.id)) };
  const spans = pointCount(replay) - 1;
  for (let i = 0; i < spans; i++) paintSpan(target, scale, replay, i);
}

function redrawAll() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (const stroke of strokes.values()) {
    paintWhole(ctx, canvas.width, stroke);
    stroke.drawn = Math.max(0, pointCount(stroke) - 1);
  }
  refreshButtons();
}

/** Clearing the sheet arrives as one removal per stroke, so a full redraw on
 *  each would be a hundred redraws. Collapse them into the next frame. */
let redrawQueued = false;
function scheduleRedraw() {
  if (redrawQueued) return;
  redrawQueued = true;
  requestAnimationFrame(() => {
    redrawQueued = false;
    redrawAll();
  });
}

/* -------------------------------------------------------------------------- *
 *  Canvas sizing. The ink layer sits exactly on the map image.
 * -------------------------------------------------------------------------- */
function resize() {
  // Keep the sheet shaped like whatever map is actually loaded.
  if (mapImg.naturalWidth) {
    document.getElementById("sheet").style.aspectRatio =
      `${mapImg.naturalWidth} / ${mapImg.naturalHeight}`;
  }
  const r = mapImg.getBoundingClientRect();
  if (!r.width) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.round(r.width * dpr);
  const h = Math.round(r.height * dpr);
  if (canvas.width === w && canvas.height === h) return;
  canvas.width = w;
  canvas.height = h;
  redrawAll();
}

/* -------------------------------------------------------------------------- *
 *  Drawing
 * -------------------------------------------------------------------------- */
let active = null;          // the stroke being drawn right now
let lastScreen = { x: 0, y: 0 };
let lastTime = 0;
let smoothedWidth = 1;
let lastPublish = 0;

function toMap(e) {
  const r = canvas.getBoundingClientRect();
  // Both axes are divided by the width, so the units are square: a circle
  // stays a circle, and the brush is the same size in x and y.
  return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.width };
}

function localId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

canvas.addEventListener("pointerdown", (e) => {
  if (e.button !== 0 || active) return;
  canvas.setPointerCapture(e.pointerId);
  const p = toMap(e);
  active = newStroke(localId());
  smoothedWidth = 0.55;
  lastScreen = { x: e.clientX, y: e.clientY };
  lastTime = performance.now();
  lastPublish = 0;
  active.pts.push(p.x, p.y, smoothedWidth);
  strokes.set(active.id, active);
  myStrokeIds.push(active.id);
  refreshButtons();
});

canvas.addEventListener("pointermove", (e) => {
  if (!active) return;
  const p = toMap(e);

  const now = performance.now();
  const speed = Math.hypot(e.clientX - lastScreen.x, e.clientY - lastScreen.y) /
    Math.max(now - lastTime, 1) * 1000;
  const wanted = widthForSpeed(speed, INK);
  smoothedWidth += (wanted - smoothedWidth) * 0.3;
  lastTime = now;
  lastScreen = { x: e.clientX, y: e.clientY };

  const n = pointCount(active);
  const lx = active.pts[(n - 1) * 3], ly = active.pts[(n - 1) * 3 + 1];
  if (Math.hypot(p.x - lx, p.y - ly) < 1e-5) return;

  active.pts.push(p.x, p.y, smoothedWidth);
  paintPending(active);

  if (now - lastPublish > CONFIG.streamEveryMs) {
    lastPublish = now;
    sync.publish(active.id, active.pts);
  }
});

function finishStroke() {
  if (!active) return;
  const stroke = active;
  active = null;

  // Lift-off: a short tail that shrinks to nothing, the way a brush leaves.
  const n = pointCount(stroke);
  if (n >= 2) {
    const ax = stroke.pts[(n - 2) * 3], ay = stroke.pts[(n - 2) * 3 + 1];
    const bx = stroke.pts[(n - 1) * 3], by = stroke.pts[(n - 1) * 3 + 1];
    const len = Math.hypot(bx - ax, by - ay);
    if (len > 1e-6) {
      const dx = (bx - ax) / len, dy = (by - ay) / len;
      const step = CONFIG.brushSize * INK.spacing * smoothedWidth;
      for (let i = 1; i <= INK.liftDabs; i++) {
        const fade = 1 - i / (INK.liftDabs + 1);
        stroke.pts.push(bx + dx * step * i, by + dy * step * i,
          smoothedWidth * fade * fade * 0.8);
      }
    }
  }
  paintPending(stroke);
  stroke.drawn = Math.max(0, pointCount(stroke) - 1);
  sync.publish(stroke.id, stroke.pts);
  refreshButtons();
}

canvas.addEventListener("pointerup", finishStroke);
canvas.addEventListener("pointercancel", finishStroke);
addEventListener("blur", finishStroke);

/* -------------------------------------------------------------------------- *
 *  Undo, clear
 * -------------------------------------------------------------------------- */
function refreshButtons() {
  undoButton.disabled = myStrokeIds.length === 0;
  clearButton.disabled = strokes.size === 0;
}

undoButton.addEventListener("click", () => {
  const id = myStrokeIds.pop();
  if (!id) return;
  strokes.delete(id);
  sync.remove(id);
  redrawAll();
});

clearButton.addEventListener("click", () => {
  overlay.hidden = false;
});
document.getElementById("overlay-cancel").addEventListener("click", () => {
  overlay.hidden = true;
});
document.getElementById("overlay-confirm").addEventListener("click", () => {
  overlay.hidden = true;
  strokes.clear();
  myStrokeIds = [];
  sync.clear();
  redrawAll();
});

/* -------------------------------------------------------------------------- *
 *  Everyone else
 * -------------------------------------------------------------------------- */
const sync = createSync({
  room: new URLSearchParams(location.search).get("rum") || "bolanderna",

  onStroke(id, pts) {
    let stroke = strokes.get(id);
    if (!stroke) {
      stroke = newStroke(id);
      strokes.set(id, stroke);
    }
    if (pts.length <= stroke.pts.length) return;   // nothing new
    stroke.pts = pts;
    paintPending(stroke);
    refreshButtons();
  },

  onRemove(id) {
    if (!strokes.delete(id)) return;
    myStrokeIds = myStrokeIds.filter((s) => s !== id);
    scheduleRedraw();
  },

  onClear() {
    strokes.clear();
    myStrokeIds = [];
    scheduleRedraw();
  },

  onStatus(text) {
    statusEl.innerHTML = text ? `<span class="dot"></span>${text}` : "";
  },
});

/* -------------------------------------------------------------------------- *
 *  Save as PDF
 *
 *  Rebuilt from the strokes at print resolution rather than scaled up from the
 *  screen, so the ink is as sharp as the map. The high-resolution map is only
 *  fetched at this point — no reason to make everyone download it to draw.
 * -------------------------------------------------------------------------- */
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`could not load ${src}`));
    img.src = src;
  });
}

async function savePdf() {
  saveButton.disabled = true;
  saveButton.classList.add("busy");
  const wasLabel = saveButton.textContent;
  saveButton.textContent = "Sparar…";
  try {
    const print = await loadImage(printMapUrl);
    const w = CONFIG.printWidth;
    const h = Math.round((print.naturalHeight / print.naturalWidth) * w);

    const sheet = document.createElement("canvas");
    sheet.width = w;
    sheet.height = h;
    const sctx = sheet.getContext("2d");
    sctx.fillStyle = "#ffffff";
    sctx.fillRect(0, 0, w, h);
    sctx.drawImage(print, 0, 0, w, h);
    for (const stroke of strokes.values()) paintWhole(sctx, w, stroke);

    const jpeg = await new Promise((res) =>
      sheet.toBlob((b) => res(b), "image/jpeg", 0.92));
    const bytes = new Uint8Array(await jpeg.arrayBuffer());
    const pdf = buildPdf(bytes, w, h, CONFIG.page.widthMm, CONFIG.page.heightMm);

    const url = URL.createObjectURL(new Blob([pdf], { type: "application/pdf" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `prata-med-platser-karta-${new Date().toISOString().slice(0, 10)}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  } catch (err) {
    console.error(err);
    statusEl.innerHTML = `<span class="dot"></span>Kunde inte spara PDF`;
  } finally {
    saveButton.disabled = false;
    saveButton.classList.remove("busy");
    saveButton.textContent = wasLabel;
  }
}
saveButton.addEventListener("click", savePdf);

/** A single-page PDF holding one JPEG, written by hand.
 *
 *  A whole PDF library would be ~350 kB for one button, and everything here is
 *  bundled rather than fetched, so it would be 350 kB every visitor pays for.
 *  A one-image page is a small, well-trodden corner of the format: the JPEG
 *  goes in untouched as a DCTDecode stream, and the page is sized in points so
 *  it prints at exactly A2. */
function buildPdf(jpeg, pxWidth, pxHeight, mmWidth, mmHeight) {
  const pageW = (mmWidth / 25.4) * 72;
  const pageH = (mmHeight / 25.4) * 72;
  const parts = [];
  const offsets = [];
  let length = 0;

  const push = (bytes) => {
    parts.push(bytes);
    length += bytes.length;
  };
  const latin1 = (s) => {
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
    return out;
  };
  const text = (s) => push(latin1(s));
  const startObject = (n) => { offsets[n] = length; };

  text("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");

  startObject(1);
  text("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");

  startObject(2);
  text("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");

  startObject(3);
  text(`3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW.toFixed(2)} ${pageH.toFixed(2)}] ` +
    `/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`);

  startObject(4);
  text(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${pxWidth} /Height ${pxHeight} ` +
    `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
  push(jpeg);
  text("\nendstream\nendobj\n");

  const content = `q ${pageW.toFixed(2)} 0 0 ${pageH.toFixed(2)} 0 0 cm /Im0 Do Q\n`;
  startObject(5);
  text(`5 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`);

  const xref = length;
  let table = "xref\n0 6\n0000000000 65535 f \n";
  for (let i = 1; i <= 5; i++) {
    table += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  text(table);
  text(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
}

/* -------------------------------------------------------------------------- *
 *  Go
 * -------------------------------------------------------------------------- */
addEventListener("resize", resize);
if (mapImg.complete) resize(); else mapImg.addEventListener("load", resize);
refreshButtons();
