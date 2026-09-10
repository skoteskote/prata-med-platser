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
import { INK, widthForSpeed, streamline, strokeSides, seedFrom, tracePath } from "../brush.js";
import { createSync } from "./sync.js";
import printMapUrl from "../assets/map/karta-fb-print.jpg";

const CONFIG = {
  /** Brush diameter as a fraction of the map's width, so it is the same mark
   *  relative to the map whatever size it is drawn at. */
  brushSize: 0.013,
  color: "#000000",

  /** How much the pen trails the cursor, 0–1. This is the flow control: at 0
   *  the stroke follows every twitch of the hand, and around 0.6 it carries
   *  through a gesture the way a loaded brush does. */
  streamline: 0.58,
  /** Minimum travel between recorded points, in map widths. Sampling by
   *  distance rather than by event keeps the curve even at any hand speed. */
  minSample: 0.0016,

  /** Taper lengths, as multiples of the brush radius: a quick swell at the
   *  press, a long run-out at the lift. */
  taperStart: 2.2,
  taperEnd: 6,

  /** How much the edge wanders, and over what length. Enough that the outline
   *  reads as cut by hand rather than offset by a machine. */
  edgeNoise: 0.11,
  edgeNoiseScale: 1.6,

  /** The sheet is A2 landscape, matching the printed map. */
  page: { widthMm: 594, heightMm: 420 },
  /** Print canvas width in pixels — 4200 over 594 mm is 180 dpi, plenty for a
   *  line map, and well inside what browsers will allocate as one canvas. */
  printWidth: 4200,
  /** How often a stroke in progress is pushed to the others, in ms. */
  streamEveryMs: 120,
  /** How far in you can go. Past about this the map's own detail runs out. */
  maxZoom: 8,
  /** Wheel notch to zoom factor, and trackpad pan sensitivity. */
  zoomPerWheel: 0.0022,
};

const mapImg = document.getElementById("map");
const canvas = document.getElementById("ink");
const ctx = canvas.getContext("2d");
const undoButton = document.getElementById("undo");
const clearButton = document.getElementById("clear");
const saveButton = document.getElementById("save");
const fitButton = document.getElementById("fit");
const statusEl = document.getElementById("status");
const overlay = document.getElementById("overlay");


/* -------------------------------------------------------------------------- *
 *  Strokes
 *
 *  A stroke is a flat list of x, y, width triples in map-width units, and it
 *  is drawn as one shape: an outline built around the path and filled once.
 *  The previous brush stamped a texture along the path, which reads well small
 *  but gives the edge a regular scallop at the stamp spacing — and zoomed in,
 *  that periodicity is the only thing you see. An outline has nothing to
 *  repeat, and is resolution-free.
 * -------------------------------------------------------------------------- */
const strokes = new Map();      // id -> stroke, in draw order
let myStrokeIds = [];           // for undo: only ever my own

function newStroke(id) {
  return { id, pts: [], seed: seedFrom(id) };
}

const pointCount = (stroke) => stroke.pts.length / 3;

/** The geometry of one stroke, in target units. Shared by the screen and by
 *  the PDF, so the printed sheet is the same shape as what was drawn. */
function strokeGeometry(stroke, scale) {
  const n = pointCount(stroke);
  if (n === 0) return null;
  const radius = CONFIG.brushSize * scale * 0.5;

  if (n < 2) {
    return { dot: { x: stroke.pts[0] * scale, y: stroke.pts[1] * scale,
      r: radius * stroke.pts[2] * 0.6 } };
  }

  const pts = new Float32Array(stroke.pts.length);
  for (let i = 0; i < n; i++) {
    pts[i * 3] = stroke.pts[i * 3] * scale;
    pts[i * 3 + 1] = stroke.pts[i * 3 + 1] * scale;
    pts[i * 3 + 2] = stroke.pts[i * 3 + 2];
  }

  const sides = strokeSides(pts, {
    radius,
    taperStart: radius * CONFIG.taperStart,
    taperEnd: radius * CONFIG.taperEnd,
    noiseAmount: CONFIG.edgeNoise,
    noiseScale: CONFIG.edgeNoiseScale,
    seed: stroke.seed,
  });
  return sides ? { sides } : null;
}

/** Draw one stroke. `scale` is how many units of the target there are across
 *  the map, so the same stroke data serves the screen at any zoom and the
 *  print sheet at 180 dpi. */
function paintStroke(target, scale, stroke) {
  const geo = strokeGeometry(stroke, scale);
  if (!geo) return;

  // A tap with no travel is still a mark: a round blot.
  if (geo.dot) {
    target.beginPath();
    target.arc(geo.dot.x, geo.dot.y, geo.dot.r, 0, Math.PI * 2);
    target.fill();
    return;
  }

  target.beginPath();
  tracePath(geo.sides, {
    move: (x, y) => target.moveTo(x, y),
    quad: (cx, cy, x, y) => target.quadraticCurveTo(cx, cy, x, y),
    close: () => target.closePath(),
  });
  target.fill();
}

/** Everything, in order. One fill per stroke is cheap enough that there is no
 *  need to track what has already been drawn — which also means a stroke that
 *  is still arriving from someone else simply redraws as it grows. */
function paintAll(target, scale) {
  target.fillStyle = CONFIG.color;
  for (const stroke of strokes.values()) paintStroke(target, scale, stroke);
}

function redrawAll() {
  wipeCanvas();
  useView(ctx);
  paintAll(ctx, fitWidth);
  refreshButtons();
}

/** Every change redraws the sheet, so they are collapsed into the next frame:
 *  clearing arrives as one removal per stroke, and a stroke in progress grows
 *  on every pointer event. */
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
 *  The view: which part of the map is on screen.
 *
 *  Zooming by scaling the canvas in CSS would just magnify the pixels already
 *  painted, and the ink would go soft exactly when someone leans in to look.
 *  So the canvas stays the size of the window and the view is applied as a
 *  transform on the context before painting — the strokes are re-rasterised at
 *  the new scale, and stay as crisp at 6x as at fit. The map image is a real
 *  image, so it just takes the same transform in CSS.
 * -------------------------------------------------------------------------- */
const view = { x: 0, y: 0, zoom: 1 };
let fitWidth = 1;               // CSS px across the map at zoom 1
let fitHeight = 1;
let dpr = 1;

/** Screen scale: CSS pixels per map-width unit. */
const viewScale = () => fitWidth * view.zoom;

function layout() {
  if (!mapImg.naturalWidth) return;
  dpr = Math.min(window.devicePixelRatio || 1, 2);

  const pad = parseFloat(getComputedStyle(document.documentElement)
    .getPropertyValue("--pad")) || 16;
  const chrome = pad * 2 + 46;                       // header above, tools below
  const availableW = Math.max(120, innerWidth - pad * 2);
  const availableH = Math.max(120, innerHeight - chrome * 2);
  const ratio = mapImg.naturalWidth / mapImg.naturalHeight;

  fitWidth = Math.min(availableW, availableH * ratio);
  fitHeight = fitWidth / ratio;

  mapImg.style.width = `${fitWidth}px`;
  mapImg.style.height = `${fitHeight}px`;

  canvas.width = Math.round(innerWidth * dpr);
  canvas.height = Math.round(innerHeight * dpr);
  canvas.style.width = `${innerWidth}px`;
  canvas.style.height = `${innerHeight}px`;

  clampView();
  applyView();
}

/** Keep the sheet from being dragged away off screen. */
function clampView() {
  const w = fitWidth * view.zoom;
  const h = fitHeight * view.zoom;
  const slackX = Math.max(0, (w - innerWidth) / 2);
  const slackY = Math.max(0, (h - innerHeight) / 2);
  const restX = (innerWidth - w) / 2;
  const restY = (innerHeight - h) / 2;
  view.x = Math.min(restX + slackX, Math.max(restX - slackX, view.x));
  view.y = Math.min(restY + slackY, Math.max(restY - slackY, view.y));
}

function applyView() {
  mapImg.style.transform =
    `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`;
  fitButton.hidden = view.zoom <= 1.001;
  scheduleRedraw();
}

/** Put the canvas context into map space, so paint code can go on working in
 *  map-width units and know nothing about panning or zooming. */
function useView(target) {
  target.setTransform(dpr, 0, 0, dpr, 0, 0);
  target.translate(view.x, view.y);
  target.scale(view.zoom, view.zoom);
}

function wipeCanvas() {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
}

function fitView() {
  view.zoom = 1;
  clampView();
  applyView();
}

/** Zoom about a point on screen, so what is under the cursor stays under it. */
function zoomAt(clientX, clientY, factor) {
  const next = Math.min(CONFIG.maxZoom, Math.max(1, view.zoom * factor));
  if (next === view.zoom) return;
  const k = next / view.zoom;
  view.x = clientX - (clientX - view.x) * k;
  view.y = clientY - (clientY - view.y) * k;
  view.zoom = next;
  clampView();
  applyView();
}


/* -------------------------------------------------------------------------- *
 *  Drawing
 * -------------------------------------------------------------------------- */
let active = null;          // the stroke being drawn right now
const pen = { x: 0, y: 0 };  // trails the cursor — see CONFIG.streamline
let lastScreen = { x: 0, y: 0 };
let lastTime = 0;
let smoothedWidth = 1;
let lastPublish = 0;

function toMap(e) {
  // Both axes are divided by the map width, so the units are square: a circle
  // stays a circle, and the brush is the same size in x and y.
  const s = viewScale();
  return { x: (e.clientX - view.x) / s, y: (e.clientY - view.y) / s };
}

function localId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

canvas.addEventListener("pointerdown", (e) => {
  if (wantsPan(e)) {
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    panning = { id: e.pointerId, x: e.clientX, y: e.clientY };
    canvas.classList.add("panning");
    return;
  }
  if (e.button !== 0 || active) return;
  canvas.setPointerCapture(e.pointerId);
  const p = toMap(e);
  active = newStroke(localId());
  pen.x = p.x;
  pen.y = p.y;
  smoothedWidth = 0.55;
  lastScreen = { x: e.clientX, y: e.clientY };
  lastTime = performance.now();
  lastPublish = 0;
  active.pts.push(pen.x, pen.y, smoothedWidth);
  strokes.set(active.id, active);
  myStrokeIds.push(active.id);
  refreshButtons();
});

canvas.addEventListener("pointermove", (e) => {
  if (panning && e.pointerId === panning.id) {
    view.x += e.clientX - panning.x;
    view.y += e.clientY - panning.y;
    panning.x = e.clientX;
    panning.y = e.clientY;
    clampView();
    applyView();
    return;
  }
  if (!active) return;
  const p = toMap(e);

  const now = performance.now();
  const speed = Math.hypot(e.clientX - lastScreen.x, e.clientY - lastScreen.y) /
    Math.max(now - lastTime, 1) * 1000;
  const wanted = widthForSpeed(speed, INK);
  smoothedWidth += (wanted - smoothedWidth) * 0.3;
  lastTime = now;
  lastScreen = { x: e.clientX, y: e.clientY };

  // The pen chases the cursor rather than tracking it. This is what turns a
  // shaky hand into a flowing gesture, and it costs a few milliseconds of lag.
  streamline(pen, p, CONFIG.streamline);

  const n = pointCount(active);
  const lx = active.pts[(n - 1) * 3], ly = active.pts[(n - 1) * 3 + 1];
  // Sample by distance, not by event: a slow hand would otherwise pile up
  // hundreds of points in one spot and stiffen the curve.
  if (Math.hypot(pen.x - lx, pen.y - ly) < CONFIG.minSample) return;

  active.pts.push(pen.x, pen.y, smoothedWidth);
  scheduleRedraw();

  if (now - lastPublish > CONFIG.streamEveryMs) {
    lastPublish = now;
    sync.publish(active.id, active.pts);
  }
});

function finishStroke() {
  if (!active) return;
  const stroke = active;
  active = null;

  // Let the pen catch up to where the hand actually stopped, so the stroke
  // ends where it was released rather than a few pixels behind.
  const n = pointCount(stroke);
  if (n >= 1) {
    const lx = stroke.pts[(n - 1) * 3], ly = stroke.pts[(n - 1) * 3 + 1];
    if (Math.hypot(pen.x - lx, pen.y - ly) > CONFIG.minSample * 0.5) {
      stroke.pts.push(pen.x, pen.y, smoothedWidth);
    }
  }

  // No lift-off tail to add by hand any more: the outline's taper runs the
  // stroke out to a point on its own, measured along the path.
  scheduleRedraw();
  sync.publish(stroke.id, stroke.pts);
  refreshButtons();
}

function releasePointer(e) {
  endPan(e);
  finishStroke();
}
canvas.addEventListener("pointerup", releasePointer);
canvas.addEventListener("pointercancel", releasePointer);
addEventListener("blur", () => { endPan(); finishStroke(); });


/* -------------------------------------------------------------------------- *
 *  Getting around
 *
 *  Drawing owns the plain drag — it is what people are here to do — so moving
 *  the map is on the gestures that are not drawing: pinch to zoom, two-finger
 *  scroll to pan, and space or the middle button to drag it about. A trackpad
 *  pinch reaches the browser as a wheel event with ctrlKey set, which is what
 *  separates the two.
 * -------------------------------------------------------------------------- */
canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  if (e.ctrlKey || e.metaKey) {
    zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * CONFIG.zoomPerWheel * 4));
  } else {
    view.x -= e.deltaX;
    view.y -= e.deltaY;
    clampView();
    applyView();
  }
}, { passive: false });

let panning = null;
let spaceHeld = false;

/** Panning is checked inside the drawing handlers rather than in a separate
 *  capture-phase listener: relying on capture to out-order a listener on the
 *  same element is subtle enough to break quietly. */
const wantsPan = (e) => e.button === 1 || (e.button === 0 && spaceHeld);

const endPan = (e) => {
  if (!panning || (e && e.pointerId !== panning.id)) return;
  panning = null;
  canvas.classList.remove("panning");
};

addEventListener("keydown", (e) => {
  if (e.code === "Space" && !spaceHeld) {
    spaceHeld = true;
    canvas.classList.add("panready");
    e.preventDefault();
  }
});
addEventListener("keyup", (e) => {
  if (e.code === "Space") {
    spaceHeld = false;
    canvas.classList.remove("panready");
  }
});
addEventListener("blur", () => {
  spaceHeld = false;
  canvas.classList.remove("panready");
});

// Double-click anywhere to get the whole sheet back.
canvas.addEventListener("dblclick", (e) => {
  e.preventDefault();
  fitView();
});
fitButton.addEventListener("click", fitView);

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
    scheduleRedraw();
    refreshButtons();
  },

  onRemove(id) {
    if (!strokes.delete(id)) return;
    myStrokeIds = myStrokeIds.filter((s) => s !== id);
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

    // Only the map is rasterised. The ink goes in as real curves, so it stays
    // sharp at whatever size the sheet is printed and costs a few kB instead
    // of being baked into the image at 180 dpi.
    const jpeg = await new Promise((res) =>
      sheet.toBlob((b) => res(b), "image/jpeg", 0.92));
    const bytes = new Uint8Array(await jpeg.arrayBuffer());
    const ink = inkAsPdfPaths(w, h, CONFIG.page.widthMm, CONFIG.page.heightMm);
    const pdf = buildPdf(bytes, w, h, CONFIG.page.widthMm, CONFIG.page.heightMm, ink);

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


/** Every stroke as PDF path operators.
 *
 *  PDF has no quadratic curve, so each one is raised to the equivalent cubic —
 *  the control points sit two thirds of the way from each end towards the
 *  quadratic's control point, which is exact, not an approximation.
 *
 *  The page runs y upwards from the bottom left; the canvas runs y down from
 *  the top. The image is laid over the whole page, so a point at pixel (px,py)
 *  of the print canvas belongs at that same fraction of the page.
 */
function inkAsPdfPaths(pxWidth, pxHeight, mmWidth, mmHeight) {
  const pageW = (mmWidth / 25.4) * 72;
  const pageH = (mmHeight / 25.4) * 72;
  const X = (px) => (px / pxWidth) * pageW;
  const Y = (py) => pageH - (py / pxHeight) * pageH;
  const f = (v) => (Math.round(v * 100) / 100).toString();

  let out = "0 g\n";
  for (const stroke of strokes.values()) {
    const geo = strokeGeometry(stroke, pxWidth);
    if (!geo) continue;

    if (geo.dot) {
      // A circle from four cubic arcs — the usual 0.5523 magic number.
      const k = geo.dot.r * 0.5523;
      const cx = geo.dot.x, cy = geo.dot.y, r = geo.dot.r;
      out += `${f(X(cx - r))} ${f(Y(cy))} m\n`;
      out += `${f(X(cx - r))} ${f(Y(cy - k))} ${f(X(cx - k))} ${f(Y(cy - r))} ${f(X(cx))} ${f(Y(cy - r))} c\n`;
      out += `${f(X(cx + k))} ${f(Y(cy - r))} ${f(X(cx + r))} ${f(Y(cy - k))} ${f(X(cx + r))} ${f(Y(cy))} c\n`;
      out += `${f(X(cx + r))} ${f(Y(cy + k))} ${f(X(cx + k))} ${f(Y(cy + r))} ${f(X(cx))} ${f(Y(cy + r))} c\n`;
      out += `${f(X(cx - k))} ${f(Y(cy + r))} ${f(X(cx - r))} ${f(Y(cy + k))} ${f(X(cx - r))} ${f(Y(cy))} c\nh f\n`;
      continue;
    }

    let cur = { x: 0, y: 0 };
    tracePath(geo.sides, {
      move: (x, y) => {
        cur = { x, y };
        out += `${f(X(x))} ${f(Y(y))} m\n`;
      },
      quad: (cx, cy, x, y) => {
        const c1x = cur.x + (2 / 3) * (cx - cur.x);
        const c1y = cur.y + (2 / 3) * (cy - cur.y);
        const c2x = x + (2 / 3) * (cx - x);
        const c2y = y + (2 / 3) * (cy - y);
        out += `${f(X(c1x))} ${f(Y(c1y))} ${f(X(c2x))} ${f(Y(c2y))} ${f(X(x))} ${f(Y(y))} c\n`;
        cur = { x, y };
      },
      close: () => { out += "h f\n"; },
    });
  }
  return out;
}

/** A single-page PDF holding one JPEG, written by hand.
 *
 *  A whole PDF library would be ~350 kB for one button, and everything here is
 *  bundled rather than fetched, so it would be 350 kB every visitor pays for.
 *  A one-image page is a small, well-trodden corner of the format: the JPEG
 *  goes in untouched as a DCTDecode stream, and the page is sized in points so
 *  it prints at exactly A2. */
function buildPdf(jpeg, pxWidth, pxHeight, mmWidth, mmHeight, extraContent = "") {
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

  const content = `q ${pageW.toFixed(2)} 0 0 ${pageH.toFixed(2)} 0 0 cm /Im0 Do Q\n` + extraContent;
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
// The hint has done its job once the map has actually been handled.
const hint = document.getElementById("hint");
const dismissHint = () => hint.classList.add("gone");
canvas.addEventListener("pointerdown", dismissHint, { once: true });
canvas.addEventListener("wheel", dismissHint, { once: true, passive: true });

addEventListener("resize", layout);
if (mapImg.complete) layout(); else mapImg.addEventListener("load", layout);
refreshButtons();
