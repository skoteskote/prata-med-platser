import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Clip } from "./metavido.js";
import { LiveLayer, RingLayer, Splats, Probe, PASS } from "./layers.js";

/* ========================================================================== *
 *  CONFIGURATION — the things worth changing all live here.
 * ========================================================================== */
const CONFIG = {
  /** The clip: OUT/NAME.mp4 + OUT/NAME.json from scripts/metavido_clip.py. */
  clip: "../assets/video/moment2-16pro",
  caption: "Workshop 1, moment 2 · iPhone 16 Pro",

  fov: 55,
  near: 0.03,
  far: 60,

  /** Start view, relative to the recording phone at frame 0: a step back and
   *  up, looking at a point this far in front of the phone. */
  startBack: 1.6,
  startUp: 0.55,
  startAside: 0.35,
  focusDistance: 2.5,

  /** Depth beyond this is dropped. The recorder encodes 0.2-10 m; LiDAR is
   *  good to ~5 m and beyond that ARKit's depth is an estimate, but the hall's
   *  far wall at 6-9 m still reads as a room, so keep most of it. */
  maxDepth: 9.5,
  /** Depth edges: a sample whose surface is steeper than this to the view ray
   *  (tan of the angle) is on the smeared ramp between a foreground object and
   *  the background — the "rubber sheet". 8 ~ 83 degrees: real slopes, like the
   *  floor 9 m away, stay under it; ramps measure 15-30. */
  edge: 8,
  /** ...or whose inverse depth bends by more than this over +-12 px (planes
   *  have none; measured: 2.7% of planar pixels exceed 0.15, two thirds of
   *  ramp pixels do). Catches the shoulders of a ramp, where the slope is low. */
  curve: 0.15,
  /** And what to do with those samples: snap them to a side (see metavido.js),
   *  drop them, or keep them (raw, for comparison). */
  edgeModes: { snap: 2, drop: 1, keep: 0 },
  edgeLabels: { snap: "Kanter: skärpta", drop: "Kanter: bortklippta", keep: "Kanter: råa" },

  /** The three looks. step = depth pixels per sample (x resolution scale). */
  looks: {
    punkter: { primitive: "points", step: 1, size: 1.4, splat: false },
    mjuk: { primitive: "points", step: 2, size: 2.3, sharp: 2.2, splat: true },
    ytor: { primitive: "surfels", step: 2, size: 2.0, sharp: 2.0, splat: true },
  },
  /** Splat visibility: splats this fraction of their depth behind the front
   *  surface still blend into it; further back they are hidden. */
  depthBias: 0.02,

  /** "Människor i fokus": people bright and dense, the room dim and sparse. */
  people: { peopleGain: 1.12, roomGain: 0.34, roomKeep: 0.32, peopleSize: 1.15 },

  /** "Rummet minns": one room-only capture every `every` frames, kept for the
   *  whole clip, so the room fills in as the handheld phone looks around. */
  memory: { every: 10, step: 4, gain: 0.62 },
  /** "Spår": the people of the last slots*every frames, fading out. */
  trails: { every: 2, slots: 14, step: 2, gain: 0.95 },
};
/* ========================================================================== */

const $ = id => document.getElementById(id);
const canvas = $("view");
const mobile = matchMedia("(pointer: coarse)").matches || Math.min(innerWidth, innerHeight) < 600;

// State: from the URL, so a view can be linked, compared and screenshotted.
const params = new URLSearchParams(location.search);
const flag = (k, d) => (params.has(k) ? params.get(k) !== "0" : d);
const state = {
  look: CONFIG.looks[params.get("look")] ? params.get("look") : "punkter",
  people: flag("people", false),
  memory: flag("memory", false),
  trails: flag("trails", false),
  camera: flag("camera", true),
  edges: CONFIG.edgeModes[params.get("edges")] !== undefined ? params.get("edges") : "snap",
  why: params.has("why"),
  res: Math.max(1, +params.get("res") || (mobile ? 2 : 1)),
  debug: params.has("debug"),
  follow: flag("follow", false),
};

const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(devicePixelRatio, mobile ? 1.5 : 2));
renderer.setClearColor(0x000000, 1);
renderer.autoClear = false;

const scene = new THREE.Scene();      // reconstructed layers
const overlay = new THREE.Scene();    // camera gizmo, drawn last
const camera = new THREE.PerspectiveCamera(CONFIG.fov, 1, CONFIG.near, CONFIG.far);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.screenSpacePanning = true;
controls.zoomSpeed = 0.9;
controls.minDistance = 0.15;
controls.maxDistance = 25;

const splats = new Splats();
let clip, live, memory, trails, probe;
const layers = () => [memory, live, trails].filter(Boolean);

/* ---------------------------------------------------------------- startup */

async function start() {
  if (!renderer.capabilities.isWebGL2) throw new Error("WebGL 2 saknas i den här webbläsaren.");
  clip = await Clip.load(CONFIG.clip);
  $("caption").textContent = CONFIG.caption;
  $("scrub").max = String(clip.frames - 1);

  buildLive();
  buildRecorderGizmo();
  startView();
  applyState();
  if (state.debug) probe = new Probe(clip);

  const t = parseFloat(params.get("t"));
  if (Number.isFinite(t)) clip.seekFrame(Math.round(t * clip.fps));
  if (params.get("paused") !== "1") await clip.video.play().catch(() => setPlaying(false));
  else setPlaying(false);
  syncTransport();

  $("loading").classList.add("gone");
  setTimeout(() => $("hint").classList.add("gone"), 6000);
  readyMs = performance.now() - bootT;
  requestAnimationFrame(loop);
}

function buildLive() {
  live?.dispose();
  if (live) scene.remove(live.object);
  const look = CONFIG.looks[state.look];
  live = new LiveLayer(clip, { primitive: look.primitive, step: look.step * state.res });
  scene.add(live.object);
  const u = live.uniforms;
  u.uSize.value = look.size;
  u.uSharp.value = look.sharp ?? 2.5;
  tuneCommon(live);
}

function tuneCommon(layer) {
  const u = layer.uniforms;
  u.uMaxDepth.value = CONFIG.maxDepth;
  u.uEdge.value = CONFIG.edge;
  u.uCurve.value = CONFIG.curve;
  u.uEdgeMode.value = CONFIG.edgeModes[state.edges];
  u.uWhy.value = state.why ? 1 : 0;
  u.uDepthBias.value = CONFIG.depthBias;
  const p = CONFIG.people;
  if (state.people) u.uPeople.value.set(p.peopleGain, p.roomGain, layer === live ? p.roomKeep : 1, layer === live ? p.peopleSize : 1);
  else u.uPeople.value.set(1, 1, 1, 1);
}

function buildMemory() {
  const m = CONFIG.memory;
  const every = mobile ? m.every * 2 : m.every;
  memory = new RingLayer(clip, { slots: Math.ceil(clip.frames / every), step: m.step * (mobile ? 1.5 : 1) | 0, who: "room" });
  memory.every = every;
  memory.uniforms.uOpacity.value = m.gain;
  memory.uniforms.uSize.value = CONFIG.looks[state.look].splat ? 2.0 : 1.0;
  scene.add(memory.object);
  tuneCommon(memory);
}

function buildTrails() {
  const t = CONFIG.trails;
  trails = new RingLayer(clip, { slots: t.slots, step: t.step, who: "people", writesDepth: false });
  trails.every = t.every;
  trails.uniforms.uOpacity.value = t.gain;
  trails.uniforms.uFadeSize.value = 0.6;
  trails.uniforms.uSize.value = CONFIG.looks[state.look].splat ? 2.0 : 1.0;
  scene.add(trails.object);
  tuneCommon(trails);
}

/* ------------------------------------------------- the phone that filmed */

let gizmo, pathLine;
function buildRecorderGizmo() {
  // A small frustum, 16:9, 18 cm deep, in the phone's own frame.
  const d = 0.18, t = Math.tan(clip.side.fov[0] / 2) * d, w = t * 16 / 9;
  const c = [[-w, -t], [w, -t], [w, t], [-w, t]];
  const v = [];
  for (const [x, y] of c) v.push(0, 0, 0, x, y, -d);
  for (let i = 0; i < 4; i++) v.push(...c[i], -d, ...c[(i + 1) % 4], -d);
  v.push(-w * 0.4, t, -d, 0, t * 1.5, -d, 0, t * 1.5, -d, w * 0.4, t, -d);  // "up" tick
  const g = new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
  gizmo = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xf4f2ec, transparent: true, opacity: 0.4 }));
  gizmo.matrixAutoUpdate = false;
  overlay.add(gizmo);
  const pg = new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(clip.side.p, 3));
  pathLine = new THREE.Line(pg, new THREE.LineBasicMaterial({ color: 0xf4f2ec, transparent: true, opacity: 0.14 }));
  overlay.add(pathLine);
}

/* ------------------------------------------------------------------ views */

const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
function recorderAxes(f) {
  clip.pose(f, _m).decompose(_p, _q, _s);
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(_q);
  const up = new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(fwd, up).normalize();
  return { pos: _p.clone(), quat: _q.clone(), fwd, up, right };
}

function startView() {
  const a = recorderAxes(0);
  const flat = a.fwd.clone().setY(0).normalize();
  controls.target.copy(a.pos).addScaledVector(a.fwd, CONFIG.focusDistance);
  camera.position.copy(a.pos)
    .addScaledVector(flat, -CONFIG.startBack)
    .addScaledVector(a.up, CONFIG.startUp)
    .addScaledVector(a.right, CONFIG.startAside);
  camera.fov = CONFIG.fov;
  camera.updateProjectionMatrix();
  controls.update();
}

/** Put the viewer where the phone was. While following, it stays there. */
function throughRecorder() {
  const a = recorderAxes(clip.frame);
  camera.position.copy(a.pos);
  camera.quaternion.copy(a.quat);
  camera.fov = clip.fovDeg(clip.frame);
  camera.updateProjectionMatrix();
  controls.target.copy(a.pos).addScaledVector(a.fwd, CONFIG.focusDistance);
}

/* --------------------------------------------------------------------- UI */

function applyState() {
  for (const b of document.querySelectorAll("[data-look]")) b.setAttribute("aria-checked", String(b.dataset.look === state.look));
  for (const b of document.querySelectorAll("[data-toggle]")) b.setAttribute("aria-pressed", String(state[b.dataset.toggle]));
  $("follow").setAttribute("aria-pressed", String(state.follow));
  $("edges").textContent = CONFIG.edgeLabels[state.edges];
  controls.enabled = !state.follow;
  if (state.follow) throughRecorder();

  if (state.memory && !memory) buildMemory();
  if (!state.memory && memory) { scene.remove(memory.object); memory.dispose(); memory = null; }
  if (state.trails && !trails) buildTrails();
  if (!state.trails && trails) { scene.remove(trails.object); trails.dispose(); trails = null; }
  for (const l of layers()) tuneCommon(l);
  const splat = CONFIG.looks[state.look].splat;
  for (const l of [memory, trails]) if (l) l.uniforms.uSize.value = splat ? 2.0 : 1.0;

  gizmo.visible = pathLine.visible = state.camera && !state.follow;
  $("debug").hidden = !state.debug;

  // Keep the URL in step, without piling up history.
  const q = new URLSearchParams();
  if (state.look !== "punkter") q.set("look", state.look);
  for (const k of ["people", "memory", "trails", "follow"]) if (state[k]) q.set(k, "1");
  if (!state.camera) q.set("camera", "0");
  if (state.edges !== "snap") q.set("edges", state.edges);
  if (state.why) q.set("why", "");
  if (params.has("res")) q.set("res", String(state.res));
  if (state.debug) q.set("debug", "");
  history.replaceState(null, "", q.toString() ? `?${q}` : location.pathname);
}

for (const b of document.querySelectorAll("[data-look]")) {
  b.addEventListener("click", () => {
    if (state.look === b.dataset.look) return;
    state.look = b.dataset.look;
    buildLive();
    applyState();
  });
}
for (const b of document.querySelectorAll("[data-toggle]")) {
  b.addEventListener("click", () => { state[b.dataset.toggle] = !state[b.dataset.toggle]; applyState(); });
}
$("edges").addEventListener("click", () => {
  const order = Object.keys(CONFIG.edgeModes);
  state.edges = order[(order.indexOf(state.edges) + 1) % order.length];
  applyState();
});
$("follow").addEventListener("click", toggleFollow);
$("reset").addEventListener("click", () => { state.follow = false; applyState(); startView(); });

function toggleFollow() {
  state.follow = !state.follow;
  if (!state.follow) { camera.fov = CONFIG.fov; camera.updateProjectionMatrix(); }
  applyState();
}

const play = $("play"), scrub = $("scrub"), timeEl = $("time");
let scrubbing = false, resumeAfterScrub = false;
function setPlaying(on) {
  if (on) clip.video.play().catch(() => {}); else clip.video.pause();
}
function syncTransport() {
  const paused = clip.video.paused;
  play.textContent = paused ? "▶" : "❚❚";
  play.setAttribute("aria-label", paused ? "Spela" : "Pausa");
}
play.addEventListener("click", () => setPlaying(clip.video.paused));
scrub.addEventListener("pointerdown", () => { scrubbing = true; resumeAfterScrub = !clip.video.paused; clip.video.pause(); });
scrub.addEventListener("input", () => clip.seekFrame(+scrub.value));
const endScrub = () => { if (!scrubbing) return; scrubbing = false; if (resumeAfterScrub) setPlaying(true); };
scrub.addEventListener("pointerup", endScrub);
scrub.addEventListener("change", endScrub);
const speeds = [1, 0.5, 0.25];
$("speed").addEventListener("click", e => {
  const i = (speeds.indexOf(clip.video.playbackRate) + 1) % speeds.length;
  clip.video.playbackRate = speeds[i];
  e.currentTarget.textContent = `${String(speeds[i]).replace(".", ",")}×`;
});
$("loop").addEventListener("click", e => {
  clip.video.loop = !clip.video.loop;
  e.currentTarget.setAttribute("aria-pressed", String(clip.video.loop));
  if (clip.video.loop && clip.video.ended) setPlaying(true);
});

addEventListener("keydown", e => {
  if (e.target instanceof HTMLInputElement && e.key !== " ") return;
  if (e.key === " ") { e.preventDefault(); setPlaying(clip.video.paused); }
  else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
    e.preventDefault();
    clip.video.pause();
    clip.seekFrame(clip.frame + (e.key === "ArrowRight" ? 1 : -1) * (e.shiftKey ? 10 : 1));
  }
  else if (e.key === "f" || e.key === "F") toggleFollow();
  else if (e.key === "c" || e.key === "C") { state.camera = !state.camera; applyState(); }
  else if (e.key === "r" || e.key === "R") { state.follow = false; applyState(); startView(); }
});

/* ------------------------------------------------------------------- loop */

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  const db = renderer.getDrawingBufferSize(new THREE.Vector2());
  splats.setSize(db.x, db.y);
}
addEventListener("resize", resize);

let lastSerial = -1, fpsT = performance.now(), fpsN = 0, fps = 0, videoFrames = 0, vfps = 0;
let firstFrameMs = 0, readyMs = 0;
const bootT = performance.now();
const stats = $("stats"), debugEl = $("debug");

// A lost context (GPU reset, driver timeout) does not come back by itself here:
// say so instead of showing a frozen frame.
let contextLost = false;
canvas.addEventListener("webglcontextlost", e => {
  e.preventDefault();
  contextLost = true;
  const el = $("loading");
  el.classList.remove("gone");
  el.classList.add("error");
  el.querySelector("p").textContent = "Grafikkortet tappade sammanhanget (WebGL). Ladda om sidan.";
});

// Debug: GPU time per frame, where the browser exposes timer queries.
const gl = renderer.getContext();
const timer = state.debug ? gl.getExtension("EXT_disjoint_timer_query_webgl2") : null;
const queries = [];
let gpuMs = 0;
function gpuBegin() {
  if (!timer || queries.length > 4) return null;
  const q = gl.createQuery();
  gl.beginQuery(timer.TIME_ELAPSED_EXT, q);
  return q;
}
function gpuEnd(q) {
  if (!q) return;
  gl.endQuery(timer.TIME_ELAPSED_EXT);
  queries.push(q);
}
function gpuPoll() {
  while (queries.length && gl.getQueryParameter(queries[0], gl.QUERY_RESULT_AVAILABLE)) {
    const q = queries.shift();
    if (!gl.getParameter(timer.GPU_DISJOINT_EXT)) {
      const ms = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6;
      gpuMs = gpuMs ? gpuMs * 0.9 + ms * 0.1 : ms;
    }
    gl.deleteQuery(q);
  }
}

function loop(now) {
  requestAnimationFrame(loop);
  if (contextLost) return;
  clip.poll();
  if (timer) gpuPoll();
  const query = gpuBegin();
  if (canvas.width !== Math.floor(innerWidth * renderer.getPixelRatio())) resize();

  const fresh = clip.serial !== lastSerial;
  if (fresh) {
    lastSerial = clip.serial;
    videoFrames++;
    onNewFrame();
  }

  if (state.follow) throughRecorder();
  else controls.update();
  camera.updateMatrixWorld();

  // Pixels per metre at 1 m: what turns a world-space footprint into gl_PointSize.
  const db = renderer.getDrawingBufferSize(_v2);
  const projScale = db.y / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  for (const l of layers()) l.uniforms.uProjScale.value = projScale;

  renderer.setRenderTarget(null);
  renderer.clear();
  const look = CONFIG.looks[state.look];
  if (look.splat) {
    splats.render(renderer, scene, camera, layers());
  } else {
    for (const l of layers()) l.setPass(PASS.OPAQUE);
    renderer.render(scene, camera);
  }
  renderer.render(overlay, camera);
  gpuEnd(query);
  if (!firstFrameMs) {
    gl.finish();   // once: include shader compilation in the number
    firstFrameMs = performance.now() - bootT;
  }

  if (!scrubbing) scrub.value = String(clip.frame);
  timeEl.textContent = `${fmt(clip.frame / clip.fps)} / ${fmt(clip.duration)}`;
  syncTransport();

  fpsN++;
  if (now - fpsT > 1000) {
    fps = fpsN * 1000 / (now - fpsT);
    vfps = videoFrames * 1000 / (now - fpsT);
    fpsT = now; fpsN = 0; videoFrames = 0;
    const pts = layers().reduce((n, l) => n + (l.count ?? l.gw * l.gh * l.slots), 0);
    stats.textContent = `${fps.toFixed(0)} fps · video ${vfps.toFixed(0)} fps · ${(pts / 1e6).toFixed(2)} M punkter`;
    if (state.debug) showDebug();
  }
}
const _v2 = new THREE.Vector2();

function onNewFrame() {
  const f = clip.frame;
  gizmo.matrix.copy(clip.camToWorld);
  gizmo.matrixWorldNeedsUpdate = true;

  if (memory) {
    const slot = Math.floor(f / memory.every) % memory.slots;
    if (memory.slotFrame[slot] < 0) memory.capture(renderer, slot);
    // Slots far from now in the clip fade a little: the room "now" is strongest.
    memory.weigh((i, sf) => 1 - 0.45 * Math.min(1, Math.abs(sf - f) / clip.frames * 2));
  }
  if (trails) {
    const slot = Math.floor(f / trails.every) % trails.slots;
    if (trails.slotFrame[slot] !== f && (f % trails.every === 0 || Math.abs(trails.slotFrame[slot] - f) >= trails.every)) {
      trails.capture(renderer, slot);
    }
    const span = trails.slots * trails.every;
    trails.weigh((i, sf) => {
      const age = f - sf;
      return age <= 0 || age > span ? 0 : Math.pow(1 - age / (span + 1), 1.6);
    });
  }
  if (probe && f % 5 === 0) probe.check(renderer);
}

function showDebug() {
  const s = probe?.stats;
  const gl = renderer.getContext();
  const dbg = gl.getExtension("WEBGL_debug_renderer_info");
  debugEl.textContent = [
    `frame ${clip.frame}/${clip.frames}  rVFC ${clip.hasFrameCallback}`,
    timer ? `GPU ${gpuMs.toFixed(2)} ms/frame` : "GPU timer unavailable",
    s ? `sync: ${s.exact}/${s.checked} exact, ${s.bitFlip} bit flips, ${s.offByOne} off by one, ${s.miss} miss` : "",
    dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : "",
  ].join("\n");
}

function fmt(t) {
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}

// For headless checks and the console.
window.__mv = {
  get clip() { return clip; }, state, camera, controls, renderer, applyState, buildLive, startView,
  get probe() { return probe; },
  get fps() { return { fps, vfps, gpuMs, readyMs, firstFrameMs }; },
  setView(pos, target, fov = CONFIG.fov) {
    state.follow = false; applyState();
    camera.position.fromArray(pos); controls.target.fromArray(target);
    camera.fov = fov; camera.updateProjectionMatrix(); controls.update();
  },
  recorderAxes,
};

start().catch(err => {
  console.error(err);
  const el = $("loading");
  el.classList.add("error");
  el.querySelector("p").textContent = `Kunde inte starta: ${err.message}`;
});
