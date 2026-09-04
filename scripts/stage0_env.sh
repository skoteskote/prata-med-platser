#!/usr/bin/env bash
# Stage 0 - environment: verify/install tools, record resolved versions.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
stage_start env

need_brew_pkg() {   # need_brew_pkg <binary> <formula>
  if command -v "$1" >/dev/null 2>&1; then say "  $1 present"; else
    say "  installing $2 via brew"; run brew install "$2" || die "brew install $2 failed"
  fi
}

command -v brew >/dev/null 2>&1 || die "Homebrew is required; install from https://brew.sh"
need_brew_pkg ffmpeg ffmpeg
need_brew_pkg colmap colmap

# Node / splat-transform
command -v node >/dev/null 2>&1 || die "Node >= 20 is required"
if ! command -v splat-transform >/dev/null 2>&1; then
  run npm install -g @playcanvas/splat-transform || die "splat-transform install failed"
fi

# Python venv with numpy + opencv (never system python)
if [ ! -x "$VENV_PY" ]; then
  run python3 -m venv "$ROOT/.venv" || die "venv creation failed"
  run "$ROOT/.venv/bin/pip" install --upgrade pip
  run "$ROOT/.venv/bin/pip" install opencv-python numpy || die "pip install failed"
fi

# Rust (only needed if we have to build brush from source)
if [ ! -x "$HOME/.cargo/bin/rustc" ]; then
  run bash -c "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --no-modify-path" || \
    say "  WARN: rustup install failed (only needed to build brush from source)"
fi

# Brush: prefer the prebuilt macOS arm64 release binary; build from source only if absent.
if [ ! -x "$BRUSH" ]; then
  say "  fetching prebuilt brush release for aarch64-apple-darwin"
  mkdir -p "$ROOT/tools" && pushd "$ROOT/tools" >/dev/null
  ASSET=$(curl -sL https://api.github.com/repos/ArthurBrussee/brush/releases/latest \
          | "$VENV_PY" -c "import json,sys;print(next((a['browser_download_url'] for a in json.load(sys.stdin)['assets'] if a['name'].endswith('aarch64-apple-darwin.tar.xz')),''))")
  if [ -n "$ASSET" ]; then
    run curl -sL -o brush.tar.xz "$ASSET" && run tar xf brush.tar.xz && rm -f brush.tar.xz
  fi
  popd >/dev/null
fi
[ -x "$BRUSH" ] || die "brush binary not available at $BRUSH (no prebuilt release; build with 'cargo build --release' from https://github.com/ArthurBrussee/brush)"
xattr -c "$BRUSH" 2>/dev/null || true
run_v "$BRUSH" --version || die "brush --help/--version does not run"

# COLMAP vocabulary tree for loop detection.
# Not downloaded: COLMAP 4.1.1 reads faiss trees, and the ones published on
# demuc.de are still the pre-May-2025 flann format, which aborts the matcher.
# Stage 2 builds a small faiss tree from the dataset's own descriptors instead.

{
  echo "# Resolved environment - $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "host:            $(sysctl -n machdep.cpu.brand_string), $(sysctl -n hw.ncpu) CPU cores, $(( $(sysctl -n hw.memsize) / 1024**3 )) GB unified memory"
  echo "macOS:           $(sw_vers -productVersion) ($(uname -m))"
  echo "homebrew:        $(brew --version | head -1)"
  echo "ffmpeg:          $(ffmpeg -version | head -1)"
  echo "colmap:          $(colmap -h 2>&1 | head -1)"
  echo "node:            $(node --version)"
  echo "npm:             $(npm --version)"
  echo "splat-transform: $(splat-transform --help 2>&1 | head -1)"
  echo "python (venv):   $("$VENV_PY" --version)"
  echo "  numpy:         $("$VENV_PY" -c 'import numpy;print(numpy.__version__)')"
  echo "  opencv:        $("$VENV_PY" -c 'import cv2;print(cv2.__version__)')"
  echo "rustc:           $("$HOME/.cargo/bin/rustc" --version 2>&1 | head -1)"
  echo "cargo:           $("$HOME/.cargo/bin/cargo" --version 2>&1 | head -1)"
  echo "brush:           $("$BRUSH" --version 2>&1 | head -1)  [prebuilt release binary]"
} > "$LOGS/env.txt"

say "--- logs/env.txt ---"; cat "$LOGS/env.txt" | tee -a "$STAGE_LOG"
stage_complete env
