import * as THREE from "three";

/* ==========================================================================
 *  Metavido in the browser.
 *
 *  A Metavido frame is 1920x1080 and packs four things (keijiro/Metavido):
 *
 *    +---------+---------+   C  colour, squeezed 2:1 into the right half
 *    |    Z    |         |   Z  depth, hue-encoded, 960x540
 *    +---------+    C    |   S  human stencil (red), 960x540
 *    |   S/M   |         |   M  metadata barcode (blue), bottom-left 96x256
 *    +---------+---------+
 *
 *  The barcode is NOT read here. scripts/metavido_clip.py reads it out of the
 *  source recording at build time and writes a sidecar with one pose per frame
 *  (see METAVIDO.md for why; and re-encoding for the web flips a barcode bit
 *  now and then, which would ruin a frame if it were decoded from this file).
 *  The browser looks the pose up by frame number, from requestVideoFrameCallback.
 *
 *  The video is uploaded as one texture with flipY, so texel row 0 is the
 *  bottom of the frame — the same v-up convention as Unity's uv, which lets the
 *  decode below follow keijiro's HLSL line for line.
 * ========================================================================== */

export const FRAME_W = 1920;
export const FRAME_H = 1080;
export const QUAD_W = 960;   // depth / stencil quadrant
export const QUAD_H = 540;

/** GLSL shared by every shader that reconstructs points from a frame. */
export const DECODE_GLSL = /* glsl */ `
uniform sampler2D uFrame;     // the whole Metavido frame, v up
uniform mat4 uCamToWorld;     // recording camera -> clip world (three.js convention)
uniform vec4 uRay;            // centre shift xy, tan(fov/2)*16/9, tan(fov/2)
uniform vec2 uRange;          // depth range: near, far
uniform float uMaxDepth;      // drop samples further than this (metres)
uniform float uEdge;          // max surface slope, tan(angle to the view ray), before a sample is an edge
uniform float uCurve;         // max curvature of inverse depth before a sample is an edge
uniform int uEdgeMode;        // what to do with edge samples: 0 keep, 1 drop, 2 snap to a side

const float QW = ${QUAD_W}.0;
const float QH = ${QUAD_H}.0;

// mtvd_RGB2Hue + mtvd_DecodeDepth, keijiro/Metavido Common/Shaders/Common.hlsl
float mtvdHue(vec3 c) {
  float minc = min(min(c.r, c.g), c.b);
  float maxc = max(max(c.r, c.g), c.b);
  float div = 1.0 / (6.0 * max(maxc - minc, 1e-5));
  float r = (c.g - c.b) * div;
  float g = 1.0 / 3.0 + (c.b - c.r) * div;
  float b = 2.0 / 3.0 + (c.r - c.g) * div;
  float d = mix(r, mix(g, b, float(c.g < c.b)), float(c.r < max(c.g, c.b)));
  return fract(d + 1.0 - 0.005) + 0.005;
}

// q: pixel in the depth quadrant, x right, y up from the quadrant's bottom edge.
// Kept a few pixels off the seams with the colour half and the S/M quadrant,
// where compression bleeds one into the other (the Unity decoder's _Margin).
float mtvdDepth(ivec2 q) {
  q = clamp(q, ivec2(0, 3), ivec2(int(QW) - 4, int(QH) - 1));
  vec3 rgb = texelFetch(uFrame, ivec2(q.x, q.y + int(QH)), 0).rgb;
  float d = mtvdHue(rgb);
  d = (d - 0.01) / 0.98;   // margin
  d = (d - 0.01) / 0.98;   // padding
  return mix(uRange.x, uRange.y, d);
}

// Human stencil, with Demux.shader's compression noise filter.
float mtvdStencil(ivec2 q) {
  q = clamp(q, ivec2(0), ivec2(int(QW) - 4, int(QH) - 4));
  return clamp(texelFetch(uFrame, q, 0).r * 1.1 - 0.1, 0.0, 1.0);
}

// Colour at depth-quadrant uv. Linear filtering, kept off the left seam.
vec3 mtvdColor(vec2 uv) {
  return texture(uFrame, vec2(0.5 + 0.5 * max(uv.x, 1.5 / QW), uv.y)).rgb;
}

// Camera-space position (three.js: camera looks down -Z) for uv at depth z.
// mtvd_DistanceToWorldPosition, keijiro/Metavido Decoder/Shaders/Utils.hlsl.
vec3 mtvdCamPos(vec2 uv, float z) {
  return vec3(((uv - 0.5) * 2.0 + uRay.xy) * uRay.zw * z, -z);
}

struct MtvdSample {
  vec3 world;     // position in clip world
  vec3 tu, tv;    // world-space size of one grid cell along x and y, following the surface
  float z;        // depth (m)
  float stencil;  // 0..1, people
  float slope;    // tan of the angle between surface normal and view ray
  vec2 uv;
  bool edge;      // on a depth ramp (before uEdgeMode is applied)
  bool ok;
};

// Decode one sample.
//
// Edges. ARKit's depth is smooth across object boundaries. Around a person at
// 2 m in front of a wall at 6.5 m the depth ramps over 20-26 quadrant pixels
// (about six LiDAR cells), and the ramp bleeds 30-40 px out beyond the human
// stencil's silhouette. Reconstructed naively, that is a "rubber sheet" from
// every silhouette to the background.
//
// A sample is on a ramp when either
//   - the surface it implies is steeper than uEdge to the view ray, judged
//     over EDGE_PX pixels on its smoother side (so a sample right on a
//     silhouette, flat on one side, is not an edge), or
//   - inverse depth bends: over +-CURVE_PX it is not linear. Any plane — floor,
//     table, wall, at any angle — has inverse depth linear in image space, so
//     planes pass; the shoulders of a ramp, where it meets a plateau, do not.
//
// Dropping ramp samples (uEdgeMode 1) removes the sheets but leaves a dark
// halo as wide as the ramp. Snapping them (uEdgeMode 2) moves each one onto one
// side of the boundary instead. The human stencil is far sharper than the
// depth, so it decides where people are: a person sample takes the nearest
// person depth around it; a background sample next to a person takes the far
// plateau if it lies behind the person (wall), the near one if in front
// (table). Edges with no person involved go to whichever side the sample's own
// depth is closer to, which splits the ramp at its middle.
const int EDGE_PX = 4;
const int CURVE_PX = 12;
const vec2 SNAP_DIRS[8] = vec2[8](vec2(1.0, 0.0), vec2(0.7071, 0.7071), vec2(0.0, 1.0), vec2(-0.7071, 0.7071),
                                  vec2(-1.0, 0.0), vec2(-0.7071, -0.7071), vec2(0.0, -1.0), vec2(0.7071, -0.7071));
const float SNAP_R[4] = float[4](6.0, 14.0, 24.0, 36.0);
float mtvdSnap(ivec2 q, float z, float stencil) {
  float zmin = 1e9, zmax = -1e9, pmin = 1e9, bmin = 1e9, bmax = -1e9;
  bool nearPerson = false;
  for (int r = 0; r < 4; r++) {
    for (int d = 0; d < 8; d++) {
      ivec2 o = q + ivec2(round(SNAP_DIRS[d] * SNAP_R[r]));
      float zz = mtvdDepth(o);
      zmin = min(zmin, zz);
      zmax = max(zmax, zz);
      if (mtvdStencil(o) > 0.5) { pmin = min(pmin, zz); nearPerson = true; }
      else { bmin = min(bmin, zz); bmax = max(bmax, zz); }
    }
  }
  // A person sample is only moved if it sits clearly behind the person's
  // nearest depth around it (pulled back by the ramp), not for the few
  // centimetres a body curves away from the camera.
  if (stencil > 0.5) return z - pmin > 0.12 + 0.04 * z ? pmin : z;
  if (nearPerson) return z > pmin ? max(bmax, z) : min(bmin, z);
  return z - zmin < zmax - z ? zmin : zmax;
}

const int BOUNDARY_PX = 10;
MtvdSample mtvdSample(ivec2 q, float cell) {
  MtvdSample s;
  float z = mtvdDepth(q);
  float zl = mtvdDepth(q - ivec2(EDGE_PX, 0)), zr = mtvdDepth(q + ivec2(EDGE_PX, 0));
  float zd = mtvdDepth(q - ivec2(0, EDGE_PX)), zu = mtvdDepth(q + ivec2(0, EDGE_PX));
  // Slope on the smoother side, for the edge test.
  float ex = abs(zr - z) < abs(z - zl) ? zr - z : z - zl;
  float ey = abs(zu - z) < abs(z - zd) ? zu - z : z - zd;
  float span = 2.0 * uRay.w / QH * float(EDGE_PX) * z;   // lateral metres across EDGE_PX at depth z
  s.slope = max(abs(ex), abs(ey)) / span;
  s.stencil = mtvdStencil(q);
  float w = 1.0 / z, curv = 0.0;
  bool boundary = false;   // a stencil edge within BOUNDARY_PX
  bool person = s.stencil > 0.5;
  for (int a = 0; a < 4; a++) {
    ivec2 o = ivec2(round(SNAP_DIRS[a] * float(CURVE_PX)));
    curv = max(curv, abs(1.0 / mtvdDepth(q + o) + 1.0 / mtvdDepth(q - o) - 2.0 * w) / w);
    ivec2 b = ivec2(round(SNAP_DIRS[a] * float(BOUNDARY_PX)));
    boundary = boundary || (mtvdStencil(q + b) > 0.5) != person || (mtvdStencil(q - b) > 0.5) != person;
  }
  bool edge = s.slope >= uEdge || curv >= uCurve;
  s.edge = edge;
  // Geometry from central differences, and the depth itself lightly smoothed
  // (a 5-tap plus): the hue encoding quantises depth to ~6 mm, which shows as
  // shingles on oblique surfaces otherwise. Planes are unaffected, being
  // symmetric about the centre.
  float dx = (zr - zl) * 0.5, dy = (zu - zd) * 0.5;
  if (!edge) z = 0.5 * z + 0.125 * (zl + zr + zu + zd);
  // Person samples near their silhouette are checked even when they look
  // smooth: the ramp bleeds a few pixels into the stencil, and a gentle start
  // of it passes both tests. Background samples are only moved when on a ramp.
  if (uEdgeMode == 2 && (edge || (boundary && person))) {
    float zs = mtvdSnap(q, z, s.stencil);
    if (zs != z || edge) {
      z = zs;
      dx = 0.0;   // facing the camera: its real slope is unknown
      dy = 0.0;
    }
    edge = false;
  }
  s.ok = z > uRange.x + 0.05 && z < uMaxDepth && !(edge && uEdgeMode == 1);

  vec2 uv = (vec2(q) + 0.5) / vec2(QW, QH);
  vec3 c = mtvdCamPos(uv, z);
  // One grid cell (cell depth pixels) along x and y, sloped like the surface.
  float k = cell / float(EDGE_PX);
  vec3 cx = mtvdCamPos(uv + vec2(cell / QW, 0.0), z + dx * k) - c;
  vec3 cy = mtvdCamPos(uv + vec2(0.0, cell / QH), z + dy * k) - c;
  mat3 r = mat3(uCamToWorld);
  s.world = (uCamToWorld * vec4(c, 1.0)).xyz;
  s.tu = r * cx;
  s.tv = r * cy;
  s.z = z;
  s.uv = uv;
  return s;
}

// Cheap stable per-sample random number, for thinning.
float mtvdHash(vec2 p) {
  p = fract(p * vec2(0.1031, 0.1030));
  p += dot(p, p.yx + 33.33);
  return fract((p.x + p.y) * p.x);
}
`;

/**
 * One Metavido clip: the <video>, its texture, its sidecar, and the uniforms
 * every layer drawing it shares. `frame` follows the decoded video frame.
 */
export class Clip {
  static async load(base, { fps } = {}) {
    const res = await fetch(base + ".json");
    if (!res.ok) throw new Error(`sidecar ${base}.json: HTTP ${res.status}`);
    const side = await res.json();
    const clip = new Clip(side, base + ".mp4");
    await clip.ready;
    return clip;
  }

  constructor(side, src) {
    this.side = side;
    this.fps = side.fps;
    this.frames = side.frames;
    this.duration = side.frames / side.fps;
    this.frame = 0;
    /** Bumped whenever a new video frame has been presented. */
    this.serial = 0;
    this.onFrame = null;

    const video = document.createElement("video");
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = "auto";
    video.setAttribute("playsinline", "");
    video.src = src;
    this.video = video;

    const tex = new THREE.VideoTexture(video);
    // Upload the frame's bytes untouched: depth is hue-encoded, and a colour
    // space conversion on upload would bend the hue and so the depth.
    tex.colorSpace = THREE.NoColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    this.texture = tex;

    this.camToWorld = new THREE.Matrix4();
    this.uniforms = {
      uFrame: { value: tex },
      uCamToWorld: { value: this.camToWorld },
      uRay: { value: new THREE.Vector4() },
      uRange: { value: new THREE.Vector2(0.2, 10) },
    };
    this._p = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3(1, 1, 1);
    this.setFrame(0);

    this.ready = new Promise((resolve, reject) => {
      video.addEventListener("loadeddata", () => resolve(), { once: true });
      video.addEventListener("error", () => reject(new Error(`video ${src}: ${video.error?.message || "failed to load"}`)), { once: true });
    });

    // The decoded frame tells us which pose to use. mediaTime is the frame's
    // presentation timestamp; the snippet is 30 fps CFR starting at 0.
    if ("requestVideoFrameCallback" in video) {
      const onVideoFrame = (now, meta) => {
        this._present(Math.round(meta.mediaTime * this.fps));
        video.requestVideoFrameCallback(onVideoFrame);
      };
      video.requestVideoFrameCallback(onVideoFrame);
      this.hasFrameCallback = true;
    } else {
      this.hasFrameCallback = false;
    }
  }

  /** Without requestVideoFrameCallback, follow currentTime (approximate). */
  poll() {
    if (this.hasFrameCallback) return;
    const f = Math.floor(this.video.currentTime * this.fps + 0.25);
    if (f !== this.frame) this._present(f);
  }

  _present(f) {
    this.setFrame(f);
    this.serial++;
    this.onFrame?.(this.frame);
  }

  setFrame(f) {
    const s = this.side;
    f = Math.min(Math.max(f, 0), this.frames - 1);
    this.frame = f;
    this.pose(f, this.camToWorld);
    const t = Math.tan(s.fov[f] / 2);
    this.uniforms.uRay.value.set(s.shift[2 * f], s.shift[2 * f + 1], t * 16 / 9, t);
    this.uniforms.uRange.value.set(s.range[2 * f], s.range[2 * f + 1]);
  }

  /** Recording camera -> clip world for frame f. */
  pose(f, target = new THREE.Matrix4()) {
    const s = this.side;
    this._p.fromArray(s.p, 3 * f);
    this._q.fromArray(s.q, 4 * f);
    return target.compose(this._p, this._q, this._s);
  }

  /** Vertical field of view of frame f, degrees. */
  fovDeg(f) {
    return THREE.MathUtils.radToDeg(this.side.fov[f]);
  }

  seekFrame(f) {
    f = Math.min(Math.max(f, 0), this.frames - 1);
    // Aim at the middle of the frame's display interval.
    this.video.currentTime = (f + 0.5) / this.fps;
  }

  dispose() {
    this.video.pause();
    this.video.removeAttribute("src");
    this.video.load();
    this.texture.dispose();
  }
}
