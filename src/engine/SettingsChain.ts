// ============================================================
// SETTINGS CHAIN — v1.0.0
// Chain Contract: settings.change end-to-end
//
// State Machine:
//   RECEIVE_MUTATION → VALIDATE → DIFF → CHECK_IDEMPOTENCY →
//   PERSIST → AUDIT → EMIT
//
// Invariants:
//   [D1] Previous settings object is never mutated in-place
//   [D2] Persistence fires only after validation passes
//   [D3] Audit log fires for every accepted change (changed_keys, from/to)
//   [D4] Rejected mutations produce zero side effects
//   [D5] Schema version is always embedded in persisted blob
//   [I1] Identical consecutive settings (same fingerprint) = no-op write
//   [B1] All numeric fields finite and in-range after normalization
//   [B2] All string fields non-null, within length bounds, safe
//   [B3] All enum fields are valid union members
//   [B4] Result settings object always has all required keys
//
// Failure Semantics:
//   INVALID_FIELD (NON_RETRYABLE) — rejected, prev settings unchanged
//   PERSIST_FAILURE (RETRYABLE_SAFE) — in-memory valid, warn only
//   SCHEMA_MISMATCH (NON_RETRYABLE) — load-time only
//
// Idempotency: fingerprintSettings() — skip write if unchanged
// Atomicity: validate → THEN persist; no partial persist path
// ============================================================

import type { UXSettings } from "./UXSettings";
import {
  validateSettings,
  diffSettings,
  fingerprintSettings,
  saveSettings,
} from "./UXSettings";
import type { Result, DomainError } from "./types";
import { Ok, Err, makeDomainError } from "./types";
import { makeLogger } from "./logger";
import { realClock } from "./determinism";
import type { ClockProvider } from "./determinism";

// ── Step names ──────────────────────────────────────────────
export type SettingsStep =
  | "RECEIVE_MUTATION"
  | "VALIDATE"
  | "DIFF"
  | "CHECK_IDEMPOTENCY"
  | "PERSIST"
  | "AUDIT"
  | "EMIT";

// ── Idempotency cache: last persisted fingerprint ──────────
let _lastFingerprint: string | null = null;

export function clearSettingsCache(): void {
  _lastFingerprint = null;
}

// ── Chain result ───────────────────────────────────────────
export interface SettingsChangeResult {
  previous: UXSettings;
  next: UXSettings;
  changedKeys: string[];
  changes: Array<{ key: string; from: unknown; to: unknown }>;
  wasIdempotent: boolean;        // true = fingerprint match, no-op
  persistFailed: boolean;        // true = in-memory ok but storage failed
  validationWarnings: string[];
  correlation_id: string;
  latency_ms: number;
  auditTrail: string[];
}

// ── Main chain entry point ─────────────────────────────────
export function executeSettingsChange(
  previous: UXSettings,
  incoming: Partial<UXSettings>,
  correlationId: string,
  onPersist?: (s: UXSettings) => void,  // Electron IPC or custom persistence
  clock: ClockProvider = realClock
): Result<SettingsChangeResult, DomainError> {
  const chainStart = clock.mark();
  const log = makeLogger(correlationId, "settings.change", "1.0.0");
  const auditTrail: string[] = [];
  const audit = (msg: string) => auditTrail.push(`[${clock.now().toFixed(1)}ms] ${msg}`);

  // ─────────────────────────────────────────────────────────
  // STEP 1: RECEIVE_MUTATION
  // ─────────────────────────────────────────────────────────
  log.start("RECEIVE_MUTATION", {
    correlation_id: correlationId,
    incoming_keys: Object.keys(incoming).join(","),
  });
  audit(`START RECEIVE_MUTATION keys=${Object.keys(incoming).join(",")}`);

  // Guard: incoming must be a plain object
  if (typeof incoming !== "object" || incoming === null || Array.isArray(incoming)) {
    const err = makeDomainError(
      "INVALID_INPUT",
      `Settings mutation must be a plain object, got: ${typeof incoming}`,
      "NON_RETRYABLE",
      { step: "RECEIVE_MUTATION" }
    );
    log.failure("RECEIVE_MUTATION", err, clock.elapsed(chainStart));
    audit(`REJECT non-object incoming`);
    return Err(err);
  }

  // ─────────────────────────────────────────────────────────
  // STEP 2: VALIDATE — normalize, clamp, reject bad fields
  // [B1] [B2] [B3] [B4]
  // ─────────────────────────────────────────────────────────
  log.transition("VALIDATE", { keys: Object.keys(incoming).length });
  audit(`TRANSITION → VALIDATE`);

  const report = validateSettings(incoming, previous);

  if (!report.ok) {
    // Emit warnings but still fail — caller must fix input
    const fieldList = report.errors.map(e => `${e.field}(rejected=${JSON.stringify(e.rejected)})`).join(", ");
    const err = makeDomainError(
      "INVALID_INPUT",
      `Settings validation failed for fields: ${fieldList}`,
      "NON_RETRYABLE",
      {
        step: "VALIDATE",
        context: {
          errors: report.errors,
          warnings: report.warnings,
        }
      }
    );
    log.failure("VALIDATE", err, clock.elapsed(chainStart));
    audit(`REJECT validation_errors=${report.errors.length}`);
    // [D4] Zero side effects — return immediately, previous unchanged
    return Err(err);
  }

  const validated = report.validated;
  audit(`VALIDATE ok warnings=${report.warnings.length}`);

  if (report.warnings.length > 0) {
    log.warn("VALIDATE", `${report.warnings.length} field warnings`, {
      warnings: report.warnings,
    });
  }

  // ─────────────────────────────────────────────────────────
  // STEP 3: DIFF — compute what actually changed
  // ─────────────────────────────────────────────────────────
  log.transition("DIFF");
  audit(`TRANSITION → DIFF`);

  const diff = diffSettings(previous, validated);

  if (diff.changedKeys.length === 0) {
    // No-op — nothing changed after validation
    const noopResult: SettingsChangeResult = {
      previous,
      next: validated,
      changedKeys: [],
      changes: [],
      wasIdempotent: true,
      persistFailed: false,
      validationWarnings: report.warnings,
      correlation_id: correlationId,
      latency_ms: clock.elapsed(chainStart),
      auditTrail,
    };
    log.success("DIFF", clock.elapsed(chainStart), { noop: true });
    audit(`NOOP no fields changed`);
    return Ok(noopResult);
  }

  audit(`DIFF changed_keys=${diff.changedKeys.join(",")}`);

  // ─────────────────────────────────────────────────────────
  // STEP 4: CHECK_IDEMPOTENCY — fingerprint dedup
  // [I1]
  // ─────────────────────────────────────────────────────────
  log.transition("CHECK_IDEMPOTENCY");
  audit(`TRANSITION → CHECK_IDEMPOTENCY`);

  const fingerprint = fingerprintSettings(validated);
  const wasIdempotent = fingerprint === _lastFingerprint;

  if (wasIdempotent) {
    audit(`IDEMPOTENCY HIT fingerprint_match`);
    log.success("CHECK_IDEMPOTENCY", clock.elapsed(chainStart), { cached: true });
    const result: SettingsChangeResult = {
      previous,
      next: validated,
      changedKeys: diff.changedKeys,
      changes: diff.changes,
      wasIdempotent: true,
      persistFailed: false,
      validationWarnings: report.warnings,
      correlation_id: correlationId,
      latency_ms: clock.elapsed(chainStart),
      auditTrail,
    };
    // [D4] No-op: settings already match — skip persist
    return Ok(result);
  }

  // ─────────────────────────────────────────────────────────
  // STEP 5: PERSIST — write validated settings
  // [D2] Only fires after validation passes
  // [D5] Schema version embedded
  // ─────────────────────────────────────────────────────────
  log.transition("PERSIST");
  audit(`TRANSITION → PERSIST`);

  let persistFailed = false;

  try {
    saveSettings(validated);
    _lastFingerprint = fingerprint;
    audit(`PERSIST localStorage ok`);
  } catch (e) {
    persistFailed = true;
    const persistErr = makeDomainError(
      "TRANSIENT_FAILURE",
      `localStorage write failed: ${e instanceof Error ? e.message : String(e)}`,
      "RETRYABLE_SAFE",
      { step: "PERSIST", cause: e }
    );
    log.warn("PERSIST", `localStorage write failed — in-memory state valid`, {
      cause: persistErr.message,
    });
    audit(`PERSIST_FAILED localStorage_error — continuing in-memory`);
    // [D3] Continue — in-memory is still valid; persist failure is non-fatal
  }

  // Run Electron IPC or custom persistence hook
  if (onPersist) {
    try {
      onPersist(validated);
      audit(`PERSIST ipc_hook ok`);
    } catch (e) {
      persistFailed = true;
      log.warn("PERSIST", `IPC persistence hook failed`, {
        cause: e instanceof Error ? e.message : String(e),
      });
      audit(`PERSIST_FAILED ipc_error — continuing`);
    }
  }

  // ─────────────────────────────────────────────────────────
  // STEP 6: AUDIT — emit structured log with full diff
  // [D3] Always fires for every accepted change
  // ─────────────────────────────────────────────────────────
  log.transition("AUDIT");
  audit(`TRANSITION → AUDIT`);

  for (const change of diff.changes) {
    audit(`CHANGED key=${change.key} from=${JSON.stringify(change.from)} to=${JSON.stringify(change.to)}`);
  }

  log.success("AUDIT", clock.elapsed(chainStart), {
    changed_keys: diff.changedKeys,
    changes: diff.changes,
    persist_failed: persistFailed,
  });

  // ─────────────────────────────────────────────────────────
  // STEP 7: EMIT — return validated result for parent to apply
  // ─────────────────────────────────────────────────────────
  log.transition("EMIT");
  audit(`TRANSITION → EMIT`);

  const totalLatency = clock.elapsed(chainStart);
  audit(`FINALIZE latency=${totalLatency.toFixed(1)}ms changed=${diff.changedKeys.length}`);

  log.success("EMIT", totalLatency, {
    changed_keys: diff.changedKeys.length,
    latency_ms: totalLatency.toFixed(2),
    persist_failed: persistFailed,
  });

  const result: SettingsChangeResult = {
    previous,
    next: validated,         // [D1] new object, previous never mutated
    changedKeys: diff.changedKeys,
    changes: diff.changes,
    wasIdempotent: false,
    persistFailed,
    validationWarnings: report.warnings,
    correlation_id: correlationId,
    latency_ms: totalLatency,
    auditTrail,
  };

  return Ok(result);
}

// ── Format result for terminal display (settings.audit command) ──
export function formatSettingsResult(r: SettingsChangeResult): string[] {
  const lines: string[] = [];
  lines.push(`[SETTINGS] ${r.wasIdempotent ? "no-op (idempotent)" : `changed ${r.changedKeys.length} field(s)`}`);
  lines.push(`  corr_id  : ${r.correlation_id.slice(0, 8)}...`);
  lines.push(`  latency  : ${r.latency_ms.toFixed(1)}ms`);
  if (r.changedKeys.length > 0) {
    lines.push(`  ── Changes ──`);
    for (const c of r.changes) {
      lines.push(`  ${c.key.padEnd(24)}: ${JSON.stringify(c.from)} → ${JSON.stringify(c.to)}`);
    }
  }
  if (r.validationWarnings.length > 0) {
    lines.push(`  ── Warnings ──`);
    for (const w of r.validationWarnings) lines.push(`  ⚠ ${w}`);
  }
  if (r.persistFailed) lines.push(`  ⚠ PERSIST FAILED — in-memory only`);
  lines.push(`  ── Audit Trail ──`);
  for (const a of r.auditTrail) lines.push(`  ${a}`);
  return lines;
}

// ── Format error ──────────────────────────────────────────
export function formatSettingsError(err: DomainError): string[] {
  return [
    `[SETTINGS ERROR] [${err.code}] ${err.message}`,
    `  retry_class: ${err.retryClass}`,
    `  step       : ${err.step ?? "unknown"}`,
    ...(err.context?.errors
      ? (err.context.errors as Array<{ field: string; reason: string; rejected: unknown; fallback: unknown }>)
          .map(e => `  field=${e.field} rejected=${JSON.stringify(e.rejected)} fallback=${JSON.stringify(e.fallback)}`)
      : []),
  ];
}
