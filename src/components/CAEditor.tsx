// ============================================================
// CA EDITOR — Living Cellular Automaton Code Editor
// Visual cell grid: color-coded by state, type, entropy
// Embedded inline in the terminal — no external deps
// ============================================================

import { useState, useCallback, useRef, useEffect } from "react";
import { UXSettings } from "../engine/UXSettings";
import { executeCAChain, formatCAError, CAResult, CAMode } from "../engine/CAChain";
import { CellGrid, Cell, Language, tokenize } from "../engine/CASyntax";

interface CAEditorProps {
  settings: UXSettings;
  onOutput: (lines: string[]) => void;
  onClose:  () => void;
}

const EXAMPLE_SOURCES: Record<string, { source: string; lang: Language }> = {
  python: {
    lang: "python",
    source: `def fibonacci(n):
    if n <= 1:
        retrn n
    return fibonacci(n - 1) + fibonacci(n - 2)

for i in range(10):
    pritn(fibonacci(i))
`,
  },
  js: {
    lang: "js",
    source: `functoin greet(name) {
  const msg = "Hello, " + name + "!";
  cosnt result = {
    message: msg,
    length: msg.length
  };
  retrun result;
}

greet("World");
`,
  },
  html: {
    lang: "html",
    source: `<!DOCTYPE html>
<html>
  <head>
    <title>Test</title>
  </head>
  <body>
    <div class="container">
      <h1>Hello World<h1>
      <p>This is a <em>test</em></p>
    </div>
  </body>
</html>
`,
  },
  xor_network: {
    lang: "python",
    source: `# XOR Neural Network in Python
import numpy as np

class NeuralNetwork:
    deff __init__(self, layers):
        self.layers = layers
        self.weights = []
        self.biases = []
    
    def forward(self, x)
        for W, b in zip(self.weights, self.biases):
            x = np.relu(x @ W + b)
        retrn x

net = NeuralNetwork([2, 4, 1])
`,
  },
};

// ── Cell state/type color mapping ─────────────────────────
const STATE_COLORS: Record<string, string> = {
  ALIVE:    "bg-green-900/40 border-green-700/50 text-green-300",
  DEAD:     "bg-gray-800/30 border-gray-700/20 text-gray-600 line-through",
  MUTATING: "bg-yellow-900/40 border-yellow-600/50 text-yellow-300",
  ERROR:    "bg-red-900/40 border-red-600/50 text-red-300",
  ORPHAN:   "bg-orange-900/40 border-orange-600/50 text-orange-300",
};

const TYPE_COLORS: Record<string, string> = {
  KEYWORD:    "font-bold text-purple-300",
  IDENTIFIER: "text-cyan-300",
  OPERATOR:   "text-yellow-400",
  DELIMITER:  "text-pink-400",
  LITERAL:    "text-green-400",
  COMMENT:    "text-gray-500 italic",
  WHITESPACE: "",
  UNKNOWN:    "text-red-400 underline decoration-dotted",
};

function CellView({ cell, onClick }: { cell: Cell; onClick: (c: Cell) => void }) {
  if (cell.type === "WHITESPACE") {
    return <span className="whitespace-pre">{cell.token}</span>;
  }

  const stateClass = STATE_COLORS[cell.state] ?? "";
  const typeClass  = TYPE_COLORS[cell.type] ?? "";
  const entropyOpacity = Math.round((1 - cell.entropy * 0.5) * 100);

  return (
    <span
      className={`
        inline-block px-0.5 mx-px rounded border
        text-xs cursor-pointer
        transition-all duration-200
        ${stateClass} ${typeClass}
        hover:brightness-125
      `}
      style={{ opacity: `${entropyOpacity}%` }}
      title={`${cell.type} | ${cell.state} | entropy=${cell.entropy.toFixed(3)} | conf=${cell.confidence.toFixed(3)}\n${cell.ruleHistory.slice(-3).join("\n")}`}
      onClick={() => onClick(cell)}
    >
      {cell.suggestion && cell.state === "MUTATING"
        ? <span><s className="opacity-50">{cell.token}</s>→<span className="text-yellow-200">{cell.suggestion}</span></span>
        : cell.token
      }
    </span>
  );
}

function LineView({ cells, lineNum, onClick }: {
  cells: Cell[];
  lineNum: number;
  onClick: (c: Cell) => void;
}) {
  return (
    <div className="flex items-start group hover:bg-white/5 rounded">
      <span className="select-none text-gray-600 text-xs w-8 flex-shrink-0 text-right mr-2 mt-0.5 group-hover:text-gray-400">
        {lineNum}
      </span>
      <div className="flex-1 flex flex-wrap items-start font-mono text-xs leading-6 min-h-5">
        {cells.map(cell => (
          <CellView key={cell.id} cell={cell} onClick={onClick} />
        ))}
      </div>
    </div>
  );
}

// ── Cell Inspector ─────────────────────────────────────────
function CellInspector({ cell, onClose }: { cell: Cell; onClose: () => void }) {
  return (
    <div className="absolute right-0 top-0 z-10 bg-gray-900 border border-gray-700 rounded-lg p-3 text-xs font-mono w-72 shadow-xl">
      <div className="flex items-center justify-between mb-2">
        <span className="text-cyan-400 font-bold">Cell Inspector</span>
        <button onClick={onClose} className="text-gray-500 hover:text-white">✕</button>
      </div>
      <div className="space-y-1 text-gray-300">
        <div><span className="text-gray-500">id:</span> {cell.id}</div>
        <div><span className="text-gray-500">token:</span> <span className="text-green-400">"{cell.token}"</span></div>
        <div><span className="text-gray-500">type:</span> <span className="text-purple-300">{cell.type}</span></div>
        <div><span className="text-gray-500">state:</span> <span className={
          cell.state === "ALIVE" ? "text-green-400" :
          cell.state === "ERROR" ? "text-red-400" :
          cell.state === "MUTATING" ? "text-yellow-400" :
          "text-gray-400"
        }>{cell.state}</span></div>
        <div><span className="text-gray-500">entropy:</span> {cell.entropy.toFixed(4)}</div>
        <div><span className="text-gray-500">confidence:</span> {cell.confidence.toFixed(4)}</div>
        <div><span className="text-gray-500">pos:</span> row={cell.row}, col={cell.col}</div>
        <div><span className="text-gray-500">generation:</span> {cell.generation}</div>
        {cell.suggestion && (
          <div><span className="text-gray-500">suggestion:</span> <span className="text-yellow-300">"{cell.suggestion}"</span></div>
        )}
        {cell.dagEdges.length > 0 && (
          <div><span className="text-gray-500">dag→:</span> [{cell.dagEdges.slice(0, 5).join(", ")}]</div>
        )}
        {cell.ruleHistory.length > 0 && (
          <div>
            <span className="text-gray-500">rules:</span>
            <div className="pl-2 mt-1 space-y-0.5">
              {cell.ruleHistory.slice(-5).map((r, i) => (
                <div key={i} className="text-gray-400 text-xs">{r}</div>
              ))}
            </div>
          </div>
        )}
        <div>
          <span className="text-gray-500">neighborhood:</span>
          <div className="grid grid-cols-3 gap-0.5 mt-1 text-center text-xs">
            {[
              cell.neighborhood.ul, cell.neighborhood.up, cell.neighborhood.ur,
              cell.neighborhood.left, null, cell.neighborhood.right,
              cell.neighborhood.dl, cell.neighborhood.down, cell.neighborhood.dr,
            ].map((nb, i) => (
              <div key={i} className={`border rounded px-1 py-0.5 ${nb ? "border-gray-600 text-gray-300" : "border-gray-800 text-gray-700"}`}>
                {i === 4 ? <span className="text-cyan-500">●</span> : (nb ? nb.token.slice(0, 6) : "·")}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Stats Bar ─────────────────────────────────────────────
function StatsBar({ grid }: { grid: CellGrid }) {
  const cells = grid.cells.filter(c => c.type !== "WHITESPACE");
  const alive    = cells.filter(c => c.state === "ALIVE").length;
  const err      = cells.filter(c => c.state === "ERROR").length;
  const mutating = cells.filter(c => c.state === "MUTATING").length;
  const dead     = cells.filter(c => c.state === "DEAD").length;
  const avgEnt   = cells.reduce((s, c) => s + c.entropy, 0) / (cells.length || 1);

  return (
    <div className="flex items-center gap-3 px-3 py-1.5 bg-gray-900/50 border-b border-gray-800 text-xs font-mono flex-wrap">
      <span className="text-gray-500">G{grid.generation}</span>
      <span className="text-green-400">●{alive} alive</span>
      {err > 0 && <span className="text-red-400">✗{err} error</span>}
      {mutating > 0 && <span className="text-yellow-400">◉{mutating} mutating</span>}
      {dead > 0 && <span className="text-gray-500">○{dead} dead</span>}
      <span className="text-cyan-400">entropy={avgEnt.toFixed(3)}</span>
      <span className="text-gray-500 ml-auto">{cells.length} cells</span>
    </div>
  );
}

// ── Main CAEditor Component ────────────────────────────────
export default function CAEditor({ settings, onOutput, onClose }: CAEditorProps) {
  const [source, setSource] = useState(EXAMPLE_SOURCES.python.source);
  const [lang, setLang] = useState<Language>("python");
  const [grid, setGrid] = useState<CellGrid | null>(null);
  const [selectedCell, setSelectedCell] = useState<Cell | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [mode, setMode] = useState<CAMode>("full");
  const [maxGen, setMaxGen] = useState(8);
  const [lastResult, setLastResult] = useState<CAResult | null>(null);
  const [activeTab, setActiveTab] = useState<"editor" | "grid" | "stats">("editor");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Live tokenize as user types
  useEffect(() => {
    if (source.trim().length === 0) { setGrid(null); return; }
    try {
      const { grid: g } = tokenize(source, lang);
      setGrid(g);
    } catch { /* ignore parse errors */ }
  }, [source, lang]);

  const runCA = useCallback(() => {
    if (!source.trim()) return;
    setIsRunning(true);
    setSelectedCell(null);

    // Use setTimeout to allow React to render "running..." before compute
    setTimeout(() => {
      try {
        const result = executeCAChain({ source, lang, maxGenerations: maxGen, mode });
        if (result.ok) {
          setLastResult(result.value);
          setGrid(result.value.dag ? result.value.dag.nodes.size > 0
            ? (() => { const { grid: g } = tokenize(result.value.correctedSource ?? source, lang); return g; })()
            : grid
            : grid);
          onOutput(result.value.displayLines);
          if (result.value.correctedSource && result.value.correctedSource !== source) {
            setActiveTab("grid");
          }
        } else {
          onOutput(formatCAError(result.error));
        }
      } catch (e: unknown) {
        onOutput([`[CA ERROR] ${e instanceof Error ? e.message : String(e)}`]);
      } finally {
        setIsRunning(false);
      }
    }, 10);
  }, [source, lang, maxGen, mode, grid, onOutput]);

  const applyCorrections = useCallback(() => {
    if (lastResult?.correctedSource) {
      setSource(lastResult.correctedSource);
      onOutput([`[CA] Applied ${lastResult.entropyReport.corrections.length} corrections to editor`]);
    }
  }, [lastResult, onOutput]);

  const loadExample = useCallback((key: string) => {
    const ex = EXAMPLE_SOURCES[key];
    if (ex) { setSource(ex.source); setLang(ex.lang); }
  }, []);

  const btnClass = `px-2 py-1 text-xs border rounded transition-colors`;
  const thm = settings.colorTheme;
  const borderCol = thm === "amber" ? "border-amber-800" : thm === "cyan" ? "border-cyan-900" : "border-gray-700";

  return (
    <div
      className={`flex flex-col h-full bg-gray-950 border-l ${borderCol} text-xs font-mono`}
      style={{ minHeight: 0, fontFamily: "monospace" }}
      onClick={e => e.stopPropagation()}
    >
      {/* ── Titlebar ── */}
      <div className={`flex items-center justify-between px-3 py-2 bg-gray-900 border-b ${borderCol} flex-shrink-0`}>
        <div className="flex items-center gap-2">
          <span className="text-green-400 font-bold text-sm">⬡ CA Editor</span>
          <span className="text-gray-500">v1.0.0</span>
          <span className="text-purple-400">Cellular Syntax Automaton</span>
        </div>
        <button
          onClick={onClose}
          className="text-gray-500 hover:text-white transition-colors px-1"
        >✕</button>
      </div>

      {/* ── Controls ── */}
      <div className={`flex items-center gap-2 px-3 py-2 bg-gray-900/80 border-b ${borderCol} flex-shrink-0 flex-wrap`}>
        {/* Language selector */}
        <select
          value={lang}
          onChange={e => setLang(e.target.value as Language)}
          className="bg-gray-800 border border-gray-700 rounded text-xs text-gray-300 px-2 py-1"
        >
          <option value="python">Python</option>
          <option value="js">JavaScript</option>
          <option value="html">HTML</option>
          <option value="css">CSS</option>
          <option value="unknown">Auto-detect</option>
        </select>

        {/* Mode selector */}
        <select
          value={mode}
          onChange={e => setMode(e.target.value as CAMode)}
          className="bg-gray-800 border border-gray-700 rounded text-xs text-gray-300 px-2 py-1"
        >
          <option value="full">Full (all stages)</option>
          <option value="analyze">Analyze only</option>
          <option value="correct">Correct</option>
          <option value="dag">DAG / GoT</option>
          <option value="audit">Metacog Audit</option>
          <option value="step">Single step</option>
        </select>

        {/* Max generations */}
        <div className="flex items-center gap-1">
          <span className="text-gray-500">gen:</span>
          <input
            type="number"
            value={maxGen}
            onChange={e => setMaxGen(Math.max(1, Math.min(64, parseInt(e.target.value) || 8)))}
            className="bg-gray-800 border border-gray-700 rounded text-xs text-gray-300 px-2 py-1 w-14"
            min={1} max={64}
          />
        </div>

        {/* Run button */}
        <button
          onClick={runCA}
          disabled={isRunning || !source.trim()}
          className={`${btnClass} bg-green-900/50 border-green-700 text-green-300 hover:bg-green-800/50 disabled:opacity-40`}
        >
          {isRunning ? "⟳ evolving..." : "▶ evolve"}
        </button>

        {/* Apply corrections */}
        {lastResult?.correctedSource && lastResult.correctedSource !== source && (
          <button
            onClick={applyCorrections}
            className={`${btnClass} bg-yellow-900/50 border-yellow-700 text-yellow-300 hover:bg-yellow-800/50`}
          >
            ✓ apply {lastResult.entropyReport.corrections.length} fix(es)
          </button>
        )}

        {/* Examples */}
        <div className="flex items-center gap-1 ml-auto">
          <span className="text-gray-600">examples:</span>
          {Object.keys(EXAMPLE_SOURCES).map(k => (
            <button
              key={k}
              onClick={() => loadExample(k)}
              className={`${btnClass} bg-gray-800 border-gray-700 text-gray-400 hover:text-gray-200`}
            >
              {k}
            </button>
          ))}
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className={`flex border-b ${borderCol} flex-shrink-0`}>
        {(["editor", "grid", "stats"] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-3 py-1.5 text-xs transition-colors ${
              activeTab === tab
                ? "text-green-400 border-b-2 border-green-400 bg-gray-900/30"
                : "text-gray-500 hover:text-gray-300"
            }`}
          >
            {tab === "editor" ? "📝 Source" : tab === "grid" ? "⬡ Cell Grid" : "📊 Stats"}
          </button>
        ))}
        {grid && (
          <div className="ml-auto flex items-center px-3 gap-2 text-xs text-gray-600">
            <span>{grid.cells.filter(c => c.type !== "WHITESPACE").length} cells</span>
            <span>G{grid.generation}</span>
            <span className={`text-${grid.cells.filter(c => c.state === "ERROR").length > 0 ? "red" : "green"}-500`}>
              {grid.cells.filter(c => c.state === "ERROR").length} errors
            </span>
          </div>
        )}
      </div>

      {/* ── Content ── */}
      <div className="flex-1 overflow-hidden flex flex-col min-h-0 relative">
        {activeTab === "editor" && (
          <div className="flex-1 flex flex-col min-h-0">
            {grid && <StatsBar grid={grid} />}
            <textarea
              ref={textareaRef}
              value={source}
              onChange={e => setSource(e.target.value)}
              className="flex-1 bg-transparent text-gray-300 font-mono text-xs p-3 resize-none outline-none leading-6"
              placeholder="Paste or type Python / JS / HTML code here..."
              spellCheck={false}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
            />
          </div>
        )}

        {activeTab === "grid" && grid && (
          <div className="flex-1 overflow-y-auto relative">
            <StatsBar grid={grid} />
            {selectedCell && (
              <div className="relative">
                <CellInspector cell={selectedCell} onClose={() => setSelectedCell(null)} />
              </div>
            )}
            <div className="p-2 space-y-0.5">
              {grid.lineMap.map((rowIds, rowIdx) => {
                const cells = rowIds.map(id => grid.cells[id]).filter(Boolean);
                if (cells.length === 0) return (
                  <div key={rowIdx} className="h-5 flex">
                    <span className="select-none text-gray-700 w-8 text-right mr-2 text-xs">{rowIdx + 1}</span>
                  </div>
                );
                return (
                  <LineView
                    key={rowIdx}
                    cells={cells}
                    lineNum={rowIdx + 1}
                    onClick={setSelectedCell}
                  />
                );
              })}
            </div>
            <div className="px-3 py-2 border-t border-gray-800 text-gray-600 text-xs">
              Click any cell to inspect its Moore neighborhood, state, entropy, and rule history.
            </div>
          </div>
        )}

        {activeTab === "grid" && !grid && (
          <div className="flex-1 flex items-center justify-center text-gray-600">
            <div className="text-center">
              <div className="text-4xl mb-2">⬡</div>
              <div>Type source code in the editor, then click ▶ evolve</div>
            </div>
          </div>
        )}

        {activeTab === "stats" && (
          <div className="flex-1 overflow-y-auto p-3 space-y-4">
            {lastResult ? (
              <>
                {/* Summary */}
                <div className="border border-gray-800 rounded p-3">
                  <div className="text-green-400 font-bold mb-2">Evolution Summary</div>
                  <div className="grid grid-cols-2 gap-1 text-gray-300">
                    <div><span className="text-gray-500">lang:</span> {lastResult.lang}</div>
                    <div><span className="text-gray-500">mode:</span> {lastResult.mode}</div>
                    <div><span className="text-gray-500">generations:</span> {lastResult.generationsRun}</div>
                    <div><span className="text-gray-500">converged:</span> {lastResult.converged ? "✓" : "✗"}</div>
                    <div><span className="text-gray-500">cells alive:</span> {lastResult.finalStats.alive}</div>
                    <div><span className="text-gray-500">errors:</span> {lastResult.finalStats.error}</div>
                    <div><span className="text-gray-500">corrections:</span> {lastResult.entropyReport.corrections.length}</div>
                    <div><span className="text-gray-500">elapsed:</span> {lastResult.latency_ms.toFixed(1)}ms</div>
                  </div>
                </div>

                {/* Entropy chart */}
                <div className="border border-gray-800 rounded p-3">
                  <div className="text-cyan-400 font-bold mb-2">Entropy Evolution</div>
                  {lastResult.statsPerGeneration.map((s, g) => (
                    <div key={g} className="flex items-center gap-2 mb-1">
                      <span className="text-gray-500 w-8">G{g + 1}</span>
                      <div className="flex-1 bg-gray-800 rounded h-3 overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-green-700 to-red-700 transition-all"
                          style={{ width: `${s.avgEntropy * 100}%` }}
                        />
                      </div>
                      <span className="text-gray-400 w-12 text-right">{(s.avgEntropy * 100).toFixed(1)}%</span>
                    </div>
                  ))}
                </div>

                {/* Metacognitive report */}
                {lastResult.metacogReport && (
                  <div className="border border-gray-800 rounded p-3">
                    <div className="text-purple-400 font-bold mb-2">
                      Metacognitive Audit — Score: {lastResult.metacogReport.overallScore}/100
                    </div>
                    <div className="space-y-1 text-gray-300">
                      <div>
                        <span className={lastResult.metacogReport.stage1_understand.valid ? "text-green-400" : "text-red-400"}>
                          {lastResult.metacogReport.stage1_understand.valid ? "✓" : "✗"}
                        </span>
                        {" Stage 1: "}{lastResult.metacogReport.stage1_understand.notes[0]}
                      </div>
                      <div>
                        <span className={lastResult.metacogReport.stage2_judge.converges ? "text-green-400" : "text-red-400"}>
                          {lastResult.metacogReport.stage2_judge.converges ? "✓" : "✗"}
                        </span>
                        {" Stage 2: "}{lastResult.metacogReport.stage2_judge.notes[0]}
                      </div>
                      <div>
                        <span className={lastResult.metacogReport.stage3_critique.tornWriteRisks.length === 0 ? "text-green-400" : "text-yellow-400"}>
                          {lastResult.metacogReport.stage3_critique.tornWriteRisks.length === 0 ? "✓" : "⚠"}
                        </span>
                        {" Stage 3: "}
                        {lastResult.metacogReport.stage3_critique.tornWriteRisks.length === 0
                          ? "No torn-write risks"
                          : `${lastResult.metacogReport.stage3_critique.tornWriteRisks.length} risk(s)`}
                      </div>
                      <div>
                        <span className={lastResult.metacogReport.stage4_finalize.hardened ? "text-green-400" : "text-yellow-400"}>
                          {lastResult.metacogReport.stage4_finalize.hardened ? "✓" : "⚠"}
                        </span>
                        {" Stage 4: "}{lastResult.metacogReport.stage4_finalize.hardened ? "Hardened" : "Risks remain"} ({lastResult.metacogReport.stage4_finalize.corrections} corrections)
                      </div>
                      <div>
                        <span className="text-cyan-400">★</span>
                        {" Stage 5: "}confidence={lastResult.metacogReport.stage5_calibrate.confidence}% exactly-once={lastResult.metacogReport.stage5_calibrate.exactOnceScore}%
                      </div>
                    </div>
                  </div>
                )}

                {/* Corrections */}
                {lastResult.entropyReport.corrections.length > 0 && (
                  <div className="border border-gray-800 rounded p-3">
                    <div className="text-yellow-400 font-bold mb-2">
                      Corrections ({lastResult.entropyReport.corrections.length})
                    </div>
                    <div className="space-y-1">
                      {lastResult.entropyReport.corrections.map((c, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <span className="text-red-400 line-through">"{c.from}"</span>
                          <span className="text-gray-500">→</span>
                          <span className="text-green-400">"{c.to}"</span>
                          <span className="text-gray-600">cell#{c.cellId}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Audit trail */}
                <div className="border border-gray-800 rounded p-3">
                  <div className="text-gray-400 font-bold mb-2">Audit Trail</div>
                  <div className="space-y-0.5 text-gray-500">
                    {lastResult.auditTrail.map((line, i) => (
                      <div key={i}>{line}</div>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <div className="flex items-center justify-center h-32 text-gray-600">
                Run ▶ evolve to see statistics
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Legend footer ── */}
      <div className={`flex items-center gap-3 px-3 py-1.5 border-t ${borderCol} bg-gray-900/50 flex-shrink-0 flex-wrap`}>
        <span className="text-green-400">● ALIVE</span>
        <span className="text-yellow-400">◉ MUTATING</span>
        <span className="text-red-400">✗ ERROR</span>
        <span className="text-gray-500">○ DEAD</span>
        <span className="text-orange-400">◌ ORPHAN</span>
        <span className="ml-auto text-gray-600">Moore 8-neighborhood · GoT DAG · entropy reduction</span>
      </div>
    </div>
  );
}
