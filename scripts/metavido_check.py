#!/usr/bin/env python3
"""Metric sanity check of a web snippet: is it level, upright and life-sized?

    python scripts/metavido_check.py web/assets/video/NAME.mp4 [--frames 0,390,779] [--png out_prefix]

Decodes the snippet exactly as the browser viewer does (BT.709 limited range,
keijiro's hue depth decode, the sidecar's pose), builds world-space point clouds
for a few frames and reports:
  - horizontal surfaces (floor, table tops): height and tilt of each plane
    against world up; the lowest is taken as the floor unless --floor is given;
  - people: each blob of the human stencil, measured from the floor to the top
    of the blob (standing adults should come out 1.5-1.9 m);
  - optionally, orthographic front and top views as PNGs, coloured by the video.
"""
import argparse, json, math, os, subprocess, sys
import numpy as np

W, H = 1920, 1080
QW, QH = 960, 540
PAD = MAR = 0.01


def frame_rgb(mp4, index, fps):
    """One frame as float RGB, BT.709 limited range, decoded by us (not ffmpeg's guess)."""
    # Select by frame number rather than seek by time: exact, and the last frame works.
    r = subprocess.run(["ffmpeg", "-v", "error", "-i", mp4, "-vf", f"select=eq(n\\,{index})", "-frames:v", "1",
                        "-f", "rawvideo", "-pix_fmt", "yuv420p", "-"], capture_output=True, check=True)
    a = np.frombuffer(r.stdout, np.uint8)
    y = (a[:W * H].reshape(H, W).astype(np.float32) - 16) / 219
    u = (a[W * H:W * H * 5 // 4].reshape(H // 2, W // 2).astype(np.float32) - 128) / 224
    v = (a[W * H * 5 // 4:].reshape(H // 2, W // 2).astype(np.float32) - 128) / 224
    u = u.repeat(2, 0).repeat(2, 1); v = v.repeat(2, 0).repeat(2, 1)
    R = y + 1.5748 * v
    B = y + 1.8556 * u
    G = (y - 0.2126 * R - 0.0722 * B) / 0.7152
    return np.clip(np.stack([R, G, B], -1), 0, 1)


def hue_depth(c, near, far):
    """mtvd_DecodeDepth, vectorised."""
    r, g, b = c[..., 0], c[..., 1], c[..., 2]
    mn, mx = c.min(-1), c.max(-1)
    div = 1 / (6 * np.maximum(mx - mn, 1e-5))
    hr = (g - b) * div; hg = 1 / 3 + (b - r) * div; hb = 2 / 3 + (r - g) * div
    d = np.where(r < np.maximum(g, b), np.where(g < b, hb, hg), hr)
    d = np.mod(d + 1 - PAD / 2, 1.0) + PAD / 2
    d = (d - MAR) / (1 - 2 * MAR); d = (d - PAD) / (1 - 2 * PAD)
    return near + (far - near) * d


def quat_mat(x, y, z, w):
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])


def cloud(rgb, side, i, max_depth=6.0):
    """World points (three.js space), colours and stencil for every depth pixel."""
    near, far = side["range"][2 * i:2 * i + 2]
    fov = side["fov"][i]; sx, sy = side["shift"][2 * i:2 * i + 2]
    p = np.array(side["p"][3 * i:3 * i + 3]); R = quat_mat(*side["q"][4 * i:4 * i + 4])
    z = hue_depth(rgb[:QH, :QW], near, far)
    col = rgb[0:H:2, QW:]                       # colour row 2r for depth row r
    sten = np.clip((rgb[QH:, :QW, 0] + 0.1) / 1.1, 0, 1)   # Demux's noise filter
    rr, cc = np.mgrid[0:QH, 0:QW]
    u = (cc + 0.5) / QW; v = 1 - (rr + 0.5) / QH
    h = math.tan(fov / 2)
    ray = np.stack([((u - 0.5) * 2 + sx) * h * 16 / 9, ((v - 0.5) * 2 + sy) * h, -np.ones_like(u)], -1)
    pc = ray * z[..., None]
    pw = pc @ R.T + p
    ok = (z > near + 0.01) & (z < max_depth)
    ok[-4:, :] = False; ok[:, -4:] = False       # quadrant seams bleed under compression
    return pw, col, sten, ok, z


def horizontal_slabs(pts, min_frac=0.005):
    """Every dense horizontal slab of points (floor, table tops), lowest first.
    Returns [(height, tilt deg from level, inliers)]."""
    y = pts[:, 1]
    hist, edges = np.histogram(y, bins=np.arange(y.min(), y.max() + 0.02, 0.02))
    peaks = [k for k in range(len(hist)) if hist[k] >= min_frac * len(y)
             and hist[k] == hist[max(0, k - 3):k + 4].max()]
    out = []
    for k in peaks:
        y0 = (edges[k] + edges[k + 1]) / 2
        for it in range(3):
            sel = pts[np.abs(y - y0) < 0.04]
            c = sel.mean(0)
            _, _, vt = np.linalg.svd(sel - c, full_matrices=False)
            n = vt[2] * np.sign(vt[2][1])
            y0 = c[1]
        tilt = math.degrees(math.acos(min(1.0, abs(n[1]))))
        # a slab is horizontal if its points spread out sideways, not just a band
        spread = np.ptp(sel[:, [0, 2]], axis=0).min()
        if tilt < 5 and spread > 0.5:
            out.append((float(c[1]), tilt, len(sel)))
    merged = []
    for s in out:
        if merged and abs(s[0] - merged[-1][0]) < 0.06:
            if s[2] > merged[-1][2]:
                merged[-1] = s
            continue
        merged.append(s)
    return merged


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("mp4")
    ap.add_argument("--frames", default=None)
    ap.add_argument("--png", default=None)
    ap.add_argument("--floor", type=float, default=None, help="floor height if it is out of view in some frames")
    args = ap.parse_args()
    side = json.load(open(os.path.splitext(args.mp4)[0] + ".json"))
    n = side["frames"]
    frames = [int(x) for x in args.frames.split(",")] if args.frames else [0, n // 4, n // 2, 3 * n // 4, n - 1]
    from scipy import ndimage
    for i in frames:
        rgb = frame_rgb(args.mp4, i, side["fps"])
        pw, col, sten, ok, z = cloud(rgb, side, i)
        pts = pw[ok]
        slabs = horizontal_slabs(pts)
        cam = side["p"][3 * i:3 * i + 3]
        print(f"frame {i} (t={i / side['fps']:.2f}s): {ok.sum()} points, camera at y={cam[1]:+.2f}")
        for y0, tilt, cnt in slabs:
            print(f"   horizontal slab y={y0:+.3f} m: tilt {tilt:.2f} deg, {cnt} pts, {cam[1] - y0:.2f} m below the camera")
        floor_y = args.floor if args.floor is not None else (slabs[0][0] if slabs else None)
        if floor_y is not None:
            print(f"   floor taken as y={floor_y:+.3f}")
        lab, nl = ndimage.label((sten > 0.5) & ok)
        for k in range(1, nl + 1):
            m = lab == k
            if m.sum() < 3000:
                continue
            ys = pw[m][:, 1]
            top = np.percentile(ys, 99)
            rows = np.where(m.any(1))[0]
            cut = " (touches top edge: head may be out of frame)" if rows.min() <= 2 else ""
            dist = np.median(z[m])
            if floor_y is not None:
                print(f"   person blob {k}: {m.sum()} px at {dist:.2f} m, top {top - floor_y:.2f} m above floor{cut}")
            else:
                print(f"   person blob {k}: {m.sum()} px at {dist:.2f} m, top y={top:+.2f}{cut}")
        if args.png:
            from PIL import Image
            c = col[ok]
            for name, (a, b, flip) in {"front": (0, 1, True), "top": (0, 2, False), "side": (2, 1, True)}.items():
                S = 160  # px per metre
                xa, xb = pts[:, a], pts[:, b]
                lo_a, hi_a = np.percentile(xa, 1) - 0.3, np.percentile(xa, 99) + 0.3
                lo_b, hi_b = np.percentile(xb, 1) - 0.3, np.percentile(xb, 99) + 0.3
                wpx, hpx = int((hi_a - lo_a) * S), int((hi_b - lo_b) * S)
                img = np.zeros((hpx, wpx, 3), np.uint8)
                ia = ((xa - lo_a) * S).astype(int); ib = ((xb - lo_b) * S).astype(int)
                if flip:
                    ib = hpx - 1 - ib
                keep = (ia >= 0) & (ia < wpx) & (ib >= 0) & (ib < hpx)
                img[ib[keep], ia[keep]] = (c[keep] * 255).astype(np.uint8)
                # 1 m grid ticks
                for gx in np.arange(math.ceil(lo_a), hi_a, 1.0):
                    img[:, int((gx - lo_a) * S)] = (60, 60, 60)
                for gy in np.arange(math.ceil(lo_b), hi_b, 1.0):
                    row = int((gy - lo_b) * S); row = hpx - 1 - row if flip else row
                    if 0 <= row < hpx:
                        img[row, :] = (60, 60, 60)
                Image.fromarray(img).save(f"{args.png}_{i}_{name}.png")


if __name__ == "__main__":
    main()
