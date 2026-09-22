// ============================================================
// PRELOAD SCRIPT — contextBridge API surface
// Runs in isolated context. No nodeIntegration in renderer.
// Exposes exactly what the renderer needs — nothing more.
// All channels go through the typed IPC registry.
// ============================================================
import { contextBridge, ipcRenderer, IpcRendererEvent } from "electron";
import { IPC } from "./ipc/channels";

// ── Typed API exposed to renderer window.electronAPI ──
const api = {

  // ── Settings (native ~/.config persistence) ──
  settings: {
    get:   ()                    => ipcRenderer.invoke(IPC.SETTINGS_GET),
    set:   (s: unknown)          => ipcRenderer.invoke(IPC.SETTINGS_SET, s),
    reset: ()                    => ipcRenderer.invoke(IPC.SETTINGS_RESET),
  },

  // ── Window controls ──
  window: {
    minimize:     () => ipcRenderer.invoke(IPC.WINDOW_MINIMIZE),
    maximize:     () => ipcRenderer.invoke(IPC.WINDOW_MAXIMIZE),
    close:        () => ipcRenderer.invoke(IPC.WINDOW_CLOSE),
    isMaximized:  () => ipcRenderer.invoke(IPC.WINDOW_IS_MAX),
  },

  // ── Shell / system ──
  shell: {
    openUrl:  (url: string)  => ipcRenderer.invoke(IPC.SHELL_OPEN_URL, url),
    openPath: (path: string) => ipcRenderer.invoke(IPC.SHELL_OPEN_PATH, path),
  },

  // ── Clipboard ──
  clipboard: {
    write: (text: string)    => ipcRenderer.invoke(IPC.CLIPBOARD_WRITE, text),
    read:  ()                => ipcRenderer.invoke(IPC.CLIPBOARD_READ),
  },

  // ── App metadata ──
  app: {
    version:  () => ipcRenderer.invoke(IPC.APP_VERSION),
    platform: () => ipcRenderer.invoke(IPC.APP_PLATFORM),
    logDir:   () => ipcRenderer.invoke(IPC.APP_LOG_DIR),
  },

  // ── File I/O ──
  file: {
    saveLog: (content: string) => ipcRenderer.invoke(IPC.FILE_SAVE_LOG, content),
    openLog: ()                => ipcRenderer.invoke(IPC.FILE_OPEN_LOG),
  },

  // ── Local AI provider ──
  ai: {
    ask: (request: string) => ipcRenderer.invoke(IPC.AI_ASK, request),
  },

  // ── Native shell session ──
  terminal: {
    start:  () => ipcRenderer.invoke(IPC.TERMINAL_START),
    write:  (id: string, input: string) => ipcRenderer.invoke(IPC.TERMINAL_WRITE, id, input),
    resize: (id: string, cols: number, rows: number) => ipcRenderer.invoke(IPC.TERMINAL_RESIZE, id, cols, rows),
    kill:   (id: string) => ipcRenderer.invoke(IPC.TERMINAL_KILL, id),
    onData: (cb: (event: { id: string; data: string; stderr?: boolean }) => void) => {
      const handler = (_event: IpcRendererEvent, payload: { id: string; data: string; stderr?: boolean }) => cb(payload);
      ipcRenderer.on(IPC.TERMINAL_DATA, handler);
      return () => ipcRenderer.removeListener(IPC.TERMINAL_DATA, handler);
    },
    onExit: (cb: (event: { id: string; code: number | null; signal: string | null }) => void) => {
      const handler = (_event: IpcRendererEvent, payload: { id: string; code: number | null; signal: string | null }) => cb(payload);
      ipcRenderer.on(IPC.TERMINAL_EXIT, handler);
      return () => ipcRenderer.removeListener(IPC.TERMINAL_EXIT, handler);
    },
  },

  // ── Updater ──
  updater: {
    check:    () => ipcRenderer.invoke(IPC.UPDATER_CHECK),
    download: () => ipcRenderer.invoke(IPC.UPDATER_DOWNLOAD),
    install:  () => ipcRenderer.invoke(IPC.UPDATER_INSTALL),
    status:   () => ipcRenderer.invoke(IPC.UPDATER_STATUS),

    // Push listener — renderer calls this to subscribe to live updates
    onStatus: (cb: (status: unknown) => void) => {
      const handler = (_event: IpcRendererEvent, status: unknown) => cb(status);
      ipcRenderer.on(IPC.UPDATER_STATUS_PUSH, handler);
      // Returns cleanup function
      return () => ipcRenderer.removeListener(IPC.UPDATER_STATUS_PUSH, handler);
    },
  },
} as const;

contextBridge.exposeInMainWorld("electronAPI", api);

// ── TypeScript declaration for renderer ──
// (Duplicated in src/bridge/electronBridge.ts for renderer consumption)
export type ElectronAPI = typeof api;
