// ============================================================
// NATIVE SETTINGS STORE — electron-store backed
// Persists to ~/.config/<appName>/config.json (Linux/macOS)
//              %APPDATA%\<appName>\config.json (Windows)
// Falls back gracefully if electron-store is unavailable.
// ============================================================
import { ipcMain, IpcMainInvokeEvent } from "electron";
import { IPC } from "./channels";

// Lazy-load electron-store to avoid hard crash if not installed
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let store: any = null;

async function getStore() {
  if (store) return store;
  try {
    // electron-store v8+ is ESM — dynamic import required
    const { default: Store } = await import("electron-store");
    store = new Store({
      name: "x86-neural-terminal-ux",
      defaults: {},
      // Validate schema loosely — we merge with defaults in renderer anyway
    });
  } catch {
    // Fallback in-memory store if electron-store not available
    const mem: Record<string, unknown> = {};
    store = {
      get: (k: string, def?: unknown) => (k in mem ? mem[k] : def),
      set: (k: string, v: unknown) => { mem[k] = v; },
      clear: () => { Object.keys(mem).forEach(k => delete mem[k]); },
    };
  }
  return store;
}

// ── Register all settings IPC handlers ──
export async function registerSettingsHandlers(): Promise<void> {
  const s = await getStore();

  // Get all settings (returns full object or empty)
  ipcMain.handle(IPC.SETTINGS_GET, (_event: IpcMainInvokeEvent) => {
    try {
      return s.get("uxSettings", null);
    } catch {
      return null;
    }
  });

  // Set all settings (renderer sends full UXSettings object)
  ipcMain.handle(IPC.SETTINGS_SET, (_event: IpcMainInvokeEvent, settings: unknown) => {
    try {
      s.set("uxSettings", settings);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  // Reset — clears the native store
  ipcMain.handle(IPC.SETTINGS_RESET, (_event: IpcMainInvokeEvent) => {
    try {
      s.clear();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });
}
