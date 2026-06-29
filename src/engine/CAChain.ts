// ============================================================
// CA CHAIN v1.0.0 — Contracted, Observable, Deterministic
// ChainName: ca.*
// Trigger:   CommandProcessor → cmdCA* → executeCAChain()
// Follows: Result<T,E>, StructuredLog, typed errors, audit trail
// ============================================================

import { Result, Ok, Err, DomainError, makeDomainError } from "./types";
import { makeLogger } from "./logger";
import { cryptoUUID } from "./determinism";
import {
  tokenize, detectLanguage, computeGridStats, gridToSource,
  GridStats, CellGrid, Language,
} from "./CASyntax";
import {
  evolve, buildDAG, entropyReductionPass, metacognitiveAudit,
  EvolutionResult, MetacognitiveReport, ThoughtDAG, EntropyReport,
} from "./CAEngine";

// ── Request DTO ────────────────────────────────────────────
export interface CARequest {
  source:          string;        // source code to analyze
  lang?:           Language;      // auto-detected if omitted
  maxGenerations?: number;        // default 8, max 64
  mode:            CAMode;        // what to do with the result
  correlationId?:  string;        // trace propagation
}

export type CAMode =
  | "analyze"    // tokenize + evolve + return stats (no edit)
  | "correct"    // analyze + apply corrections, return corrected source
  | "dag"        // analyze + return DAG structure
  | "audit"      // analyze + run metacognitive 5-stage audit
  | "step"       // single-step evolution, return grid state
  | "full";      // all of the above

// ── Result ─────────────────────────────────────────────────
export interface CAResult {
  correlationId:       string;
  mode:                CAMode;
  lang:                Language;
  originalSource:      string;
  correctedSource:     string | null;  // null if mode=analyze/dag
  generationsRun:      number;
  converged:           boolean;
  statsPerGeneration:  GridStats[];
  finalStats:          GridStats;
  entropyReport:       EntropyReport;
  dag:                 ThoughtDAG | null;
  metacogReport:       MetacognitiveReport | null;
  auditTrail:          string[];
  latency_ms:          number;
  // Formatted display lines for terminal
  displayLines:        string[];
}



// ── Boundary invariants ────────────────────────────────────
const MAX_SOURCE_BYTES = 50 * 1024;   // 50KB [B1]
const MIN_SOURCE_LEN   = 1;
const VALID_LANGS      = new Set<Language>(["python", "js", "html", "css", "unknown"]);
const MAX_GENERATIONS  = 64;

function validateCARequest(req: CARequest): DomainError | null {
  if (!req.source || req.source.trim().length < MIN_SOURCE_LEN) {
    return makeDomainError("INVALID_INPUT", "Source is empty", "NON_RETRYABLE", { step: "VALIDATE" });
  }
  if (new TextEncoder().encode(req.source).length > MAX_SOURCE_BYTES) {
    return makeDomainError("INVALID_INPUT", `Source exceeds ${MAX_SOURCE_BYTES / 1024}KB limit`, "NON_RETRYABLE", { step: "VALIDATE" });
  }
  if (req.lang && !VALID_LANGS.has(req.lang)) {
    return makeDomainError("INVALID_INPUT", `Invalid lang '${req.lang}'. Must be: python|js|html|css|unknown`, "NON_RETRYABLE", { step: "VALIDATE" });
  }
  const gens = req.maxGenerations ?? 8;
  if (gens < 1 || gens > MAX_GENERATIONS || !Number.isInteger(gens)) {
    return makeDomainError("INVALID_INPUT", `maxGenerations must be integer ∈ [1, ${MAX_GENERATIONS}]`, "NON_RETRYABLE", { step: "VALIDATE" });
  }
  if (!["analyze", "correct", "dag", "audit", "step", "full"].includes(req.mode)) {
    return makeDomainError("INVALID_INPUT", `Invalid mode '${req.mode}'`, "NON_RETRYABLE", { step: "VALIDATE" });
  }
  return null;
}

// ════════════════════════════════════════════════════════════
// MAIN CHAIN — executeCAChain
// ════════════════════════════════════════════════════════════

export function executeCAChain(
  req: CARequest,
  correlationId?: string
): Result<CAResult, DomainError> {
  const corrId = correlationId ?? req.correlationId ?? cryptoUUID.generate();
  const log = makeLogger(corrId, "ca.chain", "1.0.0");
  const t0 = performance.now();

  // ── Step 1: VALIDATE ──────────────────────────────────────
  log.start("VALIDATE", { mode: req.mode, sourceLen: req.source?.length });

  const validErr = validateCARequest(req);
  if (validErr) {
    log.failure("VALIDATE", validErr, performance.now() - t0);
    return Err(validErr);
  }
  log.transition("VALIDATE_OK");

  // ── Step 2: TOKENIZE ──────────────────────────────────────
  log.transition("TOKENIZE", { lang: req.lang ?? "auto" });

  let grid: CellGrid;
  let tokenErrors: string[];
  try {
    const result = tokenize(req.source, req.lang);
    grid = result.grid;
    tokenErrors = result.errors;
  } catch (e: unknown) {
    const err = makeDomainError("STATE_CORRUPTION", `Tokenize failed: ${e instanceof Error ? e.message : String(e)}`, "NON_RETRYABLE", { step: "TOKENIZE", cause: e });
    log.failure("TOKENIZE", err, performance.now() - t0);
    return Err(err);
  }

  if (grid.cells.length === 0) {
    const err = makeDomainError("INVALID_INPUT", "Source produced zero cells after tokenization", "NON_RETRYABLE", { step: "TOKENIZE" });
    log.failure("TOKENIZE", err, performance.now() - t0);
    return Err(err);
  }

  const lang = grid.lang;
  log.transition("TOKENIZE_OK", { cells: grid.cells.length, lang, tokenErrors: tokenErrors.length });

  // ── Step 3: EVOLVE ─────────────────────────────────────────
  const maxGenerations = req.mode === "step" ? 1 : (req.maxGenerations ?? 8);
  log.transition("EVOLVE", { maxGenerations });

  let evolutionResult: EvolutionResult;
  try {
    evolutionResult = evolve(grid, maxGenerations);
  } catch (e: unknown) {
    const err = makeDomainError("STATE_CORRUPTION", `Evolution failed: ${e instanceof Error ? e.message : String(e)}`, "RETRYABLE_SAFE", { step: "EVOLVE", cause: e });
    log.failure("EVOLVE", err, performance.now() - t0);
    return Err(err);
  }

  log.transition("EVOLVE_OK", {
    generations: evolutionResult.generations,
    converged: evolutionResult.converged,
    corrections: evolutionResult.entropyReport.corrections.length,
  });

  // ── Step 4: DAG ────────────────────────────────────────────
  let dag: ThoughtDAG | null = null;
  if (req.mode === "dag" || req.mode === "audit" || req.mode === "full") {
    log.transition("BUILD_DAG");
    dag = evolutionResult.dag;
    log.transition("DAG_OK", { nodes: dag.nodes.size, hasCycle: dag.hasCycle });
  }

  // ── Step 5: METACOGNITIVE AUDIT ───────────────────────────
  let metacogReport: MetacognitiveReport | null = null;
  if (req.mode === "audit" || req.mode === "full") {
    log.transition("METACOG_AUDIT");
    try {
      metacogReport = metacognitiveAudit(evolutionResult);
    } catch (e: unknown) {
      log.warn("METACOG_AUDIT", `Audit failed (non-fatal): ${e instanceof Error ? e.message : String(e)}`);
    }
    if (metacogReport) {
      log.transition("METACOG_OK", { overallScore: metacogReport.overallScore });
    }
  }

  // ── Step 6: CORRECTED SOURCE ───────────────────────────────
  let correctedSource: string | null = null;
  if (req.mode === "correct" || req.mode === "full") {
    log.transition("APPLY_CORRECTIONS");
    correctedSource = gridToSource(evolutionResult.grid);
    log.transition("CORRECTIONS_OK", { chars: correctedSource.length });
  }

  // ── Step 7: FINALIZE ───────────────────────────────────────
  const finalStats = computeGridStats(evolutionResult.grid);
  const latency_ms = performance.now() - t0;

  log.success("FINALIZE", latency_ms, {
    alive: finalStats.alive,
    error: finalStats.error,
    entropy: finalStats.avgEntropy,
    converged: finalStats.converged,
  });

  // ── Format display lines for terminal ─────────────────────
  const displayLines = formatCAResult(
    evolutionResult, dag, metacogReport, correctedSource, lang, corrId, latency_ms
  );

  const caResult: CAResult = {
    correlationId:      corrId,
    mode:               req.mode,
    lang,
    originalSource:     req.source,
    correctedSource,
    generationsRun:     evolutionResult.generations,
    converged:          evolutionResult.converged,
    statsPerGeneration: evolutionResult.stats,
    finalStats,
    entropyReport:      evolutionResult.entropyReport,
    dag,
    metacogReport,
    auditTrail:         evolutionResult.auditLog,
    latency_ms,
    displayLines,
  };

  return Ok(caResult);
}

// ════════════════════════════════════════════════════════════
// DISPLAY FORMATTER — terminal output lines
// ════════════════════════════════════════════════════════════

function formatCAResult(
  ev: EvolutionResult,
  dag: ThoughtDAG | null,
  meta: MetacognitiveReport | null,
  corrected: string | null,
  lang: Language,
  corrId: string,
  latency_ms: number
): string[] {
  const lines: string[] = [];
  const stats = computeGridStats(ev.grid);

  lines.push(`[CA] ══════════════════════════════════════════════`);
  lines.push(`[CA] Cellular Syntax Automaton v1.0.0`);
  lines.push(`[CA] corr=${corrId.slice(0, 8)} lang=${lang} elapsed=${latency_ms.toFixed(1)}ms`);
  lines.push(`[CA] ──────────────────────────────────────────────`);

  // Grid stats
  lines.push(`[CA] CELL POPULATION`);
  lines.push(`[CA]   Total cells   : ${stats.totalCells}`);
  lines.push(`[CA]   Alive         : ${stats.alive}  ${"█".repeat(Math.round(stats.alive / Math.max(stats.totalCells, 1) * 20))}${" ".repeat(Math.max(0, 20 - Math.round(stats.alive / Math.max(stats.totalCells, 1) * 20)))}`);
  lines.push(`[CA]   Error         : ${stats.error}  ${"█".repeat(Math.min(20, stats.error))} ${stats.error > 0 ? "⚠" : "✓"}`);
  lines.push(`[CA]   Mutating      : ${stats.mutating}`);
  lines.push(`[CA]   Dead          : ${stats.dead}`);
  lines.push(`[CA]   Avg Entropy   : ${stats.avgEntropy.toFixed(4)}  ${entropyBar(stats.avgEntropy)}`);
  lines.push(`[CA]   Avg Confidence: ${stats.avgConfidence.toFixed(4)}`);
  lines.push(`[CA]   Generations   : ${ev.generations}`);
  lines.push(`[CA]   Converged     : ${ev.converged ? "✓ YES" : "✗ NOT YET"}`);

  // Entropy evolution
  if (ev.stats.length > 0) {
    lines.push(`[CA] ──────────────────────────────────────────────`);
    lines.push(`[CA] ENTROPY EVOLUTION`);
    ev.stats.forEach((s, g) => {
      const bar = entropyBar(s.avgEntropy);
      lines.push(`[CA]   G${String(g + 1).padStart(2)}: ${s.avgEntropy.toFixed(4)} ${bar}`);
    });
  }

  // Entropy reduction report
  const er = ev.entropyReport;
  lines.push(`[CA] ──────────────────────────────────────────────`);
  lines.push(`[CA] ENTROPY REDUCTION PASS`);
  lines.push(`[CA]   Before: ${er.before.toFixed(4)}  After: ${er.after.toFixed(4)}  Δ: -${er.delta.toFixed(4)}`);
  if (er.corrections.length > 0) {
    lines.push(`[CA]   Corrections (${er.corrections.length}):`);
    er.corrections.slice(0, 10).forEach(c => {
      lines.push(`[CA]     cell#${c.cellId}: "${c.from}" → "${c.to}"`);
    });
    if (er.corrections.length > 10) {
      lines.push(`[CA]     ... ${er.corrections.length - 10} more corrections`);
    }
  } else {
    lines.push(`[CA]   No corrections needed ✓`);
  }

  // DAG report
  if (dag) {
    const maxDepth = Math.max(...[...dag.nodes.values()].map(n => n.dagDepth), 0);
    const avgConf = [...dag.nodes.values()].reduce((s, n) => s + n.mergedConfidence, 0) / Math.max(dag.nodes.size, 1);
    lines.push(`[CA] ──────────────────────────────────────────────`);
    lines.push(`[CA] GRAPH-OF-THOUGHTS (DAG)`);
    lines.push(`[CA]   Nodes         : ${dag.nodes.size}`);
    lines.push(`[CA]   Max Depth     : ${maxDepth}`);
    lines.push(`[CA]   Has Cycle     : ${dag.hasCycle ? "⚠ YES — DAG invariant breach" : "✓ NO"}`);
    lines.push(`[CA]   Merged Conf.  : ${avgConf.toFixed(4)} (thought-merged)`);
    lines.push(`[CA]   Language      : ${dag.lang}`);

    // Top nodes by depth
    const topNodes = [...dag.nodes.values()]
      .filter(n => n.dagDepth >= maxDepth - 1 && n.type !== "WHITESPACE")
      .slice(0, 5);
    if (topNodes.length > 0) {
      lines.push(`[CA]   Deep nodes:`);
      topNodes.forEach(n => {
        lines.push(`[CA]     depth=${n.dagDepth} cell#${n.cellId} "${n.token}" [${n.type}] conf=${n.mergedConfidence.toFixed(3)}`);
      });
    }
  }

  // Metacognitive audit
  if (meta) {
    lines.push(`[CA] ──────────────────────────────────────────────`);
    lines.push(`[CA] METACOGNITIVE AUDIT (5-Stage)`);
    lines.push(`[CA]   Stage 1 UNDERSTAND : ${meta.stage1_understand.valid ? "✓" : "✗"} ${meta.stage1_understand.notes[0]}`);
    lines.push(`[CA]   Stage 2 JUDGE      : ${meta.stage2_judge.converges ? "✓ CONVERGES" : "✗ DRIFTS"} drift=${(meta.stage2_judge.driftRisk * 100).toFixed(1)}%`);
    if (meta.stage3_critique.tornWriteRisks.length === 0) {
      lines.push(`[CA]   Stage 3 CRITIQUE   : ✓ No torn-write risks`);
    } else {
      lines.push(`[CA]   Stage 3 CRITIQUE   : ⚠ ${meta.stage3_critique.tornWriteRisks.length} torn-write risk(s)`);
      meta.stage3_critique.tornWriteRisks.slice(0, 3).forEach(r => {
        lines.push(`[CA]     ↳ ${r}`);
      });
    }
    lines.push(`[CA]   Stage 4 FINALIZE   : ${meta.stage4_finalize.hardened ? "✓ HARDENED" : "⚠ RISKS REMAIN"} corrections=${meta.stage4_finalize.corrections}`);
    lines.push(`[CA]   Stage 5 CALIBRATE  : confidence=${meta.stage5_calibrate.confidence}% exactly-once=${meta.stage5_calibrate.exactOnceScore}%`);
    lines.push(`[CA]   Overall Score      : ${meta.overallScore}/100`);
  }

  // Corrected source
  if (corrected !== null) {
    lines.push(`[CA] ──────────────────────────────────────────────`);
    lines.push(`[CA] CORRECTED SOURCE (${corrected.length} chars):`);
    corrected.split("\n").slice(0, 20).forEach((l, i) => {
      lines.push(`[CA]   ${String(i + 1).padStart(3)} │ ${l}`);
    });
    if (corrected.split("\n").length > 20) {
      lines.push(`[CA]   ... ${corrected.split("\n").length - 20} more lines`);
    }
  }

  lines.push(`[CA] ══════════════════════════════════════════════`);
  return lines;
}

function entropyBar(entropy: number): string {
  const filled = Math.round(entropy * 20);
  const empty  = 20 - filled;
  return `[${"█".repeat(filled)}${"░".repeat(empty)}] ${(entropy * 100).toFixed(1)}%`;
}

// ════════════════════════════════════════════════════════════
// CELL GRID DISPLAY — render the living cell grid to terminal
// ════════════════════════════════════════════════════════════

export function formatCellGrid(grid: CellGrid, maxLines = 30): string[] {
  const lines: string[] = [];
  const stateSymbol: Record<string, string> = {
    ALIVE: "●", DEAD: "○", MUTATING: "◉", ERROR: "✗", ORPHAN: "◌",
  };
  const typeSymbol: Record<string, string> = {
    KEYWORD: "K", IDENTIFIER: "I", OPERATOR: "O", DELIMITER: "D",
    LITERAL: "L", WHITESPACE: " ", COMMENT: "C", UNKNOWN: "?",
  };

  lines.push(`[CA] Cell Grid — G${grid.generation} (${grid.lang})`);
  lines.push(`[CA] Legend: ● ALIVE  ○ DEAD  ◉ MUTATING  ✗ ERROR  ◌ ORPHAN`);
  lines.push(`[CA] Types:  K=Keyword I=Identifier O=Operator D=Delimiter L=Literal C=Comment`);
  lines.push(`[CA] ─────────────────────────────────────────────`);

  let lineCount = 0;
  for (let row = 0; row < grid.lineMap.length && lineCount < maxLines; row++) {
    const rowCells = grid.lineMap[row].map(id => grid.cells[id]).filter(Boolean);
    if (rowCells.length === 0) continue;

    let rowStr = `[CA] ${String(row + 1).padStart(3)} │ `;
    for (const cell of rowCells) {
      if (cell.type === "WHITESPACE") {
        rowStr += cell.token.replace(/[^\n]/g, " ");
        continue;
      }
      const sym = stateSymbol[cell.state] ?? "?";
      const typ = typeSymbol[cell.type] ?? "?";
      rowStr += `${sym}${typ}[${cell.token.slice(0, 8)}] `;
    }
    lines.push(rowStr.trimEnd());
    lineCount++;
  }

  if (grid.lineMap.length > maxLines) {
    lines.push(`[CA] ... ${grid.lineMap.length - maxLines} more lines`);
  }
  return lines;
}

// ── Canonical chain error formatter ───────────────────────
export function formatCAError(err: DomainError): string[] {
  return [
    `[CA ERROR] ${err.code}: ${err.message}`,
    `  retry: ${err.retryClass}`,
    ...(err.step ? [`  step: ${err.step}`] : []),
  ];
}

// ── Export for CommandProcessor ────────────────────────────
export {
  detectLanguage,
  tokenize,
  evolve,
  buildDAG,
  entropyReductionPass,
  metacognitiveAudit,
  computeGridStats,
  gridToSource,
};
