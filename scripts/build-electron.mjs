// Bundles the Electron main process and preload script into electron-dist/.
//
// Bundling is required, not an optimisation: the preload runs with
// `sandbox: true`, where require() of local files is unavailable, so the
// preload must be a single self-contained file. The main process is
// bundled the same way so it can share code with the renderer
// (src/shared) without a second TypeScript project layout.
//
// Type checking is done separately by `npm run typecheck`.
import { build } from "esbuild";
import { mkdir, rm, writeFile } from "node:fs/promises";

const outdir = "electron-dist";
const watch = process.argv.includes("--watch");
const production = process.env.NODE_ENV === "production" || process.argv.includes("--production");

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

const common = {
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  sourcemap: production ? "linked" : "inline",
  minify: false,
  logLevel: "info",
  // Native and runtime-provided modules are resolved at runtime from
  // node_modules (packaged by electron-builder).
  external: ["electron", "node-pty", "electron-updater"],
};

const entries = [
  { entryPoints: ["electron/main.ts"], outfile: `${outdir}/main.js` },
  { entryPoints: ["electron/preload.ts"], outfile: `${outdir}/preload.js`, external: ["electron"] },
];

// Electron resolves "type" from the nearest package.json; the root one is
// "module", so mark the output directory as CommonJS explicitly.
await writeFile(`${outdir}/package.json`, `${JSON.stringify({ type: "commonjs" }, null, 2)}\n`, "utf8");

if (watch) {
  const { context } = await import("esbuild");
  const contexts = await Promise.all(entries.map(entry => context({ ...common, ...entry })));
  await Promise.all(contexts.map(ctx => ctx.watch()));
  console.log("[build-electron] watching for changes…");
} else {
  await Promise.all(entries.map(entry => build({ ...common, ...entry })));
}
