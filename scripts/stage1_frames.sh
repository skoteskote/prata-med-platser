#!/usr/bin/env bash
# Stage 1 - extract training frames from the video.
#
# Rather than sampling on a fixed fps grid, this scores every one of the source
# frames for sharpness and then takes the sharpest frame in each equal-length
# time bucket. Same average rate and same coverage, much sharper frames. The
# first attempt at this pipeline used a fixed grid plus a 15% blur cull and
# COLMAP registered only 50% of the images; frames that failed to register had
# roughly a third of the sharpness of those that succeeded, so frame selection
# was the thing to fix. See REPORT.md.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
already_done frames && exit 0
stage_start frames

VIDEO="$(ls "$ROOT/input"/*.[Mm][OoPp4Vv]* 2>/dev/null | head -1)"
[ -n "$VIDEO" ] || die "no video found in $ROOT/input"
say "input: $VIDEO ($(human_size "$VIDEO"))"

# --- probe -------------------------------------------------------------------
probe() { ffprobe -v error -select_streams v:0 -show_entries "$1" -of default=nw=1:nk=1 "$VIDEO" | head -1; }
DUR=$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$VIDEO")
CODED_W=$(probe stream=width); CODED_H=$(probe stream=height)
RFR=$(probe stream=r_frame_rate); AFR=$(probe stream=avg_frame_rate)
CODEC=$(probe stream=codec_name); PIXFMT=$(probe stream=pix_fmt)
TRC=$(probe stream=color_transfer); PRIM=$(probe stream=color_primaries); SPACE=$(probe stream=color_space)
NBF=$(probe stream=nb_frames)
ROT=$(ffprobe -v error -select_streams v:0 -show_entries stream_side_data=rotation -of default=nw=1:nk=1 "$VIDEO" | head -1)
ROT=${ROT:-0}

# ffmpeg applies the display rotation, so extracted frames are transposed
# relative to the coded size for +/-90 degree rotations.
case "$ROT" in
  -90|90|270) OUT_W=$CODED_H; OUT_H=$CODED_W ;;
  *)          OUT_W=$CODED_W; OUT_H=$CODED_H ;;
esac

VFR=$("$VENV_PY" - "$RFR" "$AFR" <<'PY'
import sys
from fractions import Fraction
r, a = (Fraction(x) for x in sys.argv[1:3])
print("yes (r=%.4f fps, avg=%.4f fps)" % (float(r), float(a))
      if abs(float(r) - float(a)) > 0.01 else "no (constant %.4f fps)" % float(a))
PY
)

say "  duration:    ${DUR}s"
say "  coded size:  ${CODED_W}x${CODED_H}, rotation ${ROT} -> extracted ${OUT_W}x${OUT_H}"
say "  codec:       $CODEC, pix_fmt $PIXFMT, $NBF frames"
say "  colour:      trc=$TRC primaries=$PRIM matrix=$SPACE"
say "  frame rate:  r=$RFR avg=$AFR ; variable frame rate: $VFR"

TARGET_FRAMES=${TARGET_FRAMES:-1200}
say ""
say "  selection arithmetic:"
say "    $NBF source frames / $TARGET_FRAMES buckets = $("$VENV_PY" -c "print('%.1f' % ($NBF/$TARGET_FRAMES))") source frames per bucket"
say "    average rate $("$VENV_PY" -c "print('%.2f' % ($TARGET_FRAMES/$DUR))") fps over ${DUR}s"
say "    one frame is taken per bucket, so there are no gaps in the sequence at all"

# --- 1a. sharpness of every source frame -------------------------------------
SCORES="$LOGS/sharpness_allframes.csv"
if [ ! -s "$SCORES" ]; then
  say ""
  say "+ scoring sharpness (variance of Laplacian) for all $NBF frames"
  t0=$SECONDS
  ffmpeg -hide_banner -loglevel error -i "$VIDEO" -vf "scale=320:-2,format=gray" \
    -pix_fmt gray -f rawvideo - 2>>"$STAGE_LOG" \
  | "$VENV_PY" "$ROOT/scripts/scan_sharpness.py" --width 320 --height 568 --out "$SCORES" 2>&1 | tee -a "$STAGE_LOG"
  [ -s "$SCORES" ] || die "sharpness scan produced nothing"
  say "  scored in $((SECONDS - t0))s -> logs/$(basename "$SCORES")"
else
  say "[skip] sharpness scores already computed"
fi

# --- 1b. pick the sharpest frame per bucket ----------------------------------
say ""
say "+ selecting the sharpest frame in each of $TARGET_FRAMES buckets"
run_v "$VENV_PY" "$ROOT/scripts/pick_frames.py" --scores "$SCORES" \
  --target "$TARGET_FRAMES" --total-frames "$NBF" \
  --out "$ROOT/.stamps/selected_frames.txt" --report "$LOGS/sharpness.csv" \
  || die "frame selection failed"

# --- 1c. extract and tonemap the selected frames -----------------------------
# The source is 10-bit HLG / BT.2020 (iPhone HDR). Decoding it as plain BT.709
# gives flat, milky frames, and this ffmpeg build has neither zscale nor
# libplacebo, so we pipe RGB48 into our own HLG->BT.709 tonemapper. It reads
# every frame and keeps only the selected ones: piping the lot costs ~70s, while
# ffmpeg's select filter cannot parse a thousand eq(n,..) terms.
rm -rf "$ROOT/frames"; mkdir -p "$ROOT/frames"
say ""
say "+ extracting $TARGET_FRAMES frames at ${OUT_W}x${OUT_H}, HLG -> BT.709 tonemapped"
t0=$SECONDS
ffmpeg -hide_banner -loglevel error -i "$VIDEO" \
  -vf "scale=in_color_matrix=${SPACE}:in_range=tv:out_range=pc" \
  -pix_fmt rgb48le -f rawvideo - 2>>"$STAGE_LOG" \
| "$VENV_PY" "$ROOT/scripts/hlg_tonemap.py" \
    --width "$OUT_W" --height "$OUT_H" --outdir "$ROOT/frames" --quality 95 \
    --select "$ROOT/.stamps/selected_frames.txt" 2>&1 | tee -a "$STAGE_LOG"

NKEPT=$(ls "$ROOT/frames" | wc -l | tr -d ' ')
[ "$NKEPT" -gt 0 ] || die "no frames extracted"
say "  extracted $NKEPT frames in $((SECONDS - t0))s ($(human_size "$ROOT/frames"))"
say "  per-frame scores and bucket assignments: logs/sharpness.csv"
stage_complete frames
