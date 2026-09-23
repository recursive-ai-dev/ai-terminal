// ============================================================
// IPC CHANNEL REGISTRY — Single source of truth
// All channel names typed and centralized.
// No magic strings anywhere else in the codebase.
// ============================================================

export const IPC = {
  // ── Settings ──
  SETTINGS_GET:    "settings:get",
  SETTINGS_SET:    "settings:set",
  SETTINGS_RESET:  "settings:reset",

  // ── Window controls ──
  WINDOW_MINIMIZE: "window:minimize",
  WINDOW_MAXIMIZE: "window:maximize",
  WINDOW_CLOSE:    "window:close",
  WINDOW_IS_MAX:   "window:isMaximized",
  WINDOW_MAX_PUSH: "window:maximized:push",    // main → renderer

  // ── Native menu → renderer ──
  MENU_ACTION:     "menu:action",

  // ── Shell / system ──
  SHELL_OPEN_URL:     "shell:openUrl",
  SHELL_OPEN_PATH:    "shell:openPath",
  CLIPBOARD_WRITE:    "clipboard:write",
  CLIPBOARD_READ:     "clipboard:read",

  // ── App metadata ──
  APP_VERSION:     "app:version",
  APP_PLATFORM:    "app:platform",
  APP_LOG_DIR:     "app:logDir",

  // ── Updater ──
  UPDATER_CHECK:          "updater:check",
  UPDATER_DOWNLOAD:       "updater:download",
  UPDATER_INSTALL:        "updater:install",
  UPDATER_STATUS:         "updater:status",         // renderer → main (query)
  UPDATER_STATUS_PUSH:    "updater:status:push",    // main → renderer (push)

  // ── Native file I/O ──
  FILE_SAVE_LOG:   "file:saveLog",
  FILE_OPEN_LOG:   "file:openLog",

  // ── Local AI provider ──
  AI_ASK:          "ai:ask",

  // ── Native terminal session ──
  TERMINAL_START:     "terminal:start",
  TERMINAL_WRITE:     "terminal:write",
  TERMINAL_RESIZE:    "terminal:resize",
  TERMINAL_INTERRUPT: "terminal:interrupt",
  TERMINAL_ACK:       "terminal:ack",
  TERMINAL_KILL:      "terminal:kill",
  TERMINAL_DATA:      "terminal:data",
  TERMINAL_EXIT:      "terminal:exit",
} as const;

export type IPCChannel = typeof IPC[keyof typeof IPC];

/** Actions the native menu forwards to the renderer. */
export const MENU_ACTIONS = ["saveLog", "openLog", "openSettings"] as const;
export type MenuAction = typeof MENU_ACTIONS[number];
