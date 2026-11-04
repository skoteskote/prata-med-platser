#!/usr/bin/env python3
"""Cut a web snippet out of a Metavido recording and write its pose sidecar.

    python scripts/metavido_clip.py SRC START DURATION NAME [--crf 26] [--out web/assets/video]

1. Encodes SRC[START : START+DURATION] to OUT/NAME.mp4 at 1920x1080, 30 fps CFR,
   H.264 yuv420p, no audio, +faststart. Never rescaled: the barcode and the four
   quadrants sit on fixed pixel coordinates.
2. Reads the metadata barcode out of every frame of the *encoded* file and writes
   OUT/NAME.json: one pose per output frame, already converted to three.js space.
3. Reads the barcode out of the same range of SRC and checks that the encoded
   file's frames are the source's frames, in order, and that every one decodes.

Colour: the recorder's H.264 is untagged, but it is BT.709 limited range (fitting
the depth quadrant's hue colours, which the encoder writes fully saturated, gives
max/min channel 1.002/-0.001 with BT.709 and 1.03/-0.004 +-0.08 with BT.601).
ffmpeg and browsers would otherwise guess, so the output is tagged BT.709/tv.

Coordinates: Metavido stores Unity's left-handed, Y-up camera pose. three.js is
right-handed, so z is negated: p' = (x, y, -z), q' = (-x, -y, z, w). A Unity
camera looks down +Z and a three.js camera down -Z, so in three.js camera space
the ray through depth-quadrant uv (v up) at depth d is
    ( ((u-0.5)*2 + sx) * tan(fov/2) * 16/9,  ((v-0.5)*2 + sy) * tan(fov/2),  -1 ) * d
and world = T(p') R(q') ray. Same maths as keijiro/Metavido Decoder/Shaders/Utils.hlsl.
"""
import argparse, json, math, os, struct, subprocess, sys
import numpy as np

W, H = 1920, 1080
FPS = 30
# Barcode: 12 lanes of 8 px, 32 bit rows of 8 px, counted from the frame's bottom
# edge. Only the bottom-left 96x256 needs decoding.
BX, BY, BW, BH = 0, H - 256, 96, 256


def yuv_to_blue(y, u):
    """BT.709 limited range, the blue channel only (all the barcode uses)."""
    return (y.astype(np.float32) - 16) / 219 + 1.8556 * (u.astype(np.float32) - 128) / 224


def barcodes(path, start=None, duration=None):
    """Yields the 12 raw float32 values of every frame's barcode."""
    cmd = ["ffmpeg", "-v", "error"]
    if start is not None:
        cmd += ["-ss", f"{start:.3f}"]
    cmd += ["-i", path]
    if duration is not None:
        cmd += ["-t", f"{duration:.3f}"]
    cmd += ["-map", "0:v:0", "-fps_mode", "passthrough", "-vf", f"crop={BW}:{BH}:{BX}:{BY}",
            "-f", "rawvideo", "-pix_fmt", "yuv420p", "-"]
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, bufsize=1 << 20)
    n = BW * BH * 3 // 2
    rows = np.array([BH - 1 - (i * 8 + 4) for i in range(32)])
    weights = (1 << np.arange(32, dtype=np.uint64))
    while True:
        b = p.stdout.read(n)
        if len(b) < n:
            break
        a = np.frombuffer(b, np.uint8)
        y = a[:BW * BH].reshape(BH, BW)
        u = a[BW * BH:BW * BH + BW * BH // 4].reshape(BH // 2, BW // 2)
        out = []
        for lane in range(12):
            x1, x2 = lane * 8 + 3, lane * 8 + 5
            b1 = yuv_to_blue(y[rows, x1], u[rows // 2, x1 // 2])
            b2 = yuv_to_blue(y[rows, x2], u[rows // 2, x2 // 2])
            bits = (b1 + b2) > 0.4
            acc = int((bits.astype(np.uint64) * weights).sum())
            out.append(struct.unpack("<f", struct.pack("<I", acc))[0])
        yield out
    p.wait()


def valid(v):
    fov, near, far = v[8], v[9], v[10]
    q2 = v[3] ** 2 + v[4] ** 2 + v[5] ** 2
    return (all(math.isfinite(x) for x in v) and 0 < fov < math.pi and q2 <= 1.0001
            and 0 < near < far < 100 and all(abs(x) < 1000 for x in v[0:3]))


def encode(src, start, duration, dst, crf):
    cmd = ["ffmpeg", "-v", "error", "-y", "-ss", f"{start:.3f}", "-i", src, "-t", f"{duration:.3f}",
           "-map", "0:v:0", "-an",
           "-c:v", "libx264", "-crf", str(crf), "-preset", "slow", "-r", str(FPS),
           "-pix_fmt", "yuv420p",
           # Tag what the recorder actually wrote, so nothing downstream guesses.
           "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
           "-color_range", "tv",
           "-movflags", "+faststart", dst]
    print("+", " ".join(cmd))
    subprocess.run(cmd, check=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("src")
    ap.add_argument("start", type=float)
    ap.add_argument("duration", type=float)
    ap.add_argument("name")
    ap.add_argument("--crf", type=int, default=26)
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "web", "assets", "video"))
    ap.add_argument("--skip-encode", action="store_true", help="reuse an existing OUT/NAME.mp4")
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)
    mp4 = os.path.join(args.out, args.name + ".mp4")
    if not args.skip_encode:
        encode(args.src, args.start, args.duration, mp4, args.crf)

    # The source's barcodes are the ground truth. Re-encoding can flip a bit now
    # and then (seen: one exponent bit of `near` in one frame of 780 at CRF 26,
    # next to a stencil edge that runs through the barcode), and one flipped
    # exponent bit ruins a frame. So the sidecar is written from the source, and
    # the encoded file's barcodes are only used to find which source frame each
    # encoded frame is.
    srcv = list(barcodes(args.src, args.start, args.duration))
    src_bad = [i for i, v in enumerate(srcv) if not valid(v)]
    print(f"source:  {len(srcv)} frames in range, {len(srcv) - len(src_bad)} with valid metadata")
    enc = list(barcodes(mp4))
    enc_bad = [i for i, v in enumerate(enc) if not valid(v)]
    print(f"encoded: {len(enc)} frames, {len(enc) - len(enc_bad)} with valid metadata as encoded"
          + (f" (invalid after encoding: {enc_bad[:10]})" if enc_bad else ""))

    # Every encoded frame must be one of the source's, in source order: the
    # 30 fps CFR conversion only drops or duplicates whole frames. Match on the
    # whole barcode by Hamming distance over the next few source frames, so a
    # flipped bit (even in the hash lane) cannot derail the match.
    def bits(v):
        return np.frombuffer(np.array(v, np.float32).tobytes(), np.uint32)
    sb = [bits(v) for v in srcv]
    mapping, last, dup, flipped_frames, flipped_bits = [], 0, 0, 0, 0
    for v in enc:
        e = bits(v)
        best = None
        for i in range(last, min(len(srcv), last + 6)):
            d = int(sum(bin(int(x)).count("1") for x in (e ^ sb[i])))
            if best is None or d < best[0]:
                best = (d, i)
        if best is None or best[0] > 8:
            sys.exit(f"FAIL: encoded frame {len(mapping)} matches no source frame (best {best})")
        d, i = best
        dup += bool(mapping) and i == mapping[-1]
        flipped_frames += d > 0
        flipped_bits += d
        mapping.append(i)
        last = i
    print(f"         all {len(enc)} encoded frames matched to source frames in order "
          f"({dup} duplicated by the CFR conversion, {len(set(mapping))} distinct); "
          f"{flipped_frames} frames carry flipped barcode bits after encoding ({flipped_bits} bits)")
    bad = [k for k, i in enumerate(mapping) if not valid(srcv[i])]
    if bad:
        sys.exit(f"FAIL: {len(bad)} frames have invalid metadata in the source too, first {bad[:10]}")
    enc = [list(srcv[i]) for i in mapping]

    # The source has bit flips of its own (the recorder's H.264 is lossy too):
    # in moment2-16pro one frame reads near=0.23125 instead of 0.2 and one
    # far=10.00003, each one bit off. The depth range is a constant of the
    # recorder (FrameEncoder._minDepth/_maxDepth), so any frame that disagrees
    # with the clip's own most common value is corruption, not data. Pin it and
    # say so.
    for lane, name in ((9, "near"), (10, "far")):
        vals, counts = np.unique([v[lane] for v in enc], return_counts=True)
        mode = float(vals[np.argmax(counts)])
        fixed = sum(v[lane] != mode for v in enc)
        if fixed:
            print(f"depth range: {fixed} frames had {name} != {mode:g} (bit flips), pinned to {mode:g}")
            for v in enc:
                v[lane] = mode

    # Pose track sanity: a handheld phone moves millimetres per frame. A flipped
    # high bit in a pose lane would show up here as a jump.
    P = np.array([v[0:3] for v in enc])
    step = np.linalg.norm(np.diff(P, axis=0), axis=1)
    Q = np.array([[v[3], v[4], v[5], math.sqrt(max(0.0, 1 - v[3] ** 2 - v[4] ** 2 - v[5] ** 2))] for v in enc])
    ang = np.degrees(2 * np.arccos(np.clip(np.abs((Q[1:] * Q[:-1]).sum(1)), 0, 1)))
    print(f"camera step per frame: median {1000 * np.median(step):.1f} mm, max {1000 * step.max():.1f} mm; "
          f"path {step.sum():.2f} m; rotation per frame median {np.median(ang):.2f} deg, max {ang.max():.2f} deg")
    if step.max() > 0.1 or ang.max() > 10:
        sys.exit("FAIL: the pose track jumps; a corrupted frame is getting through")
    fov = np.array([v[8] for v in enc])
    rng = np.array([v[9:11] for v in enc])
    print(f"fov(y) {math.degrees(fov.min()):.3f}..{math.degrees(fov.max()):.3f} deg "
          f"(x {math.degrees(2 * math.atan(math.tan(fov.mean() / 2) * 16 / 9)):.2f} deg), "
          f"depth range {rng.min(0)} .. {rng.max(0)}")

    def r(x, k=5):
        return round(float(x), k)

    side = {
        "format": "pratamedplatser.metavido.sidecar",
        "version": 1,
        "video": os.path.basename(mp4),
        "source": {"file": os.path.basename(args.src), "start": args.start, "duration": args.duration},
        "fps": FPS,
        "frames": len(enc),
        "space": "three.js: right-handed, Y up (gravity), metres. Unity values with z negated: "
                 "p=(x,y,-z), q=(-x,-y,z,w). Camera looks down -Z.",
        "ray": "camera-space ray through depth uv (v up): (((u-.5)*2+sx)*tan(fov/2)*16/9, ((v-.5)*2+sy)*tan(fov/2), -1) * depth",
        # Flat per-frame arrays.
        "p": [r(c) for v in enc for c in (v[0], v[1], -v[2])],
        "q": [r(c, 6) for v in enc for c in
              (-v[3], -v[4], v[5], math.sqrt(max(0.0, 1 - v[3] ** 2 - v[4] ** 2 - v[5] ** 2)))],
        "shift": [r(c, 6) for v in enc for c in (v[6], v[7])],
        "fov": [r(v[8], 6) for v in enc],
        "range": [r(c, 4) for v in enc for c in (v[9], v[10])],
        "hash": [float(np.float32(v[11])) for v in enc],
    }
    js = os.path.join(args.out, args.name + ".json")
    with open(js, "w") as f:
        json.dump(side, f, separators=(",", ":"))
    print(f"wrote {mp4} ({os.path.getsize(mp4) / 1e6:.2f} MB) and {js} ({os.path.getsize(js) / 1e3:.0f} kB)")


if __name__ == "__main__":
    main()
