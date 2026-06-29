// ============================================================
// DOMAIN TYPES — Typed Result, Error Taxonomy, Correlation IDs
// Replaces raw throw+string with a structured, classified system
// ============================================================

// ── Correlation / Trace Identity ──────────────────────────
export interface TraceContext {
  correlation_id: string;
  chain_name: string;
  chain_version: string;
  session_id: string;
  request_id: string;
  idempotency_key: string;
}

// ── Result<T, E> — no exceptions across domain boundary ───
export type Result<T, E extends DomainError = DomainError> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export function Ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function Err<E extends DomainError>(error: E): Result<never, E> {
  return { ok: false, error };
}

// ── Error Taxonomy ─────────────────────────────────────────
export type ErrorCode =
  // Boundary invariants
  | "INVALID_INPUT"
  | "SHAPE_MISMATCH"
  | "MISSING_ENTITY"
  | "DUPLICATE_KEY"
  // Domain invariants
  | "NAN_DETECTED"
  | "GRADIENT_EXPLOSION"
  | "ZERO_LOSS"
  | "INVARIANT_BREACH"
  // Infra invariants
  | "STATE_CORRUPTION"
  | "PARTIAL_UPDATE"
  // Retryable
  | "TRANSIENT_FAILURE";

export type RetryClass =
  | "NON_RETRYABLE"       // bad input / invariant breach
  | "RETRYABLE_SAFE"      // idempotent, safe to replay
  | "RETRYABLE_TRANSIENT"; // network/timeout style

export interface DomainError {
  code: ErrorCode;
  message: string;
  retryClass: RetryClass;
  step?: string;
  cause?: unknown;
  context?: Record<string, unknown>;
}

export function makeDomainError(
  code: ErrorCode,
  message: string,
  retryClass: RetryClass,
  opts?: { step?: string; cause?: unknown; context?: Record<string, unknown> }
): DomainError {
  return { code, message, retryClass, ...opts };
}

// ── Idempotency Key ────────────────────────────────────────
export interface TrainIdempotencyKey {
  networkName: string;
  xTensorName: string;
  yTensorName: string;
  optimizerName: string;
  epochs: number;
}

export function makeIdempotencyKey(k: TrainIdempotencyKey): string {
  return `net.train::${k.networkName}::${k.xTensorName}::${k.yTensorName}::${k.optimizerName}::${k.epochs}`;
}

// ── Structured Log Entry ───────────────────────────────────
export type LogLevel = "INFO" | "WARN" | "ERROR" | "DEBUG";

export interface StructuredLogEntry {
  level: LogLevel;
  correlation_id: string;
  chain_name: string;
  chain_version: string;
  step: string;
  outcome: "START" | "TRANSITION" | "SUCCESS" | "FAILURE" | "WARN";
  latency_ms?: number;
  message: string;
  fields?: Record<string, unknown>;
  error?: DomainError;
}

// ── Training Contract Types ────────────────────────────────

export interface TrainRequest {
  networkName: string;
  xTensorName: string;
  yTensorName: string;
  optimizerName: string;
  epochs: number;
  // Optional guards
  maxGradNorm?: number;       // default 10.0 — clip if exceeded
  nanAbortThreshold?: number; // default: abort on NaN
  logEveryN?: number;         // emit epoch logs every N steps
  idempotencyKey?: string;    // caller-provided dedup key
}

export interface EpochSnapshot {
  epoch: number;
  loss: number;
  gradNorm: number;
  paramNorm: number;
  isNaN: boolean;
}

export interface TrainResult {
  networkName: string;
  epochsCompleted: number;
  epochsRequested: number;
  initialLoss: number;
  finalLoss: number;
  improvement: number;         // (initialLoss - finalLoss) / initialLoss
  snapshots: EpochSnapshot[];
  didConverge: boolean;
  didNaN: boolean;
  idempotencyKey: string;
  correlation_id: string;
  latency_ms: number;
  auditTrail: string[];        // step-by-step audit record
}

// ── Step Names (state machine) ─────────────────────────────
export type TrainStep =
  | "VALIDATE_INPUTS"
  | "CHECK_SHAPES"
  | "CHECK_IDEMPOTENCY"
  | "ZERO_GRADIENTS"
  | "FORWARD_PASS"
  | "COMPUTE_LOSS"
  | "GUARD_NAN"
  | "BACKWARD_PASS"
  | "CLIP_GRADIENTS"
  | "OPTIMIZER_STEP"
  | "RECORD_SNAPSHOT"
  | "FINALIZE";
