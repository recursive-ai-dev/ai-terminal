// ============================================================
// AI COPILOT — safe, local-first command planning
//
// The copilot never executes a command by itself. It turns natural
// language into a reviewable shell plan and leaves execution to the
// user. This keeps the browser build useful and makes the native
// build safe by default, even before a remote model is configured.
// ============================================================

import { assessCommand, maxRisk, validateCommandText, type CommandRisk } from "../shared/commandRisk";

export type PlanRisk = CommandRisk;

export interface AIPlan {
  request: string;
  title: string;
  explanation: string;
  command: string;
  risk: PlanRisk;
  notes: string[];
}

function quote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Quote a path but keep a leading ~ expandable by the shell. */
function quotePath(value: string): string {
  if (value === "~") return "~";
  if (value.startsWith("~/")) return value.length > 2 ? `~/${quote(value.slice(2))}` : "~/";
  return quote(value);
}

function cleanRequest(request: string): string {
  return request.trim().replace(/^\/?(ai|ask)\s+/i, "").replace(/[\u0000-\u001f]/g, "");
}

function pathFromRequest(request: string): string | null {
  const match = request.match(/(?:file|directory|folder|path)\s+([\w./~@-]+)/i);
  return match?.[1] ?? null;
}

/**
 * Produce a deterministic shell plan for common operator tasks.
 * This is intentionally conservative: unknown requests are not
 * converted into executable shell code. The shared classifier can only
 * raise a plan's risk, never lower it.
 */
export function planCommand(rawRequest: string): AIPlan {
  return reviewPlan(templatePlan(rawRequest));
}

/**
 * Re-check any plan (local or model-generated) against the shared
 * classifier and command validation before it is shown to the user.
 */
export function reviewPlan(plan: AIPlan): AIPlan {
  if (!plan.command) return plan;
  const validated = validateCommandText(plan.command);
  if (!validated.ok) {
    return { ...plan, command: "", risk: maxRisk(plan.risk, "review"), notes: [`Command rejected: ${validated.error}.`, ...plan.notes].slice(0, 5) };
  }
  const assessment = assessCommand(validated.command);
  const notes = [...plan.notes];
  for (const reason of assessment.reasons) if (!notes.includes(reason)) notes.push(reason);
  return { ...plan, command: validated.command, risk: maxRisk(plan.risk, assessment.risk), notes: notes.slice(0, 5) };
}

function templatePlan(rawRequest: string): AIPlan {
  const request = cleanRequest(rawRequest);
  const q = request.toLowerCase();
  const base = { request, notes: ["Review the command before executing it."] };

  if (!request) {
    return {
      ...base,
      title: "Tell me what you want to do",
      explanation: "Describe an outcome in plain English, such as “show disk usage” or “find large files”.",
      command: "",
      risk: "safe",
      notes: ["Examples: list files, check git status, find large files, show running processes."],
    };
  }

  if (/^(where am i|what directory|current directory|pwd)/i.test(request)) {
    return { ...base, title: "Show the current directory", explanation: "Print the absolute working directory of the active shell.", command: "pwd", risk: "safe", notes: [] };
  }

  if (/\b(list|show|see)\b.*\b(files|folders|directory|contents)\b|\bls\b|what.s here/.test(q)) {
    return { ...base, title: "List directory contents", explanation: "Show hidden files with readable sizes, permissions, owners, and timestamps.", command: "ls -lah", risk: "safe", notes: [] };
  }

  if (/disk|storage|space|filesystem|how much room/.test(q)) {
    return { ...base, title: "Inspect disk space", explanation: "Report mounted filesystems with human-readable sizes and free space.", command: "df -h", risk: "safe", notes: ["This reads filesystem metadata only."] };
  }

  if (/memory|ram|cpu|system resources|resource usage|load average/.test(q)) {
    return { ...base, title: "Inspect system resources", explanation: "Show memory pressure and the current load average without changing anything.", command: "free -h && uptime", risk: "safe", notes: [] };
  }

  if (/\b(processes|process|running|top cpu|what.s running)\b/.test(q)) {
    return { ...base, title: "Inspect running processes", explanation: "List the busiest processes first so you can see what is using the machine.", command: "ps aux --sort=-%cpu | head -20", risk: "safe", notes: ["The list is limited to 20 rows."] };
  }

  if (/network|ports|listening|connections|ip address|wifi/.test(q)) {
    return { ...base, title: "Inspect network state", explanation: "Show addresses and listening TCP/UDP sockets when the platform provides ss.", command: "ip -brief address && ss -tulpn", risk: "safe", notes: ["Some distributions require permissions to show process names."] };
  }

  if (/git status|working tree|changed files|what changed/.test(q)) {
    return { ...base, title: "Check Git status", explanation: "Show the current branch and a concise list of staged and unstaged changes.", command: "git status --short --branch", risk: "safe", notes: [] };
  }

  if (/git log|recent commits|commit history/.test(q)) {
    return { ...base, title: "Read recent Git history", explanation: "Show the latest ten commits in a compact, readable format.", command: "git log --oneline --decorate -10", risk: "safe", notes: [] };
  }

  if (/large files|big files|largest files|disk hog/.test(q)) {
    return { ...base, title: "Find large files", explanation: "Search the current directory, sort by byte size, and show the 20 largest files.", command: "find . -type f -printf '%s %p\\n' 2>/dev/null | sort -nr | head -20", risk: "review", notes: ["This can take time in large directories.", "It does not delete anything."] };
  }

  if (/search|find.*text|grep|containing/.test(q)) {
    const quoted = request.match(/(?:for|text|word|containing)\s+["']?([^"']+?)["']?(?:\s+(?:in|under)\s+.*)?$/i)?.[1]?.trim();
    const term = quoted || "TODO";
    const location = pathFromRequest(request) || ".";
    return { ...base, title: `Search for ${term}`, explanation: "Recursively search text files and include line numbers while skipping binary matches.", command: `grep -RInI --exclude-dir=.git ${quote(term)} ${quotePath(location)}`, risk: "review", notes: [`Search scope: ${location}`] };
  }

  if (/read|show|print|inspect.*file/.test(q)) {
    const file = pathFromRequest(request) || "README.md";
    return { ...base, title: `Read ${file}`, explanation: "Print the first 160 lines of a file without editing it.", command: `sed -n '1,160p' ${quotePath(file)}`, risk: "safe", notes: ["Change the path if the file is elsewhere."] };
  }

  const install = request.match(/(?:install|add)\s+(?:the\s+)?(?:package\s+)?([a-z0-9][\w+.-]*)/i);
  if (install) {
    const pkg = install[1];
    return { ...base, title: `Install ${pkg}`, explanation: "Ask the Debian/Ubuntu package manager to install software.", command: `sudo apt install ${quote(pkg)}`, risk: "dangerous", notes: ["This changes the system and may require your password.", "Confirm the package name and repository before running it."] };
  }

  if (/delete|remove|wipe|destroy|erase|uninstall/.test(q)) {
    return { ...base, title: "Destructive request blocked for review", explanation: "I will not generate a destructive command from an ambiguous request. Name the exact path and operation, then review it manually.", command: "", risk: "dangerous", notes: ["No command was generated.", "Prefer a dry run or move files to a quarantine directory first."] };
  }

  return {
    ...base,
    title: "I need a more specific request",
    explanation: "The local copilot only generates commands for known, reviewable tasks. It will not guess arbitrary shell code.",
    command: "",
    risk: "review",
    notes: ["Try: “show disk usage”, “find large files”, “check git status”, or “list running processes”."],
  };
}

export function riskLabel(risk: PlanRisk): string {
  return risk === "safe" ? "READ ONLY" : risk === "review" ? "REVIEW" : "DANGEROUS";
}
