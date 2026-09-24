// ============================================================
// BROWSER PREVIEW SHELL
// A web page cannot (and must not) run commands on the visitor's
// machine. The preview answers a handful of harmless commands so the
// UI can be explored, and says plainly that everything else needs the
// desktop app.
// ============================================================

export const PREVIEW_PROMPT = "\u001b[32muser@preview\u001b[0m:\u001b[34m~\u001b[0m$ ";

export const PREVIEW_BANNER = [
  "\u001b[1mAI TERMINAL\u001b[0m // browser preview",
  "────────────────────────────────────────────────────────",
  "Native shell:  unavailable in a web page",
  "Desktop app:   launch the Linux build for a real PTY",
  "",
  "Try: pwd · ls · uname · date · help",
  "",
].join("\r\n");

export interface PreviewResult {
  output: string;
  clear?: boolean;
}

export function runPreviewCommand(command: string): PreviewResult {
  const normalized = command.trim().replace(/\s+/g, " ");
  switch (normalized.toLowerCase()) {
    case "":
      return { output: "" };
    case "clear":
      return { output: "", clear: true };
    case "pwd":
      return { output: "/home/user\n" };
    case "whoami":
      return { output: "user\n" };
    case "uname":
      return { output: "Linux\n" };
    case "uname -a":
      return { output: "Linux preview 6.1.0 x86_64 GNU/Linux\n" };
    case "date":
      return { output: `${new Date().toString()}\n` };
    case "help":
      return { output: "Browser preview commands: pwd, whoami, uname, date, ls, clear, help\nOpen the desktop app for a real Linux shell.\n" };
    case "ls":
      return { output: "Documents  Downloads  projects\n" };
    case "ls -la":
    case "ls -lah":
    case "ls -l":
      return { output: "total 12K\ndrwxr-xr-x 1 user user 4.0K Documents\ndrwxr-xr-x 1 user user 4.0K Downloads\ndrwxr-xr-x 1 user user 4.0K projects\n" };
    default:
      return { output: `preview: command execution is disabled for “${normalized}”\n         launch the desktop app for a native shell\n` };
  }
}
