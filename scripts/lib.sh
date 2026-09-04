# Shared helpers for the splat pipeline. Sourced by every stage.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOGS="$ROOT/logs"
VENV_PY="$ROOT/.venv/bin/python"
BRUSH="$ROOT/tools/brush-app-aarch64-apple-darwin/brush_app"
mkdir -p "$LOGS"

STAGE_LOG=""

stage_start() {           # stage_start <name>
  STAGE_LOG="$LOGS/$1.log"
  : > "$STAGE_LOG"
  say "=== stage '$1' started $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
}

say() { echo "$*" | tee -a "${STAGE_LOG:-/dev/null}"; }

# Run a command, echoing it and tee-ing all output into the stage log.
run() {
  say "+ $*"
  local start=$SECONDS
  "$@" >> "${STAGE_LOG:-/dev/stdout}" 2>&1
  local rc=$?
  say "  -> exit $rc after $((SECONDS - start))s"
  return $rc
}

# Same, but the command's stdout is also echoed to the terminal.
run_v() {
  say "+ $*"
  local start=$SECONDS
  "$@" 2>&1 | tee -a "${STAGE_LOG:-/dev/stdout}"
  local rc=${PIPESTATUS[0]}
  say "  -> exit $rc after $((SECONDS - start))s"
  return $rc
}

done_marker() { echo "$ROOT/.stamps/$1.done"; }

stage_complete() { mkdir -p "$ROOT/.stamps"; date -u +%Y-%m-%dT%H:%M:%SZ > "$(done_marker "$1")"; }

# Returns 0 (skip) when the stage already finished.
already_done() {
  if [ -f "$(done_marker "$1")" ]; then
    echo "[skip] stage '$1' already complete ($(cat "$(done_marker "$1")")). Delete .stamps/$1.done to redo."
    return 0
  fi
  return 1
}

die() { say "FATAL: $*"; exit 1; }

human_size() { du -sh "$1" 2>/dev/null | cut -f1; }
