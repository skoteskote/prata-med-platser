#!/usr/bin/env bash
# Stage 4 - inspect, conservatively crop floaters, compress to SOG.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
already_done transform && exit 0
stage_start transform

SPLAT="$ROOT/splat"
PLY="$SPLAT/scene.ply"
MODEL="$(cat "$ROOT/colmap/.best_model" 2>/dev/null)"
[ -f "$PLY" ] || die "no $PLY - run stage 3 first"
[ -d "$MODEL" ] || die "no COLMAP model recorded"

say "input PLY: $PLY ($(human_size "$PLY"))"
say ""
say "+ splat-transform summary (--summary is what 2.7.1 calls the old --info)"
splat_count() { splat-transform "$1" null --summary 2>/dev/null | sed -n 's/^\*\*Row Count:\*\* *//p' | head -1; }
run_v splat-transform "$PLY" null --summary || die "splat-transform summary failed"
PLY_COUNT=$(splat_count "$PLY")
say "  splat count: ${PLY_COUNT:-unknown}"

# --- conservative crop -------------------------------------------------------
say ""
mkdir -p "$ROOT/web/assets"
say "+ deriving crop box, world up and start camera from the COLMAP model"
run_v "$VENV_PY" "$ROOT/scripts/scene_info.py" --model "$MODEL" --inflate 0.5 \
  --out-box "$SPLAT/cropbox.txt" --out-json "$ROOT/web/assets/scene-info.json" || die "bbox derivation failed"
BOX=$(cat "$SPLAT/cropbox.txt")
say "  box: $BOX"

say ""
say "+ filtering NaN/Inf and cropping to the box"
run_v splat-transform -w "$PLY" --filter-nan --filter-box "$BOX" "$SPLAT/scene_crop.ply" \
  || die "crop failed"

CROP_COUNT=$(splat_count "$SPLAT/scene_crop.ply")
KEPT_PCT=$("$VENV_PY" -c "print('%.1f' % (100.0*$CROP_COUNT/$PLY_COUNT))")
say "  splats: $PLY_COUNT -> $CROP_COUNT (kept ${KEPT_PCT}%)"

# A crop this generous should never remove much. If it did, the splat is not in
# the COLMAP world frame and cropping would be actively destructive - so skip it.
USE="$SPLAT/scene_crop.ply"
if "$VENV_PY" -c "import sys; sys.exit(0 if $KEPT_PCT < 60.0 else 1)"; then
  say "  WARNING: crop removed over 40% of the splats, which a box this generous"
  say "  should never do. Treating the box as untrustworthy and using the uncropped"
  say "  PLY instead (the brief says err heavily towards keeping things)."
  USE="$PLY"
fi
ln -f "$USE" "$SPLAT/final.ply"
say "  using: $USE -> splat/final.ply ($(human_size "$SPLAT/final.ply"))"

# --- poster frame ------------------------------------------------------------
# Rendered straight from the splat by splat-transform's GPU rasterizer, using the
# start camera derived from the COLMAP poses, so the page shows the actual scene
# while the .sog downloads instead of a blank canvas.
WEB="$ROOT/web"
mkdir -p "$WEB/assets"
POSE=$("$VENV_PY" -c "
import json;d=json.load(open('$WEB/assets/scene-info.json'))
f=lambda v:','.join('%.5f'%x for x in v)
print(f(d['start']['position']), f(d['start']['target']), f(d['up']))
")
set -- $POSE
say ""
say "+ rendering poster frame (camera $1, look-at $2, up $3)"
if run_v splat-transform -w "$SPLAT/final.ply" "$WEB/assets/poster.webp" \
      --camera "$1" --look-at "$2" --up "$3" --fov 70 --resolution 1280x720 \
      --background 0.08,0.09,0.11,1; then
  say "  poster: $(human_size "$WEB/assets/poster.webp")"
else
  say "  WARNING: poster render failed; viewer will fall back to a plain backdrop"
  rm -f "$WEB/assets/poster.webp"
fi

# --- SOG compression ---------------------------------------------------------
say ""
say "+ SOG compression (GPU first, -g cpu on failure)"
if ! run_v splat-transform -w "$SPLAT/final.ply" "$WEB/assets/scene.sog"; then
  say "  GPU SOG failed - retrying with -g cpu"
  run_v splat-transform -w -g cpu "$SPLAT/final.ply" "$WEB/assets/scene.sog" \
    || die "SOG compression failed on CPU too"
fi

SOG_BYTES=$(stat -f%z "$WEB/assets/scene.sog")
say ""
say "  PLY: $(human_size "$SPLAT/final.ply")  ->  SOG: $(human_size "$WEB/assets/scene.sog")"
say "  ratio: $("$VENV_PY" -c "print('%.1fx' % ($(stat -f%z "$SPLAT/final.ply")/$SOG_BYTES))")"

# --- streamed SOG if the single file is too heavy ----------------------------
ASSET_KIND="sog"
if [ "$SOG_BYTES" -gt $((60 * 1024 * 1024)) ]; then
  say ""
  say "  SOG is over 60 MB - generating streamed multi-LOD SOG as well"
  mkdir -p "$WEB/assets/lod"
  if run_v splat-transform -w "$SPLAT/final.ply" "$WEB/assets/lod/lod-meta.json"; then
    ASSET_KIND="lod"
    say "  streamed SOG: $(human_size "$WEB/assets/lod") across $(ls "$WEB/assets/lod" | wc -l | tr -d ' ') files"
  else
    say "  streamed SOG generation failed; viewer will load the single .sog"
  fi
fi
echo "$ASSET_KIND" > "$WEB/assets/.kind"
say ""
say "viewer asset kind: $ASSET_KIND"

stage_complete transform
