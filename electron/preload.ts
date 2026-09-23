// ============================================================
// PRELOAD SCRIPT — contextBridge API surface
// Runs in a sandboxed, isolated context. Sandboxed preloads cannot
// require() local files at runtime, so this file is bundled by
// scripts/build-electron.mjs (the channel registry is inlined).
// Exposes exactly what the renderer needs — nothing more.
// ============================================================
import { contextBridge, ipcRenderer, IpcRendererEvent } from "electron";
import { IPC, MENU_ACTIONS, type MenuAction } from "./ipc/channels";

type Unsubscribe = () => void;

function subscribe<T>(channel: string, cb: (payload: T) => void): Unsubscribe {
  const handler = (_event: IpcRendererEvent, payload: T) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => { ipcRenderer.removeListener(channel, handler); };
}

const api = {
  // ── Settings (native persistence) ──
  settings: {
    get:   ()           => ipcRenderer.invoke(IPC.SETTINGS_GET),
    set:   (s: unknown) => ipcRenderer.invoke(IPC.SETTINGS_SET, s),
    reset: ()           => ipcRenderer.invoke(IPC.SETTINGS_RESET),
  },

  // ── Window controls ──
  window: {
    minimize:    () => ipcRenderer.invoke(IPC.WINDOW_MINIMIZE),
    maximize:    () => ipcRenderer.invoke(IPC.WINDOW_MAXIMIZE),
    close:       () => ipcRenderer.invoke(IPC.WINDOW_CLOSE),
    isMaximized: () => ipcRenderer.invoke(IPC.WINDOW_IS_MAX),
    onMaximizedChange: (cb: (maximized: boolean) => void) => subscribe<boolean>(IPC.WINDOW_MAX_PUSH, value => cb(value === true)),
  },

  // ── Native menu ──
  menu: {
    onAction: (cb: (action: MenuAction) => void) => subscribe<unknown>(IPC.MENU_ACTION, action => {
      if (typeof action === "string" && (MENU_ACTIONS as readonly string[]).includes(action)) cb(action as MenuAction);
    }),
  },

  // ── Shell / system ──
  shell: {
    openUrl:  (url: string)  => ipcRenderer.invoke(IPC.SHELL_OPEN_URL, url),
    openPath: (path: string) => ipcRenderer.invoke(IPC.SHELL_OPEN_PATH, path),
  },

  // ── Clipboard ──
  clipboard: {
    write: (text: string) => ipcRenderer.invoke(IPC.CLIPBOARD_WRITE, text),
    read:  ()             => ipcRenderer.invoke(IPC.CLIPBOARD_READ),
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
    start:     ()                                => ipcRenderer.invoke(IPC.TERMINAL_START),
    write:     (id: string, input: string)       => ipcRenderer.invoke(IPC.TERMINAL_WRITE, id, input),
    resize:    (id: string, cols: number, rows: number) => ipcRenderer.invoke(IPC.TERMINAL_RESIZE, id, cols, rows),
    interrupt: (id: string)                      => ipcRenderer.invoke(IPC.TERMINAL_INTERRUPT, id),
    ack:       (id: string, chars: number)       => ipcRenderer.invoke(IPC.TERMINAL_ACK, id, chars),
    kill:      (id: string)                      => ipcRenderer.invoke(IPC.TERMINAL_KILL, id),
    onData: (cb: (event: { id: string; data: string }) => void) => subscribe(IPC.TERMINAL_DATA, cb),
    onExit: (cb: (event: { id: string; code: number | null; signal: string | null }) => void) => subscribe(IPC.TERMINAL_EXIT, cb),
  },

  // ── Updater ──
  updater: {
    check:    () => ipcRenderer.invoke(IPC.UPDATER_CHECK),
    download: () => ipcRenderer.invoke(IPC.UPDATER_DOWNLOAD),
    install:  () => ipcRenderer.invoke(IPC.UPDATER_INSTALL),
    status:   () => ipcRenderer.invoke(IPC.UPDATER_STATUS),
    onStatus: (cb: (status: unknown) => void) => subscribe(IPC.UPDATER_STATUS_PUSH, cb),
  },
} as const;

contextBridge.exposeInMainWorld("electronAPI", api);

// Renderer-side declarations live in src/bridge/electronBridge.ts.
export type ElectronAPI = typeof api;
