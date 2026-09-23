// Development runner: Vite dev server (hot reload) + Electron.
//
//   npm run electron:dev
//
// 1. Starts the Vite dev server on a free local port.
// 2. Bundles the main process and preload (esbuild, watch mode).
// 3. Launches Electron pointed at the dev server.
// Quitting Electron stops everything; Ctrl+C stops Electron too.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "vite";

const require = createRequire(import.meta.url);
const electronBinary = require("electron");

const server = await createServer({
  mode: "development",
  server: { host: "127.0.0.1", port: 5173, strictPort: false },
});
await server.listen();
const url = server.resolvedUrls?.local?.[0];
if (!url) {
  console.error("[electron-dev] Vite did not report a local URL");
  await server.close();
  process.exit(1);
}
console.log(`[electron-dev] renderer: ${url}`);

const builder = spawn(process.execPath, ["scripts/build-electron.mjs", "--watch"], { stdio: ["ignore", "pipe", "inherit"] });

// Wait for the first bundle before starting Electron.
await new Promise((resolve, reject) => {
  builder.stdout.on("data", chunk => {
    process.stdout.write(chunk);
    if (String(chunk).includes("watching for changes")) resolve();
  });
  builder.once("exit", code => reject(new Error(`electron bundle failed (exit ${code})`)));
});

const electron = spawn(electronBinary, ["."], {
  stdio: "inherit",
  env: { ...process.env, AI_TERMINAL_DEV_SERVER_URL: url },
});

let stopping = false;
async function stop(code) {
  if (stopping) return;
  stopping = true;
  builder.kill();
  if (electron.exitCode === null) electron.kill();
  await server.close();
  process.exit(code);
}

electron.on("exit", code => { void stop(code ?? 0); });
process.on("SIGINT", () => { void stop(130); });
process.on("SIGTERM", () => { void stop(143); });
