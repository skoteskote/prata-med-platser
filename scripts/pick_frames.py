#!/usr/bin/env python3
"""Pick the sharpest frame in each fixed-length time bucket.

Sampling video on a fixed fps grid takes whatever frame the grid lands on, which
in handheld footage is often a motion-blurred one - and COLMAP then fails to
register it. Bucketing at the same average rate and taking the local sharpness
maximum keeps the frame count and coverage identical while raising per-frame
sharpness a lot.
"""
import argparse, csv
import numpy as np

AP = argparse.ArgumentParser()
AP.add_argument("--scores", required=True)
AP.add_argument("--target", type=int, required=True, help="frames to select")
AP.add_argument("--total-frames", type=int, required=True)
AP.add_argument("--out", required=True, help="one selected frame index per line")
AP.add_argument("--report", required=True, help="csv of the selection")
A = AP.parse_args()

scores = np.zeros(A.total_frames)
with open(A.scores) as fh:
    for row in csv.DictReader(fh):
        i = int(row["frame_index"])
        if i < A.total_frames:
            scores[i] = float(row["var_of_laplacian"])

edges = np.linspace(0, A.total_frames, A.target + 1).round().astype(int)
picked, bucket_of = [], []
for b in range(A.target):
    lo, hi = edges[b], edges[b + 1]
    if hi <= lo:
        continue
    idx = lo + int(np.argmax(scores[lo:hi]))
    picked.append(idx)
    bucket_of.append((b, lo, hi, idx))

picked_scores = scores[picked]
grid = scores[np.clip(((edges[:-1] + edges[1:]) // 2), 0, A.total_frames - 1)]

with open(A.out, "w") as fh:
    fh.write("\n".join(str(i) for i in picked) + "\n")
with open(A.report, "w", newline="") as fh:
    w = csv.writer(fh)
    w.writerow(["bucket", "bucket_start", "bucket_end", "picked_frame", "var_of_laplacian"])
    for (b, lo, hi, idx) in bucket_of:
        w.writerow([b, lo, hi, idx, "%.3f" % scores[idx]])

print("buckets:            %d over %d source frames (%.1f frames per bucket)"
      % (len(picked), A.total_frames, A.total_frames / max(len(picked), 1)))
print("selected sharpness: median %.1f  mean %.1f  min %.1f"
      % (np.median(picked_scores), picked_scores.mean(), picked_scores.min()))
print("fixed-grid would be: median %.1f  mean %.1f  min %.1f"
      % (np.median(grid), grid.mean(), grid.min()))
print("improvement:        %.2fx median sharpness" % (np.median(picked_scores) / max(np.median(grid), 1e-6)))
