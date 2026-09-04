#!/usr/bin/env python3
"""Read a COLMAP sparse model and emit everything downstream stages need to
frame the scene: a deliberately generous crop box, a world up vector, and a
sensible initial viewer camera taken from a real capture pose.

The operator is not in the loop, so nothing here is hand-tuned. The crop box is
the AABB of the camera centres inflated by half its own diagonal on every side
(the room is bigger than the walked path), unioned with a percentile AABB of the
sparse points so a wall COLMAP actually saw can never be clipped away.
"""
import argparse, json, os, struct, sys
import numpy as np

AP = argparse.ArgumentParser()
AP.add_argument("--model", required=True)
AP.add_argument("--inflate", type=float, default=0.5)
AP.add_argument("--point-percentile", type=float, default=99.5)
AP.add_argument("--out-box", help="write 'x,y,z,X,Y,Z' here")
AP.add_argument("--out-json", help="write scene-info.json here")
A = AP.parse_args()


def _read(f, fmt):
    return struct.unpack(fmt, f.read(struct.calcsize(fmt)))


def qvec_to_R(qw, qx, qy, qz):
    return np.array([
        [1 - 2*qy*qy - 2*qz*qz, 2*qx*qy - 2*qz*qw,     2*qx*qz + 2*qy*qw],
        [2*qx*qy + 2*qz*qw,     1 - 2*qx*qx - 2*qz*qz, 2*qy*qz - 2*qx*qw],
        [2*qx*qz - 2*qy*qw,     2*qy*qz + 2*qx*qw,     1 - 2*qx*qx - 2*qy*qy],
    ])


def read_images(path):
    """-> list of (name, centre, R, t, observed point3D ids). World-to-camera."""
    out = []
    with open(path, "rb") as f:
        (num,) = _read(f, "<Q")
        for _ in range(num):
            _id, qw, qx, qy, qz, tx, ty, tz, _cam = _read(f, "<idddddddi")
            name = b""
            while True:
                c = f.read(1)
                if c == b"\x00":
                    break
                name += c
            (npts,) = _read(f, "<Q")
            raw = f.read(npts * 24)
            ids = np.frombuffer(raw, dtype=np.dtype([("xy", "<f8", 2), ("pid", "<i8")]))["pid"]
            R = qvec_to_R(qw, qx, qy, qz)
            t = np.array([tx, ty, tz])
            out.append((name.decode(), -R.T @ t, R, t, ids[ids >= 0]))
    return out


def read_points(path):
    """-> (Nx3 array of positions, dict point3D id -> row index)."""
    pts, index = [], {}
    with open(path, "rb") as f:
        (num,) = _read(f, "<Q")
        for i in range(num):
            pid, x, y, z, _r, _g, _b, _err = _read(f, "<QdddBBBd")
            (nt,) = _read(f, "<Q")
            f.seek(nt * 8, os.SEEK_CUR)
            index[pid] = i
            pts.append((x, y, z))
    return np.asarray(pts), index


imgs = read_images(os.path.join(A.model, "images.bin"))
if not imgs:
    sys.exit("no images in model")
imgs.sort(key=lambda t: t[0])
cams = np.array([c for _, c, _, _, _ in imgs])

cmin, cmax = cams.min(0), cams.max(0)
diag = float(np.linalg.norm(cmax - cmin))
pad = A.inflate * diag
bmin, bmax = cmin - pad, cmax + pad
print("camera centres:   %d" % len(cams))
print("  camera AABB:    [%s] .. [%s]  (diagonal %.3f)"
      % (", ".join("%.3f" % v for v in cmin), ", ".join("%.3f" % v for v in cmax), diag))
print("  inflated by %.2f x diagonal = %.3f per side" % (A.inflate, pad))

ppath = os.path.join(A.model, "points3D.bin")
npoints = 0
if os.path.exists(ppath):
    pts, pindex = read_points(ppath)
    npoints = len(pts)
    if npoints:
        lo = np.percentile(pts, 100.0 - A.point_percentile, axis=0)
        hi = np.percentile(pts, A.point_percentile, axis=0)
        print("  sparse points:  %d, p%.1f AABB [%s] .. [%s]"
              % (npoints, A.point_percentile,
                 ", ".join("%.3f" % v for v in lo), ", ".join("%.3f" % v for v in hi)))
        bmin = np.minimum(bmin, lo)      # union: the box only ever grows
        bmax = np.maximum(bmax, hi)

box = "%.4f,%.4f,%.4f,%.4f,%.4f,%.4f" % (*bmin, *bmax)
print("  final crop box: %s" % box)
print("  box size:       %.2f x %.2f x %.2f" % tuple(bmax - bmin))

# World up: COLMAP cameras look down +Z with +Y pointing down the image, so the
# average camera-Y in world coordinates is roughly "down" for a handheld capture.
down = np.mean([R.T @ np.array([0.0, 1.0, 0.0]) for _, _, R, _, _ in imgs], axis=0)
up = -down / max(np.linalg.norm(down), 1e-9)

# Initial camera: a real capture pose, so the viewer opens on a view that was
# actually shot and definitely has splats in it - but chosen for how *open* it
# is. Scoring by the median depth of the sparse points each view observes avoids
# opening the scene pressed up against a roof beam, which is what picking the
# geometrically central pose did.
depth_of = {}
if npoints:
    for i, (name_i, _c, R_i, t_i, ids) in enumerate(imgs):
        rows = [pindex[p] for p in ids if p in pindex]
        if len(rows) < 200:                      # too few observations to trust
            continue
        cam_pts = pts[rows] @ R_i.T + t_i        # into camera space; +Z is forward
        d = cam_pts[:, 2]
        d = d[d > 0]
        if len(d) >= 200:
            depth_of[i] = float(np.median(d))

if depth_of:
    best = max(depth_of, key=depth_of.get)
    view_depth = depth_of[best]
    print("  start view chosen by openness: median observed depth %.2f (over %d candidate poses)"
          % (view_depth, len(depth_of)))
else:
    median = np.median(cams, axis=0)
    best = int(np.argmin(np.linalg.norm(cams - median, axis=1)))
    view_depth = 0.35 * diag
    print("  start view: no usable point depths, falling back to the central pose")

name, pos, R = imgs[best][0], imgs[best][1], imgs[best][2]
forward = R.T @ np.array([0.0, 0.0, 1.0])
forward /= max(np.linalg.norm(forward), 1e-9)
target = pos + forward * view_depth

print("  world up:       [%s]" % ", ".join("%.3f" % v for v in up))
print("  start camera:   %s at [%s] looking at [%s]"
      % (name, ", ".join("%.3f" % v for v in pos), ", ".join("%.3f" % v for v in target)))

if A.out_box:
    open(A.out_box, "w").write(box + "\n")
if A.out_json:
    json.dump({
        "cameraCount": len(cams),
        "pointCount": npoints,
        "pathDiagonal": diag,
        "boundsMin": [float(v) for v in bmin],
        "boundsMax": [float(v) for v in bmax],
        "cameraPathMin": [float(v) for v in cmin],
        "cameraPathMax": [float(v) for v in cmax],
        "up": [float(v) for v in up],
        "start": {
            "image": name,
            "position": [float(v) for v in pos],
            "target": [float(v) for v in target],
            "viewDepth": float(view_depth),
        },
    }, open(A.out_json, "w"), indent=2)
    print("  wrote %s" % A.out_json)
