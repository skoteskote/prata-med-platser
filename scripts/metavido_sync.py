#!/usr/bin/env python3
"""Time offset between two Metavido takes of the same moment, from their audio.

    python scripts/metavido_sync.py A.MOV B.MOV --guess 341.08 --at 598 [--window 40]

Prints how many seconds after A's video t=0 B's video t=0 happened, refined
from `--guess` (e.g. from the sidecar headers' startedAtServerMs) by cross-
correlating the two phones' audio over `--window` seconds around B's time
`--at`. The sidecar README says it plainly: "audio is what aligns frames";
the server-time start is only good to the phones' clock error.
"""
import argparse, subprocess
import numpy as np

SR = 8000


def audio(path, start, dur):
    r = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{start:.3f}", "-i", path, "-t", f"{dur:.3f}",
                        "-map", "0:a:0", "-ac", "1", "-ar", str(SR), "-f", "s16le", "-"],
                       capture_output=True, check=True)
    x = np.frombuffer(r.stdout, np.int16).astype(np.float32)
    # Envelope-ish whitening: speech energy, not microphone colour, should match.
    x = x - x.mean()
    return x / (np.std(x) + 1e-6)


def xcorr(a, b, max_lag):
    n = 1 << int(np.ceil(np.log2(len(a) + len(b))))
    A, B = np.fft.rfft(a, n), np.fft.rfft(b, n)
    # PHAT weighting: robust to the two microphones' different responses.
    R = A * np.conj(B)
    R /= np.abs(R) + 1e-9
    c = np.fft.irfft(R, n)
    lags = np.r_[np.arange(0, max_lag), np.arange(-max_lag, 0)]
    vals = np.r_[c[:max_lag], c[-max_lag:]]
    i = np.argmax(vals)
    order = np.sort(vals)[::-1]
    return lags[i] / SR, vals[i], vals[i] / (np.median(np.abs(vals)) + 1e-12)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("a")
    ap.add_argument("b")
    ap.add_argument("--guess", type=float, required=True, help="B starts this many s after A (rough)")
    ap.add_argument("--at", type=float, required=True, help="time in B to sync around")
    ap.add_argument("--window", type=float, default=40)
    ap.add_argument("--search", type=float, default=3, help="+- seconds around the guess")
    args = ap.parse_args()
    for at in (args.at - args.window, args.at, args.at + args.window):
        if at < 0:
            continue
        b = audio(args.b, at, args.window)
        a = audio(args.a, at + args.guess - args.search, args.window + 2 * args.search)
        # a[k] corresponds to B time at - search + k/SR; find where b sits inside a
        lag, peak, ratio = xcorr(a, b, int((2 * args.search + 1) * SR))
        offset = args.guess - args.search + lag
        print(f"around B t={at:7.1f}s: B starts {offset:.4f} s after A (peak {peak:.3f}, {ratio:.0f}x median)")


if __name__ == "__main__":
    main()
