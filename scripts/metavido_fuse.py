#!/usr/bin/env python3
"""Put two Metavido snippets of the same moment into one space.

    python scripts/metavido_fuse.py OUT.json PRIMARY.mp4::PRIMARY.sidecar.jsonl SECONDARY.mp4::SECONDARY.sidecar.jsonl
        [--frames 0,390,779] [--icp] [--png prefix]

The recorder's sidecar (.sidecar.jsonl, see Workshop1/tools/sidecar-format-README.md)
holds the printed marker's pose in each phone's own world, averaged over the
pre-roll (`markerAtStart`). The marker is the same physical object for both
phones, so secondary world -> primary world is

    T = M_primary * inverse(M_secondary)       (Unity, left-handed)

converted to three.js like the camera poses (z negated on both sides). Both
ARKit worlds are gravity-aligned, so the true T is a yaw and a translation; its
residual tilt measures how good the marker estimates are.

The script then reconstructs both snippets at the same instants (the snippets
must already be time-aligned: cut with metavido_sync.py's offset) and measures
how well the static room lines up, before and after an optional ICP refinement
on the room (people excluded). Writes OUT.json for the viewer.
"""
import argparse, json, math, os, sys
import numpy as np
from scipy.spatial import cKDTree

sys.path.insert(0, os.path.dirname(__file__))
import metavido_check as mc


def qmat(q):
    return mc.quat_mat(*q)


def unity_pose(p, q):
    T = np.eye(4)
    T[:3, :3] = qmat(q)
    T[:3, 3] = p
    return T


S = np.diag([1.0, 1.0, -1.0, 1.0])   # Unity <-> three.js: z negated


def marker(sidecar):
    h = json.loads(open(sidecar).readline())
    m = h["markerAtStart"]
    return unity_pose(m["pose"]["p"], m["pose"]["q"]), m


def cloud(mp4, side, i, room_only=True, step=3):
    rgb = mc.frame_rgb(mp4, i, side["fps"])
    pw, col, sten, ok, z = mc.cloud(rgb, side, i, max_depth=6.0)
    keep = ok & (sten < 0.5) if room_only else ok
    keep[::step, :] &= True
    sel = np.zeros_like(keep)
    sel[::step, ::step] = True
    keep &= sel
    return pw[keep], col[keep]


def voxel(p, s=0.03):
    k = np.floor(p / s).astype(np.int64)
    _, i = np.unique(k, axis=0, return_index=True)
    return p[i]


def apply(T, p):
    return p @ T[:3, :3].T + T[:3, 3]


def overlap(a, b, r=0.10):
    d, _ = cKDTree(b).query(a)
    ov = d < r
    return ov.mean(), (np.median(d[ov]) if ov.any() else float("nan"))


def icp(src, dst, iters=40, r=0.12):
    tree = cKDTree(dst)
    R, t = np.eye(3), np.zeros(3)
    cur = src.copy()
    for _ in range(iters):
        d, j = tree.query(cur, distance_upper_bound=r)
        m = np.isfinite(d)
        a, b = cur[m], dst[j[m]]
        ca, cb = a.mean(0), b.mean(0)
        U, _, Vt = np.linalg.svd((a - ca).T @ (b - cb))
        Ri = (U @ Vt).T
        if np.linalg.det(Ri) < 0:
            Vt[-1] *= -1
            Ri = (U @ Vt).T
        ti = cb - Ri @ ca
        cur = cur @ Ri.T + ti
        R, t = Ri @ R, Ri @ t + ti
    T = np.eye(4)
    T[:3, :3], T[:3, 3] = R, t
    return T


def describe(T):
    R = T[:3, :3]
    ang = math.degrees(math.acos(max(-1, min(1, (np.trace(R) - 1) / 2))))
    up = R @ np.array([0, 1, 0])
    tilt = math.degrees(math.acos(max(-1, min(1, up[1]))))
    yaw = math.degrees(math.atan2(R[0, 2], R[2, 2]))
    return f"rotation {ang:.2f} deg (yaw {yaw:.2f}, tilt {tilt:.2f}), translation {np.round(T[:3, 3], 3)}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("primary")
    ap.add_argument("secondary")
    ap.add_argument("--frames", default="0,390,779")
    ap.add_argument("--icp", action="store_true")
    ap.add_argument("--png", default=None)
    args = ap.parse_args()
    (pm, ps), (sm, ss) = [x.split("::") for x in (args.primary, args.secondary)]
    pside = json.load(open(os.path.splitext(pm)[0] + ".json"))
    sside = json.load(open(os.path.splitext(sm)[0] + ".json"))

    Mp, mp_info = marker(ps)
    Ms, ms_info = marker(ss)
    for name, info in (("primary", mp_info), ("secondary", ms_info)):
        print(f"{name} marker: {info['samples']} pre-roll samples, rms {1000 * info['positionRmsMeters']:.1f} mm, "
              f"spread {info['maxAngleDegrees']:.2f} deg")
    Tu = Mp @ np.linalg.inv(Ms)
    T = S @ Tu @ S
    print("marker transform secondary -> primary:", describe(T))

    frames = [int(f) for f in args.frames.split(",")]
    P = np.concatenate([cloud(pm, pside, f)[0] for f in frames])
    Q = np.concatenate([cloud(sm, sside, f)[0] for f in frames])
    P, Q = voxel(P), voxel(Q)
    Qm = apply(T, Q)
    ov, med = overlap(Qm, P)
    print(f"marker only: {100 * ov:.0f}% of the secondary's room within 10 cm of the primary's, median {1000 * med:.0f} mm")

    final = T
    if args.icp:
        D = icp(Qm, P)
        Ti = D @ T
        ov2, med2 = overlap(apply(Ti, Q), P)
        print("ICP correction on top of the marker:", describe(D))
        print(f"after ICP: {100 * ov2:.0f}% within 10 cm, median {1000 * med2:.0f} mm")
        final = Ti

    if args.png:
        from PIL import Image
        A = apply(final, Q)
        for name, (a, b, flip) in {"top": (0, 2, False), "front": (0, 1, True)}.items():
            S_ = 120
            allp = np.concatenate([P, A])
            lo = np.percentile(allp, 1, axis=0) - 0.3
            hi = np.percentile(allp, 99, axis=0) + 0.3
            w, h = int((hi[a] - lo[a]) * S_), int((hi[b] - lo[b]) * S_)
            img = np.zeros((h, w, 3), np.uint8)
            for pts, colr in ((P, (255, 140, 40)), (A, (60, 170, 255))):
                ia = ((pts[:, a] - lo[a]) * S_).astype(int)
                ib = ((pts[:, b] - lo[b]) * S_).astype(int)
                if flip:
                    ib = h - 1 - ib
                k = (ia >= 0) & (ia < w) & (ib >= 0) & (ib < h)
                img[ib[k], ia[k]] = colr
            Image.fromarray(img).save(f"{args.png}_{name}.png")

    out = {
        "format": "pratamedplatser.metavido.scene",
        "version": 1,
        "space": "the primary clip's world (three.js, Y up, metres)",
        "clips": [
            {"name": os.path.splitext(os.path.basename(pm))[0], "transform": np.eye(4).T.flatten().tolist()},
            {"name": os.path.splitext(os.path.basename(sm))[0],
             # column-major, as THREE.Matrix4.fromArray expects
             "transform": [round(float(x), 6) for x in final.T.flatten()],
             "via": "marker" + (" + ICP on the room" if final is not T else "")},
        ],
    }
    json.dump(out, open(args.out, "w"), indent=1)
    print("wrote", args.out)


if __name__ == "__main__":
    main()
