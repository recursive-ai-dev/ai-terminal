// ============================================================
// CA SYNTAX ENGINE — Cellular Automaton Token Primitives
// Tier 1: Step-Back Abstraction — First Principles of Syntax Automata
// Tier 2: Skeleton-of-Thought — 8 Attention Anchors
// Implements: Moore Neighborhood, Cell Types, Language Detection,
//             Tokenization into 1D/2D cell grids
// ============================================================

// ── Cell Type Taxonomy ─────────────────────────────────────
// Each syntax token maps to exactly one CellType.
// This is the "biological state" of the cell.
export type CellType =
  | "KEYWORD"      // if, for, def, function, class, return, import, var, let, const, html-tag
  | "IDENTIFIER"   // variable/function names
  | "OPERATOR"     // + - * / = == != < > && || => : -> **
  | "DELIMITER"    // () [] {} , ; .
  | "LITERAL"      // strings, numbers, booleans, null, None
  | "WHITESPACE"   // spaces, tabs, newlines (structural in Python)
  | "COMMENT"      // # // /* */ <!-- -->
  | "UNKNOWN";     // unclassified — high entropy candidate

// ── Cell State — The "Biological" State of a Syntax Cell ──
export type CellState =
  | "ALIVE"     // syntactically correct, stable
  | "DEAD"      // killed by rule (orphan, redundant, or corrected-away)
  | "MUTATING"  // below confidence threshold, candidate for self-edit
  | "ERROR"     // invariant breach: unmatched bracket, bad indent, illegal token
  | "ORPHAN";   // valid token but no valid neighborhood connection

// ── Language ──────────────────────────────────────────────
export type Language = "python" | "js" | "html" | "css" | "unknown";

// ── Moore Neighborhood (8-connected) ──────────────────────
// In a 2D cell grid, each cell has up to 8 neighbors.
// In 1D mode, only left/right are populated.
export interface MooreNeighborhood {
  left:  CellRef | null;
  right: CellRef | null;
  up:    CellRef | null;
  down:  CellRef | null;
  ul:    CellRef | null; // up-left diagonal
  ur:    CellRef | null; // up-right diagonal
  dl:    CellRef | null; // down-left diagonal
  dr:    CellRef | null; // down-right diagonal
}

export interface CellRef {
  id:    number;
  type:  CellType;
  state: CellState;
  token: string;
}

// ── The Core Cell — Memory-Mapped Cellular Grid Node ──────
// Attention Anchor 1: Memory-mapped cellular grid
export interface Cell {
  id:           number;       // unique, stable across generations
  token:        string;       // raw source token
  type:         CellType;     // syntactic classification
  lang:         Language;     // language context
  state:        CellState;    // current CA state
  generation:   number;       // last generation this cell was updated
  entropy:      number;       // [0,1] — syntactic disorder measure
  confidence:   number;       // [0,1] — CA confidence this cell is correct
  row:          number;       // grid row (line number)
  col:          number;       // grid col (token index in line)
  dagEdges:     number[];     // ids of cells this cell depends on (DAG out-edges)
  dagParents:   number[];     // ids of cells that depend on this cell (DAG in-edges)
  neighborhood: MooreNeighborhood;
  // Self-edit suggestion (populated during MUTATING resolution)
  suggestion:   string | null;
  // Audit: which rules fired on this cell
  ruleHistory:  string[];
}

// ── Grid — The 2D Memory-Mapped Cell Population ───────────
export interface CellGrid {
  cells:      Cell[];         // flat array, row-major order
  rows:       number;
  cols:       number;         // max tokens per line
  lang:       Language;
  generation: number;
  source:     string;         // original source
  lineMap:    number[][];     // lineMap[row] = [cellId, ...]
}

// ── Rule-Set Matrix ────────────────────────────────────────
// First Principles derived by Step-Back Prompting:
// Life Rules for code blocks:
//   1. SURVIVAL:        correct syntax + cohesive neighborhood → ALIVE
//   2. OVERPOPULATION:  redundant scoping (double indent, extra paren) → DEAD
//   3. LONELINESS:      orphaned bracket/paren/tag with no match → ERROR
//   4. BIRTH:           dead cell in exact-match context neighbors → ALIVE (suggestion)
//   5. MUTATION:        confidence < MUTATION_THRESHOLD → MUTATING
export const CA_RULES = {
  SURVIVAL_MIN_COHESION:    0.4,  // min neighborhood cohesion to stay ALIVE
  MUTATION_THRESHOLD:       0.5,  // confidence below this → MUTATING
  ORPHAN_THRESHOLD:         0.0,  // zero valid neighbors → ORPHAN
  ENTROPY_DECAY:            0.08, // entropy decreases per generation by this factor
  CONFIDENCE_RECOVERY:      0.12, // confidence increases when rule conditions met
  CONFIDENCE_DECAY:         0.05, // confidence decreases in ERROR state
  MAX_GENERATIONS:          64,   // prevent infinite evolution
  ENTROPY_CONVERGENCE:      0.05, // below this entropy → system is converged
} as const;

// ════════════════════════════════════════════════════════════
// LANGUAGE DETECTION
// ════════════════════════════════════════════════════════════

const PY_KEYWORDS = new Set([
  "def","class","import","from","if","elif","else","for","while","return",
  "with","as","try","except","finally","raise","pass","break","continue",
  "lambda","yield","async","await","True","False","None","not","and","or",
  "in","is","del","global","nonlocal","assert","print",
]);

const JS_KEYWORDS = new Set([
  "function","var","let","const","if","else","for","while","return","class",
  "import","export","from","default","new","this","typeof","instanceof",
  "try","catch","finally","throw","async","await","of","in","switch","case",
  "break","continue","yield","void","delete","true","false","null","undefined",
  "=>","constructor","super","extends","static","get","set",
]);

const HTML_TAGS = new Set([
  "html","head","body","div","span","p","a","ul","ol","li","h1","h2","h3",
  "h4","h5","h6","table","tr","td","th","form","input","button","select",
  "option","textarea","img","link","script","style","meta","title","header",
  "footer","nav","section","article","main","aside","figure","figcaption",
  "canvas","video","audio","svg","path","rect","circle","g","br","hr","pre",
  "code","em","strong","i","b","small","label","fieldset","legend",
]);

const CSS_PROPS = new Set([
  "color","background","margin","padding","border","font","display","flex",
  "grid","width","height","position","top","left","right","bottom","overflow",
  "transform","transition","animation","opacity","z-index","cursor","content",
]);

export function detectLanguage(source: string): Language {
  const s = source.trim();
  if (s.startsWith("<!DOCTYPE") || s.startsWith("<html") ||
      /<[a-zA-Z][^>]*>/.test(s.slice(0, 200))) return "html";
  if (/^\s*(def |class |import |from |elif |#)/.test(s) ||
      /:\s*$/.test(s.split("\n")[0] || "")) return "python";
  if (/^\s*(function |const |let |var |import |export |=>)/.test(s) ||
      s.includes("=>") || s.includes("===")) return "js";
  if (/^[.#]?[a-zA-Z][\w-]*\s*\{/.test(s) ||
      /:\s*[a-zA-Z#\d"']+\s*;/.test(s)) return "css";
  return "unknown";
}

// ════════════════════════════════════════════════════════════
// TOKENIZER — Source → Token Stream → Cell Grid
// Attention Anchor 1: Memory-mapped cellular grid
// Attention Anchor 4: Moore Neighborhood AST mapping
// ════════════════════════════════════════════════════════════

export interface TokenizeResult {
  grid: CellGrid;
  errors: string[];
}

// Token pattern — ordered by priority
const TOKEN_PATTERNS: Array<{ type: CellType; pattern: RegExp }> = [
  { type: "COMMENT",    pattern: /^(#[^\n]*|\/\/[^\n]*|\/\*[\s\S]*?\*\/|<!--[\s\S]*?-->)/ },
  { type: "LITERAL",    pattern: /^("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b\d+\.?\d*([eE][+-]?\d+)?\b|0x[0-9a-fA-F]+)/ },
  { type: "DELIMITER",  pattern: /^[()[\]{},;.]/ },
  { type: "OPERATOR",   pattern: /^(===|!==|=>|->|\*\*|>=|<=|==|!=|&&|\|\||<<|>>|\+\+|--|[+\-*/%&|^~<>=!?:@])/ },
  { type: "WHITESPACE", pattern: /^(\s+)/ },
  { type: "IDENTIFIER", pattern: /^[a-zA-Z_$][a-zA-Z0-9_$]*/ },
  { type: "UNKNOWN",    pattern: /^./ },
];

function classifyIdentifier(token: string, lang: Language): CellType {
  if (lang === "python" && PY_KEYWORDS.has(token)) return "KEYWORD";
  if ((lang === "js" || lang === "unknown") && JS_KEYWORDS.has(token)) return "KEYWORD";
  if (lang === "html" && HTML_TAGS.has(token.toLowerCase())) return "KEYWORD";
  if (lang === "css" && CSS_PROPS.has(token.toLowerCase())) return "KEYWORD";
  return "IDENTIFIER";
}

export function tokenize(source: string, lang?: Language): TokenizeResult {
  const detectedLang: Language = lang ?? detectLanguage(source);
  const errors: string[] = [];
  const cells: Cell[] = [];
  const lineMap: number[][] = [];

  let pos = 0;
  let row = 0;
  let col = 0;
  let id = 0;

  lineMap.push([]); // row 0

  while (pos < source.length) {
    let matched = false;

    for (const { type, pattern } of TOKEN_PATTERNS) {
      const m = source.slice(pos).match(pattern);
      if (!m) continue;

      const token = m[0];
      let cellType: CellType = type;

      if (type === "IDENTIFIER") {
        cellType = classifyIdentifier(token, detectedLang);
      }

      // Handle newlines — advance row
      if (type === "WHITESPACE" && token.includes("\n")) {
        const newlines = (token.match(/\n/g) || []).length;
        const cell = makeCell(id++, token, cellType, detectedLang, row, col);
        cells.push(cell);
        if (!lineMap[row]) lineMap[row] = [];
        lineMap[row].push(cell.id);
        row += newlines;
        col = token.length - token.lastIndexOf("\n") - 1;
        for (let r = lineMap.length; r <= row; r++) lineMap.push([]);
      } else {
        const cell = makeCell(id++, token, cellType, detectedLang, row, col);
        cells.push(cell);
        if (!lineMap[row]) lineMap[row] = [];
        lineMap[row].push(cell.id);
        col += token.length;
      }

      pos += token.length;
      matched = true;
      break;
    }

    if (!matched) {
      errors.push(`Tokenization failed at pos ${pos}: '${source[pos]}'`);
      pos++;
    }
  }

  const maxCols = lineMap.reduce((m, row) => Math.max(m, row.length), 0);

  const grid: CellGrid = {
    cells,
    rows: lineMap.length,
    cols: maxCols,
    lang: detectedLang,
    generation: 0,
    source,
    lineMap,
  };

  // Build Moore neighborhoods
  buildNeighborhoods(grid);

  return { grid, errors };
}

function makeCell(
  id: number, token: string, type: CellType,
  lang: Language, row: number, col: number
): Cell {
  const entropy = computeInitialEntropy(type, token);
  return {
    id, token, type, lang,
    state: type === "UNKNOWN" ? "MUTATING" : "ALIVE",
    generation: 0,
    entropy,
    confidence: 1 - entropy,
    row, col,
    dagEdges: [],
    dagParents: [],
    neighborhood: { left:null, right:null, up:null, down:null, ul:null, ur:null, dl:null, dr:null },
    suggestion: null,
    ruleHistory: [],
  };
}

function computeInitialEntropy(type: CellType, token: string): number {
  // Entropy: KEYWORD=0.0 (perfectly ordered), UNKNOWN=1.0 (max disorder)
  const base: Record<CellType, number> = {
    KEYWORD:    0.0,
    DELIMITER:  0.05,
    OPERATOR:   0.1,
    LITERAL:    0.1,
    IDENTIFIER: 0.2,
    COMMENT:    0.15,
    WHITESPACE: 0.0,
    UNKNOWN:    1.0,
  };
  let e = base[type];
  // Bonus entropy for suspicious tokens
  if (type === "IDENTIFIER" && token.length === 1 && !/[a-z]/i.test(token)) e += 0.3;
  if (type === "DELIMITER" && (token === "(" || token === "{" || token === "[")) e += 0.15;
  return Math.min(1, e);
}

// ── Moore Neighborhood Builder ─────────────────────────────
// Attention Anchor 4: Moore Neighborhood AST mapping
function buildNeighborhoods(grid: CellGrid): void {
  // Build a 2D lookup: [row][col] → cell
  const lookup: Map<string, Cell> = new Map();
  for (const cell of grid.cells) {
    lookup.set(`${cell.row},${cell.col}`, cell);
  }

  for (const cell of grid.cells) {
    const { row, col } = cell;

    const ref = (r: number, c: number): CellRef | null => {
      const n = lookup.get(`${r},${c}`);
      if (!n) return null;
      return { id: n.id, type: n.type, state: n.state, token: n.token };
    };

    cell.neighborhood = {
      left:  ref(row, col - 1),
      right: ref(row, col + 1),
      up:    ref(row - 1, col),
      down:  ref(row + 1, col),
      ul:    ref(row - 1, col - 1),
      ur:    ref(row - 1, col + 1),
      dl:    ref(row + 1, col - 1),
      dr:    ref(row + 1, col + 1),
    };
  }
}

// ── Neighborhood Cohesion Score ────────────────────────────
// How well does the 8-neighborhood support this cell's state?
export function neighborhoodCohesion(cell: Cell): number {
  const n = cell.neighborhood;
  const neighbors = [n.left, n.right, n.up, n.down, n.ul, n.ur, n.dl, n.dr]
    .filter(Boolean) as CellRef[];

  if (neighbors.length === 0) return 0;

  const alive = neighbors.filter(nb => nb.state === "ALIVE").length;
  const errors = neighbors.filter(nb => nb.state === "ERROR").length;

  const base = alive / neighbors.length;
  const penalty = errors / neighbors.length * 0.5;
  return Math.max(0, base - penalty);
}

// ── Export grid to source string ───────────────────────────
// Attention Anchor 8: Persistent state-machine I/O
export function gridToSource(grid: CellGrid): string {
  const parts: string[] = [];
  for (const cell of grid.cells) {
    if (cell.state === "DEAD") continue;
    // Use suggestion if in MUTATING state and suggestion exists
    if (cell.state === "MUTATING" && cell.suggestion !== null) {
      parts.push(cell.suggestion);
    } else {
      parts.push(cell.token);
    }
  }
  return parts.join("");
}

// ── Grid statistics ────────────────────────────────────────
export interface GridStats {
  totalCells:   number;
  alive:        number;
  dead:         number;
  mutating:     number;
  error:        number;
  orphan:       number;
  avgEntropy:   number;
  avgConfidence:number;
  generation:   number;
  converged:    boolean;
}

export function computeGridStats(grid: CellGrid): GridStats {
  const cells = grid.cells.filter(c => c.type !== "WHITESPACE");
  const alive    = cells.filter(c => c.state === "ALIVE").length;
  const dead     = cells.filter(c => c.state === "DEAD").length;
  const mutating = cells.filter(c => c.state === "MUTATING").length;
  const error    = cells.filter(c => c.state === "ERROR").length;
  const orphan   = cells.filter(c => c.state === "ORPHAN").length;
  const avgEntropy    = cells.reduce((s, c) => s + c.entropy, 0) / (cells.length || 1);
  const avgConfidence = cells.reduce((s, c) => s + c.confidence, 0) / (cells.length || 1);
  return {
    totalCells: cells.length,
    alive, dead, mutating, error, orphan,
    avgEntropy, avgConfidence,
    generation: grid.generation,
    converged: avgEntropy < CA_RULES.ENTROPY_CONVERGENCE,
  };
}
