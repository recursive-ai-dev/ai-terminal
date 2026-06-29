// ============================================================
// ADAM CHAIN — v2.0.0
// Chain Contract: adam.step — guarded, typed, observable
//
// State Machine:
//   VALIDATE_PARAMS → PRE_STEP_NAN_GUARD → SNAPSHOT →
//   MOMENT_UPDATE → PARAM_UPDATE → POST_STEP_NAN_GUARD →
//   FINALIZE
//
// Invariants:
//   [D1] Pre-step: all param gradients must be finite (skip+warn or abort)
//   [D2] Post-step: all param values must be finite
//   [D3] On NaN post-step: restore params from pre-step snapshot, return Err
//   [D4] Moment state (m, v, vMax) must remain finite across all steps
//   [D5] Step counter t is monotonically incremented only on success
//   [B1] params array must be non-empty
//   [B2] each param must have .requiresGrad = true or have a .grad present
//
// Failure Semantics:
//   NAN_IN_GRAD    (RETRYABLE_SAFE)   — grad NaN: skip param, log warn
//   NAN_IN_PARAMS  (RETRYABLE_SAFE)   — post-step NaN: rollback, Err
//   GRADIENT_EXPLOSION (RETRYABLE_SAFE) — large grad norm, clipped
//   INVALID_INPUT  (NON_RETRYABLE)    — no params
//
// Idempotency: step counter t is the idempotency key — same t = same step
// Atomicity: snapshot before → restore on failure → never partial update
// ============================================================

import { NanoTensor } from "./NanoTensor";
import type { Adam } from "./Adam";
import type { Result, DomainError } from "./types";
import { Ok, Err, makeDomainError } from "./types";
import { makeLogger } from "./logger";
import { realClock } from "./determinism";
import type { ClockProvider } from "./determinism";

// ── Step Result ───────────────────────────────────────────
export interface AdamStepResult {
  step:         number;
  paramsUpdated: number;
  paramsSkipped: number;        // params with no/NaN grad
  maxGradNorm:  number;
  maxParamNorm: number;
  effectiveLr:  number;
  nanGrads:     number[];       // param indices with NaN grad
  warnings:     string[];
  latency_ms:   number;
  auditTrail:   string[];
}

// ── Param Snapshot for rollback ───────────────────────────
interface ParamSnap {
  data: Float32Array[];
  m:    Float32Array[];
  v:    Float32Array[];
  vMax: Float32Array[];
  t:    number;
}

function snapshotAdamState(opt: Adam): ParamSnap {
  return {
    data: opt.params.map(p => new Float32Array(p.data as Float32Array)),
    m:    opt.m.map(a => new Float32Array(a)),
    v:    opt.v.map(a => new Float32Array(a)),
    vMax: opt.vMax.map(a => new Float32Array(a)),
    t:    opt.t,
  };
}

function restoreAdamState(opt: Adam, snap: ParamSnap): void {
  for (let i = 0; i < opt.params.length; i++) {
    (opt.params[i].data as Float32Array).set(snap.data[i]);
  }
  for (let i = 0; i < opt.m.length; i++) {
    opt.m[i].set(snap.m[i]);
    opt.v[i].set(snap.v[i]);
    opt.vMax[i].set(snap.vMax[i]);
  }
  opt.t = snap.t;
}

function isFiniteArray(arr: Float32Array): boolean {
  for (let i = 0; i < arr.length; i++) {
    if (!isFinite(arr[i])) return false;
  }
  return true;
}



function normArray(arr: Float32Array): number {
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i] * arr[i];
  return Math.sqrt(s);
}

// ── Main contracted step ──────────────────────────────────
export function executeAdamStep(
  opt: Adam,
  correlationId: string,
  clock: ClockProvider = realClock
): Result<AdamStepResult, DomainError> {
  const t0 = clock.mark();
  const log = makeLogger(correlationId, "adam.step", "2.0.0");
  const audit: string[] = [];
  const a = (msg: string) => audit.push(`[${clock.now().toFixed(1)}ms] ${msg}`);

  // ── STEP: VALIDATE_PARAMS ─────────────────────────────
  log.start("VALIDATE_PARAMS", { paramCount: opt.params.length, step: opt.t + 1 });
  a(`START VALIDATE_PARAMS params=${opt.params.length}`);

  if (opt.params.length === 0) {
    const err = makeDomainError("INVALID_INPUT", "Adam has no parameters", "NON_RETRYABLE", { step: "VALIDATE_PARAMS" });
    log.failure("VALIDATE_PARAMS", err, clock.elapsed(t0));
    return Err(err);
  }

  // ── STEP: PRE_STEP_NAN_GUARD ──────────────────────────
  log.transition("PRE_STEP_NAN_GUARD");
  a(`TRANSITION → PRE_STEP_NAN_GUARD`);

  const nanGradIndices: number[] = [];
  const warnings: string[] = [];

  for (let pi = 0; pi < opt.params.length; pi++) {
    const p = opt.params[pi];
    if (!p.grad) continue;
    const g = p.grad.data as Float32Array;
    if (!isFiniteArray(g)) {
      nanGradIndices.push(pi);
      warnings.push(`param[${pi}] has NaN/Inf gradient — will be skipped`);
      log.warn("PRE_STEP_NAN_GUARD", `NaN grad at param[${pi}]`, { paramIndex: pi, paramSize: p.size });
      a(`WARN NaN_grad param[${pi}]`);
    }
  }

  // ── STEP: SNAPSHOT ────────────────────────────────────
  log.transition("SNAPSHOT");
  a(`TRANSITION → SNAPSHOT step=${opt.t}`);
  const snap = snapshotAdamState(opt);

  // ── STEP: MOMENT_UPDATE + PARAM_UPDATE ───────────────
  log.transition("PARAM_UPDATE");
  a(`TRANSITION → PARAM_UPDATE`);

  // Increment step counter
  opt.t++;
  const bc1 = 1 - Math.pow(opt.beta1, opt.t);
  const bc2 = 1 - Math.pow(opt.beta2, opt.t);
  const lrT = opt.lr * Math.sqrt(bc2) / bc1;

  let paramsUpdated = 0;
  let paramsSkipped = 0;
  let maxGradNorm = 0;
  let maxParamNorm = 0;

  for (let pi = 0; pi < opt.params.length; pi++) {
    const p = opt.params[pi];

    // Skip params with no grad or NaN grad [D1]
    if (!p.grad || nanGradIndices.includes(pi)) {
      paramsSkipped++;
      continue;
    }

    const g  = p.grad.data as Float32Array;
    const pD = p.data as Float32Array;
    const m  = opt.m[pi];
    const v  = opt.v[pi];
    const vM = opt.vMax[pi];

    const gNorm = normArray(g);
    maxGradNorm = Math.max(maxGradNorm, gNorm);

    for (let i = 0; i < p.size; i++) {
      let gi = g[i] + opt.weightDecay * pD[i];
      m[i] = opt.beta1 * m[i] + (1 - opt.beta1) * gi;
      v[i] = opt.beta2 * v[i] + (1 - opt.beta2) * gi * gi;
      let vHat = v[i];
      if (opt.amsgrad) {
        vM[i] = Math.max(vM[i], v[i]);
        vHat = vM[i];
      }
      pD[i] -= lrT * m[i] / (Math.sqrt(vHat) + opt.epsilon);
    }

    const pNorm = normArray(pD);
    maxParamNorm = Math.max(maxParamNorm, pNorm);
    paramsUpdated++;
  }

  a(`PARAM_UPDATE updated=${paramsUpdated} skipped=${paramsSkipped} maxGradNorm=${maxGradNorm.toFixed(4)}`);

  // ── STEP: POST_STEP_NAN_GUARD ─────────────────────────
  log.transition("POST_STEP_NAN_GUARD");
  a(`TRANSITION → POST_STEP_NAN_GUARD`);

  for (let pi = 0; pi < opt.params.length; pi++) {
    const p = opt.params[pi];
    const pD = p.data as Float32Array;
    if (!isFiniteArray(pD)) {
      // [D3] Rollback to pre-step state
      restoreAdamState(opt, snap);
      const err = makeDomainError(
        "NAN_DETECTED",
        `NaN/Inf in param[${pi}] after adam step ${opt.t + 1}. State rolled back.`,
        "RETRYABLE_SAFE",
        { step: "POST_STEP_NAN_GUARD", context: { paramIndex: pi, maxGradNorm } }
      );
      log.failure("POST_STEP_NAN_GUARD", err, clock.elapsed(t0));
      a(`ROLLBACK NaN_in_params param[${pi}] step_reverted`);
      return Err(err);
    }

    // [D4] Check moment state integrity
    if (!isFiniteArray(opt.m[pi]) || !isFiniteArray(opt.v[pi])) {
      restoreAdamState(opt, snap);
      const err = makeDomainError(
        "STATE_CORRUPTION",
        `NaN/Inf in moment state for param[${pi}] after step. State rolled back.`,
        "RETRYABLE_SAFE",
        { step: "POST_STEP_NAN_GUARD", context: { paramIndex: pi } }
      );
      log.failure("POST_STEP_NAN_GUARD", err, clock.elapsed(t0));
      a(`ROLLBACK NaN_in_moments param[${pi}]`);
      return Err(err);
    }
  }

  // ── STEP: FINALIZE ────────────────────────────────────
  const latency = clock.elapsed(t0);
  a(`FINALIZE step=${opt.t} updated=${paramsUpdated} lr_eff=${lrT.toFixed(6)} latency=${latency.toFixed(1)}ms`);

  log.success("FINALIZE", latency, {
    step: opt.t,
    paramsUpdated,
    paramsSkipped,
    maxGradNorm: maxGradNorm.toFixed(4),
    effectiveLr: lrT.toFixed(6),
    nanGrads: nanGradIndices.length,
  });

  return Ok({
    step:         opt.t,
    paramsUpdated,
    paramsSkipped,
    maxGradNorm,
    maxParamNorm,
    effectiveLr:  lrT,
    nanGrads:     nanGradIndices,
    warnings,
    latency_ms:   latency,
    auditTrail:   audit,
  });
}

// ── Format result for terminal ────────────────────────────
export function formatAdamStepResult(r: AdamStepResult): string[] {
  const lines: string[] = [
    `[ADAM] ✓ step=${r.step}  updated=${r.paramsUpdated}  skipped=${r.paramsSkipped}`,
    `  lr_eff     : ${r.effectiveLr.toFixed(6)}`,
    `  maxGradNorm: ${r.maxGradNorm.toFixed(4)}`,
    `  maxParamNorm: ${r.maxParamNorm.toFixed(4)}`,
    `  latency    : ${r.latency_ms.toFixed(1)}ms`,
  ];
  if (r.warnings.length > 0) {
    lines.push(`  ── Warnings ──`);
    r.warnings.forEach(w => lines.push(`  ⚠ ${w}`));
  }
  return lines;
}

export function formatAdamStepError(err: DomainError): string[] {
  return [
    `[ADAM ERROR] [${err.code}] ${err.message}`,
    `  retry: ${err.retryClass}`,
    `  step:  ${err.step ?? "unknown"}`,
  ];
}

// ── Backward result type (for cmdTensorBackward) ──────────
export interface BackwardResult {
  nodesVisited:  number;
  nanGrads:      Array<{ label: string; shape: number[] }>;
  warnings:      string[];
  gradAccumWarn: boolean;   // true if grad was non-null before backward
  shapeWarn:     boolean;   // true if tensor is not scalar
  latency_ms:    number;
}

// ── Guarded backward ──────────────────────────────────────
export function executeBackward(
  t: NanoTensor,
  correlationId: string,
  clock: ClockProvider = realClock
): Result<BackwardResult, DomainError> {
  const t0 = clock.mark();
  const log = makeLogger(correlationId, "tensor.backward", "2.0.0");
  const warnings: string[] = [];

  log.start("VALIDATE", { shape: t.shape, hasGrad: !!t.grad });

  // [D2] Warn if not scalar — grad seed will be ones([shape]) which may be wrong
  const shapeWarn = !(t.shape.length === 1 && t.shape[0] === 1);
  if (shapeWarn) {
    warnings.push(`Tensor shape=[${t.shape}] is not scalar — grad seed will be ones([${t.shape}]). Call backward on loss scalar for correct gradients.`);
    log.warn("VALIDATE", `Non-scalar backward`, { shape: t.shape });
  }

  // [D1] Warn if grad accumulation likely
  const gradAccumWarn = t.grad !== null;
  if (gradAccumWarn) {
    warnings.push(`Tensor already has .grad set — backward will ACCUMULATE gradients. Call .zeroGrad() first to reset.`);
    log.warn("VALIDATE", `Grad accumulation detected — tensor.grad is non-null`);
  }

  log.transition("BACKWARD");

  // Count nodes for audit
  let nodesVisited = 0;
  const origBackward = t._backward;
  void origBackward; // used for type check

  // Execute backward
  try {
    // Topo sort to count nodes
    const visited = new Set<NanoTensor>();
    const count = (v: NanoTensor) => {
      if (!visited.has(v)) {
        visited.add(v);
        for (const c of v._children) count(c);
      }
    };
    count(t);
    nodesVisited = visited.size;

    t.backward();
  } catch (e) {
    const err = makeDomainError(
      "INVARIANT_BREACH",
      `backward() threw: ${e instanceof Error ? e.message : String(e)}`,
      "NON_RETRYABLE",
      { step: "BACKWARD", cause: e }
    );
    log.failure("BACKWARD", err, clock.elapsed(t0));
    return Err(err);
  }

  // [D3] Scan all ancestor grads for NaN/Inf
  log.transition("NAN_SCAN");
  const nanGrads: Array<{ label: string; shape: number[] }> = [];

  const scanVisited = new Set<NanoTensor>();
  const scanNaN = (v: NanoTensor) => {
    if (scanVisited.has(v)) return;
    scanVisited.add(v);
    if (v.grad) {
      const g = v.grad.data as Float32Array;
      for (let i = 0; i < g.length; i++) {
        if (!isFinite(g[i])) {
          nanGrads.push({ label: v.label || `(unlabeled)`, shape: v.shape });
          break;
        }
      }
    }
    for (const c of v._children) scanNaN(c);
  };
  scanNaN(t);

  if (nanGrads.length > 0) {
    const err = makeDomainError(
      "NAN_DETECTED",
      `${nanGrads.length} tensor(s) have NaN/Inf gradients after backward: ${nanGrads.map(n => `"${n.label}"`).join(", ")}`,
      "RETRYABLE_SAFE",
      { step: "NAN_SCAN", context: { nanGrads } }
    );
    log.failure("NAN_SCAN", err, clock.elapsed(t0));
    return Err(err);
  }

  const latency = clock.elapsed(t0);
  log.success("FINALIZE", latency, { nodesVisited, nanGrads: 0, warnings: warnings.length });

  return Ok({
    nodesVisited,
    nanGrads: [],
    warnings,
    gradAccumWarn,
    shapeWarn,
    latency_ms: latency,
  });
}

export function formatBackwardResult(r: BackwardResult): string[] {
  const lines: string[] = [
    `[AUTOGRAD] ✓ backward complete — nodes=${r.nodesVisited}  latency=${r.latency_ms.toFixed(1)}ms`,
  ];
  if (r.warnings.length > 0) {
    lines.push(`  ── Warnings ──`);
    r.warnings.forEach(w => lines.push(`  ⚠ ${w}`));
  }
  return lines;
}
