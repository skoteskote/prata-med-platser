import { defineConfig } from "vite";
import { resolve, join, normalize, extname } from "node:path";
import { createReadStream, statSync } from "node:fs";

// Builds into ../web as plain, self-contained static files. Everything
// (three.js + Spark) is bundled in, so web/ has no CDN dependency at runtime.
// emptyOutDir is off because stage 4 has already written the splat, poster and
// scene-info.json into web/assets before this runs.
//
// Three pages:
//   index.html  the splat viewer
//   map/        the workshop drawing sheet, kept a separate entry so it never
//               pulls in three.js or the 30 MB splat
//   video/      the volumetric (Metavido) video viewer: three.js, never Spark
//               or the splat

// The heavy assets (scene.sog, the Metavido clips and their sidecars) are
// written straight into web/assets by the pipeline scripts and never pass
// through Vite. In `vite build` that is fine: the pages ask for ../assets/...
// relative to web/. Under `vite` (dev) the root is web-src, which does not have
// them, so serve web/assets as a fallback, with byte ranges so <video> can seek.
const BUILT_ASSETS = resolve(import.meta.dirname, "../web/assets");
const TYPES = { ".mp4": "video/mp4", ".json": "application/json", ".sog": "application/octet-stream",
                ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg" };
function serveBuiltAssets() {
  return {
    name: "serve-built-assets",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = decodeURIComponent((req.url || "").split("?")[0]);
        if (!url.startsWith("/assets/")) return next();
        const file = normalize(join(BUILT_ASSETS, url.slice("/assets/".length)));
        if (!file.startsWith(BUILT_ASSETS)) return next();
        let st;
        try { st = statSync(file); } catch { return next(); }
        if (!st.isFile()) return next();
        const type = TYPES[extname(file).toLowerCase()] || "application/octet-stream";
        const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || "");
        res.setHeader("Accept-Ranges", "bytes");
        res.setHeader("Content-Type", type);
        if (range) {
          const start = range[1] ? +range[1] : st.size - +range[2];
          const end = range[1] && range[2] ? Math.min(+range[2], st.size - 1) : st.size - 1;
          res.statusCode = 206;
          res.setHeader("Content-Range", `bytes ${start}-${end}/${st.size}`);
          res.setHeader("Content-Length", end - start + 1);
          createReadStream(file, { start, end }).pipe(res);
        } else {
          res.setHeader("Content-Length", st.size);
          createReadStream(file).pipe(res);
        }
      });
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [serveBuiltAssets()],
  build: {
    outDir: "../web",
    emptyOutDir: false,
    assetsDir: "app",
    target: "es2020",
    sourcemap: false,
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        map: resolve(import.meta.dirname, "map/index.html"),
        video: resolve(import.meta.dirname, "video/index.html"),
      },
      output: {
        entryFileNames: "app/[name].js",
        chunkFileNames: "app/[name].js",
        assetFileNames: "app/[name][extname]",
      },
    },
  },
});
