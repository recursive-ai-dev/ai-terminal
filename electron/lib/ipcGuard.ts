// ============================================================
// IPC GUARD — only the app's own page may call privileged handlers
//
// The renderer can start a shell, so every ipcMain handler is a
// privileged entry point. `handle()` wraps ipcMain.handle with:
//   • sender validation (top-level frame of a trusted app URL),
//   • a uniform error envelope, and
//   • logging of rejected and failing calls.
// ============================================================
import { ipcMain, IpcMainInvokeEvent } from "electron";
import { pathToFileURL } from "node:url";
import { createLogger } from "./logger";

const log = createLogger("ipc");

let trustedFileUrl: string | null = null;
let trustedDevOrigin: string | null = null;

/** Declare where the app page is served from. Call before loading the window. */
export function setTrustedAppLocation(location: { indexHtml?: string; devServerUrl?: string }): void {
  trustedFileUrl = location.indexHtml ? pathToFileURL(location.indexHtml).href : null;
  trustedDevOrigin = location.devServerUrl ? new URL(location.devServerUrl).origin : null;
}

export function isTrustedUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (trustedDevOrigin && url.origin === trustedDevOrigin) return true;
  if (trustedFileUrl && url.protocol === "file:") {
    url.hash = "";
    url.search = "";
    return url.href === trustedFileUrl;
  }
  return false;
}

export function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  const frame = event.senderFrame;
  if (!frame) return false;
  // Only the top-level frame; the CSP forbids sub-frames, but be explicit.
  if (frame.parent !== null) return false;
  return isTrustedUrl(frame.url);
}

export type IpcFailure = { ok: false; error: string };

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Register a privileged invoke handler. Untrusted senders receive an error
 * envelope and never reach `listener`. Thrown errors are logged and
 * converted into `{ ok: false, error }` so the renderer never sees a
 * rejected promise with main-process stack traces.
 */
export function handle<Args extends unknown[], Result>(
  channel: string,
  listener: (event: IpcMainInvokeEvent, ...args: Args) => Result | Promise<Result>,
): void {
  ipcMain.removeHandler(channel);
  ipcMain.handle(channel, async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
    if (!isTrustedSender(event)) {
      log.warn(`rejected ${channel} from untrusted sender`, event.senderFrame?.url ?? "(no frame)");
      return { ok: false, error: "Untrusted sender" } satisfies IpcFailure;
    }
    try {
      return await listener(event, ...(args as Args));
    } catch (error) {
      log.error(`${channel} failed`, error);
      return { ok: false, error: errorMessage(error) } satisfies IpcFailure;
    }
  });
}
