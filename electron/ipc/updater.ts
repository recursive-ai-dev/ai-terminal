// ============================================================
// AUTO-UPDATER IPC HANDLERS — electron-updater
// Pushes status events to renderer via BrowserWindow.webContents.
// Only active in production builds (isDev guard).
// ============================================================
import { ipcMain, IpcMainInvokeEvent, BrowserWindow } from "electron";
import { IPC } from "./channels";

// Lazy-load electron-updater — not available in dev mode
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let autoUpdater: any = null;

type UpdaterStatus =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "available";     version: string; releaseDate: string }
  | { state: "not-available"; version: string }
  | { state: "downloading";   percent: number; bytesPerSec: number }
  | { state: "downloaded";    version: string }
  | { state: "error";         message: string };

let currentStatus: UpdaterStatus = { state: "idle" };

function pushStatus(win: BrowserWindow | null, status: UpdaterStatus) {
  currentStatus = status;
  if (win && !win.isDestroyed()) {
    win.webContents.send(IPC.UPDATER_STATUS_PUSH, status);
  }
}

export async function registerUpdaterHandlers(
  mainWindow: BrowserWindow,
  isDev: boolean
): Promise<void> {

  // ── Status query (synchronous snapshot) ──
  ipcMain.handle(IPC.UPDATER_STATUS, (_event: IpcMainInvokeEvent) => {
    return currentStatus;
  });

  if (isDev) {
    // Stub handlers in dev — updater does nothing
    ipcMain.handle(IPC.UPDATER_CHECK, () => ({
      ok: false, error: "Auto-updater disabled in development mode",
    }));
    ipcMain.handle(IPC.UPDATER_DOWNLOAD, () => ({
      ok: false, error: "Auto-updater disabled in development mode",
    }));
    ipcMain.handle(IPC.UPDATER_INSTALL, () => ({
      ok: false, error: "Auto-updater disabled in development mode",
    }));
    return;
  }

  // ── Load electron-updater ──
  try {
    const mod = await import("electron-updater");
    autoUpdater = mod.autoUpdater;
    autoUpdater.autoDownload = false;     // Manual download trigger
    autoUpdater.autoInstallOnAppQuit = true;

    // ── Wire events → push to renderer ──
    autoUpdater.on("checking-for-update", () => {
      pushStatus(mainWindow, { state: "checking" });
    });

    autoUpdater.on("update-available", (info: { version: string; releaseDate: string }) => {
      pushStatus(mainWindow, {
        state: "available",
        version: info.version,
        releaseDate: info.releaseDate ?? "",
      });
    });

    autoUpdater.on("update-not-available", (info: { version: string }) => {
      pushStatus(mainWindow, {
        state: "not-available",
        version: info.version,
      });
    });

    autoUpdater.on("download-progress", (progress: { percent: number; bytesPerSecond: number }) => {
      pushStatus(mainWindow, {
        state: "downloading",
        percent: Math.round(progress.percent),
        bytesPerSec: Math.round(progress.bytesPerSecond),
      });
    });

    autoUpdater.on("update-downloaded", (info: { version: string }) => {
      pushStatus(mainWindow, {
        state: "downloaded",
        version: info.version,
      });
    });

    autoUpdater.on("error", (err: Error) => {
      pushStatus(mainWindow, {
        state: "error",
        message: err.message ?? String(err),
      });
    });

  } catch (err) {
    console.warn("[updater] electron-updater not available:", err);
  }

  // ── IPC: check for update ──
  ipcMain.handle(IPC.UPDATER_CHECK, async (_event: IpcMainInvokeEvent) => {
    if (!autoUpdater) return { ok: false, error: "Updater not initialized" };
    try {
      await autoUpdater.checkForUpdates();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  // ── IPC: download update ──
  ipcMain.handle(IPC.UPDATER_DOWNLOAD, async (_event: IpcMainInvokeEvent) => {
    if (!autoUpdater) return { ok: false, error: "Updater not initialized" };
    try {
      await autoUpdater.downloadUpdate();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  // ── IPC: quit and install ──
  ipcMain.handle(IPC.UPDATER_INSTALL, (_event: IpcMainInvokeEvent) => {
    if (!autoUpdater) return { ok: false, error: "Updater not initialized" };
    try {
      autoUpdater.quitAndInstall(false, true);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });
}
