// ============================================================
// STRUCTURED LOGGER
// Emits StructuredLogEntry objects with required correlation fields
// Supports: in-memory ring buffer, drain to terminal output lines
// ============================================================

import type { StructuredLogEntry, LogLevel, DomainError } from "./types";

// ── Ring Buffer ────────────────────────────────────────────
const MAX_RING = 512;
const _ring: StructuredLogEntry[] = [];

export function appendLog(entry: StructuredLogEntry): void {
  _ring.push(entry);
  if (_ring.length > MAX_RING) _ring.shift();
}

export function drainLogs(): StructuredLogEntry[] {
  return _ring.splice(0);
}

export function peekLogs(): readonly StructuredLogEntry[] {
  return _ring;
}

export function clearLogs(): void {
  _ring.length = 0;
}

// ── Logger Factory ─────────────────────────────────────────
export interface Logger {
  start(step: string, fields?: Record<string, unknown>): void;
  transition(step: string, fields?: Record<string, unknown>): void;
  success(step: string, latency_ms: number, fields?: Record<string, unknown>): void;
  failure(step: string, error: DomainError, latency_ms: number): void;
  warn(step: string, message: string, fields?: Record<string, unknown>): void;
}

export function makeLogger(
  correlation_id: string,
  chain_name: string,
  chain_version: string
): Logger {
  const emit = (
    level: LogLevel,
    step: string,
    outcome: StructuredLogEntry["outcome"],
    message: string,
    latency_ms?: number,
    fields?: Record<string, unknown>,
    error?: DomainError
  ) => {
    const entry: StructuredLogEntry = {
      level,
      correlation_id,
      chain_name,
      chain_version,
      step,
      outcome,
      message,
      ...(latency_ms !== undefined ? { latency_ms } : {}),
      ...(fields ? { fields } : {}),
      ...(error ? { error } : {}),
    };
    appendLog(entry);
  };

  return {
    start(step, fields) {
      emit("INFO", step, "START", `[${chain_name}] START ${step}`, undefined, fields);
    },
    transition(step, fields) {
      emit("INFO", step, "TRANSITION", `[${chain_name}] → ${step}`, undefined, fields);
    },
    success(step, latency_ms, fields) {
      emit("INFO", step, "SUCCESS", `[${chain_name}] ✓ ${step} (${latency_ms.toFixed(1)}ms)`, latency_ms, fields);
    },
    failure(step, error, latency_ms) {
      emit("ERROR", step, "FAILURE", `[${chain_name}] ✗ ${step}: [${error.code}] ${error.message}`, latency_ms, undefined, error);
    },
    warn(step, message, fields) {
      emit("WARN", step, "WARN", `[${chain_name}] ⚠ ${step}: ${message}`, undefined, fields);
    },
  };
}

// ── Format a log entry for terminal display ───────────────
export function formatLogEntry(e: StructuredLogEntry): string {
  const ts = `[${e.level}]`;
  const id = e.correlation_id.slice(0, 8);
  const base = `${ts} [${id}] chain=${e.chain_name} step=${e.step} outcome=${e.outcome}`;
  const extra = e.latency_ms !== undefined ? ` latency=${e.latency_ms.toFixed(1)}ms` : "";
  const err = e.error ? ` code=${e.error.code} retry=${e.error.retryClass}` : "";
  const msg = ` msg="${e.message}"`;
  return base + extra + err + msg;
}

// ── Drain logs to terminal output lines ───────────────────
export function drainToLines(): string[] {
  return drainLogs().map(formatLogEntry);
}
