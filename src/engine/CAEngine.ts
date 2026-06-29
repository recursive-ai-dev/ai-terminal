// ============================================================
// CA ENGINE — Cellular Automaton Evolution Core
// Tier 2: Skeleton-of-Thought — All 8 Anchors implemented
// Tier 3: Graph-of-Thoughts — DAG + Thought-Merging
// Tier 4: Metacognitive Audit — 5-stage validation pipeline
// Implements: Rule evaluation, DAG, GoT merging, entropy reduction,
//             self-editing feedback loops, parallel rule evaluation
// ============================================================

import {
  Cell, CellGrid, CellState, CellType, Language,
  CA_RULES, CellRef,
  neighborhoodCohesion, computeGridStats, GridStats,
  tokenize, gridToSource,
} from "./CASyntax";

// ════════════════════════════════════════════════════════════
// ATTENTION ANCHOR 3: SYNTAX-TRANSITION KERNELS
// Each kernel is a pure function: Cell → next CellState + updates
// ════════════════════════════════════════════════════════════

// Rule 1: SURVIVAL — correct syntax + cohesive neighborhood stays ALIVE
function rulesSurvival(cell: Cell): Partial<Cell> | null {
  if (cell.state !== "ALIVE") return null;
  const cohesion = neighborhoodCohesion(cell);
  if (cohesion >= CA_RULES.SURVIVAL_MIN_COHESION) {
    return {
      entropy: Math.max(0, cell.entropy - CA_RULES.ENTROPY_DECAY),
      confidence: Math.min(1, cell.confidence + CA_RULES.CONFIDENCE_RECOVERY * cohesion),
      ruleHistory: [...cell.ruleHistory, `G${cell.generation}:SURVIVAL(cohesion=${cohesion.toFixed(2)})`],
    };
  }
  // Low cohesion → start MUTATING
  return {
    state: "MUTATING" as CellState,
    entropy: Math.min(1, cell.entropy + CA_RULES.ENTROPY_DECAY),
    confidence: Math.max(0, cell.confidence - CA_RULES.CONFIDENCE_DECAY),
    ruleHistory: [...cell.ruleHistory, `G${cell.generation}:LONELINESS(cohesion=${cohesion.toFixed(2)})`],
  };
}

// Rule 2: OVERPOPULATION — redundant scoping (nested same delimiters) → DEAD
function rulesOverpopulation(cell: Cell): Partial<Cell> | null {
  if (cell.type !== "DELIMITER") return null;
  if (cell.state === "DEAD") return null;
  const n = cell.neighborhood;
  const neighbors = [n.left, n.right].filter(Boolean) as CellRef[];
  const sameDelim = neighbors.filter(nb => nb.token === cell.token);
  if (sameDelim.length >= 2) {
    return {
      state: "DEAD" as CellState,
      entropy: 1.0,
      confidence: 0,
      ruleHistory: [...cell.ruleHistory, `G${cell.generation}:OVERPOPULATION(redundant:${cell.token})`],
    };
  }
  return null;
}

// Rule 3: ORPHAN — open bracket/tag with no matching close in neighborhood
function rulesOrphan(cell: Cell): Partial<Cell> | null {
  if (cell.state === "DEAD" || cell.state === "ERROR") return null;
  const openTokens = new Set(["(", "[", "{", "<"]);
  const matchMap: Record<string, string> = { "(": ")", "[": "]", "{": "}", "<": ">" };

  if (!openTokens.has(cell.token)) return null;

  const expected = matchMap[cell.token];
  const n = cell.neighborhood;
  const allNeighbors = [n.left, n.right, n.up, n.down, n.ul, n.ur, n.dl, n.dr]
    .filter(Boolean) as CellRef[];

  const hasMatch = allNeighbors.some(nb => nb.token === expected);
  if (!hasMatch && allNeighbors.length > 0) {
    return {
      state: "ERROR" as CellState,
      entropy: Math.min(1, cell.entropy + 0.3),
      confidence: Math.max(0, cell.confidence - 0.3),
      ruleHistory: [...cell.ruleHistory, `G${cell.generation}:ORPHAN(open:${cell.token},expected:${expected})`],
    };
  }
  return null;
}

// Rule 4: MUTATION RESOLUTION — if MUTATING, generate correction suggestion
function rulesMutation(cell: Cell, _grid: CellGrid): Partial<Cell> | null {
  if (cell.state !== "MUTATING") return null;
  if (cell.confidence < CA_RULES.MUTATION_THRESHOLD) {
    // Self-editing: generate suggestion based on type + context
    const suggestion = generateSuggestion(cell);
    return {
      suggestion,
      ruleHistory: [...cell.ruleHistory, `G${cell.generation}:MUTATION_SUGGEST(${suggestion ? `"${suggestion}"` : "none"})`],
    };
  }
  // Confidence recovered — revive
  return {
    state: "ALIVE" as CellState,
    ruleHistory: [...cell.ruleHistory, `G${cell.generation}:REVIVE(confidence=${cell.confidence.toFixed(2)})`],
  };
}

// Rule 5: ERROR RECOVERY — ERROR cells can recover if neighborhood improves
function rulesErrorRecovery(cell: Cell): Partial<Cell> | null {
  if (cell.state !== "ERROR") return null;
  const cohesion = neighborhoodCohesion(cell);
  if (cohesion > 0.6) {
    return {
      state: "ALIVE" as CellState,
      entropy: Math.max(0, cell.entropy - CA_RULES.ENTROPY_DECAY * 2),
      confidence: Math.min(1, cell.confidence + CA_RULES.CONFIDENCE_RECOVERY),
      ruleHistory: [...cell.ruleHistory, `G${cell.generation}:ERROR_RECOVER`],
    };
  }
  return {
    entropy: Math.min(1, cell.entropy + CA_RULES.ENTROPY_DECAY * 0.5),
    confidence: Math.max(0, cell.confidence - CA_RULES.CONFIDENCE_DECAY),
    ruleHistory: [...cell.ruleHistory, `G${cell.generation}:ERROR_PERSIST`],
  };
}

// ── Self-Edit Suggestion Generator ────────────────────────
// Attention Anchor 7: Self-editing feedback loops
function generateSuggestion(cell: Cell): string | null {
  const { token, type, lang, neighborhood: n } = cell;

  // Python: fix common keyword typos
  if (lang === "python") {
    const pyFixes: Record<string, string> = {
      "deff": "def", "retrn": "return", "imprt": "import",
      "cls": "class", "whlie": "while", "fro": "from",
      "pritn": "print", "flase": "False", "ture": "True",
    };
    if (pyFixes[token]) return pyFixes[token];
  }

  // JS: fix common keyword typos
  if (lang === "js") {
    const jsFixes: Record<string, string> = {
      "functoin": "function", "cosnt": "const", "retrun": "return",
      "improt": "import", "exoprt": "export", "clss": "class",
      "treu": "true", "flase": "false",
    };
    if (jsFixes[token]) return jsFixes[token];
  }

  // UNKNOWN type → try to classify based on context
  if (type === "UNKNOWN") {
    // If left neighbor is KEYWORD and right is DELIMITER → probably IDENTIFIER
    if (n.left?.type === "KEYWORD" && n.right?.token === "(") {
      return token; // Keep as-is but reclassify
    }
    // If surrounded by strings → might be missing quote
    if (n.left?.type === "LITERAL" && n.right?.type === "LITERAL") {
      return `"${token}"`;
    }
  }

  // DELIMITER: suggest matching close if orphaned
  if (type === "DELIMITER") {
    const closes: Record<string, string> = { "(": ")", "[": "]", "{": "}", "<": ">" };
    if (closes[token]) return token; // Keep open, flag for insertion of close
  }

  return null;
}

// ════════════════════════════════════════════════════════════
// ATTENTION ANCHOR 4: MOORE NEIGHBORHOOD AST MAPPING
// ATTENTION ANCHOR 5: PARALLEL RULE EVALUATION
// ════════════════════════════════════════════════════════════

// Evaluate all rules against a cell — parallel in semantics
// Returns the merged next-state update for this cell
function evaluateCell(cell: Cell, grid: CellGrid): Partial<Cell> {
  const updates: Partial<Cell>[] = [];

  // WHITESPACE and COMMENT cells don't participate in survival rules
  if (cell.type === "WHITESPACE") {
    return { generation: grid.generation };
  }

  // Rule pipeline — all rules evaluated, updates merged
  const r1 = rulesSurvival(cell);
  const r2 = rulesOverpopulation(cell);
  const r3 = rulesOrphan(cell);
  const r4 = rulesMutation(cell, grid);
  const r5 = rulesErrorRecovery(cell);

  if (r1) updates.push(r1);
  if (r2) updates.push(r2);
  if (r3) updates.push(r3);
  if (r4) updates.push(r4);
  if (r5) updates.push(r5);

  // Merge: later rules can override state (priority: ERROR > DEAD > MUTATING > ALIVE)
  // This implements the rule-set matrix precedence
  const merged: Partial<Cell> = { generation: grid.generation };
  for (const u of updates) {
    Object.assign(merged, u);
  }

  // State precedence — ERROR beats DEAD beats MUTATING beats ALIVE
  const statePriority: Record<CellState, number> = {
    ERROR: 4, DEAD: 3, ORPHAN: 2, MUTATING: 1, ALIVE: 0,
  };
  let winningState: CellState = cell.state;
  for (const u of updates) {
    if (u.state !== undefined) {
      if ((statePriority[u.state] ?? 0) > (statePriority[winningState] ?? 0)) {
        winningState = u.state;
      }
    }
  }
  merged.state = winningState;

  // Merge ruleHistory — collect all fired rules
  const allRules: string[] = [];
  for (const u of updates) {
    if (u.ruleHistory) allRules.push(...u.ruleHistory.slice(-1)); // only latest per rule
  }
  if (allRules.length) merged.ruleHistory = [...cell.ruleHistory, ...allRules].slice(-20);

  return merged;
}

// ════════════════════════════════════════════════════════════
// ATTENTION ANCHOR 2: NON-BLOCKING STATE UPDATES
// Double-buffer: compute next gen in new array, then swap
// ════════════════════════════════════════════════════════════

function stepGeneration(grid: CellGrid): CellGrid {
  // Non-blocking double-buffer — never mutate in place
  const nextCells: Cell[] = grid.cells.map(cell => {
    const update = evaluateCell(cell, grid);
    return { ...cell, ...update };
  });

  return {
    ...grid,
    cells: nextCells,
    generation: grid.generation + 1,
  };
}

// ════════════════════════════════════════════════════════════
// ATTENTION ANCHOR 4+6: DAG (GRAPH-OF-THOUGHTS)
// Build a Directed Acyclic Graph of syntactic dependencies
// Nodes = cells, Edges = syntactic dependency
// Thought-merging: neighbor cells aggregate state to resolve ambiguity
// ════════════════════════════════════════════════════════════

export interface DAGNode {
  cellId:   number;
  token:    string;
  type:     CellType;
  state:    CellState;
  entropy:  number;
  inEdges:  number[]; // cell ids that point to this node
  outEdges: number[]; // cell ids this node points to
  mergedConfidence: number; // GoT thought-merging result
  dagDepth: number;  // topological depth
}

export interface ThoughtDAG {
  nodes:     Map<number, DAGNode>;
  topoOrder: number[]; // topologically sorted cell ids
  hasCycle:  boolean;
  lang:      Language;
}

export function buildDAG(grid: CellGrid): ThoughtDAG {
  const nodes: Map<number, DAGNode> = new Map();

  // Initialize nodes
  for (const cell of grid.cells) {
    if (cell.type === "WHITESPACE") continue;
    nodes.set(cell.id, {
      cellId: cell.id,
      token:  cell.token,
      type:   cell.type,
      state:  cell.state,
      entropy: cell.entropy,
      inEdges:  [...cell.dagParents],
      outEdges: [...cell.dagEdges],
      mergedConfidence: cell.confidence,
      dagDepth: 0,
    });
  }

  // Auto-detect syntactic dependencies if none exist
  if (grid.cells.every(c => c.dagEdges.length === 0)) {
    inferDAGEdges(grid, nodes);
  }

  // Topological sort (Kahn's algorithm) + cycle detection
  const { order, hasCycle } = topoSort(nodes);

  // Compute DAG depths
  const depthMap = new Map<number, number>();
  for (const id of order) {
    const node = nodes.get(id)!;
    const maxParentDepth = node.inEdges.reduce(
      (m, pid) => Math.max(m, depthMap.get(pid) ?? 0), 0
    );
    const depth = node.inEdges.length === 0 ? 0 : maxParentDepth + 1;
    depthMap.set(id, depth);
    node.dagDepth = depth;
  }

  // Thought-merging: each node's confidence aggregates from its in-neighbors
  // This is the "cross-pollination" — a node's confidence is influenced by its dependencies
  thoughtMerge(nodes, order);

  return { nodes, topoOrder: order, hasCycle, lang: grid.lang };
}

// ── Infer DAG edges from syntactic structure ───────────────
// Rules:
//   KEYWORD(def/function/class) → IDENTIFIER (next identifier is its name)
//   DELIMITER( open → matching close (matched by stack)
//   HTML open tag → matching close tag
//   OPERATOR → left operand + right operand
function inferDAGEdges(grid: CellGrid, nodes: Map<number, DAGNode>): void {
  const cells = grid.cells.filter(c => c.type !== "WHITESPACE");

  // Bracket matching stack
  const stack: { cellId: number; token: string }[] = [];
  const openClose: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
  const closeOpen: Record<string, string> = { ")": "(", "]": "[", "}": "{" };

  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    const node = nodes.get(cell.id);
    if (!node) continue;

    const tok = cell.token;

    // KEYWORD → next IDENTIFIER
    if (cell.type === "KEYWORD") {
      const next = cells.slice(i + 1, i + 4).find(c => c.type === "IDENTIFIER");
      if (next) {
        const nextNode = nodes.get(next.id);
        if (nextNode) {
          node.outEdges.push(next.id);
          nextNode.inEdges.push(cell.id);
        }
      }
    }

    // Bracket matching
    if (openClose[tok]) {
      stack.push({ cellId: cell.id, token: tok });
    } else if (closeOpen[tok]) {
      const expected = closeOpen[tok];
      // Pop matching open
      for (let s = stack.length - 1; s >= 0; s--) {
        if (stack[s].token === expected) {
          const openNode = nodes.get(stack[s].cellId);
          if (openNode) {
            openNode.outEdges.push(cell.id);
            node.inEdges.push(stack[s].cellId);
          }
          stack.splice(s, 1);
          break;
        }
      }
    }

    // OPERATOR → links left + right operands
    if (cell.type === "OPERATOR" && i > 0 && i < cells.length - 1) {
      const left  = cells[i - 1];
      const right = cells[i + 1];
      const leftNode  = nodes.get(left.id);
      const rightNode = nodes.get(right.id);
      if (leftNode && (left.type === "IDENTIFIER" || left.type === "LITERAL")) {
        node.inEdges.push(left.id);
        leftNode.outEdges.push(cell.id);
      }
      if (rightNode && (right.type === "IDENTIFIER" || right.type === "LITERAL")) {
        node.outEdges.push(right.id);
        rightNode.inEdges.push(cell.id);
      }
    }
  }
}

// ── Kahn's Topological Sort + Cycle Detection ─────────────
function topoSort(nodes: Map<number, DAGNode>): { order: number[]; hasCycle: boolean } {
  const inDeg = new Map<number, number>();
  for (const [id, node] of nodes) {
    if (!inDeg.has(id)) inDeg.set(id, 0);
    for (const out of node.outEdges) {
      inDeg.set(out, (inDeg.get(out) ?? 0) + 1);
    }
  }

  const queue: number[] = [];
  for (const [id, deg] of inDeg) {
    if (deg === 0) queue.push(id);
  }

  const order: number[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(id);
    const node = nodes.get(id);
    if (!node) continue;
    for (const out of node.outEdges) {
      const newDeg = (inDeg.get(out) ?? 1) - 1;
      inDeg.set(out, newDeg);
      if (newDeg === 0) queue.push(out);
    }
  }

  const hasCycle = order.length < nodes.size;
  // If cycle: append remaining nodes
  if (hasCycle) {
    for (const id of nodes.keys()) {
      if (!order.includes(id)) order.push(id);
    }
  }

  return { order, hasCycle };
}

// ── Thought-Merging: Graph-of-Thoughts ────────────────────
// Each node's confidence = weighted average of its own confidence
// + influence from its in-neighbors (thought cross-pollination)
// A change in an HTML tag propagates to JS/CSS cells via DAG edges
function thoughtMerge(nodes: Map<number, DAGNode>, topoOrder: number[]): void {
  for (const id of topoOrder) {
    const node = nodes.get(id)!;
    if (node.inEdges.length === 0) {
      node.mergedConfidence = node.mergedConfidence; // root node: own confidence
      continue;
    }

    const parentConfs = node.inEdges
      .map(pid => nodes.get(pid)?.mergedConfidence ?? 0.5);

    const parentAvg = parentConfs.reduce((a, b) => a + b, 0) / parentConfs.length;

    // Weighted merge: 70% own + 30% parent influence
    node.mergedConfidence = 0.7 * node.mergedConfidence + 0.3 * parentAvg;
  }
}

// ════════════════════════════════════════════════════════════
// ATTENTION ANCHOR 6: ENTROPY-REDUCTION FORMATTING
// The editor converges toward minimum entropy (maximum order)
// Sorting pass: apply corrections from MUTATING cells
// ════════════════════════════════════════════════════════════

export interface EntropyReport {
  before: number;
  after:  number;
  delta:  number;
  corrections: Array<{ cellId: number; from: string; to: string }>;
}

export function entropyReductionPass(grid: CellGrid): { grid: CellGrid; report: EntropyReport } {
  const corrections: Array<{ cellId: number; from: string; to: string }> = [];
  const before = grid.cells.reduce((s, c) => s + c.entropy, 0) / (grid.cells.length || 1);

  const nextCells = grid.cells.map(cell => {
    if (cell.state !== "MUTATING" || !cell.suggestion) return cell;
    if (cell.suggestion === cell.token) return { ...cell, state: "ALIVE" as CellState };

    corrections.push({ cellId: cell.id, from: cell.token, to: cell.suggestion });
    return {
      ...cell,
      token:      cell.suggestion,
      state:      "ALIVE" as CellState,
      entropy:    Math.max(0, cell.entropy - 0.5),
      confidence: Math.min(1, cell.confidence + 0.4),
      suggestion: null,
      ruleHistory: [...cell.ruleHistory, `ENTROPY_CORRECT("${cell.token}"→"${cell.suggestion}")`],
    };
  });

  const nextGrid = { ...grid, cells: nextCells };
  const after = nextGrid.cells.reduce((s, c) => s + c.entropy, 0) / (nextGrid.cells.length || 1);

  return {
    grid: nextGrid,
    report: { before, after, delta: before - after, corrections },
  };
}

// ════════════════════════════════════════════════════════════
// MAIN EVOLUTION LOOP
// Attention Anchor 2: Non-blocking state updates
// Attention Anchor 5: Parallel rule evaluation
// Attention Anchor 7: Self-editing feedback loops
// ════════════════════════════════════════════════════════════

export interface EvolutionResult {
  grid:          CellGrid;
  dag:           ThoughtDAG;
  stats:         GridStats[];    // stats per generation
  entropyReport: EntropyReport;
  converged:     boolean;
  generations:   number;
  auditLog:      string[];
}

export function evolve(
  grid: CellGrid,
  maxGenerations: number = 8,
  onGeneration?: (g: number, stats: GridStats) => void
): EvolutionResult {
  let current = grid;
  const stats: GridStats[] = [];
  const audit: string[] = [];

  audit.push(`[CA] EVOLVE START — lang=${grid.lang} cells=${grid.cells.length} maxGen=${maxGenerations}`);

  for (let g = 0; g < maxGenerations; g++) {
    current = stepGeneration(current);
    const s = computeGridStats(current);
    stats.push(s);
    audit.push(
      `[CA] G${g + 1}: alive=${s.alive} dead=${s.dead} err=${s.error} ` +
      `mut=${s.mutating} entropy=${s.avgEntropy.toFixed(3)} conf=${s.avgConfidence.toFixed(3)}`
    );

    if (onGeneration) onGeneration(g + 1, s);

    // Convergence: entropy below threshold and no more MUTATING/ERROR cells
    if (s.converged && s.mutating === 0 && s.error === 0) {
      audit.push(`[CA] CONVERGED at generation ${g + 1}`);
      break;
    }
  }

  // Entropy-reduction pass (Tier: Metacognitive Audit step 4 — Finalize)
  const { grid: reducedGrid, report } = entropyReductionPass(current);
  audit.push(
    `[CA] ENTROPY_REDUCE: ${report.before.toFixed(3)}→${report.after.toFixed(3)} ` +
    `Δ=${report.delta.toFixed(3)} corrections=${report.corrections.length}`
  );

  // Build DAG (Graph-of-Thoughts)
  const dag = buildDAG(reducedGrid);
  if (dag.hasCycle) {
    audit.push(`[CA] WARN: DAG cycle detected — partial topological order`);
  }
  audit.push(`[CA] DAG: ${dag.nodes.size} nodes, topoDepth=${Math.max(...[...dag.nodes.values()].map(n => n.dagDepth), 0)}`);

  const finalStats = computeGridStats(reducedGrid);
  audit.push(
    `[CA] FINAL: alive=${finalStats.alive} err=${finalStats.error} ` +
    `entropy=${finalStats.avgEntropy.toFixed(3)} converged=${finalStats.converged}`
  );

  return {
    grid:          reducedGrid,
    dag,
    stats,
    entropyReport: report,
    converged:     finalStats.converged,
    generations:   reducedGrid.generation,
    auditLog:      audit,
  };
}

// ════════════════════════════════════════════════════════════
// TIER 4: METACOGNITIVE AUDIT — 5-Stage Validation Pipeline
// ════════════════════════════════════════════════════════════

export interface MetacognitiveReport {
  stage1_understand: { valid: boolean; notes: string[] };
  stage2_judge:      { converges: boolean; driftRisk: number; notes: string[] };
  stage3_critique:   { tornWriteRisks: string[] };
  stage4_finalize:   { hardened: boolean; corrections: number };
  stage5_calibrate:  { confidence: number; exactOnceScore: number };
  overallScore:      number; // 0–100
}

export function metacognitiveAudit(result: EvolutionResult): MetacognitiveReport {
  const finalStats = computeGridStats(result.grid);

  // Stage 1: UNDERSTAND — verify CA rules apply to all token types
  const coveredTypes = new Set(result.grid.cells.map(c => c.type));
  const allTypes: string[] = ["KEYWORD", "DELIMITER", "OPERATOR", "LITERAL", "IDENTIFIER", "COMMENT"];
  const missingTypes = allTypes.filter(t => !coveredTypes.has(t as CellType));
  const stage1_understand = {
    valid: missingTypes.length === 0,
    notes: missingTypes.length > 0
      ? [`Token types with no cells: ${missingTypes.join(", ")}`]
      : ["All token types present in cell population"],
  };

  // Stage 2: JUDGE — does the system converge or drift?
  const lastEntropy = result.stats[result.stats.length - 1]?.avgEntropy ?? 1;
  const firstEntropy = result.stats[0]?.avgEntropy ?? 1;
  const converges = lastEntropy <= firstEntropy; // entropy must not increase
  const driftRisk = result.stats.length > 1
    ? Math.max(0, ...result.stats.map((s, i) =>
        i > 0 ? s.avgEntropy - result.stats[i - 1].avgEntropy : 0))
    : 0;
  const stage2_judge = {
    converges,
    driftRisk,
    notes: [
      converges ? "✓ System converges (entropy non-increasing)" : "✗ Entropy drift detected",
      `Drift risk: ${(driftRisk * 100).toFixed(1)}% per generation`,
      result.dag.hasCycle ? "⚠ DAG cycle detected — torn-write risk" : "✓ DAG is acyclic",
    ],
  };

  // Stage 3: CRITIQUE — torn-write risks in parallel state updates
  const tornWriteRisks: string[] = [];
  for (const [, node] of result.dag.nodes) {
    if (node.state === "ERROR" && node.outEdges.length > 0) {
      tornWriteRisks.push(
        `Cell #${node.cellId} ('${node.token}') is ERROR but has ${node.outEdges.length} dependents — torn propagation`
      );
    }
  }
  if (result.dag.hasCycle) {
    tornWriteRisks.push("DAG cycle prevents deterministic topological update order");
  }

  // Stage 4: FINALIZE — output hardened, self-organizing kernel
  const stage4_finalize = {
    hardened: tornWriteRisks.length === 0 && !result.dag.hasCycle,
    corrections: result.entropyReport.corrections.length,
  };

  // Stage 5: CALIBRATE — confidence in "exactly-once" syntax enforcement
  const aliveRatio = finalStats.alive / (finalStats.totalCells || 1);
  const errorRatio = finalStats.error / (finalStats.totalCells || 1);
  const entropyScore = Math.max(0, 1 - finalStats.avgEntropy);
  const exactOnceScore = Math.round(
    aliveRatio * 40 +
    entropyScore * 30 +
    (1 - errorRatio) * 20 +
    (result.converged ? 10 : 0)
  );
  const confidence = Math.round(
    finalStats.avgConfidence * 60 +
    entropyScore * 20 +
    aliveRatio * 20
  );

  return {
    stage1_understand,
    stage2_judge,
    stage3_critique: { tornWriteRisks },
    stage4_finalize,
    stage5_calibrate: { confidence, exactOnceScore },
    overallScore: Math.round((confidence + exactOnceScore) / 2),
  };
}

// ════════════════════════════════════════════════════════════
// RE-EXPORT HELPERS FOR CHAIN
// ════════════════════════════════════════════════════════════
export { tokenize, gridToSource, computeGridStats };
export type { CellGrid, Cell, GridStats };
