import { defineConfig } from "vite";
import { resolve } from "node:path";

// Builds into ../web as plain, self-contained static files. Everything
// (three.js + Spark) is bundled in, so web/ has no CDN dependency at runtime.
// emptyOutDir is off because stage 4 has already written the splat, poster and
// scene-info.json into web/assets before this runs.
//
// Two pages:
//   index.html  the splat viewer
//   map/        the workshop drawing sheet, kept a separate entry so it never
//               pulls in three.js or the 30 MB splat
export default defineConfig({
  base: "./",
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
      },
      output: {
        entryFileNames: "app/[name].js",
        chunkFileNames: "app/[name].js",
        assetFileNames: "app/[name][extname]",
      },
    },
  },
});
