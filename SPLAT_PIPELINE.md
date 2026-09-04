# Task: video → 3D Gaussian splat → self-hosted browser viewer

## What you're given

- One video file in `./input/` — handheld footage of a **large room interior**.
- A macOS machine (assume Apple Silicon, Metal, **no CUDA**).
- Nothing else. The operator does not want to be involved beyond answering the
  checkpoint questions in this document.

## What you must deliver

1. A reproducible pipeline (`run.sh` plus supporting scripts) that goes from the
   video file to a finished web viewer with no manual steps.
2. `web/` — a self-contained static directory that can be dropped on any static
   host and works offline. Contains the splat and a simple interactive viewer.
3. `REPORT.md` — what was run, timings, frame counts, splat counts, file sizes,
   and anything that went wrong.

## Hard constraints

- **Everything runs locally.** Do not upload the footage or the splat to any
  cloud service, including for "quick processing". This is non-negotiable.
- **No CUDA.** Do not attempt to install Nerfstudio, gsplat, the INRIA reference
  implementation, or Postshot. They will not work here.
- Each stage writes to its own directory and is **skippable if its output
  already exists**. The operator will re-run this script; it must not redo
  30 minutes of COLMAP because a later stage failed.
- Log every command and its output to `logs/<stage>.log`.
- Do not hardcode CLI flags from memory. For `brush` and `splat-transform`,
  run `--help` and read the current README before writing the invocation.
  Both tools are moving fast and flags have changed.

---

## Stage 0 — Environment

Check and install as needed:

- Homebrew, then `brew install ffmpeg colmap`
- Rust ≥ 1.88 (`rustup`)
- Node ≥ 20, then `npm install -g @playcanvas/splat-transform`
- Python 3 with `opencv-python` and `numpy` (venv, not system Python)

**Brush** (https://github.com/ArthurBrussee/brush): check the Releases page for
a prebuilt macOS binary first. If there isn't one, `cargo build --release` from
source. Confirm `brush --help` runs before continuing.

Write all resolved versions to `logs/env.txt`.

---

## Stage 1 — Frame extraction

- `ffprobe` the video. Report duration, resolution, fps, codec, and whether it
  is variable frame rate.
- **Target 400–800 extracted frames.** A large room needs the coverage; beyond
  ~1000 frames COLMAP matching time on CPU becomes painful. Compute the
  extraction fps from the duration to land in that window and state the
  arithmetic in the log.
- Extract at full resolution, high quality:
  `ffmpeg -i input.mp4 -vf fps=N -q:v 1 frames/%05d.jpg`
- **Sharpness filter.** Compute variance-of-Laplacian per frame. Drop the
  blurriest ~15%, but never drop more than one frame in any run of three
  consecutive frames — losing a contiguous block breaks the sequential matcher.
  Write the scores to `logs/sharpness.csv`.
- Report frames kept and dropped.

---

## Stage 2 — Camera poses (COLMAP)

This is the stage most likely to fail, and the one where failure is worth
stopping for. Large rooms have flat unmarked walls, which is precisely what
classical SfM is bad at.

- `feature_extractor` with `--ImageReader.single_camera 1` and camera model
  `OPENCV`. GPU SIFT is unreliable on macOS — if it errors, fall back to
  `--SiftExtraction.use_gpu 0` and accept the slower run.
- `sequential_matcher` (the input is video, so sequential is correct), **with
  loop detection enabled** via a vocabulary tree. Download the vocab tree from
  the COLMAP site if not present. Loop closure matters a lot in a room where
  you walk back past where you started.
- `mapper` to build the sparse model.
- `image_undistorter` to produce an undistorted image set plus sparse model.

**Checkpoint — stop here and report if any of these are true:**

- Fewer than 90% of input images registered.
- The reconstruction split into more than one component.
- Mean reprojection error above ~1.5 px.

Do not proceed to training on a broken reconstruction — it wastes an hour and
produces a mess that looks like a training problem but isn't. If it fails,
report the numbers and suggest what a re-shoot would need to fix.

---

## Stage 3 — Training (Brush)

- Brush reads COLMAP output directly. Point it at the undistorted model.
- Use the **MCMC** training mode with a splat cap. Start at **2 million splats**
  for a large room. This is the main quality/size dial.
- 30k steps as a baseline.
- Export **PLY**.
- Watch memory. Unified memory means training will page to swap rather than
  fail cleanly, which just makes it slow. If the machine starts swapping,
  reduce the splat cap or the training image resolution and note it.
- Report wall-clock time and any quality metric Brush emits.

---

## Stage 4 — Cleanup and compression

- Run `splat-transform --info` on the PLY. Report splat count and file size.
- **Conservative floater crop.** The operator is not in the loop, so do not
  hand-tune this. Derive an axis-aligned bounding box from the COLMAP camera
  positions plus a generous margin (the room is bigger than the walked path),
  and filter splats outside it. Err heavily towards keeping things — a few
  floaters are better than a clipped wall.
- Convert to **SOG**: `splat-transform scene.ply scene.sog`. This typically cuts
  size by 5–20x versus PLY. It uses WebGPU by default; if that fails on macOS,
  fall back to `-g cpu` (slower but always works).
- **If the resulting `.sog` is over ~60 MB**, generate Streamed SOG (multi-LOD
  chunks plus a `lod-meta.json` manifest) instead, and make the viewer load
  that. A room scan over a domestic connection needs it.
- Report before/after sizes.

---

## Stage 5 — Browser viewer

**Do the fallback first so there is always something that works:**

```
splat-transform scene.ply web-fallback/index.html
```

That emits a standalone single-file HTML viewer. Verify it opens and renders.
Only then build the real one.

**The viewer to build** — `web/`, a simple static page:

- Renders the `.sog` (or streamed SOG) produced in Stage 4.
- Orbit controls with mouse/trackpad, plus touch support. Add WASD fly
  navigation as well — it's a room, people will want to walk it.
- A loading indicator with real progress, and a poster frame so the page isn't
  blank while a large asset downloads.
- Configurable background colour in one obvious place.
- **No CDN dependencies.** Vendor everything into `web/` so the directory works
  offline and won't break when a CDN changes. No analytics, no external calls.
- Must work in Safari. Use a **WebGL2** renderer, not WebGP-only —
  `@sparkjsdev/spark` (Three.js) is the sensible choice and reads `.sog`
  directly. `@playcanvas/supersplat-viewer` is the alternative if Spark gives
  trouble; it self-hosts as a single-file HTML export or an npm package.
- Keep it genuinely simple. One page, minimal chrome, no framework beyond what
  the renderer needs. If a build step is unavoidable, use Vite and commit the
  built output to `web/` so the directory is directly hostable.

Test with `python3 -m http.server` in `web/` and confirm it renders. If you can
drive a headless browser, capture a screenshot into `REPORT.md`.

---

## Report back to the operator at these points only

1. **After Stage 2** if the registration checkpoint fails.
2. **After Stage 3**, with a rendered still from the trained splat, before
   spending time on the web side.
3. **At the end**, with the report and the command to view it locally.

Otherwise, run through. Don't ask permission for routine decisions — make the
call, do it, and record what you chose and why in `REPORT.md`.

---

## Known failure modes — expect these, don't be surprised

- **Mirrors and glass** produce artefacts. Windows are worse: the exterior gets
  reconstructed as a smear behind the glass. Nothing to be done at this stage;
  just note where it happens.
- **Thin linear structures** — cables, railings, light fittings, chair legs —
  come out badly. Gaussians represent them poorly.
- **Changing daylight across the capture** breaks photometric consistency and
  causes ghosting. If you see brightness drift across the frame sequence,
  report it, because it explains quality problems that look like training
  failures.
- **Blank walls** will have the fewest splats and the worst geometry. This is
  expected in a room scan and is not fixable downstream.
