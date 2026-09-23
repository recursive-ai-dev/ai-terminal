// ============================================================
// ELECTRON MAIN PROCESS — x86_64 Neural Terminal
// BrowserWindow, native menus, tray, IPC, security hardening
// AppImage / NSIS / DMG via electron-builder
// ============================================================
import {
  app,
  BrowserWindow,
  Menu,
  Tray,
  nativeImage,
  ipcMain,
  IpcMainInvokeEvent,
  session,
} from "electron";
import * as path from "path";
import { registerSettingsHandlers } from "./ipc/settings";
import { registerShellHandlers }    from "./ipc/shell";
import { registerUpdaterHandlers }  from "./ipc/updater";
import { registerTerminalHandlers } from "./ipc/terminal";
import { registerAIHandlers }       from "./ipc/ai";
import { IPC } from "./ipc/channels";

// ── Environment detection ──
const isDev = !app.isPackaged;

// ── CommonJS main-process directory ──
// tsconfig.electron.json intentionally emits CommonJS so Electron can load
// the main process in both packaged and development builds.
const __dirname_main = __dirname;

// ── App constants ──
const APP_TITLE   = "AI Terminal";
const WIN_WIDTH   = 1280;
const WIN_HEIGHT  = 820;
const MIN_WIDTH   = 800;
const MIN_HEIGHT  = 560;

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

// ────────────────────────────────────────────────────────────
// BROWSER WINDOW FACTORY
// ────────────────────────────────────────────────────────────
function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width:           WIN_WIDTH,
    height:          WIN_HEIGHT,
    minWidth:        MIN_WIDTH,
    minHeight:       MIN_HEIGHT,
    title:           APP_TITLE,
    backgroundColor: "#030712",   // matches Tailwind gray-950
    show:            false,       // wait for ready-to-show
    frame:           false,       // custom title bar in renderer
    titleBarStyle:   "hidden",

    webPreferences: {
      // ── Security: Principle of Least Privilege ──
      preload:              path.join(__dirname_main, "preload.js"),
      nodeIntegration:      false,   // NEVER true
      contextIsolation:     true,    // ALWAYS true
      sandbox:              true,    // process-level sandbox
      webSecurity:          true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,

      // ── Dev tools ──
      devTools: isDev,
    },

    // ── Icon ──
    icon: path.join(__dirname_main, "../assets/icon.png"),
  });

  // ── Load app ──
  if (isDev) {
    // Vite dev server — adjust port if needed
    win.loadURL("http://localhost:5173").catch(console.error);
  } else {
    win.loadFile(
      path.join(__dirname_main, "../dist/index.html")
    ).catch(console.error);
  }

  // ── Show only when fully rendered (no white flash) ──
  win.once("ready-to-show", () => {
    win.show();
    if (isDev) win.webContents.openDevTools({ mode: "detach" });
  });

  // ── Prevent navigation away from app ──
  win.webContents.on("will-navigate", (event, navUrl) => {
    const allowed = isDev
      ? navUrl.startsWith("http://localhost")
      : navUrl.startsWith("file://");
    if (!allowed) event.preventDefault();
  });

  // ── Block new windows / popups ──
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  // ── Remember window state ──
  win.on("close", () => {
    mainWindow = null;
  });

  return win;
}

// ────────────────────────────────────────────────────────────
// CONTENT SECURITY POLICY
// ────────────────────────────────────────────────────────────
function applyCSP(): void {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline'",   // needed for Vite HMR in dev
            "style-src 'self' 'unsafe-inline'",    // Tailwind inline styles
            "img-src 'self' data: blob:",
            "font-src 'self' data:",
            "connect-src 'self' ws://localhost:* http://localhost:*", // Vite WS
            "worker-src 'self'",
            "frame-src 'none'",
            "object-src 'none'",
          ].join("; "),
        ],
      },
    });
  });
}

// ────────────────────────────────────────────────────────────
// NATIVE MENU
// ────────────────────────────────────────────────────────────
function buildMenu(win: BrowserWindow): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: "File",
      submenu: [
        {
          label: "Save Terminal Log...",
          accelerator: "CmdOrCtrl+S",
          click: () => win.webContents.send("menu:saveLog"),
        },
        {
          label: "Open Log File...",
          accelerator: "CmdOrCtrl+O",
          click: () => win.webContents.send("menu:openLog"),
        },
        { type: "separator" },
        {
          label: "Quit",
          accelerator: process.platform === "darwin" ? "Cmd+Q" : "Alt+F4",
          click: () => app.quit(),
        },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        {
          label: "Settings",
          accelerator: "CmdOrCtrl+,",
          click: () => win.webContents.send("menu:openSettings"),
        },
        { type: "separator" },
        ...(isDev ? [
          { role: "reload" as const },
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
          label: "About x86 Neural Terminal",
          click: () => {
            win.webContents.send("menu:about");
          },
        },
        {
          label: "Check for Updates",
          click: () => {
            win.webContents.send("menu:checkUpdates");
          },
        },
      ],
    },
  ];

  // macOS: add app menu
  if (process.platform === "darwin") {
    template.unshift({
      label: app.getName(),
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    });
  }

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ────────────────────────────────────────────────────────────
// SYSTEM TRAY
// ────────────────────────────────────────────────────────────
function createTray(win: BrowserWindow): void {
  try {
    const iconPath = path.join(__dirname_main, "../assets/tray-icon.png");
    const icon = nativeImage.createFromPath(iconPath);
    tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
    tray.setToolTip(APP_TITLE);

    const contextMenu = Menu.buildFromTemplate([
      {
        label: "Open Terminal",
        click: () => {
          win.show();
          win.focus();
        },
      },
      { type: "separator" },
      {
        label: "Quit",
        click: () => app.quit(),
      },
    ]);

    tray.setContextMenu(contextMenu);
    tray.on("click", () => {
      if (win.isVisible()) {
        win.hide();
      } else {
        win.show();
        win.focus();
      }
    });
  } catch {
    // Tray icon asset not found — skip tray (non-fatal)
    console.warn("[main] Tray icon not found — tray disabled.");
  }
}

// ────────────────────────────────────────────────────────────
// WINDOW CONTROL IPC HANDLERS
// (Frameless window — renderer owns the titlebar buttons)
// ────────────────────────────────────────────────────────────
function registerWindowHandlers(): void {
  ipcMain.handle(IPC.WINDOW_MINIMIZE, (_event: IpcMainInvokeEvent) => {
    mainWindow?.minimize();
  });

  ipcMain.handle(IPC.WINDOW_MAXIMIZE, (_event: IpcMainInvokeEvent) => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  });

  ipcMain.handle(IPC.WINDOW_CLOSE, (_event: IpcMainInvokeEvent) => {
    mainWindow?.close();
  });

  ipcMain.handle(IPC.WINDOW_IS_MAX, (_event: IpcMainInvokeEvent) => {
    return mainWindow?.isMaximized() ?? false;
  });
}

// ────────────────────────────────────────────────────────────
// APP LIFECYCLE
// ────────────────────────────────────────────────────────────
async function bootstrap(): Promise<void> {
  // ── Security hardening ──
  app.commandLine.appendSwitch("disable-features", "OutOfBlinkCors");

  await app.whenReady();

  applyCSP();
  registerWindowHandlers();
  registerShellHandlers();
  registerTerminalHandlers();
  registerAIHandlers();
  await registerSettingsHandlers();

  mainWindow = createWindow();
  buildMenu(mainWindow);
  createTray(mainWindow);

  // Wire updater after window exists (needs BrowserWindow ref for push events)
  await registerUpdaterHandlers(mainWindow, isDev);

  // macOS: re-create window on dock click if closed
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    } else {
      mainWindow?.show();
    }
  });
}

// ── Quit behavior ──
app.on("window-all-closed", () => {
  // On macOS: keep process alive until explicit Quit
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  tray?.destroy();
});

// ── Single instance lock ──
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    // Focus existing window on second launch
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  bootstrap().catch(err => {
    console.error("[main] Fatal bootstrap error:", err);
    app.quit();
  });
}
