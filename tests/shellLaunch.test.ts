import { describe, expect, it } from "vitest";
import { buildShellEnv, resolveShell } from "../electron/lib/shellLaunch";

const all = () => true;

describe("resolveShell", () => {
  it("uses $SHELL with no arguments under a PTY on Linux", () => {
    expect(resolveShell({ platform: "linux", envShell: "/usr/bin/zsh", pty: true, isExecutable: all }))
      .toEqual({ file: "/usr/bin/zsh", args: [], name: "zsh" });
  });

  it("forces interactive mode without a PTY; bash long options come first", () => {
    expect(resolveShell({ platform: "linux", envShell: "/bin/bash", pty: false, isExecutable: all }).args)
      .toEqual(["--noediting", "-i"]);
    expect(resolveShell({ platform: "linux", envShell: "/usr/bin/fish", pty: false, isExecutable: all }).args)
      .toEqual(["-i"]);
  });

  it("starts login shells on macOS", () => {
    expect(resolveShell({ platform: "darwin", envShell: "/bin/zsh", pty: true, isExecutable: all }).args).toEqual(["-l"]);
  });

  it("falls back past a missing or relative $SHELL", () => {
    const exists = (file: string) => file === "/bin/bash";
    expect(resolveShell({ platform: "linux", envShell: "/nonexistent/sh", userShell: "zsh", pty: true, isExecutable: exists }).file).toBe("/bin/bash");
  });

  it("passes no flags to unknown shells", () => {
    expect(resolveShell({ platform: "linux", envShell: "/usr/bin/nu", pty: false, isExecutable: all }).args).toEqual([]);
  });

  it("throws when no shell is usable", () => {
    expect(() => resolveShell({ platform: "linux", pty: true, isExecutable: () => false })).toThrow(/No usable shell/);
  });

  it("uses ComSpec on Windows", () => {
    expect(resolveShell({ platform: "win32", comSpec: "C:\\Windows\\system32\\cmd.exe", pty: true, isExecutable: all }).name).toBe("cmd");
  });
});

describe("buildShellEnv", () => {
  it("removes Electron internals and restores the desktop name", () => {
    const env = buildShellEnv({ ELECTRON_RUN_AS_NODE: "1", CHROME_DESKTOP: "x.desktop", ORIGINAL_XDG_CURRENT_DESKTOP: "GNOME", XDG_CURRENT_DESKTOP: "Unity", HOME: "/home/u" }, { pty: true, appVersion: "1.2.3" });
    expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined();
    expect(env.CHROME_DESKTOP).toBeUndefined();
    expect(env.XDG_CURRENT_DESKTOP).toBe("GNOME");
    expect(env.ORIGINAL_XDG_CURRENT_DESKTOP).toBeUndefined();
    expect(env.HOME).toBe("/home/u");
    expect(env.TERM).toBe("xterm-256color");
    expect(env.TERM_PROGRAM_VERSION).toBe("1.2.3");
  });

  it("strips AppImage mount paths from list variables", () => {
    const env = buildShellEnv({
      APPDIR: "/tmp/.mount_ai123",
      APPIMAGE: "/home/u/ai.AppImage",
      PATH: "/tmp/.mount_ai123/usr/bin:/usr/local/bin:/usr/bin",
      LD_LIBRARY_PATH: "/tmp/.mount_ai123/usr/lib",
      PWD: "/",
    }, { pty: true, appVersion: "1" });
    expect(env.PATH).toBe("/usr/local/bin:/usr/bin");
    expect(env.LD_LIBRARY_PATH).toBeUndefined();
    expect(env.APPDIR).toBeUndefined();
    expect(env.APPIMAGE).toBeUndefined();
    expect(env.PWD).toBeUndefined();
  });

  it("defaults to a UTF-8 locale only when none is set", () => {
    expect(buildShellEnv({}, { pty: true, appVersion: "1" }).LANG).toBe("C.UTF-8");
    expect(buildShellEnv({ LC_ALL: "de_DE.UTF-8" }, { pty: true, appVersion: "1" }).LANG).toBeUndefined();
  });

  it("disables pagers and colors without a PTY", () => {
    const env = buildShellEnv({ COLORTERM: "truecolor" }, { pty: false, appVersion: "1" });
    expect(env.TERM).toBe("dumb");
    expect(env.PAGER).toBe("cat");
    expect(env.COLORTERM).toBeUndefined();
  });
});
