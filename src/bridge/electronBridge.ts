// ============================================================
// ELECTRON BRIDGE — Renderer-side typed API
// Mirrors the contextBridge from preload.ts exactly.
// Safe to import in any renderer file — falls back gracefully
// when running in a plain browser (non-Electron context).
// ============================================================

// ── Type declarations for window.electronAPI ──
export interface ElectronSettingsAPI {
  get:   () => Promise<unknown>;
  set:   (s: unknown) => Promise<{ ok: boolean; error?: string }>;
  reset: () => Promise<{ ok: boolean; error?: string }>;
}

export interface ElectronWindowAPI {
  minimize:    () => Promise<void>;
  maximize:    () => Promise<void>;
  close:       () => Promise<void>;
  isMaximized: () => Promise<boolean>;
}

export interface ElectronShellAPI {
  openUrl:  (url: string)  => Promise<{ ok: boolean; error?: string }>;
  openPath: (path: string) => Promise<{ ok: boolean; error?: string }>;
}

export interface ElectronClipboardAPI {
  write: (text: string) => Promise<{ ok: boolean; error?: string }>;
  read:  () => Promise<{ ok: boolean; text?: string; error?: string }>;
}

export interface ElectronAppAPI {
  version:  () => Promise<string>;
  platform: () => Promise<string>;
  logDir:   () => Promise<string>;
}

export interface ElectronFileAPI {
  saveLog: (content: string) => Promise<{ ok: boolean; path?: string; error?: string }>;
  openLog: () => Promise<{ ok: boolean; content?: string; path?: string; error?: string }>;
}

export type UpdaterStatus =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "available";     version: string; releaseDate: string }
  | { state: "not-available"; version: string }
  | { state: "downloading";   percent: number; bytesPerSec: number }
  | { state: "downloaded";    version: string }
  | { state: "error";         message: string };

export interface ElectronUpdaterAPI {
  check:    () => Promise<{ ok: boolean; error?: string }>;
  download: () => Promise<{ ok: boolean; error?: string }>;
  install:  () => Promise<{ ok: boolean; error?: string }>;
  status:   () => Promise<UpdaterStatus>;
  onStatus: (cb: (status: UpdaterStatus) => void) => () => void;
}

export interface TerminalDataEvent {
  id: string;
  data: string;
  stderr?: boolean;
}

export interface TerminalExitEvent {
  id: string;
  code: number | null;
  signal: string | null;
}

export interface ElectronTerminalAPI {
  start:  () => Promise<{ ok: boolean; id?: string; cwd?: string; shell?: string; pty?: boolean; error?: string }>;
  write:  (id: string, input: string) => Promise<{ ok: boolean; error?: string }>;
  resize: (id: string, cols: number, rows: number) => Promise<{ ok: boolean; error?: string }>;
  kill:   (id: string) => Promise<{ ok: boolean; error?: string }>;
  onData: (cb: (event: TerminalDataEvent) => void) => () => void;
  onExit: (cb: (event: TerminalExitEvent) => void) => () => void;
}

export interface ElectronAIAPI {
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
}

export interface ElectronAPI {
  settings:  ElectronSettingsAPI;
  window:    ElectronWindowAPI;
  shell:     ElectronShellAPI;
  clipboard: ElectronClipboardAPI;
  app:       ElectronAppAPI;
  file:      ElectronFileAPI;
  ai:        ElectronAIAPI;
  terminal:  ElectronTerminalAPI;
  updater:   ElectronUpdaterAPI;
}

// ── Augment window global ──
declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

// ── Runtime detection ──
export function isElectron(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.electronAPI !== "undefined"
  );
}

// ── Safe accessor — throws if not in Electron ──
export function getElectronAPI(): ElectronAPI {
  if (!isElectron() || !window.electronAPI) {
    throw new Error("electronAPI not available — not running in Electron");
  }
  return window.electronAPI;
}

// ── Optional accessor — returns null in browser ──
export function maybeElectronAPI(): ElectronAPI | null {
  return isElectron() ? (window.electronAPI ?? null) : null;
}
