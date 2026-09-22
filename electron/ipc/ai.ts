// ============================================================
// LOCAL AI PROVIDER
//
// Optional Ollama / OpenAI-compatible local endpoint. The request is
// made from the main process so a provider URL or API key never needs
// to be exposed to the renderer. If no model is running, the renderer
// falls back to its deterministic, safe command planner.
// ============================================================
import { ipcMain, IpcMainInvokeEvent } from "electron";
import { IPC } from "./channels";

const DEFAULT_ENDPOINT = "http://127.0.0.1:11434/api/generate";
const DEFAULT_MODEL = "llama3.2:3b";
const TIMEOUT_MS = 3500;

interface AIPlanResponse {
  ok: boolean;
  source?: "ollama";
  title?: string;
  explanation?: string;
  command?: string;
  risk?: "safe" | "review" | "dangerous";
  notes?: string[];
  error?: string;
}

function localEndpoint(): string {
  return process.env.AI_TERMINAL_AI_URL || DEFAULT_ENDPOINT;
}

function isAllowedEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    // Local-only by default. A remote endpoint can be explicitly opted into
    // by setting AI_TERMINAL_ALLOW_REMOTE_AI=true in the desktop environment.
    const local = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1";
    return url.protocol === "http:" && (local || process.env.AI_TERMINAL_ALLOW_REMOTE_AI === "true");
  } catch {
    return false;
  }
}

function extractJSON(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "string") return null;
  try {
    const direct = JSON.parse(value);
    return direct && typeof direct === "object" ? direct as Record<string, unknown> : null;
  } catch {
    const match = value.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      const parsed = JSON.parse(match[0]);
      return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
    } catch {
      return null;
    }
  }
}

function sanitizePlan(raw: Record<string, unknown>): AIPlanResponse {
  const requestedRisk = raw.risk === "safe" || raw.risk === "review" || raw.risk === "dangerous" ? raw.risk : "review";
  const requestedCommand = typeof raw.command === "string" ? raw.command.slice(0, 2000) : "";
  const destructive = /(^|\s)(rm|rmdir|mkfs|dd|shutdown|reboot|sudo)\b|:\s*>/.test(requestedCommand);
  const risk = destructive ? "dangerous" : requestedRisk;
  const notes = Array.isArray(raw.notes) ? raw.notes.filter(item => typeof item === "string").slice(0, 5).map(item => item.slice(0, 240)) : [];
  if (destructive) notes.unshift("Destructive command withheld. Run it manually only after a separate review.");
  return {
    ok: true,
    source: "ollama",
    title: typeof raw.title === "string" ? raw.title.slice(0, 120) : "AI shell plan",
    explanation: typeof raw.explanation === "string" ? raw.explanation.slice(0, 500) : "Review this generated command before running it.",
    command: destructive ? "" : requestedCommand,
    risk,
    notes: notes.slice(0, 5),
  };
}

export function registerAIHandlers(): void {
  ipcMain.handle(IPC.AI_ASK, async (_event: IpcMainInvokeEvent, request: unknown): Promise<AIPlanResponse> => {
    const text = String(request ?? "").trim().slice(0, 1000);
    if (!text) return { ok: false, error: "Empty request" };

    const endpoint = localEndpoint();
    if (!isAllowedEndpoint(endpoint)) return { ok: false, error: "AI endpoint must be local (set AI_TERMINAL_ALLOW_REMOTE_AI=true to opt in)" };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model: process.env.AI_TERMINAL_AI_MODEL || DEFAULT_MODEL,
          stream: false,
          format: "json",
          prompt: [
            "You are the approval-first copilot for a Linux terminal.",
            "Convert the user's request into one safe, reviewable shell plan.",
            "Never execute anything. Do not invent paths. For destructive operations use an empty command and risk dangerous.",
            "Return JSON only with title, explanation, command, risk (safe|review|dangerous), and notes (array of strings).",
            `User request: ${text}`,
          ].join("\n"),
        }),
      });
      if (!response.ok) return { ok: false, error: `Local model returned HTTP ${response.status}` };
      const payload = await response.json() as { response?: unknown };
      const parsed = extractJSON(payload.response);
      return parsed ? sanitizePlan(parsed) : { ok: false, error: "Local model returned invalid plan JSON" };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
      clearTimeout(timeout);
    }
  });
}
