// ============================================================
// NATIVE SHELL IPC
//
// One shell process per renderer. The renderer receives output only;
// it never gets Node access. node-pty provides a real pseudo-terminal
// when its native module is built for this Electron version; otherwise
// a pipe-backed shell keeps ordinary line-oriented commands working.
//
// Output is batched (fewer IPC messages under load) and flow-controlled:
// the renderer acknowledges what it has rendered, and the shell is
// paused while too much output is unacknowledged. This keeps `yes` or
// `cat /dev/urandom | base64` from exhausting renderer memory.
// ============================================================
import { app, WebContents } from "electron";
import { spawn, ChildProcessWithoutNullStreams } from "node:child_process";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { accessSync, constants as fsConstants } from "node:fs";
import * as os from "node:os";
import type { IPty } from "node-pty";
import { IPC } from "./channels";
import { handle } from "../lib/ipcGuard";
import { createLogger } from "../lib/logger";
import { buildShellEnv, resolveShell } from "../lib/shellLaunch";

const log = createLogger("terminal");

const MAX_WRITE_BYTES = 256 * 1024;
const FLUSH_INTERVAL_MS = 8;
const MAX_BATCH_CHARS = 64 * 1024;
const HIGH_WATERMARK = 512 * 1024;
const LOW_WATERMARK = 128 * 1024;
const KILL_GRACE_MS = 2000;
const INITIAL_COLS = 120;
const INITIAL_ROWS = 36;

interface ShellHandle {
  readonly pid: number;
  readonly pty: boolean;
  write(input: string): void;
  resize(cols: number, rows: number): void;
  /** Deliver a signal to the shell (pipe mode: to its whole process group). */
  signal(signal: NodeJS.Signals): void;
  pause(): void;
  resume(): void;
  onData(callback: (data: string) => void): void;
  onExit(callback: (code: number | null, signal: string | null) => void): void;
}

interface ShellSession {
  id: string;
  owner: WebContents;
  shell: ShellHandle;
  pending: string;
  flushTimer: NodeJS.Timeout | null;
  unacked: number;
  paused: boolean;
  exited: boolean;
  killTimer: NodeJS.Timeout | null;
}

const sessions = new Map<string, ShellSession>();

// node-pty has native bindings that must match Electron's ABI. Loading it
// lazily lets the app fall back to pipes when the module is missing or was
// built for a different runtime; the reason is surfaced to the renderer.
// AI_TERMINAL_DISABLE_PTY=1 forces the pipe fallback (troubleshooting).
let ptyModule: typeof import("node-pty") | null = null;
let ptyUnavailableReason: string | null = null;
if (process.env.AI_TERMINAL_DISABLE_PTY === "1") {
  ptyUnavailableReason = "disabled by AI_TERMINAL_DISABLE_PTY";
} else {
  try {
    const nodeRequire = createRequire(__filename);
    ptyModule = nodeRequire("node-pty") as typeof import("node-pty");
  } catch (error) {
    ptyModule = null;
    ptyUnavailableReason = error instanceof Error ? error.message.split("\n")[0] : String(error);
  }
}

function signalName(signal: number | undefined): string | null {
  if (!signal) return null;
  const entry = Object.entries(os.constants.signals).find(([, value]) => value === signal);
  return entry ? entry[0] : String(signal);
}

function isExecutable(file: string): boolean {
  try {
    accessSync(file, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function makePipeShell(file: string, args: string[], cwd: string, env: Record<string, string>): ShellHandle {
  const detached = process.platform !== "win32";
  // POSIX: start the shell through `sh -c 'exec "$0" "$@" 2>&1'` so its
  // stderr shares the stdout pipe. With two pipes, prompts (stderr) and
  // command output (stdout) would arrive out of order.
  const [command, commandArgs] = detached && isExecutable("/bin/sh")
    ? ["/bin/sh", ["-c", 'exec "$0" "$@" 2>&1', file, ...args]] as const
    : [file, args] as const;
  const child: ChildProcessWithoutNullStreams = spawn(command, [...commandArgs], {
    cwd,
    env,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    // Own process group, so Ctrl+C can interrupt the running command.
    detached,
  });
  // StringDecoder-backed: multi-byte characters split across chunks survive.
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  // Writing after the shell exits raises EPIPE; that is not a crash.
  child.stdin.on("error", error => log.debug("pipe stdin error", error.message));

  const signalGroup = (signal: NodeJS.Signals) => {
    if (child.pid === undefined || child.exitCode !== null) return;
    try {
      if (detached) process.kill(-child.pid, signal);
      else child.kill(signal);
    } catch (error) {
      log.debug(`signal ${signal} failed`, (error as Error).message);
    }
  };

  return {
    pid: child.pid ?? -1,
    pty: false,
    write: input => { if (child.stdin.writable) child.stdin.write(input); },
    resize: () => undefined,
    signal: signalGroup,
    pause: () => { child.stdout.pause(); child.stderr.pause(); },
    resume: () => { child.stdout.resume(); child.stderr.resume(); },
    onData: callback => {
      child.stdout.on("data", (data: string) => callback(data));
      child.stderr.on("data", (data: string) => callback(data));
    },
    onExit: callback => {
      child.on("error", error => callback(null, error.message));
      child.on("close", (code, signal) => callback(code, signal));
    },
  };
}

function makePtyShell(file: string, args: string[], cwd: string, env: Record<string, string>): ShellHandle | null {
  if (!ptyModule) return null;
  let term: IPty;
  try {
    term = ptyModule.spawn(file, args, { name: "xterm-256color", cols: INITIAL_COLS, rows: INITIAL_ROWS, cwd, env });
  } catch (error) {
    ptyUnavailableReason = error instanceof Error ? error.message : String(error);
    log.warn("node-pty spawn failed, using pipe shell", ptyUnavailableReason);
    return null;
  }
  return {
    pid: term.pid,
    pty: true,
    write: input => term.write(input),
    resize: (cols, rows) => term.resize(cols, rows),
    signal: signal => {
      try {
        term.kill(process.platform === "win32" ? undefined : signal);
      } catch (error) {
        log.debug(`signal ${signal} failed`, (error as Error).message);
      }
    },
    pause: () => term.pause(),
    resume: () => term.resume(),
    onData: callback => { term.onData(callback); },
    onExit: callback => { term.onExit(event => callback(event.exitCode, signalName(event.signal))); },
  };
}

function flush(session: ShellSession): void {
  if (session.flushTimer) {
    clearTimeout(session.flushTimer);
    session.flushTimer = null;
  }
  if (!session.pending) return;
  const data = session.pending;
  session.pending = "";
  if (session.owner.isDestroyed()) return;
  session.owner.send(IPC.TERMINAL_DATA, { id: session.id, data });
  session.unacked += data.length;
  if (!session.paused && !session.exited && session.unacked > HIGH_WATERMARK) {
    session.paused = true;
    session.shell.pause();
  }
}

function queueOutput(session: ShellSession, data: string): void {
  session.pending += data;
  if (session.pending.length >= MAX_BATCH_CHARS) flush(session);
  else if (!session.flushTimer) session.flushTimer = setTimeout(() => flush(session), FLUSH_INTERVAL_MS);
}

/** Hang up the shell like a closing terminal would, then force-kill it. */
function terminate(session: ShellSession): void {
  sessions.delete(session.id);
  if (session.flushTimer) clearTimeout(session.flushTimer);
  session.flushTimer = null;
  if (session.exited) return;
  if (session.paused) session.shell.resume();
  // Interactive shells ignore SIGTERM; SIGHUP is what a terminal sends.
  session.shell.signal(process.platform === "win32" ? "SIGTERM" : "SIGHUP");
  session.killTimer = setTimeout(() => {
    if (!session.exited) {
      log.warn(`shell ${session.shell.pid} ignored SIGHUP; sending SIGKILL`);
      session.shell.signal("SIGKILL");
    }
  }, KILL_GRACE_MS);
  session.killTimer.unref();
}

function terminateOwnedBy(owner: WebContents): void {
  for (const session of [...sessions.values()]) {
    if (session.owner === owner) terminate(session);
  }
}

export function terminateAllShells(): void {
  for (const session of [...sessions.values()]) terminate(session);
}

function ownedSession(owner: WebContents, id: unknown): ShellSession | null {
  if (typeof id !== "string") return null;
  const session = sessions.get(id);
  return session && session.owner === owner && !session.exited ? session : null;
}

const trackedOwners = new WeakSet<WebContents>();

export function registerTerminalHandlers(): void {
  handle(IPC.TERMINAL_START, event => {
    const owner = event.sender;
    // One shell per renderer: a reload or remount replaces the old one.
    terminateOwnedBy(owner);
    if (!trackedOwners.has(owner)) {
      trackedOwners.add(owner);
      // Renderer destruction is the hard boundary for a shell process.
      owner.once("destroyed", () => terminateOwnedBy(owner));
    }

    const home = app.getPath("home");
    const usePty = ptyModule !== null;
    let launch = resolveShell({
      platform: process.platform,
      envShell: process.env.SHELL,
      userShell: safeUserShell(),
      comSpec: process.env.ComSpec,
      pty: usePty,
      isExecutable,
    });

    let shell = usePty ? makePtyShell(launch.file, launch.args, home, buildShellEnv(process.env, { pty: true, appVersion: app.getVersion() })) : null;
    if (!shell) {
      // Re-resolve for pipe mode: the arguments differ without a PTY.
      launch = resolveShell({ platform: process.platform, envShell: process.env.SHELL, userShell: safeUserShell(), comSpec: process.env.ComSpec, pty: false, isExecutable });
      shell = makePipeShell(launch.file, launch.args, home, buildShellEnv(process.env, { pty: false, appVersion: app.getVersion() }));
    }

    const session: ShellSession = {
      id: randomUUID(),
      owner,
      shell,
      pending: "",
      flushTimer: null,
      unacked: 0,
      paused: false,
      exited: false,
      killTimer: null,
    };
    sessions.set(session.id, session);

    shell.onData(data => queueOutput(session, data));
    shell.onExit((code, signal) => {
      if (session.exited) return;
      session.exited = true;
      if (session.killTimer) clearTimeout(session.killTimer);
      flush(session);
      sessions.delete(session.id);
      log.info(`shell ${shell.pid} exited`, { code, signal });
      if (!owner.isDestroyed()) owner.send(IPC.TERMINAL_EXIT, { id: session.id, code, signal });
    });

    log.info(`started ${launch.file} ${launch.args.join(" ")}`.trim(), { pid: shell.pid, pty: shell.pty });
    return {
      ok: true,
      id: session.id,
      cwd: home,
      shell: launch.file,
      pty: shell.pty,
      ptyUnavailableReason: shell.pty ? undefined : ptyUnavailableReason ?? "node-pty is not installed",
    };
  });

  handle(IPC.TERMINAL_WRITE, (event, id: unknown, input: unknown) => {
    const session = ownedSession(event.sender, id);
    if (!session) return { ok: false, error: "Unknown terminal session" };
    if (typeof input !== "string") return { ok: false, error: "Input must be text" };
    if (Buffer.byteLength(input, "utf8") > MAX_WRITE_BYTES) return { ok: false, error: "Input is too large" };
    session.shell.write(input);
    return { ok: true };
  });

  handle(IPC.TERMINAL_RESIZE, (event, id: unknown, cols: unknown, rows: unknown) => {
    const session = ownedSession(event.sender, id);
    if (!session) return { ok: false, error: "Unknown terminal session" };
    const width = Number(cols);
    const height = Number(rows);
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 1 || width > 1000 || height > 500) {
      return { ok: false, error: "Invalid terminal dimensions" };
    }
    session.shell.resize(width, height);
    return { ok: true };
  });

  // Pipe mode has no line discipline, so Ctrl+C is delivered as a signal.
  handle(IPC.TERMINAL_INTERRUPT, (event, id: unknown) => {
    const session = ownedSession(event.sender, id);
    if (!session) return { ok: false, error: "Unknown terminal session" };
    if (session.shell.pty) session.shell.write("\u0003");
    else session.shell.signal("SIGINT");
    return { ok: true };
  });

  handle(IPC.TERMINAL_ACK, (event, id: unknown, chars: unknown) => {
    const session = ownedSession(event.sender, id);
    const count = Number(chars);
    if (!session || !Number.isFinite(count) || count <= 0) return { ok: false };
    session.unacked = Math.max(0, session.unacked - count);
    if (session.paused && session.unacked < LOW_WATERMARK) {
      session.paused = false;
      session.shell.resume();
    }
    return { ok: true };
  });

  handle(IPC.TERMINAL_KILL, (event, id: unknown) => {
    const session = ownedSession(event.sender, id);
    if (!session) return { ok: false, error: "Unknown terminal session" };
    terminate(session);
    return { ok: true };
  });
}

function safeUserShell(): string | null {
  try {
    return os.userInfo().shell;
  } catch {
    return null;
  }
}
