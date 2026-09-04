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

  /** How far the scan is washed back on the start page. Applied inside the
   *  render, under the ink, so painting stays pure black on top of it. */
  scanFade: 0.3,

  /** Ink. Held-key painting onto the scan — see the "Ink" section below. */
  ink: {
    /** Brush diameter as a fraction of the viewport height, so the brush keeps
     *  a constant size on screen whatever depth you are painting at. */
    brushSize: 0.055,
    /** Dab spacing along the stroke, as a fraction of the brush radius.
     *  Tight enough that the stamps read as one continuous mark. */
    spacing: 0.22,
    /** Pure black. Tusch has no grey in it — any per-dab colour variation
     *  immediately reads as spray rather than ink. */
    color: new THREE.Color(0x000000),
    /** Dabs are stretched along the direction of travel, so consecutive stamps
     *  drag into each other instead of reading as a row of blots. */
    elongation: 1.3,

    /** Speed to width, in px per second: a brush loaded and moving slowly lays
     *  down its full width, and thins out as it is drawn faster. */
    speedFat: 140,
    speedThin: 1700,
    minWidth: 0.2,
    maxWidth: 1.0,
    /** Per-dab opacity once the brush has thinned right out. Very low on
     *  purpose: dabs overlap roughly nine deep, so anything near 0.3 still
     *  composites to solid black. 0.08 stacks up to about half. */
    dryAlpha: 0.08,

    /** Dabs the stroke takes to open up to full width, and to lift off. */
    taperDabs: 7,
    liftDabs: 4,
    /** Chance per dab of the fast brush skipping — the broken edge you get
     *  when a real brush runs out of ink. */
    skipChance: 0.22,
    /** Kept rare: specks are the one genuinely spray-like thing here. */
    spatterChance: 0.004,
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
function makeDabTexture(size = 256) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  const mid = size / 2;

  // Hard almost to the rim. A soft gradient edge is what makes a stamp read as
  // airbrush; a brush leaves a definite boundary with ink right up to it.
  const grad = g.createRadialGradient(mid, mid, 0, mid, mid, mid);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.84, "rgba(255,255,255,1)");
  grad.addColorStop(0.95, "rgba(255,255,255,0.88)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);

  // Bristle streaks, running along X — which is the direction of travel once
  // the dab is oriented. Consecutive stamps share this texture and the same
  // alignment, so the gaps line up into continuous dry-brush striations
  // instead of averaging away into a solid blob.
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

  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  // No mipmaps. A dab draws far smaller on screen than this texture, and the
  // averaged mip levels blend the bristle gaps into a uniform half-alpha haze
  // — which is what was turning solid black ink into charcoal grey.
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

const inkGeometry = new THREE.PlaneGeometry(1, 1);

// Per-dab opacity. InstancedMesh has no such thing built in, so it rides along
// as an instanced attribute and is multiplied into the fragment alpha.
const inkAlpha = new THREE.InstancedBufferAttribute(
  new Float32Array(CONFIG.ink.maxDabs), 1);
inkAlpha.setUsage(THREE.DynamicDrawUsage);
inkGeometry.setAttribute("aInkAlpha", inkAlpha);

const inkMaterial = new THREE.MeshBasicMaterial({
  map: makeDabTexture(),
  color: CONFIG.ink.color,
  transparent: true,
  // Splats do not write depth, so there is no usable depth buffer to test
  // against. Draw the ink after them instead.
  depthTest: false,
  depthWrite: false,
  toneMapped: false,
});
inkMaterial.onBeforeCompile = (shader) => {
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>",
      "#include <common>\nattribute float aInkAlpha;\nvarying float vInkAlpha;")
    .replace("#include <begin_vertex>",
      "#include <begin_vertex>\n\tvInkAlpha = aInkAlpha;");
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <common>", "#include <common>\nvarying float vInkAlpha;")
    .replace("#include <map_fragment>",
      "#include <map_fragment>\n\tdiffuseColor.a *= vInkAlpha;");
};

const inkMesh = new THREE.InstancedMesh(inkGeometry, inkMaterial, CONFIG.ink.maxDabs);
inkMesh.count = 0;
inkMesh.frustumCulled = false;   // instances are placed far from the origin
inkMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

// The wash that fades the scan lives here rather than in the DOM. As a layer
// over the canvas it dimmed the ink along with everything else, and 30% of
// off-white over black is exactly the charcoal grey the ink kept coming out.
// Drawn between the scan and the ink, it fades only what is behind it.
const fadeScene = new THREE.Scene();
const fadeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const fadeMaterial = new THREE.MeshBasicMaterial({
  color: new THREE.Color(CONFIG.backgroundColor),
  transparent: true,
  opacity: CONFIG.scanFade,
  depthTest: false,
  depthWrite: false,
  toneMapped: false,
});
fadeScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), fadeMaterial));

// The ink gets its own scene, drawn in a second pass over the finished frame.
// Inside the main scene the splats were winning the draw order and blending
// over it, which is what kept the ink a washed charcoal instead of black —
// renderOrder does not help, because Spark draws its splats its own way.
// Authored in world space, so the mesh itself needs no transform.
const inkScene = new THREE.Scene();
inkScene.add(inkMesh);

const stroke = {
  active: false,
  plane: new THREE.Plane(),
  quaternion: new THREE.Quaternion(),
  radius: 0.1,
  lastScreen: new THREE.Vector2(),
  lastTime: 0,
  direction: new THREE.Vector3(),
  right: new THREE.Vector3(),
  up: new THREE.Vector3(),
  width: 1,
  carry: 0,
  dabs: 0,
  /** Every sampled point of this stroke, so the path can be curved through
   *  them rather than joined corner to corner. */
  points: [],
};
let inkDabs = 0;
let inkDirty = false;

const ndc = new THREE.Vector2();
const UNIT_Z = new THREE.Vector3(0, 0, 1);
const scratch = {
  point: new THREE.Vector3(),
  curve: new THREE.Vector3(),
  prev: new THREE.Vector3(),
  dir: new THREE.Vector3(),
  at: new THREE.Vector3(),
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

/** The stroke's heading, as an angle in the plane's own axes. */
function dabAngle() {
  if (stroke.direction.lengthSq() < 1e-12) return 0;
  return Math.atan2(stroke.direction.dot(stroke.up), stroke.direction.dot(stroke.right));
}

/** Stamp one brush dab. `scale` is a multiple of the stroke's brush radius. */
function dab(center, scale) {
  if (inkDabs >= CONFIG.ink.maxDabs) return;
  const size = Math.max(stroke.radius * scale, 1e-4) * 2;
  // Turn the dab so the texture's bristle streaks run along the stroke.
  scratch.roll.setFromAxisAngle(UNIT_Z, dabAngle());
  scratch.quaternion.copy(stroke.quaternion).multiply(scratch.roll);
  scratch.scale.set(size * CONFIG.ink.elongation, size, 1);
  scratch.matrix.compose(center, scratch.quaternion, scratch.scale);
  inkMesh.setMatrixAt(inkDabs, scratch.matrix);
  // A thinned-out brush carries less ink, so the surface shows through it.
  // Taper and lift-off ride on this too, since both come through `scale`.
  const load = THREE.MathUtils.clamp(
    (scale - CONFIG.ink.minWidth) / (CONFIG.ink.maxWidth - CONFIG.ink.minWidth), 0, 1);
  inkAlpha.setX(inkDabs, THREE.MathUtils.clamp(
    THREE.MathUtils.lerp(CONFIG.ink.dryAlpha, 1, Math.pow(load, 0.35)) *
      (0.9 + Math.random() * 0.2), 0.05, 1));
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
  raycaster.setFromCamera(toNdc(clientX, clientY), camera);
  let point = null;
  if (splatMesh) {
    scene.updateMatrixWorld();
    const hits = [];
    splatMesh.raycast(raycaster, hits);
    let nearest = null;
    for (const hit of hits) {
      if (!nearest || hit.distance < nearest.distance) nearest = hit;
    }
    if (nearest) point = nearest.point.clone();
  }

  // Nothing under the cursor — looking out of a window, or off the end of the
  // capture. Fall back to the pivot's depth, but along the cursor's own ray.
  // Using the centre of the view instead started the stroke mid-screen and
  // dragged a diagonal across to wherever the brush had actually been put down.
  if (!point) {
    point = raycaster.ray.at(rig.position.distanceTo(rig.target), new THREE.Vector3());
  }

  // The camera's +Z points back towards the viewer, so dabs laid out on this
  // plane face you as you paint them.
  const normal = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 2).normalize();

  const distance = camera.position.distanceTo(point);

  stroke.plane.setFromNormalAndCoplanarPoint(normal, point);
  // An explicit basis, so a dab can be rolled to face along the stroke.
  stroke.right.setFromMatrixColumn(camera.matrix, 0).normalize();
  stroke.up.setFromMatrixColumn(camera.matrix, 1).normalize();
  scratch.matrix.makeBasis(stroke.right, stroke.up, normal);
  stroke.quaternion.setFromRotationMatrix(scratch.matrix);
  const visibleHeight = 2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
  stroke.radius = visibleHeight * CONFIG.ink.brushSize * 0.5;

  stroke.active = true;
  stroke.points = [point.clone()];
  stroke.lastScreen.set(clientX, clientY);
  stroke.lastTime = performance.now();
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

/** A stroke point, with the ends clamped so the curve has controls to work
 *  with at the very start and finish. */
function strokePoint(i) {
  const n = stroke.points.length;
  return stroke.points[THREE.MathUtils.clamp(i, 0, n - 1)];
}

/** Catmull-Rom position along the span from point i to point i+1. Pointer
 *  samples arrive far apart when the hand moves quickly; joining them with
 *  straight lines is what made fast strokes come out as polygons. */
function curveAt(i, t, out) {
  const p0 = strokePoint(i - 1);
  const p1 = strokePoint(i);
  const p2 = strokePoint(i + 1);
  const p3 = strokePoint(i + 2);
  const t2 = t * t;
  const t3 = t2 * t;
  return out.set(0, 0, 0)
    .addScaledVector(p0, -0.5 * t3 + t2 - 0.5 * t)
    .addScaledVector(p1, 1.5 * t3 - 2.5 * t2 + 1)
    .addScaledVector(p2, -1.5 * t3 + 2 * t2 + 0.5 * t)
    .addScaledVector(p3, 0.5 * t3 - 0.5 * t2);
}

/** Lay dabs along the curved span from point i to point i+1, at even spacing,
 *  carrying the remainder so spacing stays even across span boundaries. */
function emitSpan(i) {
  const chord = strokePoint(i).distanceTo(strokePoint(i + 1));
  if (chord < 1e-7) return;

  const step = Math.max(stroke.radius * CONFIG.ink.spacing * stroke.width, 1e-4);
  // Walk the curve finely enough that its bend is followed, not chorded.
  const sub = THREE.MathUtils.clamp(Math.ceil((chord / step) * 3), 6, 64);

  curveAt(i, 0, scratch.prev);
  for (let k = 1; k <= sub; k++) {
    curveAt(i, k / sub, scratch.curve);
    const length = scratch.prev.distanceTo(scratch.curve);
    if (length > 1e-9) {
      scratch.dir.copy(scratch.curve).sub(scratch.prev).divideScalar(length);
      stroke.direction.copy(scratch.dir);

      let travelled = step - stroke.carry;
      while (travelled <= length) {
        scratch.at.copy(scratch.prev).addScaledVector(scratch.dir, travelled);
        const dry = stroke.width < 0.62 && Math.random() < CONFIG.ink.skipChance;
        if (!dry) {
          dab(scratch.at, taperedWidth());
          if (Math.random() < CONFIG.ink.spatterChance) spatter(scratch.at);
        }
        stroke.dabs += 1;
        travelled += step;
      }
      stroke.carry = length - (travelled - step);
    }
    scratch.prev.copy(scratch.curve);
  }
}

function extendStroke(clientX, clientY) {
  if (!stroke.active) return;
  raycaster.setFromCamera(toNdc(clientX, clientY), camera);
  const hit = raycaster.ray.intersectPlane(stroke.plane, scratch.point);
  if (!hit) return;                          // stroke has swung past the horizon

  // Slow and loaded lays down full width; drawn fast the brush thins out.
  // Measured per second, because pointer event rate varies with the hardware.
  const now = performance.now();
  const speed = Math.hypot(clientX - stroke.lastScreen.x, clientY - stroke.lastScreen.y) /
    Math.max(now - stroke.lastTime, 1) * 1000;
  const t = THREE.MathUtils.clamp(
    (speed - CONFIG.ink.speedFat) / (CONFIG.ink.speedThin - CONFIG.ink.speedFat), 0, 1);
  const wanted = THREE.MathUtils.lerp(
    CONFIG.ink.maxWidth, CONFIG.ink.minWidth, Math.pow(t, 0.65));
  stroke.width += (wanted - stroke.width) * 0.3;
  stroke.lastTime = now;
  stroke.lastScreen.set(clientX, clientY);

  const last = stroke.points[stroke.points.length - 1];
  if (last && last.distanceToSquared(hit) < 1e-10) return;
  stroke.points.push(hit.clone());

  // Draw the span that now has a neighbour on both sides. That costs one
  // sample of lag and buys a curve that bends through the points.
  if (stroke.points.length >= 3) emitSpan(stroke.points.length - 3);
}

/** Lift-off: a short tail that shrinks to nothing, the way a brush leaves. */
function endStroke() {
  if (!stroke.active) return;
  // The last span is still unpainted: extendStroke always runs one behind.
  if (stroke.points.length >= 2) emitSpan(stroke.points.length - 2);
  if (stroke.dabs > 0 && stroke.direction.lengthSq() > 0) {
    const step = stroke.radius * CONFIG.ink.spacing * stroke.width;
    const tip = strokePoint(stroke.points.length - 1);
    for (let i = 1; i <= CONFIG.ink.liftDabs; i++) {
      const fade = 1 - i / (CONFIG.ink.liftDabs + 1);
      dab(scratch.at.copy(tip).addScaledVector(stroke.direction, step * i),
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
    inkAlpha.needsUpdate = true;
    inkDirty = false;
  }
  renderer.render(scene, camera);
  renderer.autoClear = false;
  if (fadeMaterial.opacity > 0) renderer.render(fadeScene, fadeCamera);
  if (inkMesh.count > 0) renderer.render(inkScene, camera);
  renderer.autoClear = true;

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
