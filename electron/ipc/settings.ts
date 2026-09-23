// ============================================================
// NATIVE SETTINGS STORE
// Persists to <userData>/settings.json:
//   Linux:   ~/.config/AI Terminal/settings.json
//   macOS:   ~/Library/Application Support/AI Terminal/settings.json
//   Windows: %APPDATA%\AI Terminal\settings.json
// Imports the pre-1.0 electron-store file once, if present.
// ============================================================
import { app } from "electron";
import * as path from "node:path";
import { IPC } from "./channels";
import { handle } from "../lib/ipcGuard";
import { JsonStore } from "../lib/jsonStore";
import { createLogger } from "../lib/logger";

const log = createLogger("settings");
const SETTINGS_KEY = "uxSettings";
const MAX_SETTINGS_BYTES = 256 * 1024;

export function registerSettingsHandlers(): void {
  const userData = app.getPath("userData");
  const store = new JsonStore({
    file: path.join(userData, "settings.json"),
    legacyFile: path.join(userData, "x86-neural-terminal-ux.json"),
    onRecover: (reason, backup) => log.warn(`settings file recovered (${reason})`, backup ? { backup } : undefined),
  });
  log.info("settings store", store.path);

  handle(IPC.SETTINGS_GET, () => {
    const value = store.get(SETTINGS_KEY);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  });

  handle(IPC.SETTINGS_SET, (_event, settings: unknown) => {
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
      return { ok: false, error: "Settings must be an object" };
    }
    const size = Buffer.byteLength(JSON.stringify(settings), "utf8");
    if (size > MAX_SETTINGS_BYTES) {
      return { ok: false, error: `Settings exceed ${MAX_SETTINGS_BYTES} bytes` };
    }
    store.set(SETTINGS_KEY, settings);
    return { ok: true };
  });

  handle(IPC.SETTINGS_RESET, () => {
    store.clear();
    return { ok: true };
  });
}
