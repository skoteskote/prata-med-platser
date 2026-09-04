#!/usr/bin/env python3
"""Score every frame of the video for sharpness, reading small grayscale frames
on stdin. Writes 'frame_index,var_of_laplacian' so the extractor can pick the
sharpest frame in each time bucket instead of whatever lands on a fixed grid.
"""
import argparse, sys
import cv2
import numpy as np

AP = argparse.ArgumentParser()
AP.add_argument("--width", type=int, required=True)
AP.add_argument("--height", type=int, required=True)
AP.add_argument("--out", required=True)
A = AP.parse_args()

FRAME = A.width * A.height
stdin = sys.stdin.buffer
n = 0
with open(A.out, "w") as fh:
    fh.write("frame_index,var_of_laplacian\n")
    while True:
        buf = stdin.read(FRAME)
        if len(buf) < FRAME:
            break
        img = np.frombuffer(buf, dtype=np.uint8).reshape(A.height, A.width)
        fh.write("%d,%.3f\n" % (n, cv2.Laplacian(img, cv2.CV_64F).var()))
        n += 1
        if n % 2000 == 0:
            print("  scored %d frames" % n, file=sys.stderr, flush=True)
print("scored %d frames total" % n, file=sys.stderr)
