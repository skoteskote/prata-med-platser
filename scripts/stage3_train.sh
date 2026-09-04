#!/usr/bin/env bash
# Stage 3 - train the Gaussian splat with Brush (MCMC-style, splat-capped).
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
already_done train && exit 0
stage_start train

UNDIST="$ROOT/colmap/undistorted"
OUT="$ROOT/splat"
[ -d "$UNDIST/sparse" ] || die "no undistorted COLMAP model at $UNDIST - run stage 2 first"
mkdir -p "$OUT"

# Brush 0.3 trains MCMC-style by default (see its CHANGELOG: "Brush now trains
# using the MCMC splatting technique ... You can set a limit of the maximum
# number of splats like in the original MCMC"), so --max-splats *is* the cap.
MAX_SPLATS=${MAX_SPLATS:-2000000}
STEPS=${STEPS:-30000}
MAX_RES=${MAX_RES:-1920}

NIMG=$(ls "$UNDIST/images" | wc -l | tr -d ' ')
say "dataset:     $UNDIST ($NIMG undistorted images)"
say "splat cap:   $MAX_SPLATS"
say "steps:       $STEPS"
say "max res:     $MAX_RES"
say "free disk:   $(df -h "$ROOT" | tail -1 | awk '{print $4}')"

# Only export at the end plus one mid-run checkpoint: a 2M-splat PLY is ~0.5 GB
# and disk here is tight.
EXPORT_EVERY=$(( STEPS / 2 ))

say ""
say "+ brush_app (streaming progress to logs/train.log)"
t0=$SECONDS
"$BRUSH" "$UNDIST" \
  --total-steps "$STEPS" \
  --max-splats "$MAX_SPLATS" \
  --max-resolution "$MAX_RES" \
  --eval-split-every 8 \
  --eval-every 5000 \
  --export-every "$EXPORT_EVERY" \
  --export-path "$OUT" \
  --export-name "export_{iter}.ply" \
  2>&1 | tee -a "$STAGE_LOG"
RC=${PIPESTATUS[0]}
ELAPSED=$((SECONDS - t0))
say ""
say "brush exited $RC after ${ELAPSED}s ($((ELAPSED/60)) min)"
[ "$RC" = "0" ] || die "brush training failed"

FINAL=$(ls -1 "$OUT"/export_*.ply 2>/dev/null | sort -V | tail -1)
[ -n "$FINAL" ] || die "brush produced no PLY export"
# hard link, not a copy: these PLYs are ~0.5 GB and disk here is tight
ln -f "$FINAL" "$OUT/scene.ply"
say "final export: $FINAL -> splat/scene.ply ($(human_size "$OUT/scene.ply"))"

# Keep only the final PLY; intermediates are ~0.5 GB each.
for f in "$OUT"/export_*.ply; do rm -f "$f"; done   # scene.ply keeps the data alive

say ""
say "--- eval metrics reported by brush ---"
METRICS=$(grep -iE "psnr|ssim" "$STAGE_LOG" | tail -20)
say "${METRICS:-(brush emitted no psnr/ssim lines)}"

stage_complete train
