# AI Terminal

A Linux-native terminal with an approval-first AI copilot. The desktop build opens a real user shell in an isolated Electron main-process session; the browser build is intentionally a safe preview and never executes commands on the host.

## What is real

- **Native shell:** Electron starts the user's `$SHELL` in the user's home directory. `node-pty` is used when its native module is available, with a pipe-backed fallback for development environments.
- **AI copilot:** Describe an outcome such as `show disk usage`, `check git status`, or `find large files`. The copilot generates a reviewable command and never executes it automatically. The desktop build can optionally use a local Ollama model (`AI_TERMINAL_AI_MODEL=llama3.2:3b`); without one it uses the safe local planner.
- **Safety boundary:** Renderer code has no Node integration. Shell, files, clipboard, updates, and window controls are exposed through a narrow, typed preload bridge.
- **Neural lab:** The original NanoTensor, Adam, TreeLogic, cellular automaton, metrics, and visualization tools remain available under **neural lab**.

## Development

```bash
npm install
npm run dev
```

The web preview is useful for exploring the UI and copilot. It shows a small, explicit browser sandbox instead of pretending that a web page is a Linux shell.

## Desktop development

```bash
npm run electron:dev
```

The native terminal depends on the optional `node-pty` module. If native compilation is unavailable, the app uses a pipe-backed shell session so ordinary commands still work; interactive full-screen programs require the PTY build.

## Packaging

```bash
npm run dist:linux
# or
npm run electron:build
```

The primary distribution target is a Linux AppImage. Windows and macOS builder targets remain configured for cross-platform packaging.
