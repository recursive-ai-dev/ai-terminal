// ============================================================
// usePlatform — React hook
// Detects Electron vs browser. Routes settings persistence,
// clipboard, window controls, and file I/O to the correct layer.
// In browser: falls back to localStorage + navigator.clipboard.
// In Electron: uses native IPC via electronBridge.
// ============================================================
import { useState, useEffect, useCallback, useRef } from "react";
import {
  isElectron,
  maybeElectronAPI,
  UpdaterStatus,
} from "./electronBridge";
import {
  UXSettings,
  loadSettings,
  saveSettings,
  resetSettings,
} from "../engine/UXSettings";

// ── Platform info snapshot ──
export interface PlatformInfo {
  runtime:   "electron" | "browser";
  platform:  string;      // "linux" | "darwin" | "win32" | "web"
  version:   string;      // app version (Electron) or build version (web)
  logDir:    string;      // native log dir or "(browser)"
}

// ── Window controls (frameless window) ──
export interface WindowControls {
  minimize:    () => void;
  maximize:    () => void;
  close:       () => void;
  isMaximized: boolean;
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

  // File I/O (Electron only — no-op in browser)
  saveLog:  (content: string) => Promise<{ ok: boolean; path?: string; error?: string }>;
  openLog:  () => Promise<{ ok: boolean; content?: string; path?: string; error?: string }>;

  // Local AI provider (optional; browser uses the deterministic fallback)
  ai: {
    ask: (request: string) => Promise<{
      ok: boolean;
      source?: "ollama";
      title?: string;
      explanation?: string;
      command?: string;
      risk?: "safe" | "review" | "dangerous";
      notes?: string[];
      error?: string;
    }>;
  };

  // Native shell session (Electron only — browser stays sandboxed)
  terminal: {
    start: () => Promise<{ ok: boolean; id?: string; cwd?: string; shell?: string; pty?: boolean; error?: string }>;
    write: (id: string, input: string) => Promise<{ ok: boolean; error?: string }>;
    resize: (id: string, cols: number, rows: number) => Promise<{ ok: boolean; error?: string }>;
    kill: (id: string) => Promise<{ ok: boolean; error?: string }>;
    onData: (cb: (event: { id: string; data: string; stderr?: boolean }) => void) => () => void;
    onExit: (cb: (event: { id: string; code: number | null; signal: string | null }) => void) => () => void;
  };

  // Window controls (Electron only — no-op in browser)
  window: WindowControls;

  // Updater (Electron only)
  updaterStatus: UpdaterStatus;
  checkForUpdates:  () => Promise<void>;
  downloadUpdate:   () => Promise<void>;
  installUpdate:    () => Promise<void>;
}

// ────────────────────────────────────────────────────────────
// HOOK IMPLEMENTATION
// ────────────────────────────────────────────────────────────
export function usePlatform(): UsePlatformResult {
  const electron = maybeElectronAPI();
  const [ready, setReady] = useState(false);
  const [platform, setPlatform] = useState<PlatformInfo>({
    runtime:  isElectron() ? "electron" : "browser",
    platform: "web",
    version:  "2.0.0",
    logDir:   "(browser)",
  });
  const [isMaximized, setIsMaximized] = useState(false);
  const [updaterStatus, setUpdaterStatus] = useState<UpdaterStatus>({ state: "idle" });
  const updaterCleanupRef = useRef<(() => void) | null>(null);

  // ── Hydrate platform info on mount ──
  useEffect(() => {
    async function init() {
      if (electron) {
        const [ver, plat, logDir, isMax] = await Promise.all([
          electron.app.version().catch(() => "unknown"),
          electron.app.platform().catch(() => "unknown"),
          electron.app.logDir().catch(() => "(unavailable)"),
          electron.window.isMaximized().catch(() => false),
        ]);
        setPlatform({
          runtime:  "electron",
          platform: plat,
          version:  ver,
          logDir,
        });
        setIsMaximized(isMax);

        // Subscribe to updater status pushes
        updaterCleanupRef.current = electron.updater.onStatus(status => {
          setUpdaterStatus(status as UpdaterStatus);
        });

        // Get initial updater status
        const s = await electron.updater.status().catch(() => ({ state: "idle" as const }));
        setUpdaterStatus(s);
      }
      setReady(true);
    }
    init();

    return () => {
      updaterCleanupRef.current?.();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Settings — route to native or localStorage ──
  const loadNativeSettings = useCallback(async (): Promise<UXSettings> => {
    if (electron) {
      try {
        const native = await electron.settings.get();
        if (native && typeof native === "object") {
          // Merge with defaults (same strategy as localStorage path)
          return { ...loadSettings(), ...(native as Partial<UXSettings>) };
        }
      } catch {
        // Fall through to localStorage
      }
    }
    return loadSettings();
  }, [electron]);

  const saveNativeSettings = useCallback(async (s: UXSettings): Promise<void> => {
    // Always write localStorage as fallback
    saveSettings(s);
    if (electron) {
      try {
        await electron.settings.set(s);
      } catch {
        // localStorage already saved — non-fatal
      }
    }
  }, [electron]);

  const resetNativeSettings = useCallback(async (): Promise<UXSettings> => {
    const defaults = resetSettings(); // clears localStorage
    if (electron) {
      try {
        await electron.settings.reset();
      } catch {
        // non-fatal
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
    if (electron) {
      return electron.file.saveLog(content);
    }
    // Browser fallback: trigger download
    try {
      const blob = new Blob([content], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `x86-terminal-${Date.now()}.log`;
      a.click();
      URL.revokeObjectURL(url);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }, [electron]);

  const openLog = useCallback(async () => {
    if (electron) {
      return electron.file.openLog();
    }
    // Browser fallback: file input
    return new Promise<{ ok: boolean; content?: string; error?: string }>(resolve => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".log,.txt";
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) { resolve({ ok: false, error: "No file selected" }); return; }
        try {
          const content = await file.text();
          resolve({ ok: true, content });
        } catch (err) {
          resolve({ ok: false, error: String(err) });
        }
      };
      input.oncancel = () => resolve({ ok: false, error: "Cancelled" });
      input.click();
    });
  }, [electron]);

  // ── Local AI provider ──
  const ai = {
    ask: useCallback(async (request: string) => {
      if (electron) return electron.ai.ask(request);
      return { ok: false, error: "Local model bridge is available in the desktop app" };
    }, [electron]),
  };

  // ── Native shell session ──
  // Browser builds deliberately return a clear capability error rather than
  // pretending that a web page can execute commands on the user's machine.
  const terminal = {
    start: useCallback(async () => {
      if (electron) return electron.terminal.start();
      return { ok: false, error: "Native shell is available in the desktop app" };
    }, [electron]),
    write: useCallback(async (id: string, input: string) => {
      if (electron) return electron.terminal.write(id, input);
      return { ok: false, error: "Native shell is available in the desktop app" };
    }, [electron]),
    resize: useCallback(async (id: string, cols: number, rows: number) => {
      if (electron) return electron.terminal.resize(id, cols, rows);
      return { ok: false, error: "Native shell is available in the desktop app" };
    }, [electron]),
    kill: useCallback(async (id: string) => {
      if (electron) return electron.terminal.kill(id);
      return { ok: false, error: "Native shell is available in the desktop app" };
    }, [electron]),
    onData: useCallback((cb: (event: { id: string; data: string; stderr?: boolean }) => void) => {
      return electron ? electron.terminal.onData(cb) : () => undefined;
    }, [electron]),
    onExit: useCallback((cb: (event: { id: string; code: number | null; signal: string | null }) => void) => {
      return electron ? electron.terminal.onExit(cb) : () => undefined;
    }, [electron]),
  };

  // ── Window controls ──
  const windowControls: WindowControls = {
    minimize:    useCallback(() => { electron?.window.minimize(); }, [electron]),
    maximize:    useCallback(async () => {
      if (electron) {
        await electron.window.maximize();
        const isMax = await electron.window.isMaximized().catch(() => false);
        setIsMaximized(isMax);
      }
    }, [electron]),
    close:       useCallback(() => { electron?.window.close(); }, [electron]),
    isMaximized,
  };

  // ── Updater ──
  const checkForUpdates = useCallback(async () => {
    if (electron) await electron.updater.check().catch(() => {});
  }, [electron]);

  const downloadUpdate = useCallback(async () => {
    if (electron) await electron.updater.download().catch(() => {});
  }, [electron]);

  const installUpdate = useCallback(async () => {
    if (electron) await electron.updater.install().catch(() => {});
  }, [electron]);

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
    window: windowControls,
    updaterStatus,
    checkForUpdates,
    downloadUpdate,
    installUpdate,
  };
}
