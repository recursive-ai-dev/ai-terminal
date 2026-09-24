# Building and releasing the AppImage

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | ≥ 20.19 (22 LTS recommended) | |
| Build tools | `python3`, `make`, `g++` | Needed to compile `node-pty`. On Debian/Ubuntu: `sudo apt install build-essential python3` |
| FUSE 2 | runtime only | Needed to *run* an AppImage. On Ubuntu 22.04+: `sudo apt install libfuse2` |

## Build

```bash
npm ci
npm run check        # typecheck, tests, both production builds
npm run dist:linux   # → release/ai-terminal-<version>-x86_64.AppImage
```

`dist:linux` runs three stages:

1. `vite build --mode electron` bundles the renderer into `dist/`. This build uses relative asset URLs and embeds the Content Security Policy as a `<meta>` tag.
2. `scripts/build-electron.mjs` bundles `electron/main.ts` and `electron/preload.ts` into `electron-dist/` with esbuild. The preload must be a single file because sandboxed preloads cannot `require()` local modules.
3. `electron-builder --linux AppImage` rebuilds `node-pty` for Electron's ABI, packs `app.asar` (with `node-pty` unpacked), and produces the AppImage.

For arm64, build on an arm64 machine: `npm run dist:linux -- --arm64`. Cross-compiling `node-pty` is not supported.

## Run

```bash
chmod +x release/ai-terminal-*.AppImage
./release/ai-terminal-*.AppImage
```

Without FUSE:

```bash
./release/ai-terminal-*.AppImage --appimage-extract
./squashfs-root/AppRun
```

## Release (auto-update)

1. Set `version` in `package.json` (for example, `1.0.1`) and commit.
2. Tag the commit and push the tag: `git tag v1.0.1 && git push origin v1.0.1`.
3. The **Release** workflow checks that the tag matches `package.json`. It then builds x64 and arm64 AppImages and publishes them, together with `latest-linux.yml` and `latest-linux-arm64.yml`, to the GitHub release for that tag.

Installed AppImages check for updates quietly about 15 seconds after start-up. The title bar shows when an update is available. Downloading and restarting always require a click. The updater is off in development builds and in non-AppImage Linux installs, which your package manager updates instead. Setting `AI_TERMINAL_DISABLE_UPDATES=1` also turns it off.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Limited mode: no pseudo-terminal" | `node-pty` failed to load. The reason appears in the banner and in `~/.config/AI Terminal/logs/main.log`. From source, run `npm run rebuild:native`. |
| AppImage does not start | Install `libfuse2`, or run it with `--appimage-extract` (see above). |
| The copilot says "No local model is running" | Start Ollama (`ollama serve`) and pull the model (`ollama pull llama3.2:3b`), or set `AI_TERMINAL_AI_MODEL`. |
| Anything else | Start with `AI_TERMINAL_LOG_LEVEL=debug` and check `main.log`. |
