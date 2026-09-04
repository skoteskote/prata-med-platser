#!/usr/bin/env bash
#
# video -> 3D Gaussian splat -> self-hosted browser viewer.
#
#   ./run.sh              run every stage that has not completed
#   ./run.sh 3 4 5        run only these stages
#   ./run.sh --redo 3     forget stage 3's completion stamp, then run everything
#   ./run.sh --list       show stage status
#
# Every stage writes to its own directory and is skipped when it has already
# finished (stamps live in .stamps/), so a failure late in the run never repeats
# COLMAP. All command output is logged to logs/<stage>.log.
#
# Everything runs locally. Nothing is uploaded anywhere.
set -uo pipefail
cd "$(dirname "$0")"

STAGES=(env frames colmap train transform web)
declare -a SCRIPTS=(
  scripts/stage0_env.sh
  scripts/stage1_frames.sh
  scripts/stage2_colmap.sh
  scripts/stage3_train.sh
  scripts/stage4_transform.sh
  scripts/stage5_web.sh
)

usage() { sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'; exit 0; }

list() {
  printf '%-4s %-10s %-9s %s\n' "#" "STAGE" "STATUS" "SCRIPT"
  for i in "${!STAGES[@]}"; do
    if [ -f ".stamps/${STAGES[$i]}.done" ]; then st="done"; else st="pending"; fi
    printf '%-4s %-10s %-9s %s\n' "$i" "${STAGES[$i]}" "$st" "${SCRIPTS[$i]}"
  done
  exit 0
}

SELECT=()
while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help) usage ;;
    --list) list ;;
    --redo) shift; rm -f ".stamps/${STAGES[$1]}.done"; echo "cleared stamp for stage $1 (${STAGES[$1]})"; shift ;;
    [0-5]) SELECT+=("$1"); shift ;;
    *) echo "unknown argument: $1"; usage ;;
  esac
done
[ ${#SELECT[@]} -eq 0 ] && SELECT=(0 1 2 3 4 5)

START=$SECONDS
for i in "${SELECT[@]}"; do
  echo
  echo "################ stage $i: ${STAGES[$i]} ################"
  bash "${SCRIPTS[$i]}"
  rc=$?
  if [ "$rc" != "0" ]; then
    # Stage 2 exits non-zero when its registration checkpoint fails. That is a
    # report-and-stop condition, not a crash: the model is on disk either way.
    if [ "$i" = "2" ] && [ -f ".stamps/colmap.done" ]; then
      echo
      echo "!! stage 2 finished but its registration checkpoint FAILED - see logs/colmap.log."
      echo "!! Training on a broken reconstruction wastes an hour, so stopping here."
      echo "!! Override with: ./run.sh 3 4 5"
      exit 2
    fi
    echo "!! stage $i (${STAGES[$i]}) failed with exit $rc - see logs/${STAGES[$i]}.log"
    exit "$rc"
  fi
done

echo
echo "################ done in $(( (SECONDS - START) / 60 )) min ################"
echo "View locally:  cd web && python3 -m http.server 8000   # then open http://localhost:8000"
echo "Fallback:      open web-fallback/index.html"
