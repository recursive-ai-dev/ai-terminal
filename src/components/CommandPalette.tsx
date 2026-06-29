// ============================================================
// COMMAND PALETTE v1.0 — Fuzzy search, categorized, keyboard nav
// Ctrl+Shift+P to open, Escape to close, arrows to navigate
// ============================================================
import React, { useState, useEffect, useRef, useMemo } from "react";
import { THEMES, UXSettings } from "../engine/UXSettings";


interface PaletteEntry {
  cmd: string;
  label: string;
  category: string;
  description: string;
  icon: string;
}

const PALETTE_ENTRIES: PaletteEntry[] = [
  // System
  { cmd: "help",          label: "Help",                 category: "System",    icon: "?",  description: "Show all commands" },
  { cmd: "sysinfo",       label: "System Info",          category: "System",    icon: "▣",  description: "Architecture + engine info" },
  { cmd: "clear",         label: "Clear Terminal",        category: "System",    icon: "⊘",  description: "Wipe output" },
  { cmd: "reset",         label: "Reset All State",       category: "System",    icon: "↺",  description: "Clear all tensors, nets, vars" },
  { cmd: "benchmark",     label: "Benchmark",             category: "System",    icon: "⏱",  description: "NanoTensor performance test" },
  { cmd: "logs",          label: "View Logs",             category: "System",    icon: "◈",  description: "Drain structured log buffer" },
  { cmd: "seed 42",       label: "Seed RNG (42)",         category: "System",    icon: "🎲",  description: "Set deterministic seed" },
  // Neural
  { cmd: "demo xor",      label: "Demo: XOR Problem",     category: "Neural",    icon: "⊕",  description: "MLP + Adam training demo" },
  { cmd: "demo adam",     label: "Demo: Adam Optimizer",  category: "Neural",    icon: "∇",  description: "Convergence f(x)=(x-3)²" },
  { cmd: "net.list",      label: "List Networks",         category: "Neural",    icon: "N",  description: "Show all loaded networks" },
  { cmd: "tensor.list",   label: "List Tensors",          category: "Neural",    icon: "T",  description: "Show all tensors" },
  { cmd: "adam.info",     label: "Adam Info",             category: "Neural",    icon: "∇",  description: "Show optimizer state" },
  // Performance
  { cmd: "perf.cache",    label: "Cache Stats",           category: "Perf",      icon: "⚡",  description: "L1/L2/L3 cache simulation" },
  { cmd: "perf.pipeline", label: "Pipeline State",        category: "Perf",      icon: "⟶",  description: "5-stage pipeline viewer" },
  { cmd: "perf.branch",   label: "Branch Predictor",      category: "Perf",      icon: "⋔",  description: "2-bit saturating predictor" },
  { cmd: "perf.mem",      label: "Virtual Memory",        category: "Perf",      icon: "⧠",  description: "TLB + page table stats" },
  { cmd: "perf.simd",     label: "SIMD Throughput",       category: "Perf",      icon: "▦",  description: "AVX2/SSE instruction table" },
  { cmd: "perf.full",     label: "Full Perf Report",      category: "Perf",      icon: "📊",  description: "All subsystems overview" },
  // Visualization
  { cmd: "viz.net",       label: "Visualize Network",     category: "Viz",       icon: "🔬",  description: "ASCII topology diagram" },
  { cmd: "viz.loss",      label: "Loss Curve",            category: "Viz",       icon: "📉",  description: "ASCII loss sparkline" },
  { cmd: "viz.weights",   label: "Weight Heatmap",        category: "Viz",       icon: "🌡",  description: "Layer weight visualization" },
  { cmd: "viz.gradients", label: "Gradient Flow",         category: "Viz",       icon: "∂",  description: "Backward pass gradient norms" },
  // Script
  { cmd: "script.list",   label: "List Scripts",          category: "Script",    icon: "📜",  description: "Show stored scripts" },
  { cmd: "script.new",    label: "New Script (help)",     category: "Script",    icon: "✏",  description: "How to write scripts" },
  // Registers
  { cmd: "reg.dump",      label: "Register Dump",         category: "x86",       icon: "▤",  description: "All x86_64 registers" },
  { cmd: "demo registers",label: "Demo: SIMD",            category: "x86",       icon: "⚙",  description: "AVX2 SIMD operations" },
  // Tree Logic
  { cmd: "demo tree",     label: "Demo: Tree Logic",      category: "Logic",     icon: "⬡",  description: "Boolean logic inference" },
  { cmd: "tree.list",     label: "List Trees",            category: "Logic",     icon: "⬡",  description: "Available logic trees" },
  // Math
  { cmd: "demo math",     label: "Demo: Math",            category: "Math",      icon: "∑",  description: "Math command showcase" },
  { cmd: "math.pi",       label: "π",                     category: "Math",      icon: "π",  description: "Print pi" },
  { cmd: "uuid",          label: "Generate UUID",         category: "Util",      icon: "🔑",  description: "Crypto random UUID" },
  { cmd: "time.now",      label: "Current Time",          category: "Util",      icon: "🕐",  description: "HH:MM:SS timestamp" },
  // Fetch
  { cmd: "demo fetch",    label: "Demo: Fetch",           category: "Network",   icon: "⇣",  description: "HTTP fetch examples" },
  { cmd: "fetch.list",    label: "Fetch Store",           category: "Network",   icon: "⇣",  description: "Cached HTTP responses" },
  // CA
  { cmd: "ca.editor",     label: "CA Editor",             category: "CA",        icon: "⬡",  description: "Cellular automaton editor" },
  { cmd: "ca.full",       label: "CA Full Analysis",      category: "CA",        icon: "⬡",  description: "Full CA pipeline" },
  // Settings
  { cmd: "settings",      label: "Settings",              category: "Settings",  icon: "⚙",  description: "Open UX settings panel" },
  { cmd: "demo pipe",     label: "Demo: Pipe",            category: "Util",      icon: "|",  description: "Pipe command examples" },
  { cmd: "demo stat",     label: "Demo: Statistics",      category: "Math",      icon: "∑",  description: "Statistics showcase" },
];

const CATEGORIES = Array.from(new Set(PALETTE_ENTRIES.map(e => e.category)));

function fuzzyScore(query: string, target: string): number {
  if (!query) return 1;
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (t === q) return 100;
  if (t.startsWith(q)) return 80;
  if (t.includes(q)) return 60;
  // Fuzzy: all chars of query appear in order in target
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  if (qi === q.length) return 40 - q.length;
  return 0;
}

interface Props {
  settings: UXSettings;
  onRun: (cmd: string) => void;
  onClose: () => void;
}

export default function CommandPalette({ settings: s, onRun, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const thm = THEMES[s.colorTheme];

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filtered = useMemo(() => {
    if (!query.trim()) return PALETTE_ENTRIES;
    const q = query.trim();
    return PALETTE_ENTRIES
      .map(e => ({
        entry: e,
        score: Math.max(
          fuzzyScore(q, e.cmd),
          fuzzyScore(q, e.label),
          fuzzyScore(q, e.category),
          fuzzyScore(q, e.description) * 0.5,
        ),
      }))
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(x => x.entry);
  }, [query]);

  useEffect(() => { setSelected(0); }, [filtered]);

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setSelected(i => Math.min(i + 1, filtered.length - 1)); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); setSelected(i => Math.max(i - 1, 0)); return; }
    if (e.key === "Enter") {
      e.preventDefault();
      const entry = filtered[selected];
      if (entry) { onRun(entry.cmd); onClose(); }
    }
  };

  // Scroll selected item into view
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${selected}"]`) as HTMLElement | null;
    el?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  // Group by category for display when no query
  const grouped = useMemo(() => {
    if (query.trim()) return null;
    const map = new Map<string, PaletteEntry[]>();
    for (const cat of CATEGORIES) map.set(cat, []);
    for (const e of PALETTE_ENTRIES) map.get(e.category)?.push(e);
    return map;
  }, [query]);

  const itemStyle = (idx: number) => ({
    background: idx === selected ? `${thm.rawAccent}18` : "transparent",
    borderLeft: idx === selected ? `2px solid ${thm.rawAccent}` : "2px solid transparent",
    cursor: "pointer",
  });

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-start justify-center pt-20"
      style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(8px)" }}
      onClick={onClose}
    >
      <div
        className="command-palette w-full max-w-2xl rounded-xl overflow-hidden shadow-2xl animate-scale-in"
        style={{
          background: "rgba(10,10,15,0.97)",
          border: `1px solid ${thm.rawAccent}44`,
          boxShadow: `0 0 40px ${thm.rawGlow}, 0 8px 64px rgba(0,0,0,0.8)`,
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Search input */}
        <div
          className="flex items-center gap-3 px-4 py-3"
          style={{ borderBottom: `1px solid ${thm.rawAccent}22` }}
        >
          <span style={{ color: thm.rawAccent, fontSize: 18, opacity: 0.7 }}>⌕</span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Search commands…"
            className="flex-1 bg-transparent outline-none text-sm"
            style={{
              color: "rgba(255,255,255,0.9)",
              fontFamily: "inherit",
              caretColor: thm.rawAccent,
            }}
            spellCheck={false}
          />
          <span className="text-xs" style={{ color: `${thm.rawAccent}55` }}>
            {filtered.length} results
          </span>
          <button
            onClick={onClose}
            className="text-xs px-2 py-0.5 rounded"
            style={{ color: `${thm.rawAccent}77`, border: `1px solid ${thm.rawAccent}33` }}
          >Esc</button>
        </div>

        {/* Results */}
        <div
          ref={listRef}
          className="overflow-y-auto"
          style={{ maxHeight: "480px" }}
        >
          {query.trim() ? (
            // Flat filtered results
            filtered.length === 0 ? (
              <div className="px-6 py-8 text-center text-sm" style={{ color: `${thm.rawAccent}44` }}>
                No matching commands
              </div>
            ) : (
              filtered.map((entry, idx) => (
                <PaletteItem
                  key={entry.cmd}
                  entry={entry}
                  idx={idx}
                  style={itemStyle(idx)}
                  thm={thm}
                  onMouseEnter={() => setSelected(idx)}
                  onClick={() => { onRun(entry.cmd); onClose(); }}
                />
              ))
            )
          ) : (
            // Grouped by category
            CATEGORIES.map(cat => {
              const entries = grouped?.get(cat) ?? [];
              if (entries.length === 0) return null;
              return (
                <div key={cat}>
                  <div
                    className="px-4 py-1.5 text-xs font-bold uppercase tracking-widest"
                    style={{ color: `${thm.rawAccent}66`, borderBottom: `1px solid ${thm.rawAccent}11` }}
                  >
                    {cat}
                  </div>
                  {entries.map((entry) => {
                    const globalIdx = PALETTE_ENTRIES.indexOf(entry);
                    return (
                      <PaletteItem
                        key={entry.cmd}
                        entry={entry}
                        idx={globalIdx}
                        style={itemStyle(globalIdx)}
                        thm={thm}
                        onMouseEnter={() => setSelected(globalIdx)}
                        onClick={() => { onRun(entry.cmd); onClose(); }}
                      />
                    );
                  })}
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div
          className="flex items-center gap-4 px-4 py-2 text-xs"
          style={{ borderTop: `1px solid ${thm.rawAccent}11`, color: `${thm.rawAccent}44` }}
        >
          <span>↑↓ navigate</span>
          <span>↵ run</span>
          <span>Esc close</span>
          <span className="ml-auto">Ctrl+Shift+P</span>
        </div>
      </div>
    </div>
  );
}

function PaletteItem({
  entry, idx, style, thm, onMouseEnter, onClick,
}: {
  entry: PaletteEntry;
  idx: number;
  style: React.CSSProperties;
  thm: (typeof THEMES)[keyof typeof THEMES];
  onMouseEnter: () => void;
  onClick: () => void;
}) {
  return (
    <div
      data-idx={idx}
      className="flex items-center gap-3 px-4 py-2.5 transition-colors"
      style={style}
      onMouseEnter={onMouseEnter}
      onClick={onClick}
    >
      <span className="text-lg w-7 text-center flex-shrink-0" style={{ color: thm.rawAccent }}>
        {entry.icon}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-medium text-white">{entry.label}</span>
          <span className="text-xs font-mono" style={{ color: `${thm.rawAccent}88` }}>
            {entry.cmd}
          </span>
        </div>
        <div className="text-xs truncate" style={{ color: "rgba(255,255,255,0.35)" }}>
          {entry.description}
        </div>
      </div>
      <span
        className="text-xs px-1.5 py-0.5 rounded flex-shrink-0"
        style={{ background: `${thm.rawAccent}11`, color: `${thm.rawAccent}66`, border: `1px solid ${thm.rawAccent}22` }}
      >
        {entry.category}
      </span>
    </div>
  );
}


