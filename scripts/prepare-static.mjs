import { mkdirSync, writeFileSync } from "node:fs";

mkdirSync("public", { recursive: true });
writeFileSync("public/.nojekyll", "");
