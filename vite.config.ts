/// <reference types="vitest/config" />
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pkg = JSON.parse(readFileSync(path.join(__dirname, "package.json"), "utf8")) as { version: string };

// Must match contentSecurityPolicy() in electron/main.ts for production.
// Delivered as a <meta> tag because file:// loads carry no HTTP headers.
const ELECTRON_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' https: http:",
  "worker-src 'self' blob:",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'",
  "object-src 'none'",
].join("; ");

function electronCsp(): Plugin {
  return {
    name: "ai-terminal:electron-csp",
    apply: "build",
    transformIndexHtml: {
      order: "pre",
      handler: html => html.replace(
        "<head>",
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="${ELECTRON_CSP}" />`,
      ),
    },
  };
}

// https://vite.dev/config/
//   vite build                  → dist/ single-file web preview
//   vite build --mode electron  → dist/ multi-file bundle for the desktop app
export default defineConfig(({ mode }) => {
  const electron = mode === "electron";
  return {
    // Relative asset URLs so index.html works when loaded from file://.
    base: electron ? "./" : "/",
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
    plugins: [react(), tailwindcss(), ...(electron ? [electronCsp()] : [viteSingleFile()])],
    server: {
      host: "0.0.0.0",
      // Arena proxies the preview through a generated hostname.
      allowedHosts: true,
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "src"),
      },
    },
    build: {
      outDir: "dist",
      emptyOutDir: true,
      sourcemap: false,
      // Chromium in Electron 44 supports modern output.
      target: electron ? "chrome130" : "es2020",
    },
    test: {
      include: ["tests/**/*.test.ts"],
      setupFiles: ["tests/setup.ts"],
      environment: "node",
    },
  };
});
