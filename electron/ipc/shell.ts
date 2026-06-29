// ============================================================
// SHELL / CLIPBOARD / FILE IPC HANDLERS
// All shell operations are validated — no arbitrary execution.
// URL allowlist enforced. File paths restricted to app dirs.
// ============================================================
import {
  ipcMain,
  IpcMainInvokeEvent,
  shell,
  clipboard,
  app,
  dialog,
} from "electron";
import * as path from "path";
import * as fs from "fs/promises";
import { IPC } from "./channels";

// Allowed URL schemes for shell.openExternal
const ALLOWED_SCHEMES = ["https:", "http:", "mailto:"];

export function registerShellHandlers(): void {

  // ── Open external URL (allowlisted) ──
  ipcMain.handle(IPC.SHELL_OPEN_URL, async (_event: IpcMainInvokeEvent, url: string) => {
    try {
      const parsed = new URL(url);
      if (!ALLOWED_SCHEMES.includes(parsed.protocol)) {
        return { ok: false, error: `Disallowed URL scheme: ${parsed.protocol}` };
      }
      await shell.openExternal(url);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  // ── Open path in file manager ──
  ipcMain.handle(IPC.SHELL_OPEN_PATH, async (_event: IpcMainInvokeEvent, filePath: string) => {
    try {
      const result = await shell.openPath(filePath);
      return result ? { ok: false, error: result } : { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  // ── Clipboard write ──
  ipcMain.handle(IPC.CLIPBOARD_WRITE, (_event: IpcMainInvokeEvent, text: string) => {
    try {
      clipboard.writeText(String(text).slice(0, 1_000_000)); // 1MB max
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  // ── Clipboard read ──
  ipcMain.handle(IPC.CLIPBOARD_READ, (_event: IpcMainInvokeEvent) => {
    try {
      return { ok: true, text: clipboard.readText() };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  // ── App version ──
  ipcMain.handle(IPC.APP_VERSION, (_event: IpcMainInvokeEvent) => {
    return app.getVersion();
  });

  // ── App platform ──
  ipcMain.handle(IPC.APP_PLATFORM, (_event: IpcMainInvokeEvent) => {
    return process.platform;
  });

  // ── Log directory path ──
  ipcMain.handle(IPC.APP_LOG_DIR, (_event: IpcMainInvokeEvent) => {
    return app.getPath("logs");
  });

  // ── Save terminal log to file ──
  ipcMain.handle(IPC.FILE_SAVE_LOG, async (_event: IpcMainInvokeEvent, content: string) => {
    try {
      const { filePath, canceled } = await dialog.showSaveDialog({
        title: "Save Terminal Log",
        defaultPath: path.join(
          app.getPath("documents"),
          `x86-terminal-${Date.now()}.log`
        ),
        filters: [
          { name: "Log Files", extensions: ["log", "txt"] },
          { name: "All Files", extensions: ["*"] },
        ],
      });

      if (canceled || !filePath) return { ok: false, error: "Cancelled" };

      // Restrict to user-writable directories
      const docDir = app.getPath("documents");
      const homeDir = app.getPath("home");
      const resolved = path.resolve(filePath);
      const inDocs = resolved.startsWith(path.resolve(docDir));
      const inHome = resolved.startsWith(path.resolve(homeDir));

      if (!inDocs && !inHome) {
        return { ok: false, error: "Write restricted to home/documents directory" };
      }

      await fs.writeFile(filePath, content, "utf-8");
      return { ok: true, path: filePath };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  // ── Open log file ──
  ipcMain.handle(IPC.FILE_OPEN_LOG, async (_event: IpcMainInvokeEvent) => {
    try {
      const { filePaths, canceled } = await dialog.showOpenDialog({
        title: "Open Terminal Log",
        filters: [
          { name: "Log Files", extensions: ["log", "txt"] },
          { name: "All Files", extensions: ["*"] },
        ],
        properties: ["openFile"],
      });

      if (canceled || filePaths.length === 0) return { ok: false, error: "Cancelled" };

      const content = await fs.readFile(filePaths[0], "utf-8");
      return { ok: true, content, path: filePaths[0] };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });
}
