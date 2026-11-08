import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

await build({
  entryPoints: [path.join(root, "server/main.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: path.join(root, "dist/waymark-mcp.mjs"),
  plugins: [
    {
      name: "at-alias",
      setup(build) {
        build.onResolve({ filter: /^@\// }, (args) => {
          const base = path.join(root, args.path.slice(2));
          const file = [".ts", ".tsx"].map((ext) => base + ext).find((candidate) => fs.existsSync(candidate));
          return { path: file ?? base };
        });
      },
    },
  ],
});
