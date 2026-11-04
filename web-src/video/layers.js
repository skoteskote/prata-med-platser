import * as THREE from "three";
import { DECODE_GLSL, QUAD_W, QUAD_H } from "./metavido.js";

/* ==========================================================================
 *  What gets drawn, and how.
 *
 *  Every layer is drawn in one of three passes:
 *    OPAQUE  plain depth-tested points (the "Punkter" look)
 *    DEPTH   depth only, pushed back a little — the visibility pre-pass of
 *            surface splatting
 *    ACCUM   soft gaussian weights, added up in a float target: (rgb*w, w)
 *  ...and Splats.resolve() divides the sum by the weight. Splats within the
 *  depth bias of the front surface blend into one continuous surface; splats
 *  further back fail the depth test. That is the classic EWA visibility trick,
 *  and it needs no sorting, so it costs the same at a million splats as at ten.
 * ========================================================================== */

export const PASS = { OPAQUE: 0, DEPTH: 1, ACCUM: 2 };
const PASS_DEFINE = ["PASS_OPAQUE", "PASS_DEPTH", "PASS_ACCUM"];

const OFFSCREEN = "vec4(0.0, 0.0, -2.0, 1.0)";  // in front of the near plane: clipped

/** Uniforms every reconstructed layer has, besides its clip's. */
function commonUniforms() {
  return {
    uMaxDepth: { value: 8 },
    uEdge: { value: 8 },
    uCurve: { value: 0.15 },
    uEdgeMode: { value: 2 },
    uWhy: { value: 0 },
    uSize: { value: 1 },
    uSharp: { value: 2.5 },
    uProjScale: { value: 500 },
    // x people gain, y room gain, z fraction of room samples kept, w people size factor
    uPeople: { value: new THREE.Vector4(1, 1, 1, 1) },
    uDepthBias: { value: 0.015 },
    uOpacity: { value: 1 },
  };
}

const FRAG = /* glsl */ `
in vec3 vColor;
in float vWeight;
#ifdef PRIM_SURFEL
in vec2 vCorner;
#else
in float vPx;
#endif
uniform float uSharp;
void main() {
#ifdef PRIM_SURFEL
  vec2 c = vCorner;
  float r2 = dot(c, c);
  if (r2 > 1.0) discard;
#else
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(c, c);
  // A sprite of a pixel or two is a square anyway: cutting it round only
  // leaves holes between neighbours.
  if (r2 > 1.0 && vPx > 3.0) discard;
#endif
#if defined(PASS_ACCUM)
  float w = exp(-r2 * uSharp) * vWeight;
  gl_FragColor = vec4(vColor * w, w);
#elif defined(PASS_DEPTH)
  gl_FragColor = vec4(0.0);
#else
  gl_FragColor = vec4(vColor * vWeight, 1.0);
#endif
}
`;

function passMaterial(pass, { vertexShader, uniforms, defines }) {
  const m = new THREE.ShaderMaterial({
    // No GLSL3 flag: three then still compiles #version 300 es, and maps gl_FragColor.
    vertexShader,
    fragmentShader: FRAG,
    uniforms,
    defines: { ...defines, [PASS_DEFINE[pass]]: "" },
  });
  if (pass === PASS.DEPTH) {
    m.colorWrite = false;
  } else if (pass === PASS.ACCUM) {
    m.transparent = true;
    m.depthWrite = false;
    m.blending = THREE.CustomBlending;
    m.blendEquation = THREE.AddEquation;
    m.blendSrc = m.blendSrcAlpha = THREE.OneFactor;
    m.blendDst = m.blendDstAlpha = THREE.OneFactor;
  }
  return m;
}

/** Base: a Points or instanced-quad object with one material per pass. */
class Layer {
  constructor(object, materials, { writesDepth = true } = {}) {
    this.object = object;
    this.materials = materials;
    this.writesDepth = writesDepth;
    this.enabled = true;
    object.frustumCulled = false;
    object.matrixAutoUpdate = false;
    // Positions are computed on the GPU; give three a bound so it never tries to
    // derive one from the placeholder attribute.
    object.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
  }
  get uniforms() { return this.materials[0].uniforms; }
  setPass(pass) {
    this.object.material = this.materials[pass];
    this.object.visible = this.enabled && (pass !== PASS.DEPTH || this.writesDepth);
  }
  dispose() {
    this.object.geometry.dispose();
    for (const m of this.materials) m.dispose();
  }
}

/* --------------------------------------------------------------------------
 *  The live frame, reconstructed straight out of the video texture.
 *  primitive: "points"  round sprites sized to the depth pixel's footprint
 *             "surfels" quads lying in the surface, spanned by the
 *                       neighbouring samples (so they stretch on slopes)
 * ------------------------------------------------------------------------ */
const LIVE_VERT = /* glsl */ `
${DECODE_GLSL}
uniform int uStep;
uniform int uGridW;
uniform float uSize;
uniform float uProjScale;
uniform vec4 uPeople;
uniform float uDepthBias;
uniform float uOpacity;
uniform int uWhy;   // debug: tint edge samples (snapped magenta / dropped red), people green
out vec3 vColor;
out float vWeight;
#ifdef PRIM_SURFEL
out vec2 vCorner;
#else
out float vPx;
#endif

void main() {
#ifdef PRIM_SURFEL
  int id = gl_InstanceID;
#else
  int id = gl_VertexID;
#endif
  ivec2 q = ivec2(id % uGridW, id / uGridW) * uStep + uStep / 2;
  MtvdSample s = mtvdSample(q, float(uStep));
  bool person = s.stencil > 0.5;
  bool ok = s.ok && mtvdHash(vec2(q)) < (person ? 1.0 : uPeople.z);
  float size = uSize * (person ? uPeople.w : 1.0);
  vColor = mtvdColor(s.uv) * (person ? uPeople.x : uPeople.y);
  vWeight = uOpacity;
  if (uWhy == 1) {
    if (s.edge) vColor = uEdgeMode == 2 ? vec3(1.0, 0.2, 1.0) : vec3(1.0, 0.1, 0.1);
    else if (person) vColor = mix(vColor, vec3(0.2, 1.0, 0.3), 0.5);
    if (s.edge && uEdgeMode == 1 && s.z < uMaxDepth) ok = true;   // show what would be dropped
  }
#ifdef PRIM_SURFEL
  vCorner = position.xy;
  vec4 mv = modelViewMatrix * vec4(s.world + (position.x * s.tu + position.y * s.tv) * 0.5 * size, 1.0);
#else
  vec4 mv = modelViewMatrix * vec4(s.world, 1.0);
  float footprint = float(uStep) * 2.0 * uRay.w / QH * s.z;   // metres covered by one grid cell
  gl_PointSize = clamp(size * footprint * uProjScale / max(-mv.z, 0.05), 1.0, 96.0);
  vPx = gl_PointSize;
#endif
#ifdef PASS_DEPTH
  mv.xyz += normalize(mv.xyz) * uDepthBias * -mv.z;
#endif
  gl_Position = ok ? projectionMatrix * mv : ${OFFSCREEN};
}
`;

export class LiveLayer extends Layer {
  constructor(clip, { primitive = "points", step = 1 } = {}) {
    const gw = Math.floor(QUAD_W / step), gh = Math.floor(QUAD_H / step);
    const count = gw * gh;
    const uniforms = {
      ...clip.uniforms,
      ...commonUniforms(),
      uStep: { value: step },
      uGridW: { value: gw },
    };
    let geometry, object;
    const defines = primitive === "surfels" ? { PRIM_SURFEL: "" } : {};
    const materials = [PASS.OPAQUE, PASS.DEPTH, PASS.ACCUM].map(p =>
      passMaterial(p, { vertexShader: LIVE_VERT, uniforms, defines }));
    if (primitive === "surfels") {
      geometry = new THREE.InstancedBufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(
        [-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
      geometry.setIndex([0, 1, 2, 0, 2, 3]);
      geometry.instanceCount = count;
      object = new THREE.Mesh(geometry, materials[0]);
    } else {
      // Positions come from gl_VertexID; the attribute only sets the count.
      geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(new Uint8Array(count), 1));
      object = new THREE.Points(geometry, materials[0]);
    }
    super(object, materials);
    this.clip = clip;
    this.primitive = primitive;
    this.step = step;
    this.count = count;
  }
}

/* --------------------------------------------------------------------------
 *  A ring of past frames, kept as world-space samples on the GPU.
 *
 *  Each slot is one layer of a float array texture, gw x gh texels: xyz in
 *  clip world, w = packed 8-bit RGB + 1, negative for people, 0 for nothing.
 *  capture() decodes the current video frame into a slot; the layer draws
 *  every filled slot in a single call, weighted per slot.
 * ------------------------------------------------------------------------ */
const CAPTURE_FRAG = /* glsl */ `
${DECODE_GLSL}
uniform int uStep;
uniform int uWho;   // 0 room only, 1 people only, 2 everything
void main() {
  ivec2 cell = ivec2(gl_FragCoord.xy);
  ivec2 q = cell * uStep + uStep / 2;
  MtvdSample s = mtvdSample(q, float(uStep));
  bool person = s.stencil > 0.5;
  bool want = uWho == 2 || ((uWho == 1) == person);
  // The room memory keeps only what is surely room: next to a silhouette the
  // colour is often still the person's, and kept for the whole clip that
  // draws dark outlines of everyone onto the walls.
  if (uWho == 0 && (s.edge || s.boundary)) want = false;
  if (!s.ok || !want) { gl_FragColor = vec4(0.0); return; }
  vec3 c = floor(clamp(mtvdColor(s.uv), 0.0, 1.0) * 255.0 + 0.5);
  float packed = c.r * 65536.0 + c.g * 256.0 + c.b + 1.0;
  gl_FragColor = vec4(s.world, person ? -packed : packed);
}
`;

const RING_VERT = /* glsl */ `
uniform highp sampler2DArray uRing;
uniform int uGridW;
uniform int uGridH;
uniform vec4 uSlotWeight[MAX_SLOTS / 4];
uniform float uWorldSize;   // splat diameter in metres
uniform float uSize;
uniform float uFadeSize;    // 0: weight only fades colour, 1: also shrinks the splat
uniform float uProjScale;
uniform vec4 uPeople;
uniform float uDepthBias;
uniform float uOpacity;
uniform vec3 uTint;
out vec3 vColor;
out float vWeight;
out float vPx;

void main() {
  int per = uGridW * uGridH;
  int slot = gl_VertexID / per;
  int cell = gl_VertexID - slot * per;
  vec4 t = texelFetch(uRing, ivec3(cell % uGridW, cell / uGridW, slot), 0);
  float w = uSlotWeight[slot >> 2][slot & 3];
  if (t.w == 0.0 || w <= 0.0) { gl_Position = ${OFFSCREEN}; return; }
  float packed = abs(t.w) - 1.0;
  vec3 col = vec3(floor(packed / 65536.0), mod(floor(packed / 256.0), 256.0), mod(packed, 256.0)) / 255.0;
  bool person = t.w < 0.0;
  vColor = col * uTint * (person ? uPeople.x : uPeople.y);
  vWeight = w * uOpacity;
  vec4 mv = modelViewMatrix * vec4(t.xyz, 1.0);
  gl_PointSize = clamp(uSize * uWorldSize * mix(1.0, w, uFadeSize) * uProjScale / max(-mv.z, 0.05), 1.0, 64.0);
  vPx = gl_PointSize;
#ifdef PASS_DEPTH
  mv.xyz += normalize(mv.xyz) * uDepthBias * -mv.z;
#endif
  gl_Position = projectionMatrix * mv;
}
`;

export class RingLayer extends Layer {
  /**
   * @param who   "room" | "people" | "all": which samples a capture keeps
   * @param step  depth pixels per grid cell
   */
  constructor(clip, { slots, step = 4, who = "room", writesDepth = true } = {}) {
    const maxSlots = Math.ceil(slots / 4) * 4;
    const gw = Math.floor(QUAD_W / step), gh = Math.floor(QUAD_H / step);
    const target = new THREE.WebGLArrayRenderTarget(gw, gh, slots, {
      type: THREE.FloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: false,
      generateMipmaps: false,
    });
    const uniforms = {
      ...commonUniforms(),
      uRing: { value: target.texture },
      uGridW: { value: gw },
      uGridH: { value: gh },
      uSlotWeight: { value: Array.from({ length: maxSlots / 4 }, () => new THREE.Vector4()) },
      uWorldSize: { value: 0.012 * step / 2 },
      uFadeSize: { value: 0 },
      uTint: { value: new THREE.Color(1, 1, 1) },
    };
    const defines = { MAX_SLOTS: maxSlots };
    const materials = [PASS.OPAQUE, PASS.DEPTH, PASS.ACCUM].map(p =>
      passMaterial(p, { vertexShader: RING_VERT, uniforms, defines }));
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Uint8Array(gw * gh * slots), 1));
    super(new THREE.Points(geometry, materials[0]), materials, { writesDepth });

    this.clip = clip;
    this.target = target;
    this.slots = slots;
    this.gw = gw;
    this.gh = gh;
    /** Video frame held in each slot, or -1. */
    this.slotFrame = new Int32Array(slots).fill(-1);

    this._capture = new THREE.Mesh(
      new THREE.BufferGeometry().setAttribute("position",
        new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3)),
      new THREE.ShaderMaterial({
        // No GLSL3 flag: three then still compiles #version 300 es, and maps gl_FragColor.
        vertexShader: "void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }",
        fragmentShader: CAPTURE_FRAG,
        uniforms: {
          ...clip.uniforms,
          uMaxDepth: uniforms.uMaxDepth,
          uEdge: uniforms.uEdge,
          uCurve: uniforms.uCurve,
          uEdgeMode: uniforms.uEdgeMode,
          uStep: { value: step },
          uWho: { value: { room: 0, people: 1, all: 2 }[who] },
        },
        depthTest: false,
        depthWrite: false,
      }));
    this._capture.frustumCulled = false;
    this._captureScene = new THREE.Scene().add(this._capture);
    this._captureCam = new THREE.Camera();
  }

  /** Decode the clip's current frame into `slot`. */
  capture(renderer, slot) {
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.target, slot);
    renderer.render(this._captureScene, this._captureCam);
    renderer.setRenderTarget(prev);
    this.slotFrame[slot] = this.clip.frame;
  }

  /** weight(slot, frameInSlot) -> 0..1 for each slot; empty slots stay 0. */
  weigh(fn) {
    const v = this.uniforms.uSlotWeight.value;
    for (let i = 0; i < this.slots; i++) {
      const f = this.slotFrame[i];
      v[i >> 2].setComponent(i & 3, f < 0 ? 0 : Math.max(0, fn(i, f)));
    }
  }

  clear() {
    this.slotFrame.fill(-1);
  }

  dispose() {
    super.dispose();
    this.target.dispose();
    this._capture.geometry.dispose();
    this._capture.material.dispose();
  }
}

/* --------------------------------------------------------------------------
 *  Surface splatting: depth pre-pass, weighted accumulation, normalisation.
 * ------------------------------------------------------------------------ */
export class Splats {
  constructor() {
    this.target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
      generateMipmaps: false,
    });
    this.resolveMaterial = new THREE.ShaderMaterial({
      // No GLSL3 flag: three then still compiles #version 300 es, and maps gl_FragColor.
      vertexShader: "out vec2 vUv; void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }",
      fragmentShader: /* glsl */ `
        uniform sampler2D uAcc;
        uniform float uCoverage;
        in vec2 vUv;
        void main() {
          vec4 a = texture(uAcc, vUv);
          if (a.a < 1e-4) discard;
          gl_FragColor = vec4(a.rgb / a.a, 1.0 - exp(-a.a * uCoverage));
        }`,
      uniforms: { uAcc: { value: this.target.texture }, uCoverage: { value: 3 } },
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const quad = new THREE.Mesh(
      new THREE.BufferGeometry().setAttribute("position",
        new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3)),
      this.resolveMaterial);
    quad.frustumCulled = false;
    this.scene = new THREE.Scene().add(quad);
    this.camera = new THREE.Camera();
  }

  setSize(w, h) {
    this.target.setSize(w, h);
  }

  /** Draw `layers` (which live in `scene`) as splats onto the current target. */
  render(renderer, scene, camera, layers) {
    const out = renderer.getRenderTarget();
    const clear = new THREE.Color();
    renderer.getClearColor(clear);
    const clearAlpha = renderer.getClearAlpha();

    renderer.setRenderTarget(this.target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, false);
    for (const l of layers) l.setPass(PASS.DEPTH);
    renderer.render(scene, camera);
    for (const l of layers) l.setPass(PASS.ACCUM);
    renderer.render(scene, camera);

    renderer.setRenderTarget(out);
    renderer.setClearColor(clear, clearAlpha);
    renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.target.dispose();
    this.resolveMaterial.dispose();
  }
}

/* --------------------------------------------------------------------------
 *  Debug: read frame-sync and colour decode back from the GPU.
 * ------------------------------------------------------------------------ */
export class Probe {
  constructor(clip) {
    this.clip = clip;
    this.target = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false });
    this.material = new THREE.ShaderMaterial({
      // No GLSL3 flag: three then still compiles #version 300 es, and maps gl_FragColor.
      vertexShader: "void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }",
      // The hash lane (lane 11) of the barcode, exactly as Decoder.compute reads it.
      fragmentShader: /* glsl */ `
        uniform sampler2D uFrame;
        void main() {
          uint acc = 0u;
          for (int i = 0; i < 32; i++) {
            int y = i * 8 + 4;
            float b = texelFetch(uFrame, ivec2(11 * 8 + 3, y), 0).b + texelFetch(uFrame, ivec2(11 * 8 + 5, y), 0).b;
            if (b > 0.4) acc |= 1u << uint(i);
          }
          gl_FragColor = vec4(float(acc & 255u), float((acc >> 8u) & 255u), float((acc >> 16u) & 255u), float(acc >> 24u)) / 255.0;
        }`,
      uniforms: { uFrame: clip.uniforms.uFrame },
      depthTest: false,
      depthWrite: false,
    });
    const quad = new THREE.Mesh(
      new THREE.BufferGeometry().setAttribute("position",
        new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3)),
      this.material);
    quad.frustumCulled = false;
    this.scene = new THREE.Scene().add(quad);
    this.camera = new THREE.Camera();
    this._px = new Uint8Array(4);
    this._f32 = new Float32Array(1);
    this._u32 = new Uint32Array(this._f32.buffer);
    this.stats = { checked: 0, exact: 0, bitFlip: 0, offByOne: 0, miss: 0, misses: [] };
  }

  /** Hash bits in the texture right now vs the sidecar's at frames f-1, f, f+1. */
  check(renderer) {
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.target);
    renderer.render(this.scene, this.camera);
    renderer.readRenderTargetPixels(this.target, 0, 0, 1, 1, this._px);
    renderer.setRenderTarget(prev);
    const got = (this._px[0] | (this._px[1] << 8) | (this._px[2] << 16) | (this._px[3] << 24)) >>> 0;
    const f = this.clip.frame, h = this.clip.side.hash;
    const bitsAt = i => { this._f32[0] = h[i]; return this._u32[0]; };
    const ham = (a, b) => { let x = (a ^ b) >>> 0, n = 0; while (x) { n += x & 1; x >>>= 1; } return n; };
    const s = this.stats;
    s.checked++;
    const d0 = ham(got, bitsAt(f));
    if (d0 === 0) s.exact++;
    else if (d0 <= 2) s.bitFlip++;
    else if ((f > 0 && ham(got, bitsAt(f - 1)) <= 2) || (f + 1 < h.length && ham(got, bitsAt(f + 1)) <= 2)) {
      s.offByOne++;
      if (s.misses.length < 20) s.misses.push({ frame: f, kind: "off-by-one" });
    } else {
      s.miss++;
      if (s.misses.length < 20) s.misses.push({ frame: f, kind: "miss" });
    }
    return s;
  }

  /** Mean max/min channel over the depth quadrant: a correct YUV decode gives 1 / 0. */
  colourCheck(renderer) {
    const w = 960, h = 540;
    const rt = new THREE.WebGLRenderTarget(w, h, { depthBuffer: false });
    const m = new THREE.ShaderMaterial({
      // No GLSL3 flag: three then still compiles #version 300 es, and maps gl_FragColor.
      vertexShader: "void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }",
      fragmentShader: "uniform sampler2D uFrame; void main() { gl_FragColor = vec4(texelFetch(uFrame, ivec2(gl_FragCoord.xy) + ivec2(0, 540), 0).rgb, 1.0); }",
      uniforms: { uFrame: this.clip.uniforms.uFrame },
      depthTest: false,
    });
    const mesh = this.scene.children[0];
    const keep = mesh.material;
    mesh.material = m;
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(rt);
    renderer.render(this.scene, this.camera);
    const px = new Uint8Array(w * h * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, w, h, px);
    renderer.setRenderTarget(prev);
    mesh.material = keep;
    m.dispose();
    rt.dispose();
    // Rows bottom-up: row y is image row 539 - y of the depth quadrant.
    this.lastQuadrant = { w, h, frame: this.clip.frame, px };
    let n = 0, sMax = 0, sMin = 0, qMax = 0, qMin = 0;
    for (let y = 20; y < h - 20; y += 2) for (let x = 20; x < w - 20; x += 2) {
      const i = (y * w + x) * 4;
      const r = px[i] / 255, g = px[i + 1] / 255, b = px[i + 2] / 255;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      sMax += mx; sMin += mn; qMax += mx * mx; qMin += mn * mn; n++;
    }
    const mMax = sMax / n, mMin = sMin / n;
    return { maxMean: mMax, maxSd: Math.sqrt(qMax / n - mMax * mMax), minMean: mMin, minSd: Math.sqrt(qMin / n - mMin * mMin) };
  }
}
