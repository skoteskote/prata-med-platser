import { defineConfig } from "vite";

// Builds the viewer into ../web as plain, self-contained static files.
// Everything (three.js + Spark) is bundled in, so web/ has no CDN or network
// dependency at runtime. emptyOutDir is off because stage 4 has already written
// the splat, poster and scene-info.json into web/assets before this runs.
export default defineConfig({
  base: "./",
  build: {
    outDir: "../web",
    emptyOutDir: false,
    assetsDir: "app",
    target: "es2020",
    sourcemap: false,
    rollupOptions: {
      output: {
        entryFileNames: "app/[name].js",
        chunkFileNames: "app/[name].js",
        assetFileNames: "app/[name][extname]",
      },
    },
  },
});
