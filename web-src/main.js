import * as THREE from "three";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";

/* ========================================================================== *
 *  CONFIGURATION — the things worth changing all live here.
 * ========================================================================== */
const CONFIG = {
  /** Viewer background colour — matches the off-white page background. */
  backgroundColor: "#f4f2ec",

  /** Splat asset, relative to this page. */
  splatUrl: "./assets/scene.sog",
  /** Camera framing derived from the COLMAP poses at build time. */
  sceneInfoUrl: "./assets/scene-info.json",

  fov: 65,
  near: 0.05,
  far: 500,

  /** Fly speed in world units/second, and the Shift multiplier. */
  flySpeed: 1.6,
  flyBoost: 4.0,

  orbitSpeed: 0.0042,   // radians per pixel dragged
  panSpeed: 0.0016,     // world units per pixel, per unit of pivot distance
  zoomSpeed: 0.0012,    // fraction of pivot distance per wheel unit

  /** Orbit pivot. Everything — orbit radius, pan speed, zoom step — is
   *  measured from the pivot, so a pivot stuck far across the room makes the
   *  whole rig feel wrong. It gets re-anchored onto whatever is actually in
   *  front of the camera; these bound the result. `fallbackPivot` is replaced
   *  with a scene-sized value once the capture dimensions are known. */
  minPivotDistance: 0.4,
  fallbackPivot: 4,
  /** Splats fainter than this don't count as a surface worth orbiting around. */
  minRaycastOpacity: 0.35,
  /** A new scroll gesture starts after this long without a wheel event. */
  gestureGapMs: 250,

  /** Middle-drag dolly: fraction of the step scale travelled per pixel, so a
   *  full-height drag covers a bit under twice the distance to what you face. */
  dollyDragSpeed: 0.002,
  /** Closest the orbit may come to straight up or straight down, in radians. */
  polarLimit: 0.09,

  /** Ink. Held-key painting onto the scan — see the "Ink" section below. */
  ink: {
    /** Brush diameter as a fraction of the viewport height, so the brush keeps
     *  a constant size on screen whatever depth you are painting at. */
    brushSize: 0.05,
    /** Dab spacing along the stroke, as a fraction of the brush radius.
     *  Tight enough that the stamps read as one continuous mark. */
    spacing: 0.28,
    /** The ink itself. Each dab is a stamp of the brush texture, so darkness
     *  builds up where a stroke doubles back, the way real ink does. */
    color: new THREE.Color(0x121212),
    /** Dabs the stroke takes to open up to full width, and to lift off. */
    taperDabs: 5,
    liftDabs: 4,
    /** Screen speed, in px per event, at which the brush runs fully dry. */
    dryAt: 95,
    minWidth: 0.32,
    maxWidth: 1.15,
    /** Chance per dab of the fast brush skipping — the broken edge you get
     *  when a real brush runs out of ink. */
    skipChance: 0.2,
    /** Chance per dab of throwing a few specks, as the logo's brush does. */
    spatterChance: 0.022,
    maxDabs: 24000,
  },
};
/* ========================================================================== */

const canvas = document.getElementById("view");
const loading = document.getElementById("loading");
const bar = document.getElementById("bar");
const barFill = document.getElementById("bar-fill");
const statusEl = document.getElementById("status");
const hud = document.getElementById("hud");
const fpsEl = document.getElementById("fps");
const inkToggle = document.getElementById("ink-toggle");
const inkClear = document.getElementById("ink-clear");

const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(new THREE.Color(CONFIG.backgroundColor), 1);

const scene = new THREE.Scene();
scene.add(new SparkRenderer({ renderer }));

const camera = new THREE.PerspectiveCamera(CONFIG.fov, 1, CONFIG.near, CONFIG.far);

// The splat sits under a group so the whole scene can be levelled: Spark is
// Y-up, 3DGS/COLMAP is Y-down, and COLMAP's world axes are arbitrary anyway.
const world = new THREE.Group();
scene.add(world);

const fmtMB = (b) => (b / 1048576).toFixed(1) + " MB";

/* -------------------------------------------------------------------------- *
 *  Camera rig: one pivot-based rig that serves both orbiting and flying.
 *  `target` is the orbit pivot; flying moves the camera and the pivot together.
 * -------------------------------------------------------------------------- */
const rig = {
  position: new THREE.Vector3(0, 0, 4),
  target: new THREE.Vector3(0, 0, 0),
  home: { position: new THREE.Vector3(0, 0, 4), target: new THREE.Vector3(0, 0, 0) },

  apply() {
    camera.position.copy(this.position);
    camera.up.set(0, 1, 0);
    camera.lookAt(this.target);
    // Keep camera.matrix current: orbit/pan/fly all read their basis vectors
    // off it in the same tick, before the renderer would refresh it.
    camera.updateMatrix();
  },
  setHome(position, target) {
    this.home.position.copy(position);
    this.home.target.copy(target);
    this.reset();
  },
  reset() {
    this.position.copy(this.home.position);
    this.target.copy(this.home.target);
    this.apply();
  },

  /** Orbit the camera around the pivot. */
  orbit(dx, dy) {
    const offset = this.position.clone().sub(this.target);
    const radius = offset.length();
    let theta = Math.atan2(offset.x, offset.z);
    let phi = Math.acos(THREE.MathUtils.clamp(offset.y / radius, -1, 1));
    theta -= dx * CONFIG.orbitSpeed;
    // Stop short of the poles. Straight overhead the azimuth becomes
    // hypersensitive and the view spins on the spot, which reads as the scene
    // tipping over even though the camera itself never rolls.
    phi = THREE.MathUtils.clamp(
      phi - dy * CONFIG.orbitSpeed, CONFIG.polarLimit, Math.PI - CONFIG.polarLimit);
    offset.set(
      radius * Math.sin(phi) * Math.sin(theta),
      radius * Math.cos(phi),
      radius * Math.sin(phi) * Math.cos(theta),
    );
    this.position.copy(this.target).add(offset);
    this.apply();
  },

  /** Slide camera and pivot together across the view plane. */
  pan(dx, dy) {
    const dist = this.position.distanceTo(this.target);
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1);
    const move = right.multiplyScalar(-dx * CONFIG.panSpeed * dist)
      .add(up.multiplyScalar(dy * CONFIG.panSpeed * dist));
    this.position.add(move);
    this.target.add(move);
    this.apply();
  },

  /** How far one "unit" of movement should carry, given what you are looking
   *  at. Never so small that motion crawls once the pivot is against the lens. */
  stepScale() {
    return Math.max(this.position.distanceTo(this.target), CONFIG.fallbackPivot * 0.25);
  },

  /** Push the camera along its own view axis, carrying the pivot with it.
   *  Unlike zoom this has no floor — you can travel straight past whatever you
   *  were orbiting instead of stalling on it. */
  dolly(fraction) {
    const forward = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 2).negate();
    this.translate(forward.multiplyScalar(fraction * this.stepScale()));
  },

  /** Draw the camera towards the pivot. Once it would close right up against
   *  the pivot it hands over to dolly, so scrolling keeps moving you forward
   *  rather than grinding to a halt a few centimetres short of the wall. */
  zoom(amount) {
    const offset = this.position.clone().sub(this.target);
    const wanted = offset.length() * (1 + amount * CONFIG.zoomSpeed);
    if (wanted < CONFIG.minPivotDistance) {
      this.dolly(-amount * CONFIG.zoomSpeed);
      return;
    }
    this.position.copy(this.target)
      .add(offset.setLength(Math.min(wanted, CONFIG.far * 0.5)));
    this.apply();
  },

  /** Translate the whole rig — used by WASD flight. */
  translate(v) {
    this.position.add(v);
    this.target.add(v);
    this.apply();
  },
};

/* -------------------------------------------------------------------------- *
 *  Orbit pivot.
 *
 *  The pivot used to be fixed at the point the opening shot looked at, roughly
 *  15 m away, so every drag swung the camera around a point far across the hall
 *  instead of around what you were looking at. Spark can raycast the splat
 *  itself, so the pivot is re-anchored onto real geometry whenever an
 *  interaction starts — the behaviour you get in most 3D software.
 *
 *  The pivot is always placed on the camera's forward axis, at the depth of the
 *  hit rather than at the hit point itself. That matters: the rig orients with
 *  lookAt(target), so a pivot placed off-axis would spin the camera the moment
 *  you touched it. On-axis, re-anchoring changes only how far away the pivot
 *  is, never where the camera points.
 * -------------------------------------------------------------------------- */
const raycaster = new THREE.Raycaster();
const SCREEN_CENTRE = new THREE.Vector2(0, 0);
let splatMesh = null;

function repivot() {
  if (!splatMesh) return;
  scene.updateMatrixWorld();
  raycaster.setFromCamera(SCREEN_CENTRE, camera);

  const hits = [];
  splatMesh.raycast(raycaster, hits);

  // Nothing in the middle of the view — looking out of a window, or off the
  // end of the capture. Fall back to a distance that suits the scene size,
  // which still beats leaving the pivot wherever it happened to be.
  let distance = CONFIG.fallbackPivot;
  if (hits.length) {
    distance = Infinity;
    for (const hit of hits) if (hit.distance < distance) distance = hit.distance;
  }

  const forward = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 2).negate();
  rig.target.copy(rig.position)
    .addScaledVector(forward, Math.max(distance, CONFIG.minPivotDistance));
}

/* -------------------------------------------------------------------------- *
 *  Ink.
 *
 *  The workshops paint ink on big white sheets, so the scan can be painted on
 *  too. A splat has no surfaces to paint onto, but it can be *asked* where a
 *  surface is: the same raycast that anchors the pivot returns a point on the
 *  scan, and one cast at the start of a stroke fixes a plane through that point
 *  facing the camera. The rest of the stroke is projected onto that plane,
 *  which costs nothing and holds the ink at the depth of whatever you aimed at.
 *  It is the sheet of paper held up against the room, which is the right
 *  metaphor anyway — and it stays put in world space when you orbit away.
 *
 *  The ink itself is instanced brush stamps rather than gaussians. Pushing it
 *  into a second SplatMesh would have composited more natively, but Spark will
 *  not render a mesh whose PackedSplats started empty — it initialises, reports
 *  a generator and no error, and draws nothing. Stamps also give a far better
 *  brush: a real dab texture with a bitten edge beats a soft ellipsoid. They
 *  carry no depth test, because splats never write depth for one to use.
 * -------------------------------------------------------------------------- */
/** One brush dab, drawn once onto a canvas: a loaded centre that falls away
 *  softly, with the rim bitten into so it reads as bristles rather than a
 *  circle. Every dab on the page is an instance of this. */
function makeDabTexture(size = 128) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  const mid = size / 2;

  const grad = g.createRadialGradient(mid, mid, 0, mid, mid, mid);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.58, "rgba(255,255,255,1)");
  grad.addColorStop(0.8, "rgba(255,255,255,0.82)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.beginPath();
  g.arc(mid, mid, mid, 0, Math.PI * 2);
  g.fill();

  // Bite irregular notches out of the edge.
  g.globalCompositeOperation = "destination-out";
  for (let i = 0; i < 16; i++) {
    const angle = Math.random() * Math.PI * 2;
    const at = mid * (0.74 + Math.random() * 0.4);
    g.beginPath();
    g.arc(mid + Math.cos(angle) * at, mid + Math.sin(angle) * at,
      mid * (0.05 + Math.random() * 0.15), 0, Math.PI * 2);
    g.fill();
  }
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const inkMesh = new THREE.InstancedMesh(
  new THREE.PlaneGeometry(1, 1),
  new THREE.MeshBasicMaterial({
    map: makeDabTexture(),
    transparent: true,
    // Splats do not write depth, so there is no usable depth buffer to test
    // against. Draw the ink after them instead.
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  }),
  CONFIG.ink.maxDabs,
);
inkMesh.count = 0;
inkMesh.frustumCulled = false;   // instances are placed far from the origin
inkMesh.renderOrder = 10;
inkMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
scene.add(inkMesh);              // authored in world space, so no transform

const stroke = {
  active: false,
  plane: new THREE.Plane(),
  quaternion: new THREE.Quaternion(),
  radius: 0.1,
  last: new THREE.Vector3(),
  lastScreen: new THREE.Vector2(),
  direction: new THREE.Vector3(),
  width: 1,
  carry: 0,
  dabs: 0,
};
let inkDabs = 0;
let inkDirty = false;

const ndc = new THREE.Vector2();
const UNIT_Z = new THREE.Vector3(0, 0, 1);
const scratch = {
  point: new THREE.Vector3(),
  scale: new THREE.Vector3(),
  quaternion: new THREE.Quaternion(),
  roll: new THREE.Quaternion(),
  matrix: new THREE.Matrix4(),
  color: new THREE.Color(),
};

function toNdc(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  return ndc;
}

/** Drop one gaussian dab. `scale` is a multiple of the stroke's brush radius. */
function dab(center, scale) {
  if (inkDabs >= CONFIG.ink.maxDabs) return;
  const size = Math.max(stroke.radius * scale, 1e-4) * 2;
  // Spin each dab so repeated stamps of one texture never read as a pattern.
  scratch.roll.setFromAxisAngle(UNIT_Z, Math.random() * Math.PI * 2);
  scratch.quaternion.copy(stroke.quaternion).multiply(scratch.roll);
  scratch.scale.set(size, size, 1);
  scratch.matrix.compose(center, scratch.quaternion, scratch.scale);
  inkMesh.setMatrixAt(inkDabs, scratch.matrix);
  // Vary the load so the stroke has the density mottling of real ink.
  scratch.color.copy(CONFIG.ink.color)
    .multiplyScalar(0.7 + Math.random() * 0.9);
  inkMesh.setColorAt(inkDabs, scratch.color);
  inkDabs += 1;
  inkMesh.count = inkDabs;
  inkDirty = true;
}

/** A few specks thrown off the brush, in the plane of the stroke. */
function spatter(center) {
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0);
  const up = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1);
  for (let i = 0, n = 1 + Math.floor(Math.random() * 3); i < n; i++) {
    const spread = stroke.radius * (1.4 + Math.random() * 3.2);
    const a = Math.random() * Math.PI * 2;
    dab(center.clone()
      .addScaledVector(right, Math.cos(a) * spread)
      .addScaledVector(up, Math.sin(a) * spread),
      0.1 + Math.random() * 0.2);
  }
}

function beginStroke(clientX, clientY) {
  // Where is the surface? One raycast, at the depth the brush will work at.
  let point = null;
  if (splatMesh) {
    scene.updateMatrixWorld();
    raycaster.setFromCamera(toNdc(clientX, clientY), camera);
    const hits = [];
    splatMesh.raycast(raycaster, hits);
    for (const hit of hits) {
      if (!point || hit.distance < point.distance) point = hit;
    }
    point = point ? point.point.clone() : null;
  }

  // The camera's +Z points back towards the viewer, so dabs laid out on this
  // plane face you as you paint them.
  const normal = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 2).normalize();
  if (!point) {
    // Nothing under the cursor: paint on the pivot's depth instead, which is
    // already anchored to something sensible.
    point = camera.position.clone()
      .addScaledVector(normal.clone().negate(), rig.position.distanceTo(rig.target));
  }

  const distance = camera.position.distanceTo(point);

  stroke.plane.setFromNormalAndCoplanarPoint(normal, point);
  stroke.quaternion.setFromUnitVectors(UNIT_Z, normal);
  const visibleHeight = 2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
  stroke.radius = visibleHeight * CONFIG.ink.brushSize * 0.5;

  stroke.active = true;
  stroke.last.copy(point);
  stroke.lastScreen.set(clientX, clientY);
  stroke.direction.set(0, 0, 0);
  stroke.width = 0.55;
  stroke.carry = 0;
  stroke.dabs = 0;
  dab(point, taperedWidth());
  updateInkUi();
}

/** Brush width for the next dab: speed-driven, opening up from a fine tip. */
function taperedWidth() {
  const open = Math.min(1, stroke.dabs / CONFIG.ink.taperDabs);
  return stroke.width * (0.4 + 0.6 * open) * (0.9 + Math.random() * 0.2);
}

function extendStroke(clientX, clientY) {
  if (!stroke.active) return;
  raycaster.setFromCamera(toNdc(clientX, clientY), camera);
  const hit = raycaster.ray.intersectPlane(stroke.plane, scratch.point);
  if (!hit) return;                          // stroke has swung past the horizon

  // A real brush thins out as it moves faster. Smoothed, or it flickers.
  const speed = Math.hypot(clientX - stroke.lastScreen.x, clientY - stroke.lastScreen.y);
  const wanted = THREE.MathUtils.clamp(
    CONFIG.ink.maxWidth - speed / CONFIG.ink.dryAt,
    CONFIG.ink.minWidth, CONFIG.ink.maxWidth);
  stroke.width += (wanted - stroke.width) * 0.35;
  stroke.lastScreen.set(clientX, clientY);

  const segment = hit.clone().sub(stroke.last);
  const length = segment.length();
  if (length < 1e-6) return;
  stroke.direction.copy(segment).normalize();

  // Walk the segment at fixed spacing, carrying the remainder into the next
  // one so dab spacing stays even however coarse the pointer events are.
  const step = Math.max(stroke.radius * CONFIG.ink.spacing * stroke.width, 1e-4);
  let travelled = step - stroke.carry;
  while (travelled <= length) {
    const at = stroke.last.clone().addScaledVector(stroke.direction, travelled);
    const dry = stroke.width < 0.62 && Math.random() < CONFIG.ink.skipChance;
    if (!dry) {
      dab(at, taperedWidth());
      if (Math.random() < CONFIG.ink.spatterChance) spatter(at);
    }
    stroke.dabs += 1;
    travelled += step;
  }
  stroke.carry = length - (travelled - step);
  stroke.last.copy(hit);
}

/** Lift-off: a short tail that shrinks to nothing, the way a brush leaves. */
function endStroke() {
  if (!stroke.active) return;
  if (stroke.dabs > 0 && stroke.direction.lengthSq() > 0) {
    const step = stroke.radius * CONFIG.ink.spacing * stroke.width;
    for (let i = 1; i <= CONFIG.ink.liftDabs; i++) {
      const fade = 1 - i / (CONFIG.ink.liftDabs + 1);
      dab(stroke.last.clone().addScaledVector(stroke.direction, step * i),
        stroke.width * fade * fade * 0.8);
    }
  }
  stroke.active = false;
  updateInkUi();
}

function clearInk() {
  inkDabs = 0;
  inkMesh.count = 0;
  inkDirty = true;
  updateInkUi();
}

/* Painting is a held-key mode so it can never fight with navigation. Touch has
 * no keyboard, so there it becomes a toggle — the only extra control, and it
 * only exists on devices that need it. */
let paintKeyHeld = false;
let paintToggled = false;
const painting = () => paintKeyHeld || paintToggled;

function updateInkUi() {
  canvas.classList.toggle("painting", painting());
  inkClear.hidden = inkDabs === 0;
  inkToggle.setAttribute("aria-pressed", String(paintToggled));
}

/* -------------------------------------------------------------------------- *
 *  Pointer input: mouse, trackpad and touch through one Pointer Events path.
 * -------------------------------------------------------------------------- */
const pointers = new Map();
let pinchDist = 0;

canvas.addEventListener("pointerdown", (e) => {
  // Middle button would otherwise start the browser's autoscroll.
  if (e.button === 1) e.preventDefault();
  canvas.setPointerCapture(e.pointerId);

  // Painting takes the drag entirely, so it can never fight the camera.
  if (painting() && pointers.size === 0 && !stroke.active && e.button === 0) {
    e.preventDefault();
    beginStroke(e.clientX, e.clientY);
    return;
  }

  if (pointers.size === 0) repivot();     // once per drag, not per move
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, button: e.button });
  if (pointers.size === 2) pinchDist = twoPointerDistance();
});
canvas.addEventListener("auxclick", (e) => e.preventDefault());

canvas.addEventListener("pointermove", (e) => {
  if (stroke.active) {
    extendStroke(e.clientX, e.clientY);
    return;
  }
  const prev = pointers.get(e.pointerId);
  if (!prev) return;
  const dx = e.clientX - prev.x;
  const dy = e.clientY - prev.y;
  prev.x = e.clientX;
  prev.y = e.clientY;

  if (pointers.size >= 2) {
    // Two fingers: pinch to zoom, drag to pan.
    const d = twoPointerDistance();
    if (pinchDist > 0) rig.zoom((pinchDist - d) * 2.2);
    pinchDist = d;
    rig.pan(dx / 2, dy / 2);
  } else if (prev.button === 1) {
    // Middle-drag: dolly. Push away from you to travel forwards.
    rig.dolly(-dy * CONFIG.dollyDragSpeed);
  } else if (prev.button === 2 || e.shiftKey) {
    rig.pan(dx, dy);
  } else {
    rig.orbit(dx, dy);
  }
});

const endPointer = (e) => {
  if (stroke.active) endStroke();
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinchDist = 0;
};
canvas.addEventListener("pointerup", endPointer);
canvas.addEventListener("pointercancel", endPointer);
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
// Re-anchor once per scroll gesture rather than per event — a raycast is far
// too expensive to run on every wheel tick.
let lastWheel = 0;
canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  const now = performance.now();
  if (now - lastWheel > CONFIG.gestureGapMs) repivot();
  lastWheel = now;
  rig.zoom(e.deltaY);
}, { passive: false });

function twoPointerDistance() {
  const [a, b] = [...pointers.values()];
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/* -------------------------------------------------------------------------- *
 *  Keyboard: WASD/QE flight, R to reset.
 * -------------------------------------------------------------------------- */
const keys = new Set();
addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;

  // Hold space to paint. Held, not toggled, so you drop straight back into
  // navigating the moment you let go.
  if (e.code === "Space") {
    e.preventDefault();
    if (!paintKeyHeld) {
      paintKeyHeld = true;
      updateInkUi();
    }
    return;
  }

  const k = e.key.toLowerCase();
  if (k === "r") {
    rig.reset();
    repivot();      // home's stored pivot is the distant one from the capture
  }
  if ("wasdqe".includes(k) || k === "shift") {
    keys.add(k);
    e.preventDefault();
  }
});

addEventListener("keyup", (e) => {
  if (e.code === "Space") {
    paintKeyHeld = false;
    if (stroke.active) endStroke();
    updateInkUi();
    return;
  }
  keys.delete(e.key.toLowerCase());
});

addEventListener("blur", () => {
  keys.clear();
  paintKeyHeld = false;
  if (stroke.active) endStroke();
  updateInkUi();
});

inkToggle.addEventListener("click", () => {
  paintToggled = !paintToggled;
  updateInkUi();
});
inkClear.addEventListener("click", clearInk);

function fly(dt) {
  const forwardInput = (keys.has("w") ? 1 : 0) - (keys.has("s") ? 1 : 0);
  const strafeInput = (keys.has("d") ? 1 : 0) - (keys.has("a") ? 1 : 0);
  const riseInput = (keys.has("e") ? 1 : 0) - (keys.has("q") ? 1 : 0);
  if (!forwardInput && !strafeInput && !riseInput) return;

  const speed = CONFIG.flySpeed * (keys.has("shift") ? CONFIG.flyBoost : 1) * dt;
  const forward = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 2).negate();
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0);
  rig.translate(
    forward.multiplyScalar(forwardInput * speed)
      .add(right.multiplyScalar(strafeInput * speed))
      .add(new THREE.Vector3(0, riseInput * speed, 0)),
  );
}

/* -------------------------------------------------------------------------- *
 *  Scene framing + splat loading.
 * -------------------------------------------------------------------------- */
// Spark renders Y-up; 3DGS/COLMAP data is Y-down, hence this fixed flip.
const YDOWN_TO_YUP = new THREE.Quaternion(1, 0, 0, 0);

async function frameScene() {
  let info = null;
  try {
    const res = await fetch(CONFIG.sceneInfoUrl);
    if (res.ok) info = await res.json();
  } catch { /* fall through to a generic default framing */ }

  if (!info) {
    rig.setHome(new THREE.Vector3(0, 0, 4), new THREE.Vector3(0, 0, 0));
    return;
  }

  const toView = (p) => new THREE.Vector3(p[0], p[1], p[2]).applyQuaternion(YDOWN_TO_YUP);

  // Level the scene: rotate the capture's up vector onto +Y so orbiting, panning
  // and QE flight all behave the way a person expects in a room.
  const up = toView(info.up).normalize();
  const level = new THREE.Quaternion().setFromUnitVectors(up, new THREE.Vector3(0, 1, 0));
  world.quaternion.copy(level);

  const position = toView(info.start.position).applyQuaternion(level);
  const target = toView(info.start.target).applyQuaternion(level);
  rig.setHome(position, target);

  // Scale movement and clipping to the real size of the capture.
  const span = Math.max(info.pathDiagonal || 4, 1);
  CONFIG.flySpeed = span * 0.12;
  CONFIG.fallbackPivot = span * 0.25;
  camera.far = Math.max(CONFIG.far, span * 12);
  camera.near = Math.max(0.02, span * 0.002);
  camera.updateProjectionMatrix();
}

function setProgress(loaded, total) {
  if (total > 0) {
    bar.classList.remove("indeterminate");
    barFill.style.width = ((loaded / total) * 100).toFixed(1) + "%";
    statusEl.textContent = `${fmtMB(loaded)} av ${fmtMB(total)}`;
  } else {
    bar.classList.add("indeterminate");
    statusEl.textContent = `${fmtMB(loaded)} hämtat`;
  }
}

function fail(message) {
  bar.classList.remove("indeterminate");
  bar.style.display = "none";
  statusEl.classList.add("error");
  statusEl.textContent = message;
}

async function load() {
  await frameScene();
  bar.classList.add("indeterminate");
  statusEl.textContent = "Hämtar scanningen…";

  const mesh = new SplatMesh({
    url: CONFIG.splatUrl,
    // Lets the orbit pivot land on real geometry — see repivot().
    raycastable: true,
    minRaycastOpacity: CONFIG.minRaycastOpacity,
    onProgress: (e) => setProgress(e.loaded ?? 0, e.lengthComputable ? e.total : 0),
  });
  mesh.quaternion.copy(YDOWN_TO_YUP);
  world.add(mesh);

  try {
    await mesh.initialized;
  } catch (err) {
    console.error(err);
    fail("Scanningen kunde inte laddas. Sidan behöver serveras över HTTP (inte file://).");
    return;
  }

  splatMesh = mesh;
  // The raycast index is not ready the instant `initialized` resolves, so this
  // first call usually falls back; retry on a later frame to open on the real
  // geometry rather than on the scene-sized guess.
  repivot();
  requestAnimationFrame(() => requestAnimationFrame(repivot));

  bar.classList.remove("indeterminate");
  barFill.style.width = "100%";
  statusEl.textContent = "Klar";
  canvas.classList.add("ready");   // fade the scene up out of the background
  loading.classList.add("done");
  setTimeout(() => loading.remove(), 700);
  hud.hidden = false;
}

/* -------------------------------------------------------------------------- *
 *  Frame loop.
 * -------------------------------------------------------------------------- */
function resize() {
  const w = canvas.clientWidth || window.innerWidth;
  const h = canvas.clientHeight || window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener("resize", resize);

let last = performance.now();
let frames = 0;
let fpsClock = last;
renderer.setAnimationLoop((now) => {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  fly(dt);
  // Batch the ink upload to one per frame rather than one per dab.
  if (inkDirty) {
    inkMesh.instanceMatrix.needsUpdate = true;
    if (inkMesh.instanceColor) inkMesh.instanceColor.needsUpdate = true;
    inkDirty = false;
  }
  renderer.render(scene, camera);

  if (++frames >= 30) {
    fpsEl.textContent = `${Math.round((frames * 1000) / (now - fpsClock))} fps`;
    frames = 0;
    fpsClock = now;
  }
});

document.getElementById("help-toggle").addEventListener("click", (e) => {
  const help = document.getElementById("help");
  help.hidden = !help.hidden;
  e.currentTarget.setAttribute("aria-expanded", String(!help.hidden));
});

/* -------------------------------------------------------------------------- *
 *  Routing. Hash-based on purpose: the site is served from a project subpath
 *  on GitHub Pages, where real paths would need server-side rewrites.
 *  The scan keeps rendering behind every page — only the wash over it changes,
 *  which is driven off body[data-route] in the stylesheet.
 * -------------------------------------------------------------------------- */
const ROUTES = {
  hem: "Prata med platser",
  om: "Om projektet — Prata med platser",
  schema: "Schema — Prata med platser",
};

const pagesEl = document.getElementById("pages");
const navLinks = [...document.querySelectorAll(".nav-link")];

function currentRoute() {
  const name = location.hash.replace(/^#\/?/, "").trim();
  return Object.hasOwn(ROUTES, name) && name !== "hem" ? name : "hem";
}

function applyRoute() {
  const route = currentRoute();
  document.body.dataset.route = route;
  document.title = ROUTES[route];

  for (const page of document.querySelectorAll(".page")) {
    page.hidden = page.id !== `page-${route}`;
  }
  pagesEl.hidden = route === "hem";
  if (route !== "hem") pagesEl.scrollTop = 0;

  for (const link of navLinks) {
    if (link.getAttribute("href") === `#/${route}`) {
      link.setAttribute("aria-current", "page");
    } else {
      link.removeAttribute("aria-current");
    }
  }
}

addEventListener("hashchange", applyRoute);
applyRoute();

// The hint has done its job once you have actually moved the scan.
const hint = document.getElementById("hint");
canvas.addEventListener("pointerdown", () => hint.classList.add("gone"), { once: true });

resize();
rig.apply();
load();
