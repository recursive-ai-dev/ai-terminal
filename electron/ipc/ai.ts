// ============================================================
// LOCAL AI PROVIDER
//
// Optional Ollama endpoint (/api/generate). The request is made from
// the main process so a provider URL never needs to be exposed to the
// renderer. If no model is running, the renderer falls back to its
// deterministic, safe command planner.
//
// Environment:
//   AI_TERMINAL_AI_URL           endpoint (default http://127.0.0.1:11434/api/generate)
//   AI_TERMINAL_AI_MODEL         model name (default llama3.2:3b)
//   AI_TERMINAL_AI_TIMEOUT_MS    request timeout (default 30000)
//   AI_TERMINAL_ALLOW_REMOTE_AI  "true" to allow a non-loopback https endpoint
// ============================================================
import { IPC } from "./channels";
import { handle, errorMessage } from "../lib/ipcGuard";
import { createLogger } from "../lib/logger";
import {
  buildPrompt,
  checkEndpoint,
  extractJSON,
  readAIConfig,
  sanitizePlan,
  MAX_REQUEST_CHARS,
  type AIPlanResponse,
} from "../lib/aiPlan";

const log = createLogger("ai");
const MAX_RESPONSE_BYTES = 256 * 1024;

// One request at a time per renderer: a new question cancels the old one.
const inFlight = new Map<number, AbortController>();

export function registerAIHandlers(): void {
  const config = readAIConfig(process.env);
  const endpoint = checkEndpoint(config.endpoint, config.allowRemote);
  if (!endpoint.ok) log.warn(`AI endpoint disabled: ${endpoint.error}`, config.endpoint);

  handle(IPC.AI_ASK, async (event, request: unknown): Promise<AIPlanResponse> => {
    if (!endpoint.ok) return { ok: false, error: endpoint.error };
    const text = (typeof request === "string" ? request : "").trim().slice(0, MAX_REQUEST_CHARS);
    if (!text) return { ok: false, error: "Empty request" };

    const senderId = event.sender.id;
    inFlight.get(senderId)?.abort(new Error("Superseded by a newer request"));
    const controller = new AbortController();
    inFlight.set(senderId, controller);
    const timeout = setTimeout(() => controller.abort(new Error(`Local model did not answer within ${Math.round(config.timeoutMs / 1000)}s`)), config.timeoutMs);

    try {
      const response = await fetch(endpoint.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ model: config.model, stream: false, format: "json", prompt: buildPrompt(text) }),
      });
      if (!response.ok) return { ok: false, error: `Local model returned HTTP ${response.status}` };

      const body = await response.text();
      if (Buffer.byteLength(body, "utf8") > MAX_RESPONSE_BYTES) return { ok: false, error: "Local model response is too large" };

      let payload: { response?: unknown };
      try {
        payload = JSON.parse(body) as { response?: unknown };
      } catch {
        return { ok: false, error: "Local model returned invalid JSON" };
      }
      const parsed = extractJSON(payload.response);
      return parsed ? sanitizePlan(parsed) : { ok: false, error: "Local model returned invalid plan JSON" };
    } catch (error) {
      if (controller.signal.aborted) {
        const reason = controller.signal.reason;
        return { ok: false, error: reason instanceof Error ? reason.message : "Request cancelled" };
      }
      const message = errorMessage(error);
      log.info("local model unavailable", message);
      return { ok: false, error: /ECONNREFUSED|fetch failed/i.test(message) ? "No local model is running" : message };
    } finally {
      clearTimeout(timeout);
      if (inFlight.get(senderId) === controller) inFlight.delete(senderId);
    }
  });
}
