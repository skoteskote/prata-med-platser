import * as THREE from "three";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";

/* ========================================================================== *
 *  CONFIGURATION — the things worth changing all live here.
 * ========================================================================== */
const CONFIG = {
  /** Viewer background colour. */
  backgroundColor: "#12141a",

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
};
/* ========================================================================== */

const canvas = document.getElementById("view");
const loading = document.getElementById("loading");
const bar = document.getElementById("bar");
const barFill = document.getElementById("bar-fill");
const statusEl = document.getElementById("status");
const hud = document.getElementById("hud");
const fpsEl = document.getElementById("fps");

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
    phi = THREE.MathUtils.clamp(phi - dy * CONFIG.orbitSpeed, 0.02, Math.PI - 0.02);
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

  /** Dolly towards/away from the pivot, keeping a sane minimum distance. */
  zoom(amount) {
    const offset = this.position.clone().sub(this.target);
    const dist = THREE.MathUtils.clamp(
      offset.length() * (1 + amount * CONFIG.zoomSpeed), 0.05, CONFIG.far * 0.5);
    this.position.copy(this.target).add(offset.setLength(dist));
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
 *  Pointer input: mouse, trackpad and touch through one Pointer Events path.
 * -------------------------------------------------------------------------- */
const pointers = new Map();
let pinchDist = 0;

canvas.addEventListener("pointerdown", (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, button: e.button });
  if (pointers.size === 2) pinchDist = twoPointerDistance();
});

canvas.addEventListener("pointermove", (e) => {
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
  } else if (prev.button === 2 || e.shiftKey) {
    rig.pan(dx, dy);
  } else {
    rig.orbit(dx, dy);
  }
});

const endPointer = (e) => {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinchDist = 0;
};
canvas.addEventListener("pointerup", endPointer);
canvas.addEventListener("pointercancel", endPointer);
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
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
  const k = e.key.toLowerCase();
  if (k === "r") rig.reset();
  if ("wasdqe".includes(k) || k === "shift") {
    keys.add(k);
    e.preventDefault();
  }
});
addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
addEventListener("blur", () => keys.clear());

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
  camera.far = Math.max(CONFIG.far, span * 12);
  camera.near = Math.max(0.02, span * 0.002);
  camera.updateProjectionMatrix();
}

function setProgress(loaded, total) {
  if (total > 0) {
    bar.classList.remove("indeterminate");
    barFill.style.width = ((loaded / total) * 100).toFixed(1) + "%";
    statusEl.textContent = `${fmtMB(loaded)} of ${fmtMB(total)}`;
  } else {
    bar.classList.add("indeterminate");
    statusEl.textContent = `${fmtMB(loaded)} downloaded`;
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
  statusEl.textContent = "Downloading splat…";

  const mesh = new SplatMesh({
    url: CONFIG.splatUrl,
    onProgress: (e) => setProgress(e.loaded ?? 0, e.lengthComputable ? e.total : 0),
  });
  mesh.quaternion.copy(YDOWN_TO_YUP);
  world.add(mesh);

  try {
    await mesh.initialized;
  } catch (err) {
    console.error(err);
    fail("Could not load the splat. Serve this directory over HTTP (not file://).");
    return;
  }

  bar.classList.remove("indeterminate");
  barFill.style.width = "100%";
  statusEl.textContent = "Ready";
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

resize();
rig.apply();
load();
