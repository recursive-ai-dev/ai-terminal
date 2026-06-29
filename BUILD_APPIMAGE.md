# Building the x86 Neural Terminal AppImage

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | 18+ | LTS recommended |
| npm | 9+ | Comes with Node |
| Linux | Any x64/arm64 distro | For AppImage |
| `fuse` | kernel module | `sudo apt install fuse libfuse2` (Ubuntu) |

---

## Step 1 — Install all dependencies

```bash
npm install

# Install Electron-specific packages (not in web package.json)
npm install --save-dev \
  electron@latest \
  electron-builder@latest \
  electron-store@latest \
  electron-updater@latest \
  @types/electron
```

---

## Step 2 — Add build scripts to package.json

Add these to the `"scripts"` section of `package.json`:

```json
{
  "scripts": {
    "dev":              "vite",
    "build":            "vite build",
    "preview":          "vite preview",

    "electron:compile": "tsc -p tsconfig.electron.json",
    "electron:dev":     "npm run build && npm run electron:compile && electron electron-dist/main.js",
    "electron:build":   "npm run build && npm run electron:compile && electron-builder",

    "dist:linux":       "npm run build && npm run electron:compile && electron-builder --linux appimage",
    "dist:win":         "npm run build && npm run electron:compile && electron-builder --win nsis",
    "dist:mac":         "npm run build && npm run electron:compile && electron-builder --mac dmg",
    "dist:all":         "npm run build && npm run electron:compile && electron-builder -mwl"
  }
}
```

---

## Step 3 — Generate app icons

AppImage requires icons at specific sizes. Generate from any source PNG (512x512 minimum):

```bash
# Install imagemagick
sudo apt install imagemagick   # Ubuntu/Debian
brew install imagemagick        # macOS

# Create all required sizes
mkdir -p assets
convert source-icon.png -resize 512x512 assets/icon.png
convert source-icon.png -resize 256x256 assets/icon-256.png
convert source-icon.png -resize 128x128 assets/icon-128.png
convert source-icon.png -resize 48x48   assets/icon-48.png
convert source-icon.png -resize 16x16   assets/icon-16.png
convert source-icon.png                 assets/tray-icon.png  # 16x16 or 22x22 for tray

# Windows (requires Wine or Windows build host)
convert source-icon.png assets/icon.ico

# macOS
# Use iconutil or electron-icon-maker
npx electron-icon-maker --input=source-icon.png --output=assets
```

A minimal placeholder (any PNG) will work for development builds.

---

## Step 4 — Build the AppImage

```bash
# Linux AppImage (x64)
npm run dist:linux

# Output: release/x86-neural-terminal-2.0.0-x64.AppImage
```

---

## Step 5 — Run the AppImage

```bash
chmod +x release/x86-neural-terminal-2.0.0-x64.AppImage
./release/x86-neural-terminal-2.0.0-x64.AppImage
```

### If FUSE is unavailable:
```bash
# Extract and run without FUSE
./release/x86-neural-terminal-2.0.0-x64.AppImage --appimage-extract
./squashfs-root/AppRun
```

---

## Step 6 — Development mode (hot-reload)

```bash
# Terminal 1: Vite dev server
npm run dev

# Terminal 2: Electron pointing at Vite (port 5173)
npm run electron:compile && electron electron-dist/main.js
```

---

## Architecture of the Built App

```
release/
  x86-neural-terminal-2.0.0-x64.AppImage   ← Linux portable executable
  x86-neural-terminal-2.0.0-setup.exe       ← Windows NSIS installer
  x86-neural-terminal-2.0.0-x64.dmg         ← macOS disk image

electron-dist/                               ← Compiled main process
  main.js                                    ← Entry point
  preload.js                                 ← contextBridge
  ipc/
    channels.js
    settings.js                              ← ~/.config persistence
    shell.js                                 ← clipboard, file dialogs
    updater.js                               ← electron-updater

dist/                                        ← Vite renderer build
  index.html
  assets/
    index-[hash].js                          ← All React + engine code
    index-[hash].css

src/bridge/                                  ← Renderer ↔ Main bridge
  electronBridge.ts                          ← Typed IPC API surface
  usePlatform.ts                             ← React hook (Electron/browser)
```

---

## Settings Persistence

| Runtime | Location |
|---------|----------|
| Electron (Linux) | `~/.config/x86-neural-terminal-ux/config.json` |
| Electron (Windows) | `%APPDATA%\x86-neural-terminal-ux\config.json` |
| Electron (macOS) | `~/Library/Application Support/x86-neural-terminal-ux/config.json` |
| Browser | `localStorage["x86_neural_ux_settings"]` |

Settings are **always written to both** localStorage AND native store when in Electron, so they survive both browser testing and native runs.

---

## Auto-Updater Setup

1. Push a release to GitHub with the tag `v2.0.1`
2. Upload the AppImage as a release asset
3. electron-updater checks `https://github.com/YOUR_USER/x86-neural-terminal/releases/latest`
4. The renderer shows the update badge automatically
5. User clicks "download" → "restart to update"

Update `electron-builder.yml`:
```yaml
publish:
  provider: github
  owner: YOUR_GITHUB_USERNAME
  repo: x86-neural-terminal
```

---

## Security Model

| Setting | Value | Reason |
|---------|-------|--------|
| `nodeIntegration` | `false` | Never allow renderer Node access |
| `contextIsolation` | `true` | Isolate preload from renderer |
| `sandbox` | `true` | OS-level process sandbox |
| `webSecurity` | `true` | No mixed content |
| CSP | strict | No external script sources |
| Shell URLs | allowlisted | Only `https:`, `http:`, `mailto:` |
| File writes | user dirs only | No writes outside home/documents |
| Single instance | enforced | `requestSingleInstanceLock()` |
