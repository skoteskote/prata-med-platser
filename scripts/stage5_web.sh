#!/usr/bin/env bash
# Stage 5 - build the browser viewers: the single-file fallback first, then the
# real one. Everything is vendored so web/ works offline on any static host.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
already_done web && exit 0
stage_start web

SPLAT="$ROOT/splat"
WEB="$ROOT/web"
FALLBACK="$ROOT/web-fallback"
[ -f "$SPLAT/final.ply" ] || die "no $SPLAT/final.ply - run stage 4 first"

# --- fallback viewer first, so something always works ------------------------
say "+ fallback viewer (splat-transform's standalone single-file HTML export)"
mkdir -p "$FALLBACK"
if ! run_v splat-transform -w "$SPLAT/final.ply" "$FALLBACK/index.html"; then
  say "  GPU export failed - retrying with -g cpu"
  run_v splat-transform -w -g cpu "$SPLAT/final.ply" "$FALLBACK/index.html" \
    || die "fallback viewer export failed"
fi
say "  web-fallback/index.html: $(human_size "$FALLBACK/index.html")"

# --- the real viewer ---------------------------------------------------------
say ""
say "+ building web/ with Vite (three.js + @sparkjsdev/spark bundled in)"
cd "$ROOT/web-src" || die "web-src missing"
[ -d node_modules ] || run npm install
rm -rf "$WEB/app" "$WEB/index.html"
run_v npx vite build || die "vite build failed"
cd "$ROOT"

[ -f "$WEB/index.html" ] || die "vite produced no index.html"
say ""
say "web/ contents:"
find "$WEB" -type f -not -name ".*" | sed "s#$WEB#  web#" | sort | tee -a "$STAGE_LOG"
say ""
say "total: $(human_size "$WEB")"

# No CDN dependencies: nothing in the built output may actually load from an
# outside host. Bare https:// strings are not enough to judge - three.js is full
# of XML namespace URIs passed to createElementNS and documentation links in
# comments, neither of which touches the network. Look for real loads only.
say ""
say "+ offline check (no external loads in the built viewer)"
HITS=$(grep -ohE "(src|href)=[\"'][^\"']*https?://[^\"']*|fetch\([\"']https?://|importScripts\([\"']https?://|new Worker\([\"']https?://|@import[^;]*https?://" \
  "$WEB/index.html" "$WEB/app/"*.js "$WEB/app/"*.css 2>/dev/null)
if [ -n "$HITS" ]; then
  say "  FAIL - the viewer would load from the network:"
  echo "$HITS" | sed 's/^/    /' | tee -a "$STAGE_LOG"
  die "web/ is not self-contained"
fi
say "  clean: no script/style/fetch/worker target outside web/"
say "  (the remaining https:// strings are XML namespaces and doc links, not requests)"

stage_complete web
say ""
say "View it with:  cd web && python3 -m http.server 8000"
