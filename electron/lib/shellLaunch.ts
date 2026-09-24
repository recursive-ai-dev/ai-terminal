// ============================================================
// SHELL LAUNCH — choose the user's shell, its arguments, and a clean
// environment. Pure functions (no Electron imports) so the policy is
// unit-testable.
// ============================================================
import * as path from "node:path";

export interface ShellLaunch {
  file: string;
  args: string[];
  /** Basename without extension, e.g. "bash", "zsh", "fish". */
  name: string;
}

export interface ResolveShellOptions {
  platform: NodeJS.Platform;
  /** $SHELL from the environment. */
  envShell?: string;
  /** Login shell from the passwd database (os.userInfo().shell). */
  userShell?: string | null;
  /** %ComSpec% on Windows. */
  comSpec?: string;
  /** True when a real pseudo-terminal is available. */
  pty: boolean;
  isExecutable: (file: string) => boolean;
}

const POSIX_FALLBACKS = ["/bin/bash", "/usr/bin/bash", "/bin/zsh", "/usr/bin/zsh", "/bin/sh"];

// Shells known to accept `-i` (force interactive) and `-l` (login).
const KNOWN_SHELLS = new Set(["bash", "zsh", "sh", "dash", "ksh", "mksh", "fish", "tcsh", "csh", "ash", "yash"]);

export function shellName(file: string): string {
  // Split on both separators: Windows paths may be inspected on any host.
  const base = file.split(/[\\/]/).pop() ?? file;
  return base.replace(/\.exe$/i, "").toLowerCase();
}

export function resolveShell(options: ResolveShellOptions): ShellLaunch {
  if (options.platform === "win32") {
    const file = options.comSpec || "cmd.exe";
    return { file, args: [], name: shellName(file) };
  }

  const candidates = [options.envShell, options.userShell ?? undefined, ...POSIX_FALLBACKS]
    .filter((value): value is string => typeof value === "string" && path.isAbsolute(value));
  const file = candidates.find(candidate => options.isExecutable(candidate));
  if (!file) throw new Error("No usable shell found (checked $SHELL, the passwd entry, bash, zsh and sh)");

  const name = shellName(file);
  const args: string[] = [];
  if (KNOWN_SHELLS.has(name)) {
    // The renderer's line editor echoes input; readline would echo it
    // again. (bash requires long options before single-letter ones.)
    if (!options.pty && name === "bash") args.push("--noediting");
    // macOS terminals conventionally start login shells so /etc/zprofile
    // and path_helper run; Linux terminal emulators do not.
    if (options.platform === "darwin") args.push("-l");
    // Without a PTY the shell cannot detect a terminal, so force the
    // interactive mode that makes it print prompts and read its rc file.
    if (!options.pty) args.push("-i");
  }
  return { file, args, name };
}

export interface ShellEnvOptions {
  pty: boolean;
  appVersion: string;
}

const LIST_VARIABLES = ["PATH", "LD_LIBRARY_PATH", "XDG_DATA_DIRS", "XDG_CONFIG_DIRS", "GSETTINGS_SCHEMA_DIR", "PERLLIB", "QT_PLUGIN_PATH", "PYTHONPATH"];

/**
 * Build the environment for the user's shell from the app's environment,
 * removing what Electron and the AppImage runtime injected so the shell
 * looks exactly like one started by a normal terminal emulator.
 */
export function buildShellEnv(base: NodeJS.ProcessEnv, options: ShellEnvOptions): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) {
    if (typeof value === "string") env[key] = value;
  }

  // Electron / Chromium internals.
  for (const key of Object.keys(env)) {
    if (key.startsWith("ELECTRON_") || key === "CHROME_DESKTOP" || key === "GOOGLE_API_KEY") delete env[key];
  }
  if (env.ORIGINAL_XDG_CURRENT_DESKTOP !== undefined) {
    env.XDG_CURRENT_DESKTOP = env.ORIGINAL_XDG_CURRENT_DESKTOP;
    delete env.ORIGINAL_XDG_CURRENT_DESKTOP;
  }

  // AppImage runtime: strip entries that point inside the mounted image.
  const appDir = env.APPDIR;
  if (appDir) {
    for (const key of LIST_VARIABLES) {
      if (env[key] === undefined) continue;
      const kept = env[key].split(":").filter(entry => entry && !entry.startsWith(appDir));
      if (kept.length) env[key] = kept.join(":");
      else delete env[key];
    }
  }
  for (const key of ["APPDIR", "APPIMAGE", "ARGV0", "OWD", "PWD", "OLDPWD"]) delete env[key];

  if (!env.LANG && !env.LC_ALL && !env.LC_CTYPE) env.LANG = "C.UTF-8";

  env.TERM_PROGRAM = "ai-terminal";
  env.TERM_PROGRAM_VERSION = options.appVersion;
  if (options.pty) {
    env.TERM = "xterm-256color";
    env.COLORTERM = "truecolor";
  } else {
    // No PTY: full-screen programs and pagers cannot work, so make tools
    // fall back to plain streaming output.
    env.TERM = "dumb";
    delete env.COLORTERM;
    env.PAGER = "cat";
    env.GIT_PAGER = "cat";
    env.SYSTEMD_PAGER = "";
  }
  return env;
}
