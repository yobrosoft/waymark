import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";

mkdirSync("public", { recursive: true });
copyFileSync(
  "node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs",
  "public/maplibre-gl-worker.js",
);
writeFileSync("public/.nojekyll", "");
