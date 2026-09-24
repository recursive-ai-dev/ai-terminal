// ============================================================
// AUTO-UPDATER — electron-updater against GitHub Releases
//
// Active only in packaged builds that can self-update (AppImage on
// Linux, NSIS on Windows, DMG/zip on macOS). Downloads are always
// user-initiated; a quiet background check runs once after start-up.
// Status is pushed to every window.
//
// AI_TERMINAL_DISABLE_UPDATES=1 turns the updater off entirely.
// ============================================================
import { app, BrowserWindow } from "electron";
import { createRequire } from "node:module";
import type { AppUpdater } from "electron-updater";
import { IPC } from "./channels";
import { handle, errorMessage } from "../lib/ipcGuard";
import { createLogger } from "../lib/logger";

const log = createLogger("updater");
const STARTUP_CHECK_DELAY_MS = 15_000;

export type UpdaterStatus =
  | { state: "idle" }
  | { state: "disabled"; reason: string }
  | { state: "checking" }
  | { state: "available";     version: string; releaseDate: string }
  | { state: "not-available"; version: string }
  | { state: "downloading";   percent: number; bytesPerSec: number }
  | { state: "downloaded";    version: string }
  | { state: "error";         message: string };

let currentStatus: UpdaterStatus = { state: "idle" };
let updater: AppUpdater | null = null;
let userInitiatedCheck = false;

function pushStatus(status: UpdaterStatus): void {
  currentStatus = status;
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IPC.UPDATER_STATUS_PUSH, status);
  }
}

function disabledReason(): string | null {
  if (!app.isPackaged) return "Updates are disabled in development builds";
  if (process.env.AI_TERMINAL_DISABLE_UPDATES === "1") return "Updates are disabled by AI_TERMINAL_DISABLE_UPDATES";
  if (process.platform === "linux" && !process.env.APPIMAGE) return "This installation is managed by your package manager";
  return null;
}

function loadUpdater(): AppUpdater | null {
  try {
    // Plain require: electron-updater exposes `autoUpdater` through a lazy
    // getter, which an ESM-interop wrapper around import() does not keep.
    const nodeRequire = createRequire(__filename);
    const { autoUpdater } = nodeRequire("electron-updater") as typeof import("electron-updater");
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.logger = {
      info: (message?: unknown) => log.info(String(message)),
      warn: (message?: unknown) => log.warn(String(message)),
      error: (message?: unknown) => log.error(String(message)),
      debug: (message: string) => log.debug(message),
    };

    autoUpdater.on("checking-for-update", () => pushStatus({ state: "checking" }));
    autoUpdater.on("update-available", info => pushStatus({ state: "available", version: info.version, releaseDate: info.releaseDate ?? "" }));
    autoUpdater.on("update-not-available", info => pushStatus({ state: "not-available", version: info.version }));
    autoUpdater.on("download-progress", progress => pushStatus({
      state: "downloading",
      percent: Math.round(progress.percent),
      bytesPerSec: Math.round(progress.bytesPerSecond),
    }));
    autoUpdater.on("update-downloaded", info => pushStatus({ state: "downloaded", version: info.version }));
    autoUpdater.on("error", error => {
      log.warn("update error", error);
      // A failed background check (offline, rate-limited) is not worth
      // alarming the user about; a check they asked for is.
      if (userInitiatedCheck || currentStatus.state === "downloading") {
        pushStatus({ state: "error", message: errorMessage(error) });
      } else {
        pushStatus({ state: "idle" });
      }
    });
    return autoUpdater;
  } catch (error) {
    log.error("electron-updater could not be loaded", error);
    return null;
  }
}

async function check(userInitiated: boolean): Promise<{ ok: boolean; error?: string }> {
  if (!updater) return { ok: false, error: currentStatus.state === "disabled" ? currentStatus.reason : "Updater not initialized" };
  userInitiatedCheck = userInitiated;
  try {
    await updater.checkForUpdates();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

export async function registerUpdaterHandlers(): Promise<void> {
  handle(IPC.UPDATER_STATUS, () => currentStatus);
  handle(IPC.UPDATER_CHECK, () => check(true));

  handle(IPC.UPDATER_DOWNLOAD, async () => {
    if (!updater) return { ok: false, error: "Updater not initialized" };
    if (currentStatus.state !== "available") return { ok: false, error: "No update is available to download" };
    await updater.downloadUpdate();
    return { ok: true };
  });

  handle(IPC.UPDATER_INSTALL, () => {
    if (!updater) return { ok: false, error: "Updater not initialized" };
    if (currentStatus.state !== "downloaded") return { ok: false, error: "No downloaded update to install" };
    // Defer so the IPC reply is delivered before the app quits.
    setImmediate(() => updater?.quitAndInstall(false, true));
    return { ok: true };
  });

  const reason = disabledReason();
  if (reason) {
    currentStatus = { state: "disabled", reason };
    log.info(reason);
    return;
  }

  updater = loadUpdater();
  if (!updater) {
    currentStatus = { state: "disabled", reason: "Updater failed to load" };
    return;
  }
  setTimeout(() => { void check(false); }, STARTUP_CHECK_DELAY_MS).unref();
}

/** Menu entry point: behaves like the user pressed "check for updates". */
export function checkForUpdatesFromMenu(): Promise<{ ok: boolean; error?: string }> {
  return check(true);
}
