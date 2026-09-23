// ============================================================
// usePlatform — React hook
// Detects Electron vs browser. Routes settings persistence,
// clipboard, window controls, and file I/O to the correct layer.
// In browser: falls back to localStorage + navigator.clipboard.
// In Electron: uses native IPC via electronBridge.
// All returned objects and functions are referentially stable.
// ============================================================
import { useState, useEffect, useCallback, useMemo } from "react";
import {
  isElectron,
  maybeElectronAPI,
  type AIAskResult,
  type MenuAction,
  type TerminalDataEvent,
  type TerminalExitEvent,
  type TerminalResult,
  type TerminalStartResult,
  type UpdaterStatus,
} from "./electronBridge";
import {
  UXSettings,
  loadSettings,
  saveSettings,
  resetSettings,
  validateSettings,
} from "../engine/UXSettings";

// ── Platform info snapshot ──
export interface PlatformInfo {
  runtime:   "electron" | "browser";
  platform:  string;      // "linux" | "darwin" | "win32" | "web"
  version:   string;      // app version
  logDir:    string;      // native log dir or "(browser)"
}

// ── Window controls (frameless window) ──
export interface WindowControls {
  minimize:    () => void;
  maximize:    () => void;
  close:       () => void;
  isMaximized: boolean;
}

export interface PlatformTerminal {
  start:     () => Promise<TerminalStartResult>;
  write:     (id: string, input: string) => Promise<TerminalResult>;
  resize:    (id: string, cols: number, rows: number) => Promise<TerminalResult>;
  interrupt: (id: string) => Promise<TerminalResult>;
  ack:       (id: string, chars: number) => void;
  kill:      (id: string) => Promise<TerminalResult>;
  onData:    (cb: (event: TerminalDataEvent) => void) => () => void;
  onExit:    (cb: (event: TerminalExitEvent) => void) => () => void;
}

// ── Full platform hook return ──
export interface UsePlatformResult {
  // Platform metadata
  platform:   PlatformInfo;
  ready:      boolean;

  // Settings — unified API regardless of runtime
  loadNativeSettings:  () => Promise<UXSettings>;
  saveNativeSettings:  (s: UXSettings) => Promise<void>;
  resetNativeSettings: () => Promise<UXSettings>;

  // Clipboard
  copyToClipboard: (text: string) => Promise<boolean>;
  readClipboard:   () => Promise<string>;

  // File I/O (download / file picker in the browser)
  saveLog:  (content: string) => Promise<{ ok: boolean; path?: string; error?: string }>;
  openLog:  () => Promise<{ ok: boolean; content?: string; path?: string; error?: string }>;

  // Local AI provider (optional; browser uses the deterministic fallback)
  ai: { ask: (request: string) => Promise<AIAskResult> };

  // Native shell session (Electron only — browser stays sandboxed)
  terminal: PlatformTerminal;

  // Native menu actions (Electron only)
  onMenuAction: (cb: (action: MenuAction) => void) => () => void;

  // Window controls (Electron only — no-op in browser)
  window: WindowControls;

  // Updater (Electron only)
  updaterStatus: UpdaterStatus;
  checkForUpdates:  () => Promise<void>;
  downloadUpdate:   () => Promise<void>;
  installUpdate:    () => Promise<void>;
}

const DESKTOP_ONLY = "Native shell is available in the desktop app";
const noop = () => undefined;

// ────────────────────────────────────────────────────────────
// HOOK IMPLEMENTATION
// ────────────────────────────────────────────────────────────
export function usePlatform(): UsePlatformResult {
  // window.electronAPI is fixed for the page's lifetime.
  const electron = useMemo(() => maybeElectronAPI(), []);
  const [ready, setReady] = useState(false);
  const [platform, setPlatform] = useState<PlatformInfo>({
    runtime:  isElectron() ? "electron" : "browser",
    platform: "web",
    version:  __APP_VERSION__,
    logDir:   "(browser)",
  });
  const [isMaximized, setIsMaximized] = useState(false);
  const [updaterStatus, setUpdaterStatus] = useState<UpdaterStatus>({ state: "idle" });

  // ── Hydrate platform info on mount ──
  useEffect(() => {
    let disposed = false;
    const cleanups: Array<() => void> = [];

    async function init() {
      if (electron) {
        cleanups.push(electron.updater.onStatus(status => setUpdaterStatus(status)));
        cleanups.push(electron.window.onMaximizedChange(setIsMaximized));

        const [ver, plat, logDir, isMax, status] = await Promise.all([
          electron.app.version().catch(() => "unknown"),
          electron.app.platform().catch(() => "unknown"),
          electron.app.logDir().catch(() => "(unavailable)"),
          electron.window.isMaximized().catch(() => false),
          electron.updater.status().catch((): UpdaterStatus => ({ state: "idle" })),
        ]);
        if (disposed) return;
        setPlatform({ runtime: "electron", platform: plat, version: ver, logDir });
        setIsMaximized(isMax === true);
        setUpdaterStatus(status);
      }
      if (!disposed) setReady(true);
    }
    void init();

    return () => {
      disposed = true;
      cleanups.forEach(cleanup => cleanup());
    };
  }, [electron]);

  // ── Settings — route to native or localStorage ──
  const loadNativeSettings = useCallback(async (): Promise<UXSettings> => {
    const local = loadSettings();
    if (!electron) return local;
    try {
      const native = await electron.settings.get();
      if (native && typeof native === "object" && !Array.isArray(native)) {
        // Native values are validated the same way as localStorage values.
        return { ...local, ...validateSettings(native as Partial<UXSettings>).validated };
      }
    } catch (error) {
      console.warn("[settings] native store unavailable, using local copy", error);
    }
    return local;
  }, [electron]);

  const saveNativeSettings = useCallback(async (s: UXSettings): Promise<void> => {
    // Always write localStorage as a fallback copy.
    saveSettings(s);
    if (!electron) return;
    try {
      const result = await electron.settings.set(s);
      if (!result.ok) console.warn("[settings] native save failed:", result.error);
    } catch (error) {
      console.warn("[settings] native save failed", error);
    }
  }, [electron]);

  const resetNativeSettings = useCallback(async (): Promise<UXSettings> => {
    const defaults = resetSettings(); // clears localStorage
    if (electron) {
      try {
        await electron.settings.reset();
      } catch (error) {
        console.warn("[settings] native reset failed", error);
      }
    }
    return defaults;
  }, [electron]);

  // ── Clipboard ──
  const copyToClipboard = useCallback(async (text: string): Promise<boolean> => {
    if (electron) {
      const res = await electron.clipboard.write(text).catch(() => ({ ok: false }));
      return res.ok;
    }
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }, [electron]);

  const readClipboard = useCallback(async (): Promise<string> => {
    if (electron) {
      const res = await electron.clipboard.read().catch(() => ({ ok: false, text: "" }));
      return res.text ?? "";
    }
    try {
      return await navigator.clipboard.readText();
    } catch {
      return "";
    }
  }, [electron]);

  // ── File I/O ──
  const saveLog = useCallback(async (content: string) => {
    if (electron) return electron.file.saveLog(content);
    // Browser fallback: trigger a download.
    try {
      const blob = new Blob([content], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ai-terminal-${new Date().toISOString().replace(/[:.]/g, "-")}.log`;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }, [electron]);

  const openLog = useCallback(async () => {
    if (electron) return electron.file.openLog();
    // Browser fallback: file input.
    return new Promise<{ ok: boolean; content?: string; error?: string }>(resolve => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".log,.txt";
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) { resolve({ ok: false, error: "No file selected" }); return; }
        try {
          resolve({ ok: true, content: await file.text() });
        } catch (err) {
          resolve({ ok: false, error: String(err) });
        }
      };
      input.oncancel = () => resolve({ ok: false, error: "Cancelled" });
      input.click();
    });
  }, [electron]);

  // ── Local AI provider ──
  const ai = useMemo(() => ({
    ask: async (request: string): Promise<AIAskResult> => {
      if (electron) return electron.ai.ask(request);
      return { ok: false, error: "Local model bridge is available in the desktop app" };
    },
  }), [electron]);

  // ── Native shell session ──
  // Browser builds deliberately return a clear capability error rather than
  // pretending that a web page can execute commands on the user's machine.
  const terminal = useMemo<PlatformTerminal>(() => ({
    start:     async () => electron ? electron.terminal.start() : { ok: false, error: DESKTOP_ONLY },
    write:     async (id, input) => electron ? electron.terminal.write(id, input) : { ok: false, error: DESKTOP_ONLY },
    resize:    async (id, cols, rows) => electron ? electron.terminal.resize(id, cols, rows) : { ok: false, error: DESKTOP_ONLY },
    interrupt: async id => electron ? electron.terminal.interrupt(id) : { ok: false, error: DESKTOP_ONLY },
    ack:       (id, chars) => { if (electron) void electron.terminal.ack(id, chars).catch(noop); },
    kill:      async id => electron ? electron.terminal.kill(id) : { ok: false, error: DESKTOP_ONLY },
    onData:    cb => electron ? electron.terminal.onData(cb) : noop,
    onExit:    cb => electron ? electron.terminal.onExit(cb) : noop,
  }), [electron]);

  const onMenuAction = useCallback((cb: (action: MenuAction) => void) => {
    return electron ? electron.menu.onAction(cb) : noop;
  }, [electron]);

  // ── Window controls ──
  const minimize = useCallback(() => { void electron?.window.minimize(); }, [electron]);
  const maximize = useCallback(() => { void electron?.window.maximize(); }, [electron]);
  const close = useCallback(() => { void electron?.window.close(); }, [electron]);
  const windowControls = useMemo<WindowControls>(
    () => ({ minimize, maximize, close, isMaximized }),
    [minimize, maximize, close, isMaximized],
  );

  // ── Updater ──
  const reportUpdaterFailure = useCallback((result: { ok: boolean; error?: string }) => {
    if (!result.ok && result.error) setUpdaterStatus({ state: "error", message: result.error });
  }, []);

  const checkForUpdates = useCallback(async () => {
    if (electron) reportUpdaterFailure(await electron.updater.check().catch(error => ({ ok: false, error: String(error) })));
  }, [electron, reportUpdaterFailure]);

  const downloadUpdate = useCallback(async () => {
    if (electron) reportUpdaterFailure(await electron.updater.download().catch(error => ({ ok: false, error: String(error) })));
  }, [electron, reportUpdaterFailure]);

  const installUpdate = useCallback(async () => {
    if (electron) reportUpdaterFailure(await electron.updater.install().catch(error => ({ ok: false, error: String(error) })));
  }, [electron, reportUpdaterFailure]);

  return {
    platform,
    ready,
    loadNativeSettings,
    saveNativeSettings,
    resetNativeSettings,
    copyToClipboard,
    readClipboard,
    saveLog,
    openLog,
    ai,
    terminal,
    onMenuAction,
    window: windowControls,
    updaterStatus,
    checkForUpdates,
    downloadUpdate,
    installUpdate,
  };
}
