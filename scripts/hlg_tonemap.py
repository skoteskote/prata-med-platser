#!/usr/bin/env python3
"""Read rgb48le frames on stdin, tonemap HLG/BT.2020 -> sRGB/BT.709, write JPEGs.

The source is iPhone HLG (ARIB STD-B67 transfer, BT.2020 primaries, 10-bit).
Decoding it as if it were BT.709 gives washed-out, wrongly-saturated frames.
This does the real conversion:
  HLG inverse-OETF -> scene linear -> HLG OOTF (system gamma) -> BT.2020->BT.709
  -> Reinhard-style highlight rolloff -> sRGB encode.
"""
import sys, os, argparse
import numpy as np
import cv2

AP = argparse.ArgumentParser()
AP.add_argument("--width", type=int, required=True)
AP.add_argument("--height", type=int, required=True)
AP.add_argument("--outdir", required=True)
AP.add_argument("--quality", type=int, default=95)
AP.add_argument("--start-index", type=int, default=1)
# Nominal peak luminance of the HLG signal, used for the OOTF system gamma.
AP.add_argument("--npl", type=float, default=1000.0)
AP.add_argument("--exposure", type=float, default=1.0)
AP.add_argument("--select", help="file of source frame indices to keep; all frames if omitted")
A = AP.parse_args()

KEEP = None
if A.select:
    KEEP = {int(l) for l in open(A.select) if l.strip()}

os.makedirs(A.outdir, exist_ok=True)
W, H = A.width, A.height
FRAME_BYTES = W * H * 3 * 2  # rgb48le

# --- HLG inverse OETF (ITU-R BT.2100) ---
HLG_A, HLG_B, HLG_C = 0.17883277, 0.28466892, 0.55991073

def hlg_inverse_oetf(e):
    """Signal [0,1] -> scene linear [0,1] (1.0 == reference white * 12)."""
    lo = (e ** 2) / 3.0
    hi = (np.exp((e - HLG_C) / HLG_A) + HLG_B) / 12.0
    return np.where(e <= 0.5, lo, hi)

# BT.2020 -> BT.709 (linear light), via XYZ, Bradford-less (same D65 white)
M_2020_TO_709 = np.array([
    [ 1.6605, -0.5876, -0.0728],
    [-0.1246,  1.1329, -0.0083],
    [-0.0182, -0.1006,  1.1187],
], dtype=np.float32)

# HLG OOTF system gamma for the nominal peak luminance
GAMMA = 1.2 + 0.42 * np.log10(A.npl / 1000.0)

def srgb_encode(x):
    x = np.clip(x, 0.0, 1.0)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)

idx = A.start_index
src = 0
stdin = sys.stdin.buffer
while True:
    buf = stdin.read(FRAME_BYTES)
    if len(buf) < FRAME_BYTES:
        break
    src += 1
    # Reading every frame and discarding most is far cheaper than asking ffmpeg
    # to select them: its expression parser cannot hold a thousand eq(n,..) terms.
    if KEEP is not None and (src - 1) not in KEEP:
        continue
    rgb = np.frombuffer(buf, dtype="<u2").reshape(H, W, 3).astype(np.float32) / 65535.0

    lin = hlg_inverse_oetf(rgb)                       # scene linear, BT.2020
    # HLG OOTF: scale by luminance^(gamma-1)
    Y = (0.2627 * lin[..., 0] + 0.6780 * lin[..., 1] + 0.0593 * lin[..., 2])
    lin *= np.power(np.maximum(Y, 1e-6), GAMMA - 1.0)[..., None]

    lin = lin @ M_2020_TO_709.T                       # -> BT.709 primaries
    lin = np.maximum(lin, 0.0) * A.exposure

    # Normalise so HLG diffuse white (~0.26 of the 0..1 scene range) lands at 1.0,
    # then roll the remaining highlights off instead of hard-clipping the windows.
    lin /= 0.26
    lin = lin * (1.0 + lin / 9.0) / (1.0 + lin)        # extended Reinhard, white=3

    out = (srgb_encode(lin) * 255.0 + 0.5).astype(np.uint8)
    cv2.imwrite(os.path.join(A.outdir, "%05d.jpg" % idx),
                cv2.cvtColor(out, cv2.COLOR_RGB2BGR),
                [cv2.IMWRITE_JPEG_QUALITY, A.quality])
    idx += 1

print("wrote %d frames (from %d source frames)" % (idx - A.start_index, src), file=sys.stderr)
