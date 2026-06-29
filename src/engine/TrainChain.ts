// ============================================================
// TRAIN CHAIN — v2.0.0
// Chain Contract: net.train end-to-end
//
// State Machine:
//   VALIDATE_INPUTS → CHECK_SHAPES → CHECK_IDEMPOTENCY →
//   [per epoch]:
//     ZERO_GRADIENTS → FORWARD_PASS → COMPUTE_LOSS →
//     GUARD_NAN → BACKWARD_PASS → CLIP_GRADIENTS →
//     OPTIMIZER_STEP → RECORD_SNAPSHOT
//   → FINALIZE
//
// Invariants:
//   [D1] No NaN/Inf may propagate past GUARD_NAN
//   [D2] Gradient norm must not exceed maxGradNorm after clipping
//   [D3] lossHistory must reflect exactly epochsCompleted entries appended
//   [D4] Optimizer step count must equal epochsCompleted after training
//   [D5] On any failure: no partial lossHistory entries remain beyond last clean epoch
//   [B1] networkName, xTensorName, yTensorName, optimizerName must exist
//   [B2] X.shape[1] must equal network input dimension
//   [B3] Y.shape[0] must equal X.shape[0]
//   [I1] idempotency_key deduplicated per session — same key = cached result
//
// Failure Semantics:
//   NON_RETRYABLE:     INVALID_INPUT, SHAPE_MISMATCH, MISSING_ENTITY
//   RETRYABLE_SAFE:    TRANSIENT_FAILURE (infra)
//   RETRYABLE_SAFE:    NAN_DETECTED after rollback (weights restored from snapshot)
// ============================================================

import { NanoTensor } from "./NanoTensor";
import type { MLP } from "./NeuralNetwork";
import type { Adam } from "./Adam";
import type { TerminalState } from "./CommandProcessor";
import type {
  TrainRequest,
  TrainResult,
  EpochSnapshot,
  TrainStep,
  Result,
  DomainError,
} from "./types";
import {
  Ok,
  Err,
  makeDomainError,
  makeIdempotencyKey,
} from "./types";
import { makeLogger } from "./logger";
import { realClock } from "./determinism";
import type { ClockProvider } from "./determinism";

// ── Idempotency Cache (session-scoped) ────────────────────
const _resultCache = new Map<string, TrainResult>();

export function clearTrainCache(): void {
  _resultCache.clear();
}

// ── Parameter Snapshot (for rollback) ────────────────────
interface ParamSnapshot {
  data: Float32Array[];
}

function snapshotParams(net: MLP): ParamSnapshot {
  return {
    data: net.params().map(p => new Float32Array(p.data as Float32Array)),
  };
}

function restoreParams(net: MLP, snap: ParamSnapshot): void {
  const params = net.params();
  for (let i = 0; i < params.length; i++) {
    (params[i].data as Float32Array).set(snap.data[i]);
  }
}

// ── NaN/Inf Guard ─────────────────────────────────────────
function hasNaN(t: NanoTensor): boolean {
  const d = t.data as Float32Array;
  for (let i = 0; i < d.length; i++) {
    if (!isFinite(d[i])) return true;
  }
  return false;
}

function hasNaNInParams(net: MLP): boolean {
  return net.params().some(hasNaN);
}

// ── Gradient Norm Calculation ─────────────────────────────
function computeGradNorm(net: MLP): number {
  let sq = 0;
  for (const p of net.params()) {
    if (!p.grad) continue;
    const g = p.grad.data as Float32Array;
    for (let i = 0; i < g.length; i++) sq += g[i] * g[i];
  }
  return Math.sqrt(sq);
}

// ── Gradient Clipping (global norm clip) ─────────────────
function clipGradients(net: MLP, maxNorm: number): number {
  const norm = computeGradNorm(net);
  if (norm > maxNorm) {
    const scale = maxNorm / (norm + 1e-8);
    for (const p of net.params()) {
      if (!p.grad) continue;
      const g = p.grad.data as Float32Array;
      for (let i = 0; i < g.length; i++) g[i] *= scale;
    }
    return norm; // return pre-clip norm
  }
  return norm;
}

// ── Param Norm ────────────────────────────────────────────
function computeParamNorm(net: MLP): number {
  let sq = 0;
  for (const p of net.params()) {
    const d = p.data as Float32Array;
    for (let i = 0; i < d.length; i++) sq += d[i] * d[i];
  }
  return Math.sqrt(sq);
}

// ── Shape Validation ──────────────────────────────────────
function validateShapes(
  net: MLP,
  X: NanoTensor,
  Y: NanoTensor
): DomainError | null {
  if (X.shape.length < 2) {
    return makeDomainError(
      "SHAPE_MISMATCH",
      `X must be 2D [batch, features], got shape=[${X.shape}]`,
      "NON_RETRYABLE",
      { step: "CHECK_SHAPES" }
    );
  }
  if (Y.shape.length < 1) {
    return makeDomainError(
      "SHAPE_MISMATCH",
      `Y must be at least 1D, got shape=[${Y.shape}]`,
      "NON_RETRYABLE",
      { step: "CHECK_SHAPES" }
    );
  }
  const batchX = X.shape[0];
  const batchY = Y.shape[0];
  if (batchX !== batchY) {
    return makeDomainError(
      "SHAPE_MISMATCH",
      `Batch size mismatch: X.shape[0]=${batchX} != Y.shape[0]=${batchY}`,
      "NON_RETRYABLE",
      { step: "CHECK_SHAPES" }
    );
  }
  const inFeatures = X.shape[1];
  const expectedIn = net.layers[0]?.inF ?? -1;
  if (inFeatures !== expectedIn) {
    return makeDomainError(
      "SHAPE_MISMATCH",
      `X.shape[1]=${inFeatures} but network expects inFeatures=${expectedIn}`,
      "NON_RETRYABLE",
      { step: "CHECK_SHAPES" }
    );
  }
  return null;
}

// ── Main Chain Entry Point ────────────────────────────────
export function executeTrainChain(
  req: TrainRequest,
  state: TerminalState,
  correlationId: string,
  clock: ClockProvider = realClock
): Result<TrainResult, DomainError> {
  const chainStart = clock.mark();
  const log = makeLogger(correlationId, "net.train", "2.0.0");
  const auditTrail: string[] = [];
  const audit = (msg: string) => {
    auditTrail.push(`[${clock.now().toFixed(1)}ms] ${msg}`);
  };

  const iKey = req.idempotencyKey ??
    makeIdempotencyKey({
      networkName: req.networkName,
      xTensorName: req.xTensorName,
      yTensorName: req.yTensorName,
      optimizerName: req.optimizerName,
      epochs: req.epochs,
    });

  // ─────────────────────────────────────────────────────────
  // STEP: VALIDATE_INPUTS
  // ─────────────────────────────────────────────────────────
  const step0: TrainStep = "VALIDATE_INPUTS";
  log.start(step0, {
    correlation_id: correlationId,
    idempotency_key: iKey,
    networkName: req.networkName,
    epochs: req.epochs,
  });
  audit(`START ${step0}`);

  if (!req.networkName || !req.xTensorName || !req.yTensorName || !req.optimizerName) {
    const err = makeDomainError(
      "INVALID_INPUT",
      "networkName, xTensorName, yTensorName, optimizerName are all required",
      "NON_RETRYABLE",
      { step: step0 }
    );
    log.failure(step0, err, clock.elapsed(chainStart));
    return Err(err);
  }

  if (!Number.isInteger(req.epochs) || req.epochs < 1 || req.epochs > 100_000) {
    const err = makeDomainError(
      "INVALID_INPUT",
      `epochs must be integer in [1, 100000], got: ${req.epochs}`,
      "NON_RETRYABLE",
      { step: step0 }
    );
    log.failure(step0, err, clock.elapsed(chainStart));
    return Err(err);
  }

  const net: MLP | undefined = state.networks.get(req.networkName);
  const X: NanoTensor | undefined = state.tensors.get(req.xTensorName);
  const Y: NanoTensor | undefined = state.tensors.get(req.yTensorName);
  const opt: Adam | undefined = state.optimizers.get(req.optimizerName);

  if (!net) {
    const err = makeDomainError(
      "MISSING_ENTITY",
      `Network '${req.networkName}' not found`,
      "NON_RETRYABLE",
      { step: step0 }
    );
    log.failure(step0, err, clock.elapsed(chainStart));
    return Err(err);
  }
  if (!X) {
    const err = makeDomainError(
      "MISSING_ENTITY",
      `Tensor '${req.xTensorName}' not found`,
      "NON_RETRYABLE",
      { step: step0 }
    );
    log.failure(step0, err, clock.elapsed(chainStart));
    return Err(err);
  }
  if (!Y) {
    const err = makeDomainError(
      "MISSING_ENTITY",
      `Tensor '${req.yTensorName}' not found`,
      "NON_RETRYABLE",
      { step: step0 }
    );
    log.failure(step0, err, clock.elapsed(chainStart));
    return Err(err);
  }
  if (!opt) {
    const err = makeDomainError(
      "MISSING_ENTITY",
      `Optimizer '${req.optimizerName}' not found`,
      "NON_RETRYABLE",
      { step: step0 }
    );
    log.failure(step0, err, clock.elapsed(chainStart));
    return Err(err);
  }

  log.transition("CHECK_SHAPES");
  audit("TRANSITION → CHECK_SHAPES");

  // ─────────────────────────────────────────────────────────
  // STEP: CHECK_SHAPES [B2, B3]
  // ─────────────────────────────────────────────────────────
  const shapeError = validateShapes(net, X, Y);
  if (shapeError) {
    log.failure("CHECK_SHAPES", shapeError, clock.elapsed(chainStart));
    return Err(shapeError);
  }

  log.transition("CHECK_IDEMPOTENCY");
  audit("TRANSITION → CHECK_IDEMPOTENCY");

  // ─────────────────────────────────────────────────────────
  // STEP: CHECK_IDEMPOTENCY [I1]
  // ─────────────────────────────────────────────────────────
  if (_resultCache.has(iKey)) {
    const cached = _resultCache.get(iKey)!;
    audit(`IDEMPOTENCY HIT key=${iKey}`);
    log.success("CHECK_IDEMPOTENCY", clock.elapsed(chainStart), {
      cached: true,
      idempotency_key: iKey,
    });
    // Return cached result — no side effects
    return Ok({ ...cached, auditTrail: [...cached.auditTrail, `[REPLAY] idempotency_key=${iKey}`] });
  }

  // ─────────────────────────────────────────────────────────
  // Snapshot params BEFORE training begins — rollback anchor
  // ─────────────────────────────────────────────────────────
  const paramSnap = snapshotParams(net);
  const lossHistoryLenBefore = net.lossHistory.length;
  const optStepBefore = opt.t;
  audit(`SNAPSHOT params lossHistoryLen=${lossHistoryLenBefore} optStep=${optStepBefore}`);

  // ─────────────────────────────────────────────────────────
  // TRAINING LOOP
  // ─────────────────────────────────────────────────────────
  const maxGradNorm = req.maxGradNorm ?? 10.0;
  const logEveryN = req.logEveryN ?? Math.max(1, Math.floor(req.epochs / 10));
  const snapshots: EpochSnapshot[] = [];
  let epochsCompleted = 0;
  let initialLoss = 0;
  let finalLoss = 0;
  let didNaN = false;

  for (let epoch = 0; epoch < req.epochs; epoch++) {
    const epochStart = clock.mark();

    // STEP: ZERO_GRADIENTS
    log.transition("ZERO_GRADIENTS", { epoch });
    opt.zeroGrad();

    // STEP: FORWARD_PASS
    log.transition("FORWARD_PASS", { epoch });
    let pred: NanoTensor;
    try {
      pred = net.forward(X);
    } catch (e) {
      // Rollback: restore params, trim lossHistory to pre-training length
      restoreParams(net, paramSnap);
      net.lossHistory.length = lossHistoryLenBefore;
      opt.t = optStepBefore;
      const err = makeDomainError(
        "INVARIANT_BREACH",
        `Forward pass threw at epoch ${epoch}: ${e instanceof Error ? e.message : String(e)}`,
        "NON_RETRYABLE",
        { step: "FORWARD_PASS", cause: e }
      );
      log.failure("FORWARD_PASS", err, clock.elapsed(chainStart));
      audit(`ROLLBACK epoch=${epoch} reason=forward_throw`);
      return Err(err);
    }

    // STEP: COMPUTE_LOSS
    log.transition("COMPUTE_LOSS", { epoch });
    const loss = pred.mseLoss(Y);
    const lossVal = loss.data[0] as number;

    if (epoch === 0) initialLoss = lossVal;

    // STEP: GUARD_NAN [D1]
    if (!isFinite(lossVal)) {
      restoreParams(net, paramSnap);
      net.lossHistory.length = lossHistoryLenBefore;
      opt.t = optStepBefore;
      didNaN = true;
      const err = makeDomainError(
        "NAN_DETECTED",
        `Loss is ${lossVal} at epoch ${epoch}. Params rolled back to pre-training snapshot.`,
        "RETRYABLE_SAFE",
        { step: "GUARD_NAN", context: { epoch, lossVal } }
      );
      log.failure("GUARD_NAN", err, clock.elapsed(chainStart));
      audit(`ROLLBACK epoch=${epoch} reason=NaN loss=${lossVal}`);
      return Err(err);
    }

    // STEP: BACKWARD_PASS
    log.transition("BACKWARD_PASS", { epoch });
    loss.backward();

    // STEP: CLIP_GRADIENTS [D2]
    const rawGradNorm = clipGradients(net, maxGradNorm);
    if (!isFinite(rawGradNorm)) {
      restoreParams(net, paramSnap);
      net.lossHistory.length = lossHistoryLenBefore;
      opt.t = optStepBefore;
      didNaN = true;
      const err = makeDomainError(
        "GRADIENT_EXPLOSION",
        `Gradient norm is ${rawGradNorm} at epoch ${epoch}. Rolled back.`,
        "RETRYABLE_SAFE",
        { step: "CLIP_GRADIENTS", context: { epoch, rawGradNorm } }
      );
      log.failure("CLIP_GRADIENTS", err, clock.elapsed(chainStart));
      audit(`ROLLBACK epoch=${epoch} reason=grad_explosion gradNorm=${rawGradNorm}`);
      return Err(err);
    }

    if (rawGradNorm > maxGradNorm) {
      log.warn("CLIP_GRADIENTS", `Clipped gradient norm ${rawGradNorm.toFixed(4)} → ${maxGradNorm}`, { epoch });
      audit(`CLIP epoch=${epoch} preNorm=${rawGradNorm.toFixed(4)}`);
    }

    // STEP: OPTIMIZER_STEP
    log.transition("OPTIMIZER_STEP", { epoch });
    opt.step();

    // Guard: NaN in params post-step [D1]
    if (hasNaNInParams(net)) {
      restoreParams(net, paramSnap);
      net.lossHistory.length = lossHistoryLenBefore;
      opt.t = optStepBefore;
      didNaN = true;
      const err = makeDomainError(
        "NAN_DETECTED",
        `NaN detected in network parameters after optimizer step at epoch ${epoch}. Rolled back.`,
        "RETRYABLE_SAFE",
        { step: "OPTIMIZER_STEP", context: { epoch } }
      );
      log.failure("OPTIMIZER_STEP", err, clock.elapsed(chainStart));
      audit(`ROLLBACK epoch=${epoch} reason=NaN_in_params`);
      return Err(err);
    }

    // STEP: RECORD_SNAPSHOT [D3]
    const paramNorm = computeParamNorm(net);
    const gradNorm = computeGradNorm(net); // post-clip norm
    finalLoss = lossVal;
    epochsCompleted++;

    // [D3] lossHistory append — atomic with epochsCompleted increment
    net.lossHistory.push(lossVal);

    const snap: EpochSnapshot = {
      epoch,
      loss: lossVal,
      gradNorm,
      paramNorm,
      isNaN: false,
    };

    if (epoch % logEveryN === 0 || epoch === req.epochs - 1) {
      snapshots.push(snap);
      log.transition("RECORD_SNAPSHOT", {
        epoch,
        loss: lossVal.toFixed(6),
        gradNorm: gradNorm.toFixed(4),
        paramNorm: paramNorm.toFixed(4),
        latency_epoch_ms: clock.elapsed(epochStart).toFixed(2),
      });
      audit(`EPOCH=${epoch} loss=${lossVal.toFixed(6)} gradNorm=${gradNorm.toFixed(4)} paramNorm=${paramNorm.toFixed(4)}`);
    }
  }

  // ─────────────────────────────────────────────────────────
  // STEP: FINALIZE
  // ─────────────────────────────────────────────────────────
  const totalLatency = clock.elapsed(chainStart);
  const improvement = initialLoss > 0
    ? (initialLoss - finalLoss) / initialLoss
    : 0;
  const didConverge = improvement > 0.01 && finalLoss < 0.01;

  audit(`FINALIZE epochsCompleted=${epochsCompleted} improvement=${(improvement*100).toFixed(2)}% finalLoss=${finalLoss.toFixed(6)}`);

  // [D4] Invariant check: optimizer step count must equal epochs completed
  const expectedOptStep = optStepBefore + epochsCompleted;
  if (opt.t !== expectedOptStep) {
    // Non-fatal — audit only (optimizer may have been externally stepped)
    log.warn("FINALIZE", `Optimizer step count ${opt.t} != expected ${expectedOptStep}`, {
      optStepBefore,
      epochsCompleted,
    });
    audit(`WARN opt.t=${opt.t} expected=${expectedOptStep}`);
  }

  const result: TrainResult = {
    networkName: req.networkName,
    epochsCompleted,
    epochsRequested: req.epochs,
    initialLoss,
    finalLoss,
    improvement,
    snapshots,
    didConverge,
    didNaN,
    idempotencyKey: iKey,
    correlation_id: correlationId,
    latency_ms: totalLatency,
    auditTrail,
  };

  // Cache for idempotency [I1]
  _resultCache.set(iKey, result);

  log.success("FINALIZE", totalLatency, {
    epochsCompleted,
    finalLoss: finalLoss.toFixed(6),
    improvement: (improvement * 100).toFixed(2) + "%",
    didConverge,
    idempotency_key: iKey,
  });

  return Ok(result);
}

// ── Format TrainResult for terminal display ───────────────
export function formatTrainResult(r: TrainResult): string[] {
  const lines: string[] = [];

  lines.push(`[TRAIN] ✓ ${r.networkName} — ${r.epochsCompleted}/${r.epochsRequested} epochs`);
  lines.push(`  corr_id    : ${r.correlation_id.slice(0, 8)}...`);
  lines.push(`  idem_key   : ${r.idempotencyKey.slice(0, 48)}...`);
  lines.push(`  latency    : ${r.latency_ms.toFixed(1)}ms`);
  lines.push(`  loss       : ${r.initialLoss.toFixed(6)} → ${r.finalLoss.toFixed(6)}`);
  lines.push(`  improvement: ${(r.improvement * 100).toFixed(2)}%`);
  lines.push(`  converged  : ${r.didConverge ? "✓ YES" : "✗ NO"}`);
  lines.push(`  nan_abort  : ${r.didNaN ? "✗ YES (rolled back)" : "✓ clean"}`);
  lines.push(`  ── Epoch Snapshots ──`);

  for (const s of r.snapshots) {
    const bar = buildLossBar(s.loss, r.initialLoss);
    lines.push(
      `  epoch ${String(s.epoch).padStart(5)}: loss=${s.loss.toFixed(6)}  gNorm=${s.gradNorm.toFixed(4)}  pNorm=${s.paramNorm.toFixed(4)}  ${bar}`
    );
  }

  lines.push(`  ── Audit Trail ──`);
  for (const a of r.auditTrail) {
    lines.push(`  ${a}`);
  }

  return lines;
}

function buildLossBar(loss: number, initialLoss: number): string {
  if (initialLoss <= 0) return "";
  const progress = Math.max(0, Math.min(1, 1 - loss / initialLoss));
  const filled = Math.round(progress * 20);
  return "▓".repeat(filled) + "░".repeat(20 - filled);
}

// ── Format error for terminal display ────────────────────
export function formatTrainError(err: DomainError): string[] {
  return [
    `[ERROR] [${err.code}] ${err.message}`,
    `  retry_class: ${err.retryClass}`,
    `  step       : ${err.step ?? "unknown"}`,
    ...(err.context ? [`  context    : ${JSON.stringify(err.context)}`] : []),
  ];
}
