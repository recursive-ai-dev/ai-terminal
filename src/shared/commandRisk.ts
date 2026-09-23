// ============================================================
// COMMAND RISK CLASSIFIER — shared by renderer and main process
//
// Every command the copilot proposes (local rules or a model) is
// classified here before it is shown. The classifier is deliberately
// conservative: anything it does not positively recognise as read-only
// is "review", and anything that can destroy data, escalate privilege,
// or run remote code is "dangerous".
//
// This module must stay free of DOM and Node APIs so both the Electron
// main process and the renderer can import it.
// ============================================================

export type CommandRisk = "safe" | "review" | "dangerous";

export interface RiskAssessment {
  risk: CommandRisk;
  reasons: string[];
}

export type CommandValidation =
  | { ok: true; command: string }
  | { ok: false; error: string };

export const MAX_COMMAND_LENGTH = 2000;

const RISK_ORDER: Record<CommandRisk, number> = { safe: 0, review: 1, dangerous: 2 };

export function maxRisk(a: CommandRisk, b: CommandRisk): CommandRisk {
  return RISK_ORDER[a] >= RISK_ORDER[b] ? a : b;
}

export function isCommandRisk(value: unknown): value is CommandRisk {
  return value === "safe" || value === "review" || value === "dangerous";
}

/**
 * A proposed command must be a single line of printable text. Newlines
 * would let one "reviewed" command smuggle further commands into the
 * shell, and control characters can rewrite what the user sees.
 */
export function validateCommandText(raw: unknown): CommandValidation {
  if (typeof raw !== "string") return { ok: false, error: "Command must be text" };
  const command = raw.replace(/\t/g, " ").trim();
  if (!command) return { ok: false, error: "Command is empty" };
  if (command.length > MAX_COMMAND_LENGTH) return { ok: false, error: `Command exceeds ${MAX_COMMAND_LENGTH} characters` };
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(command)) {
    return { ok: false, error: "Command contains newlines or control characters" };
  }
  return { ok: true, command };
}

// Programs that only read state when used without write flags.
const READ_ONLY_PROGRAMS = new Set([
  "ls", "pwd", "cat", "head", "tail", "grep", "egrep", "fgrep", "rg", "ag", "wc", "sort", "uniq",
  "cut", "tr", "column", "nl", "df", "du", "free", "uptime", "ps", "pgrep", "whoami", "id", "groups",
  "uname", "date", "cal", "echo", "printf", "which", "type", "whereis", "file", "stat", "printenv",
  "hostname", "hostnamectl", "ss", "netstat", "lsblk", "lscpu", "lsusb", "lspci", "lsof", "tree",
  "history", "basename", "dirname", "realpath", "readlink", "md5sum", "sha1sum", "sha256sum",
  "sha512sum", "diff", "cmp", "less", "more", "true", "false", "test", "[", "env", "locale",
  "w", "who", "last", "journalctl", "dmesg", "vmstat", "iostat", "nproc", "arch", "man", "jq",
  "xxd", "hexdump", "od", "strings", "tac", "rev", "seq", "sleep", "awk", "sed", "find", "git", "ip",
  "systemctl", "top", "htop",
]);

// Programs that destroy data, change the system, or escalate privilege.
const DANGEROUS_PROGRAMS = new Set([
  "rm", "rmdir", "shred", "dd", "fdisk", "sfdisk", "cfdisk", "gdisk", "sgdisk", "parted", "wipefs",
  "shutdown", "reboot", "poweroff", "halt", "init", "telinit", "sudo", "doas", "su", "pkexec",
  "truncate", "mkswap", "swapoff", "cryptsetup", "lvremove", "vgremove", "pvremove", "zpool", "chattr",
  "userdel", "groupdel", "passwd", "chpasswd", "visudo", "iptables", "nft", "ufw", "insmod", "rmmod",
  "modprobe", "kexec",
]);

// Programs that are normal to run but change state — the user reviews them.
const MUTATING_PROGRAMS = new Set([
  "mv", "cp", "ln", "mkdir", "touch", "chmod", "chown", "chgrp", "kill", "pkill", "killall", "tee",
  "apt", "apt-get", "dnf", "yum", "pacman", "zypper", "snap", "flatpak", "pip", "pip3", "npm", "pnpm",
  "yarn", "cargo", "gem", "brew", "make", "docker", "podman", "kubectl", "crontab", "useradd",
  "usermod", "groupadd", "mount", "umount", "tar", "unzip", "zip", "gzip", "gunzip", "xz", "rsync",
  "scp", "ssh", "curl", "wget", "eval", "source", ".", "sh", "bash", "zsh", "fish", "dash",
  "python", "python3", "node", "perl", "ruby", "at", "vi", "vim", "nvim",
  "nano", "emacs",
]);

// Wrappers that run the next word as the real program.
const PASSTHROUGH_WRAPPERS = new Set(["command", "builtin", "time", "nice", "ionice", "stdbuf", "timeout", "env", "nohup", "setsid", "exec", "watch"]);

const SHELLS = "(?:ba|z|da|k|fi|c|tc)?sh";

interface Rule {
  pattern: RegExp;
  risk: CommandRisk;
  reason: string;
}

// Whole-command patterns. These catch constructs that a per-segment
// program lookup cannot see (pipes into shells, redirects, fork bombs).
const COMMAND_RULES: Rule[] = [
  { pattern: new RegExp(`\\b(?:curl|wget|fetch)\\b[^|]*\\|\\s*(?:sudo\\s+)?(?:${SHELLS}|python3?|perl|ruby|node)\\b`), risk: "dangerous", reason: "Pipes downloaded content into an interpreter" },
  { pattern: /:\s*\(\s*\)\s*\{[^}]*:\s*\|\s*:/, risk: "dangerous", reason: "Fork bomb" },
  { pattern: />\s*\/dev\/(?:sd|hd|nvme|vd|xvd|mmcblk|disk)/, risk: "dangerous", reason: "Writes directly to a block device" },
  { pattern: /(?:^|[^<>&0-9])>{1,2}\s*(?!\/dev\/null\b|&)[^\s|;&]+/, risk: "review", reason: "Redirects output into a file" },
  { pattern: /\bmkfs(?:\.\w+)?\b/, risk: "dangerous", reason: "Formats a filesystem" },
  { pattern: /\$\(|`/, risk: "review", reason: "Uses command substitution" },
];

/** Split a command line into simple-command segments on shell operators. */
function splitSegments(command: string): string[] {
  return command
    // `&` is a separator only when it is not part of a redirection
    // such as 2>&1, &>file or <&3.
    .split(/\|\||&&|[;|\n]|(?<![<>])&(?![>&])|\$\(|[`()]/)
    .map(segment => segment.trim())
    .filter(Boolean);
}

/** Tokenize a segment into words, honouring simple single/double quoting. */
function words(segment: string): string[] {
  const out: string[] = [];
  const re = /'([^']*)'|"((?:[^"\\]|\\.)*)"|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(segment)) !== null) {
    out.push(match[1] ?? match[2] ?? match[3] ?? "");
  }
  return out;
}

function programOf(tokens: string[]): { program: string; args: string[] } | null {
  let index = 0;
  // Skip leading VAR=value assignments.
  while (index < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index])) index++;
  // Skip wrappers (and the wrapper's own leading flags/durations).
  while (index < tokens.length && PASSTHROUGH_WRAPPERS.has(basename(tokens[index]))) {
    index++;
    while (index < tokens.length && (tokens[index].startsWith("-") || /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index]) || /^\d+[smhd]?$/.test(tokens[index]))) index++;
  }
  if (index >= tokens.length) return null;
  return { program: basename(tokens[index]), args: tokens.slice(index + 1) };
}

function basename(word: string): string {
  const slash = word.lastIndexOf("/");
  return slash >= 0 ? word.slice(slash + 1) : word;
}

function hasFlag(args: string[], ...flags: string[]): boolean {
  return args.some(arg => flags.includes(arg) || (arg.startsWith("-") && !arg.startsWith("--") && flags.some(flag => flag.length === 2 && flag.startsWith("-") && arg.slice(1).includes(flag[1]))));
}

function touchesRoot(args: string[]): boolean {
  return args.some(arg => arg === "/" || arg === "/*" || arg === "~" || arg === "~/" || arg === "$HOME" || /^\/(?:bin|boot|dev|etc|lib|lib64|proc|sbin|sys|usr|var)(?:\/|$)/.test(arg));
}

function assessSegment(segment: string): RiskAssessment {
  const parsed = programOf(words(segment));
  if (!parsed) return { risk: "safe", reasons: [] };
  const { program, args } = parsed;

  if (DANGEROUS_PROGRAMS.has(program)) {
    return { risk: "dangerous", reasons: [`\`${program}\` can destroy data or change the system`] };
  }

  switch (program) {
    case "find":
      if (args.includes("-delete") || args.some(arg => /^-(?:exec|execdir|ok|okdir)$/.test(arg))) {
        return { risk: "dangerous", reasons: ["`find` with -delete/-exec modifies files"] };
      }
      return { risk: "safe", reasons: [] };
    case "sed":
      return hasFlag(args, "-i") || args.some(arg => arg.startsWith("--in-place"))
        ? { risk: "review", reasons: ["`sed -i` edits files in place"] }
        : { risk: "safe", reasons: [] };
    case "awk":
      return args.some(arg => /system\s*\(|>\s*"/.test(arg))
        ? { risk: "review", reasons: ["`awk` program writes files or runs commands"] }
        : { risk: "safe", reasons: [] };
    case "chmod":
    case "chown":
    case "chgrp":
      if (hasFlag(args, "-R") || args.includes("--recursive") || touchesRoot(args)) {
        return { risk: "dangerous", reasons: [`Recursive or system-wide \`${program}\``] };
      }
      return { risk: "review", reasons: [`\`${program}\` changes permissions`] };
    case "kill":
      if (args.includes("-1") || args.includes("1")) return { risk: "dangerous", reasons: ["Signals every process or init"] };
      return { risk: "review", reasons: ["Terminates a process"] };
    case "crontab":
      return hasFlag(args, "-r") ? { risk: "dangerous", reasons: ["`crontab -r` deletes all scheduled jobs"] } : { risk: "review", reasons: ["Edits scheduled jobs"] };
    case "git": {
      const sub = args.find(arg => !arg.startsWith("-")) ?? "";
      const rest = args.join(" ");
      if (/\breset\b.*--hard|\bclean\b.*-\w*f|\bpush\b.*(?:--force|\s-f\b|--mirror|--delete)|\bbranch\b.*-D\b|\bcheckout\b.*\s--\s|\brestore\b|\bfilter-branch\b|\breflog\b.*\bexpire\b|\bgc\b.*--prune/.test(` ${rest}`)) {
        return { risk: "dangerous", reasons: ["Git operation can discard work"] };
      }
      const readOnly = ["status", "log", "diff", "show", "blame", "shortlog", "describe", "rev-parse", "ls-files", "grep", "remote", "branch", "tag", "config", "stash"];
      if (sub === "stash") return args.includes("list") || args.includes("show") ? { risk: "safe", reasons: [] } : { risk: "review", reasons: ["Changes the stash"] };
      if (sub === "config" && !args.includes("--get") && !args.includes("--list") && !args.includes("-l")) return { risk: "review", reasons: ["Writes git configuration"] };
      if ((sub === "branch" || sub === "tag") && args.length > 1 && !args.some(arg => /^(?:-a|-r|-v|-vv|--list|-l)$/.test(arg))) return { risk: "review", reasons: [`Creates or edits a ${sub}`] };
      if (readOnly.includes(sub)) return { risk: "safe", reasons: [] };
      return { risk: "review", reasons: [sub ? `\`git ${sub}\` changes the repository` : "`git` without a subcommand"] };
    }
    case "ip":
      return args.some(arg => /^(?:add|del|delete|set|flush|change|replace|append)$/.test(arg))
        ? { risk: "dangerous", reasons: ["Changes network configuration"] }
        : { risk: "safe", reasons: [] };
    case "systemctl": {
      const sub = args.find(arg => !arg.startsWith("-")) ?? "";
      if (/^(?:poweroff|reboot|halt|suspend|hibernate|kexec|emergency|rescue|isolate|mask)$/.test(sub)) return { risk: "dangerous", reasons: [`\`systemctl ${sub}\` affects the whole system`] };
      if (/^(?:status|list-units|list-unit-files|list-timers|is-active|is-enabled|is-failed|show|cat)$/.test(sub) || !sub) return { risk: "safe", reasons: [] };
      return { risk: "review", reasons: [`\`systemctl ${sub}\` changes services`] };
    }
    case "xargs":
      if (args.some(arg => DANGEROUS_PROGRAMS.has(basename(arg)))) {
        return { risk: "dangerous", reasons: ["`xargs` feeds input into a destructive command"] };
      }
      return { risk: "review", reasons: ["`xargs` runs a command for each input line"] };
    default:
      break;
  }

  if (MUTATING_PROGRAMS.has(program)) {
    return { risk: "review", reasons: [`\`${program}\` changes files, processes, or packages`] };
  }
  if (READ_ONLY_PROGRAMS.has(program)) {
    return { risk: "safe", reasons: [] };
  }
  return { risk: "review", reasons: [`\`${program}\` is not a known read-only command`] };
}

/** Classify a full command line. The result is the most severe segment. */
export function assessCommand(command: string): RiskAssessment {
  const text = command.trim();
  if (!text) return { risk: "safe", reasons: [] };

  let risk: CommandRisk = "safe";
  const reasons: string[] = [];
  const addReason = (reason: string) => { if (!reasons.includes(reason)) reasons.push(reason); };

  for (const rule of COMMAND_RULES) {
    if (rule.pattern.test(text)) {
      risk = maxRisk(risk, rule.risk);
      addReason(rule.reason);
    }
  }
  for (const segment of splitSegments(text)) {
    const result = assessSegment(segment);
    risk = maxRisk(risk, result.risk);
    result.reasons.forEach(addReason);
  }
  return { risk, reasons };
}
