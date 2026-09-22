// ============================================================
// NATIVE SHELL IPC
//
// One isolated shell process per renderer. The renderer receives
// output only; it never gets Node access. node-pty is used when its
// native module is available, with a pipe fallback for development.
// ============================================================
import { ipcMain, IpcMainInvokeEvent, WebContents, app } from "electron";
import { spawn, ChildProcessWithoutNullStreams } from "node:child_process";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import type { IPty } from "node-pty";
import { IPC } from "./channels";

interface ShellHandle {
  write(input: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: NodeJS.Signals): void;
  onData(callback: (data: string) => void): void;
  onExit(callback: (code: number | null, signal: string | null) => void): void;
  pty: boolean;
}

interface ShellSession {
  id: string;
  owner: WebContents;
  shell: ShellHandle;
}

const sessions = new Map<string, ShellSession>();
const ownerSessions = new Map<number, Set<string>>();
const MAX_WRITE_BYTES = 256 * 1024;

// node-pty has native bindings. Loading it lazily lets `npm run dev` keep
// working on machines where optional native dependencies are unavailable.
let ptyModule: typeof import("node-pty") | null = null;
try {
  const nodeRequire = createRequire(__filename);
  ptyModule = nodeRequire("node-pty") as typeof import("node-pty");
} catch {
  ptyModule = null;
}

function send(owner: WebContents, channel: string, payload: unknown): void {
  if (!owner.isDestroyed()) owner.send(channel, payload);
}

function removeSession(session: ShellSession): void {
  sessions.delete(session.id);
  const owned = ownerSessions.get(session.owner.id);
  owned?.delete(session.id);
  if (owned && owned.size === 0) ownerSessions.delete(session.owner.id);
}

function killOwnedSessions(owner: WebContents): void {
  const ids = [...(ownerSessions.get(owner.id) ?? [])];
  for (const id of ids) {
    const session = sessions.get(id);
    if (session) {
      session.shell.kill("SIGTERM");
      removeSession(session);
    }
  }
}

function shellCommand(): { file: string; args: string[] } {
  if (process.platform === "win32") {
    return { file: process.env.ComSpec || "cmd.exe", args: [] };
  }
  // No profile scripts: a broken .bashrc must not prevent the terminal
  // from opening. Interactive mode keeps readline/history available.
  return { file: process.env.SHELL || "/bin/bash", args: ["--noprofile", "--norc", "-i"] };
}

function makePipeShell(file: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): ShellHandle {
  const child: ChildProcessWithoutNullStreams = spawn(file, args, {
    cwd,
    env,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  return {
    write: input => child.stdin.write(input),
    resize: () => undefined,
    kill: signal => child.kill(signal),
    onData: callback => {
      child.stdout.on("data", data => callback(String(data)));
      child.stderr.on("data", data => callback(String(data)));
    },
    onExit: callback => {
      child.on("error", error => callback(1, error.message));
      child.on("close", (code, signal) => callback(code, signal));
    },
    pty: false,
  };
}

function makePtyShell(file: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): ShellHandle | null {
  if (!ptyModule) return null;
  try {
    const process: IPty = ptyModule.spawn(file, args, {
      name: "xterm-256color",
      cols: 120,
      rows: 36,
      cwd,
      env: Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    });
    return {
      write: input => process.write(input),
      resize: (cols, rows) => process.resize(cols, rows),
      kill: signal => process.kill(signal),
      onData: callback => { process.onData(callback); },
      onExit: callback => { process.onExit(event => callback(event.exitCode, event.signal ? String(event.signal) : null)); },
      pty: true,
    };
  } catch {
    return null;
  }
}

export function registerTerminalHandlers(): void {
  ipcMain.handle(IPC.TERMINAL_START, (event: IpcMainInvokeEvent) => {
    const owner = event.sender;
    killOwnedSessions(owner);

    const command = shellCommand();
    const home = app.getPath("home");
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      TERM: process.platform === "win32" ? "dumb" : "xterm-256color",
      COLORTERM: "truecolor",
      // Keep the shell prompt quiet: the renderer owns the prompt line.
      PS1: "",
      PROMPT_COMMAND: "",
      PWD: home,
    };

    let shell: ShellHandle;
    try {
      shell = makePtyShell(command.file, command.args, home, env) ?? makePipeShell(command.file, command.args, home, env);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }

    const session: ShellSession = { id: randomUUID(), owner, shell };
    sessions.set(session.id, session);
    const owned = ownerSessions.get(owner.id) ?? new Set<string>();
    owned.add(session.id);
    ownerSessions.set(owner.id, owned);

    shell.onData(data => send(owner, IPC.TERMINAL_DATA, { id: session.id, data }));
    shell.onExit((code, signal) => {
      send(owner, IPC.TERMINAL_EXIT, { id: session.id, code, signal });
      removeSession(session);
    });

    return { ok: true, id: session.id, cwd: home, shell: command.file, pty: shell.pty };
  });

  ipcMain.handle(IPC.TERMINAL_WRITE, (event: IpcMainInvokeEvent, id: unknown, input: unknown) => {
    const session = sessions.get(String(id));
    if (!session || session.owner !== event.sender) return { ok: false, error: "Unknown terminal session" };
    const value = String(input ?? "");
    if (Buffer.byteLength(value, "utf8") > MAX_WRITE_BYTES) return { ok: false, error: "Input is too large" };
    session.shell.write(value);
    return { ok: true };
  });

  ipcMain.handle(IPC.TERMINAL_RESIZE, (event: IpcMainInvokeEvent, id: unknown, cols: unknown, rows: unknown) => {
    const session = sessions.get(String(id));
    if (!session || session.owner !== event.sender) return { ok: false, error: "Unknown terminal session" };
    const width = Number(cols);
    const height = Number(rows);
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 20 || height < 4 || width > 500 || height > 300) {
      return { ok: false, error: "Invalid terminal dimensions" };
    }
    session.shell.resize(width, height);
    return { ok: true };
  });

  ipcMain.handle(IPC.TERMINAL_KILL, (event: IpcMainInvokeEvent, id: unknown) => {
    const session = sessions.get(String(id));
    if (!session || session.owner !== event.sender) return { ok: false, error: "Unknown terminal session" };
    session.shell.kill("SIGTERM");
    removeSession(session);
    return { ok: true };
  });

  // Renderer destruction is the hard boundary for a shell process. Do not
  // leave orphaned user shells behind after a reload or window close.
  app.on("web-contents-created", (_event, contents) => {
    contents.once("destroyed", () => killOwnedSessions(contents));
  });
}
