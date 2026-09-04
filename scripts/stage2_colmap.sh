#!/usr/bin/env bash
# Stage 2 - camera poses with COLMAP. Each step is individually skippable.
#
# Tuning here is driven by what the first attempt actually showed: with default
# SIFT settings the images averaged only 3.5k keypoints, and of 176,715
# exhaustively matched pairs just 3,414 (1.9%) survived geometric verification.
# The reconstruction fragmented into 4 components and registered 50% of images.
# Blur, not missing loop closure, was the cause - so this run spends its budget
# on richer, more robust features rather than on more image pairs.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
already_done colmap && exit 0
stage_start colmap

IMG="$ROOT/frames"
CM="$ROOT/colmap"
DB="$CM/database.db"
SPARSE="$CM/sparse"
UNDIST="$CM/undistorted"
NIMG=$(ls "$IMG" | wc -l | tr -d ' ')
[ "$NIMG" -gt 0 ] || die "no images in $IMG - run stage 1 first"
mkdir -p "$CM"
say "images: $NIMG in $IMG"

# --- 2a. feature extraction --------------------------------------------------
# COLMAP 4.1.1 spells this --FeatureExtraction.use_gpu; the old
# --SiftExtraction.use_gpu no longer exists.
#   peak_threshold 0.004  - keeps weaker features, which is where blurred frames live
#   max_num_features 16384 - the cap actually binds on the sharp frames
#   domain_size_pooling   - DSP-SIFT, markedly better descriptors under blur/scale change
#   estimate_affine_shape - more robust to the oblique views in a walkthrough
# The last two are CPU-only in COLMAP, and cost ~0.6s/image here.
if [ ! -f "$CM/.features.done" ]; then
  say "+ feature_extractor (DSP-SIFT, affine shape, low peak threshold)"
  run colmap feature_extractor \
    --database_path "$DB" \
    --image_path "$IMG" \
    --ImageReader.single_camera 1 \
    --ImageReader.camera_model OPENCV \
    --SiftExtraction.max_num_features 16384 \
    --SiftExtraction.peak_threshold 0.004 \
    --SiftExtraction.domain_size_pooling 1 \
    --SiftExtraction.estimate_affine_shape 1 \
    --FeatureExtraction.use_gpu 0 \
    || die "feature_extractor failed"
  touch "$CM/.features.done"
else
  say "[skip] features already extracted"
fi
say "  keypoints/image: $(sqlite3 "$DB" 'select round(avg(rows)) from keypoints;' 2>/dev/null)"

# --- 2b. matching ------------------------------------------------------------
# Two passes into the same database (COLMAP merges match tables):
#
#  1. Sequential, with a generous overlap, for the local chain along the walk.
#  2. Vocabulary-tree retrieval for loop closure. This matters more than it
#     sounds: it is not only about closing a loop at the end, it is what bridges
#     the stretches where the camera moved too fast to chain frame-to-frame, by
#     linking them to a later, sharper pass over the same part of the room.
#     Sequential matching alone fragmented this scene into 17 components.
#
# The vocabulary tree has to be built locally: COLMAP 4.1.1 switched the format
# from flann to faiss in May 2025 and the trees published on demuc.de are still
# flann, so they abort the matcher on load. Keep it small - 16k words over 1.5M
# descriptors ran >10 min with no ETA, 4k words over 300k descriptors takes ~2.
#
# All matching is on CPU: GPU matching deadlocks on this machine, wedging inside
# IOGPUCommandQueueSubmitCommandBuffers at 0% CPU.
if [ ! -f "$CM/.seqmatch.done" ]; then
  say "+ sequential_matcher (overlap 25, quadratic) on CPU"
  run colmap sequential_matcher \
    --database_path "$DB" \
    --SequentialMatching.overlap 25 \
    --SequentialMatching.quadratic_overlap 1 \
    --SequentialMatching.loop_detection 0 \
    --FeatureMatching.use_gpu 0 \
    || die "sequential_matcher failed"
  touch "$CM/.seqmatch.done"
else
  say "[skip] sequential matches already computed"
fi
say "  after sequential: $(sqlite3 "$DB" 'select count(*) from two_view_geometries where rows>0;' 2>/dev/null) verified pairs"

VOCAB="$ROOT/tools/vocab_tree_faiss_4k.bin"
if [ ! -f "$CM/.matches.done" ]; then
  if [ ! -s "$VOCAB" ]; then
    say "+ vocab_tree_builder (small faiss tree from this dataset's descriptors)"
    run colmap vocab_tree_builder \
      --database_path "$DB" --vocab_tree_path "$VOCAB" \
      --num_visual_words 4096 --max_num_descriptors 300000 --num_iterations 10 \
      || { say "  vocab_tree_builder failed"; rm -f "$VOCAB"; }
  fi
  if [ -s "$VOCAB" ]; then
    say "+ vocab_tree_matcher for loop closure (top 60 retrievals per image)"
    run colmap vocab_tree_matcher \
      --database_path "$DB" \
      --VocabTreeMatching.vocab_tree_path "$VOCAB" \
      --VocabTreeMatching.num_images 60 \
      --FeatureMatching.use_gpu 0 \
      || die "vocab_tree_matcher failed"
  else
    say "  no vocabulary tree - falling back to exhaustive matching"
    run colmap exhaustive_matcher --database_path "$DB" \
      --ExhaustiveMatching.block_size 35 --FeatureMatching.use_gpu 0 \
      || die "exhaustive_matcher failed"
  fi
  touch "$CM/.matches.done"
else
  say "[skip] loop-closure matches already computed"
fi
say "  pairs with matches: $(sqlite3 "$DB" 'select count(*) from matches;' 2>/dev/null), geometrically verified: $(sqlite3 "$DB" 'select count(*) from two_view_geometries where rows>0;' 2>/dev/null)"

# --- 2c. mapping -------------------------------------------------------------
# Slightly more permissive than default: this footage is blurry enough that the
# default inlier counts reject views that are in fact fine.
if [ ! -f "$CM/.mapper.done" ]; then
  mkdir -p "$SPARSE"
  say "+ mapper (this is the slow one)"
  run colmap mapper --database_path "$DB" --image_path "$IMG" --output_path "$SPARSE" \
    --Mapper.abs_pose_min_num_inliers 20 \
    --Mapper.filter_max_reproj_error 6 \
    --Mapper.min_num_matches 12 \
    || die "mapper failed"
  touch "$CM/.mapper.done"
else
  say "[skip] mapper already run"
fi

# --- 2d. checkpoint ----------------------------------------------------------
COMPONENTS=$(find "$SPARSE" -maxdepth 1 -mindepth 1 -type d | wc -l | tr -d ' ')
say ""
say "reconstruction components: $COMPONENTS"

BEST=""; BEST_N=-1
for d in "$SPARSE"/*/; do
  [ -d "$d" ] || continue
  n=$(colmap model_analyzer --path "$d" 2>&1 | sed -n 's/.*Registered images: *//p' | head -1)
  n=${n:-0}
  say "  $(basename "$d"): $n registered images"
  if [ "$n" -gt "$BEST_N" ]; then BEST_N=$n; BEST="$d"; fi
done
[ -n "$BEST" ] || die "mapper produced no model"
BEST="${BEST%/}"
say "  largest model: $BEST"
echo "$BEST" > "$CM/.best_model"

ANALYSIS=$(colmap model_analyzer --path "$BEST" 2>&1)
say ""
say "--- model_analyzer $BEST ---"
say "$ANALYSIS"

REG=$(echo "$ANALYSIS" | sed -n 's/.*Registered images: *//p' | head -1)
ERR=$(echo "$ANALYSIS" | sed -n 's/.*Mean reprojection error: *//p' | head -1 | tr -d 'px')
PCT=$("$VENV_PY" -c "print('%.1f' % (100.0*$REG/$NIMG))")

say ""
say "=============== STAGE 2 CHECKPOINT ==============="
say " input images:            $NIMG"
say " registered:              $REG (${PCT}%)      [threshold: >= 90%]"
say " components:              $COMPONENTS        [threshold: 1]"
say " mean reprojection error: ${ERR} px  [threshold: <= 1.5 px]"
FAIL=0
"$VENV_PY" -c "import sys; sys.exit(0 if $PCT >= 90.0 else 1)" || { say " FAIL: under 90% of images registered"; FAIL=1; }
[ "$COMPONENTS" -gt 1 ] && { say " FAIL: reconstruction split into $COMPONENTS components"; FAIL=1; }
"$VENV_PY" -c "import sys; sys.exit(0 if $ERR <= 1.5 else 1)" || { say " FAIL: mean reprojection error above 1.5 px"; FAIL=1; }
if [ "$FAIL" = "0" ]; then say " PASS - all three checks clear"; else say " CHECKPOINT FAILED"; fi
say "================================================="
echo "$FAIL" > "$CM/.checkpoint_failed"

# --- 2e. undistortion --------------------------------------------------------
if [ ! -f "$CM/.undistort.done" ]; then
  say ""
  say "+ image_undistorter"
  run colmap image_undistorter --image_path "$IMG" --input_path "$BEST" \
      --output_path "$UNDIST" --output_type COLMAP || die "image_undistorter failed"
  touch "$CM/.undistort.done"
else
  say "[skip] already undistorted"
fi
say "  undistorted set: $(ls "$UNDIST/images" | wc -l | tr -d ' ') images, $(human_size "$UNDIST")"

stage_complete colmap
exit "$FAIL"
