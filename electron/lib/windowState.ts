// ============================================================
// WINDOW STATE — remember size, position and maximized state.
// Restored bounds are validated against the current displays so a
// window saved on a now-disconnected monitor never opens off-screen.
// ============================================================
import { BrowserWindow, Rectangle, screen } from "electron";
import * as path from "node:path";
import { JsonStore } from "./jsonStore";
import { createLogger } from "./logger";

const log = createLogger("window-state");

export interface WindowState {
  bounds?: Rectangle;
  maximized: boolean;
  fullScreen: boolean;
}

function isRectangle(value: unknown): value is Rectangle {
  if (!value || typeof value !== "object") return false;
  const rect = value as Record<string, unknown>;
  return ["x", "y", "width", "height"].every(key => typeof rect[key] === "number" && Number.isFinite(rect[key] as number));
}

function visibleOnSomeDisplay(bounds: Rectangle): boolean {
  return screen.getAllDisplays().some(({ workArea }) => {
    const overlapX = Math.min(bounds.x + bounds.width, workArea.x + workArea.width) - Math.max(bounds.x, workArea.x);
    const overlapY = Math.min(bounds.y + bounds.height, workArea.y + workArea.height) - Math.max(bounds.y, workArea.y);
    return overlapX >= 100 && overlapY >= 50;
  });
}

export class WindowStateKeeper {
  private readonly store: JsonStore;
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(userData: string) {
    this.store = new JsonStore({
      file: path.join(userData, "window-state.json"),
      onRecover: reason => log.warn(`window state reset (${reason})`),
    });
  }

  load(minWidth: number, minHeight: number): WindowState {
    const saved = this.store.get<Record<string, unknown>>("main") ?? {};
    const bounds = isRectangle(saved.bounds)
      && saved.bounds.width >= minWidth
      && saved.bounds.height >= minHeight
      && visibleOnSomeDisplay(saved.bounds)
      ? saved.bounds
      : undefined;
    return { bounds, maximized: saved.maximized === true, fullScreen: saved.fullScreen === true };
  }

  track(win: BrowserWindow): void {
    const schedule = () => {
      if (this.saveTimer) clearTimeout(this.saveTimer);
      this.saveTimer = setTimeout(() => this.save(win), 400);
    };
    win.on("resize", schedule);
    win.on("move", schedule);
    win.on("maximize", schedule);
    win.on("unmaximize", schedule);
    win.on("enter-full-screen", schedule);
    win.on("leave-full-screen", schedule);
    win.on("close", () => {
      if (this.saveTimer) clearTimeout(this.saveTimer);
      this.save(win);
    });
  }

  private save(win: BrowserWindow): void {
    if (win.isDestroyed()) return;
    try {
      this.store.set("main", {
        // getNormalBounds: the restored size, even while maximized.
        bounds: win.getNormalBounds(),
        maximized: win.isMaximized(),
        fullScreen: win.isFullScreen(),
      });
    } catch (error) {
      log.warn("could not save window state", error);
    }
  }
}
