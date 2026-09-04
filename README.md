# Warehouse interior — 3D Gaussian splat

A large timber-framed warehouse interior, reconstructed from a single handheld
iPhone clip and rendered in the browser.

**▶ [View it live](https://skoteskote.github.io/prata-med-platser/)**

Drag to orbit · right-drag or two fingers to pan · scroll to zoom ·
**W A S D** to fly · Q/E down/up · Shift to move faster · R to reset.

| | |
|---|---|
| Source | 391 s handheld iPhone clip, 1080×1920, HLG/BT.2020 HDR |
| Frames used | 1,200 of 11,730 (sharpest per time bucket) |
| Registered by COLMAP | 918 (76.5%), 0.91 px mean reprojection error |
| Splats | 2,000,000, SH degree 3 |
| Payload | 29.7 MB `.sog` (15× smaller than the 449 MB PLY) |

Everything ran locally on an Apple M1 Max. No CUDA-dependent tool was used and
nothing was uploaded to a reconstruction service.

**[REPORT.md](REPORT.md)** is the full write-up: the HDR tonemapping, the
sharpness-based frame selection, why COLMAP registration fell short of the 90%
checkpoint, and what a re-shoot would need to do differently.

## Reproducing

The heavy directories (`input/`, `frames/`, `colmap/`, `splat/`, `tools/`) are
gitignored — together they are about 3.2 GB and all are regenerable:

```sh
./run.sh          # runs every stage that has not completed yet
./run.sh --list   # stage status
```

Stages are stamped in `.stamps/` and each logs to `logs/<stage>.log`.

## Viewing locally

```sh
cd web && python3 -m http.server 8000
# open http://localhost:8000
```

## Deployment

`.github/workflows/pages.yml` publishes `web/` to GitHub Pages on every push to
`main`. The site is about 36 MB, comfortably inside the 1 GB Pages site limit
and the 100 MiB per-file limit.
