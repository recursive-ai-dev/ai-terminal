// ============================================================
// ELECTRON MAIN PROCESS — AI Terminal
// Window lifecycle, native menu, tray, IPC registration and the
// security boundary around the renderer.
//
// Development: set AI_TERMINAL_DEV_SERVER_URL (see `npm run electron:dev`)
// to load the Vite dev server instead of the built renderer.
// ============================================================
import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  MenuItemConstructorOptions,
  nativeImage,
  session,
  Tray,
  WebContents,
} from "electron";
import * as path from "node:path";
import { registerSettingsHandlers } from "./ipc/settings";
import { openExternalSafely, registerShellHandlers } from "./ipc/shell";
import { checkForUpdatesFromMenu, registerUpdaterHandlers } from "./ipc/updater";
import { registerTerminalHandlers, terminateAllShells } from "./ipc/terminal";
import { registerAIHandlers } from "./ipc/ai";
import { IPC, type MenuAction } from "./ipc/channels";
import { handle, isTrustedUrl, setTrustedAppLocation } from "./lib/ipcGuard";
import { createLogger, initLogger } from "./lib/logger";
import { WindowStateKeeper } from "./lib/windowState";

// ── Paths & environment ──
const isPackaged = app.isPackaged;
const devServerUrl = !isPackaged ? process.env.AI_TERMINAL_DEV_SERVER_URL?.trim() || null : null;
const indexHtml = path.join(__dirname, "../dist/index.html");
const assetsDir = path.join(__dirname, "../assets");
const isMac = process.platform === "darwin";

app.setAppLogsPath();
const logFile = initLogger(app.getPath("logs"), process.env.AI_TERMINAL_LOG_LEVEL === "debug" ? "debug" : "info");
const log = createLogger("main");

process.on("uncaughtException", error => log.error("uncaught exception", error));
process.on("unhandledRejection", reason => log.error("unhandled rejection", reason));

// ── App constants ──
const APP_TITLE  = "AI Terminal";
const WIN_WIDTH  = 1280;
const WIN_HEIGHT = 820;
const MIN_WIDTH  = 800;
const MIN_HEIGHT = 560;

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let windowState: WindowStateKeeper | null = null;

// ────────────────────────────────────────────────────────────
// CONTENT SECURITY POLICY
// The production renderer also carries this policy as a <meta> tag
// (injected by vite.config.ts), because response-header hooks do not
// apply to file:// loads. The dev server needs inline scripts and a
// websocket for hot reload.
// ────────────────────────────────────────────────────────────
function contentSecurityPolicy(): string {
  const directives = [
    "default-src 'none'",
    devServerUrl ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    // The neural lab's wget command fetches user-supplied URLs.
    devServerUrl ? "connect-src 'self' https: http: ws://localhost:* ws://127.0.0.1:*" : "connect-src 'self' https: http:",
    "worker-src 'self' blob:",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-src 'none'",
    "object-src 'none'",
  ];
  return directives.join("; ");
}

function hardenSession(): void {
  const ses = session.defaultSession;
  const csp = contentSecurityPolicy();
  ses.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [csp],
      },
    });
  });
  // The app needs no camera, microphone, geolocation, notifications, etc.
  ses.setPermissionRequestHandler((_contents, permission, callback) => {
    log.warn(`denied permission request: ${permission}`);
    callback(false);
  });
  ses.setPermissionCheckHandler(() => false);
}

// Chromium downloads a Hunspell dictionary from Google's CDN at start-up
// even with webPreferences.spellcheck off (electron/electron#22995, closed
// as not planned). A terminal should not phone home, so disable the
// checker and point any dictionary fetch at the discard port on loopback.
// This must happen at session creation; by "ready" the fetch has begun.
app.on("session-created", ses => {
  ses.setSpellCheckerEnabled(false);
  ses.setSpellCheckerDictionaryDownloadURL("http://127.0.0.1:9/");
});

// Applies to every WebContents the app ever creates.
function hardenWebContents(contents: WebContents): void {
  contents.on("will-navigate", (event, url) => {
    if (!isTrustedUrl(url)) {
      event.preventDefault();
      log.warn("blocked navigation", url);
    }
  });
  contents.on("will-redirect", (event, url) => {
    if (!isTrustedUrl(url)) event.preventDefault();
  });
  contents.on("will-attach-webview", event => event.preventDefault());
  // Links open in the user's browser, never inside the app.
  contents.setWindowOpenHandler(({ url }) => {
    openExternalSafely(url);
    return { action: "deny" };
  });
}

// ────────────────────────────────────────────────────────────
// BROWSER WINDOW FACTORY
// ────────────────────────────────────────────────────────────
function createWindow(): BrowserWindow {
  windowState ??= new WindowStateKeeper(app.getPath("userData"));
  const state = windowState.load(MIN_WIDTH, MIN_HEIGHT);

  const win = new BrowserWindow({
    width:           state.bounds?.width ?? WIN_WIDTH,
    height:          state.bounds?.height ?? WIN_HEIGHT,
    x:               state.bounds?.x,
    y:               state.bounds?.y,
    minWidth:        MIN_WIDTH,
    minHeight:       MIN_HEIGHT,
    title:           APP_TITLE,
    backgroundColor: "#080b12",
    show:            false,       // wait for ready-to-show (no white flash)
    frame:           false,       // custom title bar in renderer
    titleBarStyle:   isMac ? "hiddenInset" : "hidden",
    icon:            path.join(assetsDir, "icon.png"),

    webPreferences: {
      preload:                     path.join(__dirname, "preload.js"),
      nodeIntegration:             false,
      contextIsolation:            true,
      sandbox:                     true,
      webSecurity:                 true,
      allowRunningInsecureContent: false,
      experimentalFeatures:        false,
      spellcheck:                  false,
      devTools:                    !isPackaged,
    },
  });
  windowState.track(win);

  win.once("ready-to-show", () => {
    if (state.maximized) win.maximize();
    if (state.fullScreen) win.setFullScreen(true);
    win.show();
    if (devServerUrl) win.webContents.openDevTools({ mode: "detach" });
  });

  const pushMaximized = () => {
    if (!win.isDestroyed()) win.webContents.send(IPC.WINDOW_MAX_PUSH, win.isMaximized());
  };
  win.on("maximize", pushMaximized);
  win.on("unmaximize", pushMaximized);

  win.webContents.on("render-process-gone", (_event, details) => {
    log.error("renderer process gone", details);
    if (details.reason !== "clean-exit" && !win.isDestroyed()) {
      // The terminal module replaces the old shell when the page restarts.
      setTimeout(() => { if (!win.isDestroyed()) win.webContents.reload(); }, 500);
    }
  });
  // Renderer warnings and errors land in main.log for bug reports.
  win.webContents.on("console-message", details => {
    if (details.level === "warning" || details.level === "error") {
      log.warn(`renderer ${details.level}: ${details.message}`, `${details.sourceId}:${details.lineNumber}`);
    } else if (!isPackaged) {
      log.debug(`renderer: ${details.message}`);
    }
  });
  win.on("unresponsive", () => log.warn("window became unresponsive"));
  win.on("responsive", () => log.info("window responsive again"));
  win.webContents.on("did-fail-load", (_event, code, description, url) => {
    log.error("renderer failed to load", { code, description, url });
  });

  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });

  const load = devServerUrl ? win.loadURL(devServerUrl) : win.loadFile(indexHtml);
  load.catch(error => {
    log.error("could not load renderer", error);
    dialog.showErrorBox(APP_TITLE, `The interface could not be loaded.\n\n${error instanceof Error ? error.message : String(error)}`);
  });

  return win;
}

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

// ────────────────────────────────────────────────────────────
// NATIVE MENU
// Accelerators avoid plain Ctrl+<letter>: in a terminal those keys
// belong to the shell (Ctrl+C interrupt, Ctrl+Z suspend, Ctrl+R history
// search, Ctrl+S/O in editors). Like other Linux terminals, app
// shortcuts use Ctrl+Shift on Linux/Windows and Cmd on macOS.
// ────────────────────────────────────────────────────────────
function sendMenuAction(action: MenuAction): void {
  const target = BrowserWindow.getFocusedWindow() ?? mainWindow;
  if (target && !target.isDestroyed()) target.webContents.send(IPC.MENU_ACTION, action);
}

function buildMenu(): void {
  const mod = isMac ? "Cmd" : "Ctrl+Shift";

  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: "appMenu" as const }] : []),
    {
      label: "File",
      submenu: [
        { label: "Save Terminal Log…", accelerator: `${mod}+S`, click: () => sendMenuAction("saveLog") },
        { label: "Open Log File…", accelerator: `${mod}+O`, click: () => sendMenuAction("openLog") },
        { type: "separator" },
        isMac ? { role: "close" } : { label: "Quit", accelerator: "Ctrl+Shift+Q", click: () => app.quit() },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo", registerAccelerator: isMac },
        { role: "redo", registerAccelerator: isMac },
        { type: "separator" },
        { role: "cut", registerAccelerator: isMac },
        { role: "copy", accelerator: `${mod}+C` },
        { role: "paste", accelerator: `${mod}+V` },
        { role: "selectAll", accelerator: `${mod}+A` },
      ],
    },
    {
      label: "View",
      submenu: [
        { label: "Settings", accelerator: "CmdOrCtrl+,", click: () => sendMenuAction("openSettings") },
        { type: "separator" },
        ...(!isPackaged ? [
          { role: "reload" as const, registerAccelerator: false },
          { role: "forceReload" as const },
          { role: "toggleDevTools" as const },
          { type: "separator" as const },
        ] : []),
        { role: "resetZoom" as const },
        { role: "zoomIn" as const },
        { role: "zoomOut" as const },
        { type: "separator" as const },
        { role: "togglefullscreen" as const },
      ],
    },
    {
      label: "Help",
      submenu: [
        {
          label: `About ${APP_TITLE}`,
          click: () => {
            const options: Electron.MessageBoxOptions = {
              type: "info",
              title: `About ${APP_TITLE}`,
              message: `${APP_TITLE} ${app.getVersion()}`,
              detail: [
                `Electron ${process.versions.electron} · Chromium ${process.versions.chrome} · Node ${process.versions.node}`,
                logFile ? `Log file: ${logFile}` : "",
              ].filter(Boolean).join("\n"),
            };
            const parent = BrowserWindow.getFocusedWindow();
            void (parent ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options));
          },
        },
        {
          label: "Check for Updates…",
          click: async () => {
            const result = await checkForUpdatesFromMenu();
            if (!result.ok && result.error) {
              const parent = BrowserWindow.getFocusedWindow();
              const options: Electron.MessageBoxOptions = { type: "info", title: "Updates", message: result.error };
              void (parent ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options));
            }
          },
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ────────────────────────────────────────────────────────────
// SYSTEM TRAY (optional — not every Linux desktop shows one)
// ────────────────────────────────────────────────────────────
function createTray(): void {
  const icon = nativeImage.createFromPath(path.join(assetsDir, "tray-icon.png"));
  if (icon.isEmpty()) {
    log.warn("tray icon missing — tray disabled");
    return;
  }
  try {
    tray = new Tray(icon);
    tray.setToolTip(APP_TITLE);
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: "Open Terminal", click: showMainWindow },
      { type: "separator" },
      { label: "Quit", click: () => app.quit() },
    ]));
    tray.on("click", () => {
      if (mainWindow?.isVisible() && mainWindow.isFocused()) mainWindow.hide();
      else showMainWindow();
    });
  } catch (error) {
    tray = null;
    log.warn("tray unavailable", error);
  }
}

// ────────────────────────────────────────────────────────────
// WINDOW CONTROL IPC (frameless window — renderer owns the buttons)
// Each call acts on the window that sent it.
// ────────────────────────────────────────────────────────────
function registerWindowHandlers(): void {
  handle(IPC.WINDOW_MINIMIZE, event => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });
  handle(IPC.WINDOW_MAXIMIZE, event => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  handle(IPC.WINDOW_CLOSE, event => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });
  handle(IPC.WINDOW_IS_MAX, event => BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false);
}

// ────────────────────────────────────────────────────────────
// APP LIFECYCLE
// ────────────────────────────────────────────────────────────
async function bootstrap(): Promise<void> {
  await app.whenReady();
  log.info(`starting ${APP_TITLE} ${app.getVersion()}`, {
    electron: process.versions.electron,
    platform: process.platform,
    arch: process.arch,
    packaged: isPackaged,
    devServer: devServerUrl,
  });

  setTrustedAppLocation(devServerUrl ? { devServerUrl } : { indexHtml });
  hardenSession();

  registerWindowHandlers();
  registerShellHandlers();
  registerTerminalHandlers();
  registerAIHandlers();
  registerSettingsHandlers();
  await registerUpdaterHandlers();

  buildMenu();
  mainWindow = createWindow();
  createTray();

  // macOS: re-create the window on dock click if it was closed.
  app.on("activate", showMainWindow);
}

app.on("web-contents-created", (_event, contents) => hardenWebContents(contents));

app.on("window-all-closed", () => {
  // macOS keeps the process alive until an explicit Quit.
  if (!isMac) app.quit();
});

app.on("before-quit", () => {
  terminateAllShells();
  tray?.destroy();
  tray = null;
});

// ── Single instance lock ──
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", showMainWindow);
  bootstrap().catch(error => {
    log.error("fatal bootstrap error", error);
    dialog.showErrorBox(APP_TITLE, `AI Terminal failed to start.\n\n${error instanceof Error ? error.message : String(error)}`);
    app.exit(1);
  });
}
