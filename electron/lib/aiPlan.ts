// ============================================================
// AI PLAN — pure helpers for the local model provider
//
// Kept free of Electron imports so the endpoint policy and response
// sanitising can be unit-tested in plain Node.
// ============================================================
import {
  assessCommand,
  isCommandRisk,
  maxRisk,
  validateCommandText,
  type CommandRisk,
} from "../../src/shared/commandRisk";

export const DEFAULT_ENDPOINT = "http://127.0.0.1:11434/api/generate";
export const DEFAULT_MODEL = "llama3.2:3b";
export const DEFAULT_TIMEOUT_MS = 30_000;
export const MAX_REQUEST_CHARS = 1000;

export interface AIPlanResponse {
  ok: boolean;
  source?: "ollama";
  title?: string;
  explanation?: string;
  command?: string;
  risk?: CommandRisk;
  notes?: string[];
  error?: string;
}

export interface AIConfig {
  endpoint: string;
  model: string;
  timeoutMs: number;
  allowRemote: boolean;
}

export function readAIConfig(env: NodeJS.ProcessEnv): AIConfig {
  const timeout = Number.parseInt(env.AI_TERMINAL_AI_TIMEOUT_MS ?? "", 10);
  return {
    endpoint: env.AI_TERMINAL_AI_URL?.trim() || DEFAULT_ENDPOINT,
    model: env.AI_TERMINAL_AI_MODEL?.trim() || DEFAULT_MODEL,
    timeoutMs: Number.isFinite(timeout) && timeout >= 1000 && timeout <= 600_000 ? timeout : DEFAULT_TIMEOUT_MS,
    allowRemote: env.AI_TERMINAL_ALLOW_REMOTE_AI === "true",
  };
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

export function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname.toLowerCase()) || /^127(?:\.\d{1,3}){3}$/.test(hostname);
}

/**
 * Local-only by default. A remote endpoint must be opted into explicitly,
 * and then must use HTTPS so prompts are not sent in clear text.
 */
export function checkEndpoint(value: string, allowRemote: boolean): { ok: true; url: URL } | { ok: false; error: string } {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, error: "AI endpoint is not a valid URL" };
  }
  if (url.username || url.password) return { ok: false, error: "AI endpoint must not embed credentials" };
  if (isLoopbackHost(url.hostname)) {
    return url.protocol === "http:" || url.protocol === "https:" ? { ok: true, url } : { ok: false, error: "AI endpoint must use http or https" };
  }
  if (!allowRemote) return { ok: false, error: "AI endpoint must be local (set AI_TERMINAL_ALLOW_REMOTE_AI=true to opt in)" };
  if (url.protocol !== "https:") return { ok: false, error: "Remote AI endpoints must use https" };
  return { ok: true, url };
}

export function buildPrompt(request: string): string {
  return [
    "You are the approval-first copilot for a Linux terminal.",
    "Convert the user's request into one safe, reviewable shell command on a single line.",
    "Never execute anything. Do not invent paths. For destructive operations use an empty command and risk dangerous.",
    "Return JSON only with keys: title, explanation, command, risk (safe|review|dangerous), notes (array of strings).",
    `User request: ${request}`,
  ].join("\n");
}

/** Parse a model response that should be JSON but may wrap it in prose. */
export function extractJSON(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "string") return null;
  const asObject = (parsed: unknown) => parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  try {
    return asObject(JSON.parse(value));
  } catch {
    const start = value.indexOf("{");
    const end = value.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      return asObject(JSON.parse(value.slice(start, end + 1)));
    } catch {
      return null;
    }
  }
}

function clip(value: unknown, max: number, fallback: string): string {
  // eslint-disable-next-line no-control-regex
  return typeof value === "string" && value.trim() ? value.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim().slice(0, max) : fallback;
}

/**
 * Normalise an untrusted model plan. The final risk is never lower than
 * the shared classifier's verdict, and dangerous commands are withheld.
 */
export function sanitizePlan(raw: Record<string, unknown>): AIPlanResponse {
  const notes = Array.isArray(raw.notes)
    ? raw.notes.filter((item): item is string => typeof item === "string" && item.trim() !== "").slice(0, 5).map(item => clip(item, 240, ""))
    : [];

  let command = "";
  let risk: CommandRisk = isCommandRisk(raw.risk) ? raw.risk : "review";

  if (typeof raw.command === "string" && raw.command.trim()) {
    const validated = validateCommandText(raw.command);
    if (validated.ok) {
      const assessment = assessCommand(validated.command);
      risk = maxRisk(risk, assessment.risk);
      command = validated.command;
      notes.unshift(...assessment.reasons.slice(0, 3));
    } else {
      risk = maxRisk(risk, "review");
      notes.unshift(`Model command rejected: ${validated.error}.`);
    }
  }

  if (risk === "dangerous" && command) {
    notes.unshift("Destructive command withheld. Run it manually only after a separate review.");
    command = "";
  }

  return {
    ok: true,
    source: "ollama",
    title: clip(raw.title, 120, "AI shell plan"),
    explanation: clip(raw.explanation, 500, "Review this generated command before running it."),
    command,
    risk,
    notes: [...new Set(notes)].slice(0, 5),
  };
}
