// ============================================================
// SHELL / CLIPBOARD / FILE IPC HANDLERS
// URL schemes are allowlisted; file dialogs are modal to the calling
// window; reads and writes are size-capped.
// ============================================================
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  shell,
  IpcMainInvokeEvent,
} from "electron";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { IPC } from "./channels";
import { handle } from "../lib/ipcGuard";
import { isInside } from "../lib/paths";

const ALLOWED_SCHEMES = new Set(["https:", "http:", "mailto:"]);
const MAX_CLIPBOARD_CHARS = 1_000_000;
const MAX_LOG_BYTES = 20 * 1024 * 1024;

function ownerWindow(event: IpcMainInvokeEvent): BrowserWindow | undefined {
  return BrowserWindow.fromWebContents(event.sender) ?? undefined;
}

export function openExternalSafely(raw: string): { ok: boolean; error?: string } {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, error: "Invalid URL" };
  }
  if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
    return { ok: false, error: `Disallowed URL scheme: ${parsed.protocol}` };
  }
  void shell.openExternal(parsed.href);
  return { ok: true };
}

export function registerShellHandlers(): void {
  handle(IPC.SHELL_OPEN_URL, (_event, url: unknown) => {
    if (typeof url !== "string") return { ok: false, error: "URL must be text" };
    return openExternalSafely(url);
  });

  // Reveal (never execute) a path inside the user's home or app log dir.
  handle(IPC.SHELL_OPEN_PATH, (_event, filePath: unknown) => {
    if (typeof filePath !== "string" || !path.isAbsolute(filePath)) return { ok: false, error: "Path must be absolute" };
    const resolved = path.resolve(filePath);
    const allowedRoots = [app.getPath("home"), app.getPath("logs"), app.getPath("userData")];
    if (!allowedRoots.some(root => isInside(root, resolved))) return { ok: false, error: "Path is outside the allowed directories" };
    shell.showItemInFolder(resolved);
    return { ok: true };
  });

  handle(IPC.CLIPBOARD_WRITE, (_event, text: unknown) => {
    if (typeof text !== "string") return { ok: false, error: "Clipboard text must be a string" };
    clipboard.writeText(text.slice(0, MAX_CLIPBOARD_CHARS));
    return { ok: true };
  });

  handle(IPC.CLIPBOARD_READ, () => ({ ok: true, text: clipboard.readText() }));

  handle(IPC.APP_VERSION, () => app.getVersion());
  handle(IPC.APP_PLATFORM, () => process.platform);
  handle(IPC.APP_LOG_DIR, () => app.getPath("logs"));

  handle(IPC.FILE_SAVE_LOG, async (event, content: unknown) => {
    if (typeof content !== "string") return { ok: false, error: "Log content must be text" };
    if (Buffer.byteLength(content, "utf8") > MAX_LOG_BYTES) return { ok: false, error: "Log is too large to save" };

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const options: Electron.SaveDialogOptions = {
      title: "Save Terminal Log",
      defaultPath: path.join(app.getPath("documents"), `ai-terminal-${stamp}.log`),
      filters: [
        { name: "Log Files", extensions: ["log", "txt"] },
        { name: "All Files", extensions: ["*"] },
      ],
    };
    const parent = ownerWindow(event);
    const { filePath, canceled } = parent ? await dialog.showSaveDialog(parent, options) : await dialog.showSaveDialog(options);
    if (canceled || !filePath) return { ok: false, error: "Cancelled" };

    // The user chose this path in a native dialog, which is the consent
    // boundary. Mode 0600: terminal logs can contain secrets.
    await fs.writeFile(filePath, content, { encoding: "utf8", mode: 0o600 });
    return { ok: true, path: filePath };
  });

  handle(IPC.FILE_OPEN_LOG, async event => {
    const options: Electron.OpenDialogOptions = {
      title: "Open Terminal Log",
      filters: [
        { name: "Log Files", extensions: ["log", "txt"] },
        { name: "All Files", extensions: ["*"] },
      ],
      properties: ["openFile"],
    };
    const parent = ownerWindow(event);
    const { filePaths, canceled } = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
    if (canceled || filePaths.length === 0) return { ok: false, error: "Cancelled" };

    const file = filePaths[0];
    const stat = await fs.stat(file);
    if (!stat.isFile()) return { ok: false, error: "Not a regular file" };
    if (stat.size > MAX_LOG_BYTES) return { ok: false, error: `File is larger than ${MAX_LOG_BYTES / 1024 / 1024} MB` };
    const content = await fs.readFile(file, "utf8");
    return { ok: true, content, path: file };
  });
}
