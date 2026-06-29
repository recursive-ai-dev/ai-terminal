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

  // ── Native file I/O (optional future use) ──
  FILE_SAVE_LOG:   "file:saveLog",
  FILE_OPEN_LOG:   "file:openLog",
} as const;

export type IPCChannel = typeof IPC[keyof typeof IPC];
