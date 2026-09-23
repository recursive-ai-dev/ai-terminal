# AI Terminal

A Linux-native terminal with an approval-first AI copilot. The desktop app runs your real shell in a pseudo-terminal rendered by [xterm.js](https://xtermjs.org/). The browser build is a safe preview and never executes commands on the visitor's machine.

## Features

- **A real terminal.** Your `$SHELL` runs in a PTY via `node-pty`, with your rc files, prompt, colors, tab completion, job control, and full-screen programs (`vim`, `htop`, `less`). The toolbar follows the working directory when your shell emits OSC 7, which most distro shell configs do by default.
- **Approval-first copilot.** Describe an outcome (`show disk usage`, `find large files`) and get a command you review before anything runs. You can **insert** the command into the prompt or **run** it. Dangerous commands need a second confirmation.
  - Every proposed command, whether it comes from the built-in rules or a model, goes through a shared risk classifier (`src/shared/commandRisk.ts`). A plan's risk can be raised by the classifier but never lowered.
  - Multi-line commands and commands containing control characters are rejected.
  - A model plan that the classifier marks dangerous has its command withheld.
- **Optional local model.** The copilot can use a local [Ollama](https://ollama.com/) model. Without one, it uses deterministic local rules.
- **Neural lab.** The NanoTensor / Adam / TreeLogic / cellular-automaton workspace is still available under **neural lab**, including its in-app self-tests (`test.train`).

## Keyboard

| Action | Linux / Windows | macOS |
|---|---|---|
| Copy / paste | `Ctrl+Shift+C` / `Ctrl+Shift+V` | `⌘C` / `⌘V` |
| Select all | `Ctrl+Shift+A` | `⌘A` |
| Save terminal log | `Ctrl+Shift+S` | `⌘S` |
| Open log file | `Ctrl+Shift+O` | `⌘O` |
| Settings | `Ctrl+,` | `⌘,` |
| Quit | `Ctrl+Shift+Q` | `⌘Q` |

Plain `Ctrl+<letter>` shortcuts are never used by the app because they belong to the shell (`Ctrl+C`, `Ctrl+Z`, `Ctrl+R`, and so on).

## Configuration

Set these environment variables before launching the app:

| Variable | Default | Purpose |
|---|---|---|
| `AI_TERMINAL_AI_URL` | `http://127.0.0.1:11434/api/generate` | Ollama `generate` endpoint |
| `AI_TERMINAL_AI_MODEL` | `llama3.2:3b` | Model name |
| `AI_TERMINAL_AI_TIMEOUT_MS` | `30000` | Model request timeout (1000–600000) |
| `AI_TERMINAL_ALLOW_REMOTE_AI` | unset | `true` allows a non-loopback endpoint, which must use `https` |
| `AI_TERMINAL_DISABLE_UPDATES` | unset | `1` disables the auto-updater |
| `AI_TERMINAL_DISABLE_PTY` | unset | `1` forces the limited pipe mode (for troubleshooting) |
| `AI_TERMINAL_LOG_LEVEL` | `info` | `debug` for verbose main-process logs |

### Files

| What | Linux location |
|---|---|
| Settings | `~/.config/AI Terminal/settings.json` |
| Window size/position | `~/.config/AI Terminal/window-state.json` |
| Log (rotates at 5 MB) | `~/.config/AI Terminal/logs/main.log` |

On macOS these files live under `~/Library/Application Support/AI Terminal/` (logs under `~/Library/Logs/AI Terminal/`). On Windows they live under `%APPDATA%\AI Terminal\`.

## Security model

The renderer can start a shell, so it is treated as privileged and locked down:

- `contextIsolation`, `sandbox`, and no Node integration. The preload script exposes a narrow, typed API.
- Every IPC handler checks that the call came from the app's own top-level page (`electron/lib/ipcGuard.ts`).
- A strict Content Security Policy (`script-src 'self'`, no inline scripts). Fonts are bundled, so no third-party CDN is involved.
- Navigation away from the app, `<webview>`, new windows, and all permission requests (camera, notifications, and so on) are blocked. Links open in your browser, and only `http`, `https`, and `mailto` links are allowed.
- Shell output is flow-controlled, so a runaway command cannot exhaust renderer memory. Shells are hung up (`SIGHUP`, then `SIGKILL`) when their window closes or reloads, or when the app quits.
- The AI endpoint is loopback-only unless you opt in explicitly. Model output is size-capped, validated, and classified before you see it.

## Development

Requires Node.js ≥ 20.19 (22 recommended).

```bash
npm install
npm run dev            # browser preview with hot reload
npm run electron:dev   # desktop app against the Vite dev server (hot reload)
npm run electron:start # desktop app from a production build
```

Quality gates, which CI runs on every push and pull request:

```bash
npm run typecheck   # renderer + main process
npm test            # unit tests + the neural lab's contract suites
npm run check       # all of the above + both production builds
```

`node-pty` is a native module. `npm install` builds it, and `electron-builder` rebuilds it for Electron's ABI when packaging. If the desktop app reports *limited mode*, run `npm run rebuild:native`. The pipe fallback keeps line-oriented commands working, but full-screen programs need the PTY.

## Packaging & releases

```bash
npm run dist:linux              # release/ai-terminal-<version>-x86_64.AppImage
npm run dist:linux -- --arm64   # arm64 AppImage (build on an arm64 host)
```

To publish a release, bump `version` in `package.json`, commit, and push a matching tag (`v1.0.1`). The **Release** workflow builds x64 and arm64 AppImages and publishes them to GitHub Releases, together with the update metadata that the in-app updater reads. See [BUILD_APPIMAGE.md](BUILD_APPIMAGE.md) for details.

## Project layout

```
electron/            main process (bundled by scripts/build-electron.mjs)
  main.ts            window, menu, tray, CSP, lifecycle
  preload.ts         contextBridge API (sandboxed; bundled into one file)
  ipc/               terminal, AI, settings, updater, file/clipboard handlers
  lib/               IPC guard, logger, JSON store, shell launch policy, window state
src/                 renderer (React + Vite)
  components/        RealTerminal (xterm.js), title bar, neural lab UI
  terminal/          line editor (pipe mode / preview), browser preview shell
  shared/            code shared with the main process (command risk classifier)
  engine/            neural lab engines
tests/               Vitest unit tests
```
