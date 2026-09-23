import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { processCommand, globalState, achievementEngine } from "./engine/CommandProcessor";
import {
  UXSettings, loadSettings, THEMES, FONT_STACKS,
  TERMINAL_WIDTH_CLASS, OUTPUT_DENSITY_CLASS,
  resolvePrompt, matchesKey, ALL_COMPLETIONS,
} from "./engine/UXSettings";
import { liveMetrics } from "./engine/LiveMetrics";
import SettingsPanel from "./components/SettingsPanel";
import SuggestionBar from "./components/SuggestionBar";
import NativeTitleBar from "./components/NativeTitleBar";
import CAEditor from "./components/CAEditor";
import AchievementToast from "./components/AchievementToast";
import RealTerminal from "./components/RealTerminal";
import { usePlatform } from "./bridge/usePlatform";
import { isElectron } from "./bridge/electronBridge";
import type { Achievement } from "./engine/AchievementEngine";

/* ================================================================
   HELPERS
   ================================================================ */
function timestamp(): string {
  const n = new Date();
  return `${String(n.getHours()).padStart(2,"0")}:${String(n.getMinutes()).padStart(2,"0")}:${String(n.getSeconds()).padStart(2,"0")}`;
}

function colorize(line: string): string {
  if (line.startsWith("[ACH]") || line.startsWith("[PROFILE]") || line.startsWith("║  Level") || line.startsWith("║  XP")) return "text-yellow-300";
  if (line.startsWith("[ERROR]") || line.startsWith("[EXCEPTION]")) return "text-red-400";
  if (line.startsWith("[TRAIN]") || line.includes("epoch"))         return "text-yellow-300";
  if (line.startsWith("[TENSOR]") || line.startsWith("Tensor("))   return "text-cyan-300";
  if (line.startsWith("[NET]") || line.startsWith("Network:") || line.startsWith("  Layer")) return "text-green-300";
  if (line.startsWith("[ADAM]"))   return "text-purple-300";
  if (line.startsWith("[REG]") || line.startsWith("[STACK]") || line.startsWith("[XMM]") || line.startsWith("[YMM]") || line.startsWith("[SIMD]") || line.startsWith("[CMP]")) return "text-orange-300";
  if (line.startsWith("[TREE]") || line.startsWith("[BACKWARD") || line.startsWith("[RULE]") || line.startsWith("[QUERY]") || line.startsWith("[KNOWN]")) return "text-pink-300";
  if (line.startsWith("[AUTOGRAD]") || line.startsWith("[GRAD]")) return "text-indigo-300";
  if (line.startsWith("[PREDICT]")) return "text-teal-300";
  if (line.startsWith("[DEMO]") || line.startsWith("[BENCHMARK]")) return "text-amber-300";
  if (line.startsWith("[NORM]") || line.startsWith("[MSE]")) return "text-lime-300";
  if (line.startsWith("[FETCH]") || line.startsWith("[HEAD]") || line.startsWith("[POST]") || line.startsWith("[SPIDER]") || line.startsWith("[LINKS]") || line.startsWith("[WGET]")) return "text-emerald-300";
  if (line.startsWith("  [FETCH]") || line.startsWith("  ✓") || line.startsWith("  ✗") || line.startsWith("  →")) return "text-emerald-200";
  if (line.startsWith("[RESET]")) return "text-red-300";
  if (line.startsWith("[CA]") || line.startsWith("[CELL]") || line.startsWith("[DAG]")) return "text-violet-300";
  if (line.startsWith("[MATH]") || line.startsWith("[CALC]")) return "text-sky-300";
  if (line.startsWith("[JSON]")) return "text-teal-300";
  if (line.startsWith("[STR]") || line.startsWith("[BASE64]") || line.startsWith("[HASH]")) return "text-rose-300";
  if (line.startsWith("[TIME]") || line.startsWith("[RNG]") || line.startsWith("[LOGS]")) return "text-fuchsia-300";
  if (line.startsWith("[VAR]") || line.startsWith("[ALIAS]")) return "text-cyan-400";
  if (line.startsWith("[STAT]") || line.startsWith("[COLOR]") || line.startsWith("[MATRIX]")) return "text-lime-300";
  if (line.startsWith("[FILE]") || line.startsWith("[SETTINGS]")) return "text-amber-200";
  if (line.startsWith("[TB]") || line.startsWith("[METRICS]") || line.startsWith("[DASH]")) return "text-fuchsia-300";
  if (line.startsWith("[SCRIPT]") || line.startsWith("[MACRO]") || line.startsWith("[SESSION]")) return "text-cyan-200";
  if (line.startsWith("[PERF]") || line.startsWith("[PIPELINE]") || line.startsWith("[CACHE]")) return "text-orange-200";
  if (line.startsWith("╔") || line.startsWith("║") || line.startsWith("╚") || line.startsWith("╠") || line.startsWith("╗") || line.startsWith("╝") || line.startsWith("┌") || line.startsWith("│") || line.startsWith("└") || line.startsWith("├")) return "text-sky-400";
  if (line.startsWith("━━")) return "text-gray-500";
  if (line.startsWith("  ")) return "text-gray-300";
  return "";
}

function isErrorLine(line: string): boolean {
  return line.startsWith("[ERROR]") || line.startsWith("[EXCEPTION]");
}

interface HistoryEntry {
  type: "input" | "output" | "banner";
  lines: string[];
  ts?: string;
  index?: number;
}

/* ================================================================
   BOOT BANNER
   ================================================================ */
const BOOT_BANNER: string[] = [
  "  ██╗  ██╗ █████╗  ██████╗      ███╗   ██╗███████╗██╗   ██╗██████╗  █████╗ ██╗     ",
  "  ╚██╗██╔╝██╔══██╗██╔════╝      ████╗  ██║██╔════╝██║   ██║██╔══██╗██╔══██╗██║     ",
  "   ╚███╔╝ ╚█████╔╝███████╗█████╗██╔██╗ ██║█████╗  ██║   ██║██████╔╝███████║██║     ",
  "   ██╔██╗ ██╔══██╗██╔═══╝ ╚════╝██║╚██╗██║██╔══╝  ██║   ██║██╔══██╗██╔══██║██║     ",
  "  ██╔╝ ██╗╚█████╔╝╚██████╗      ██║ ╚████║███████╗╚██████╔╝██║  ██║██║  ██║███████╗",
  "  ╚═╝  ╚═╝ ╚════╝  ╚═════╝      ╚═╝  ╚═══╝╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝",
  "",
  "  ┌──────────────────────────────────────────────────────────────────────────────────┐",
  "  │  arch: x86_64  │  NanoTensor+Autograd  │  Adam+AMSGrad  │  MLP  │  TreeLogic   │",
  "  │  wget engine   │  pipe chain  │  cellular automaton  │  tb.*  │  metrics.*     │",
  "  │  script engine │  perf engine │  viz engine  │  100+ commands  │  achievements │",
  "  └──────────────────────────────────────────────────────────────────────────────────┘",
  "",
  "  Type 'help' · 'metrics.dash' · 'tb.list' · 'profile' · 'demo xor'",
];

/* ================================================================
   QUICK COMMANDS
   ================================================================ */
const QUICK_CMDS = [
  { label: "help",       cmd: "help",            icon: "?" },
  { label: "sysinfo",    cmd: "sysinfo",          icon: "▣" },
  { label: "demo xor",   cmd: "demo xor",         icon: "⊕" },
  { label: "demo tree",  cmd: "demo tree",         icon: "⬡" },
  { label: "demo reg",   cmd: "demo registers",    icon: "⚙" },
  { label: "demo adam",  cmd: "demo adam",         icon: "∇" },
  { label: "demo fetch", cmd: "demo fetch",        icon: "⇣" },
  { label: "demo math",  cmd: "demo math",         icon: "∑" },
  { label: "demo pipe",  cmd: "demo pipe",         icon: "|" },
  { label: "bench",      cmd: "benchmark",         icon: "⏱" },
  { label: "CA editor",  cmd: "__ca_editor__",     icon: "⬡" },
  { label: "reg.dump",   cmd: "reg.dump",          icon: "▤" },
  { label: "t.list",     cmd: "tensor.list",       icon: "T" },
  { label: "n.list",     cmd: "net.list",          icon: "N" },
  { label: "tb.list",    cmd: "tb.list",           icon: "◈" },
  { label: "metrics",    cmd: "metrics.dash",      icon: "📊" },
  { label: "profile",    cmd: "profile",           icon: "★" },
  { label: "logs",       cmd: "logs",              icon: "◈" },
  { label: "clear",      cmd: "clear",             icon: "⊘" },
  { label: "settings",   cmd: "__settings__",      icon: "⚙" },
];

/* ================================================================
   THEME → CSS VARIABLES
   ================================================================ */
function applyThemeVars(thm: { rawAccent: string; rawGlow: string }) {
  const root = document.documentElement;
  root.style.setProperty("--accent-color", thm.rawAccent);
  root.style.setProperty("--accent-glow",  thm.rawGlow);
}

/* ================================================================
   STATUS CHIP
   ================================================================ */
function StatusChip({ label, value, glow, onClick }: {
  label: string; value: string | number; glow?: boolean; onClick?: () => void
}) {
  return (
    <span
      className={`status-chip ${glow ? "animate-glow-pulse" : ""} ${onClick ? "cursor-pointer hover:opacity-90" : ""}`}
      style={{ color: "var(--accent-color)", borderColor: "var(--accent-color)22" }}
      onClick={onClick}
    >
      <span style={{ color: "var(--accent-color)", opacity: 0.5 }}>{label}</span>
      <span style={{ color: "var(--accent-color)" }}>{value}</span>
    </span>
  );
}

/* ================================================================
   LIVE METRIC BAR
   ================================================================ */
function LiveMetricBar({ thm, onCommand }: {
  thm: { rawAccent: string; rawGlow: string };
  onCommand: (cmd: string) => void;
}) {
  const [metrics, setMetrics] = useState({ cpm: 0, lat: "0.0", err: "0.0", dur: "0s", spark: "─────────────────────" });

  useEffect(() => {
    const id = setInterval(() => {
      setMetrics({
        cpm: liveMetrics.getCPM(),
        lat: liveMetrics.getAvgLatency().toFixed(1),
        err: (liveMetrics.getErrorRate() * 100).toFixed(1),
        dur: liveMetrics.getSessionDuration(),
        spark: liveMetrics.getSparkline("commandsPerMin", 21),
      });
    }, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div
      className="flex items-center gap-3 px-4 py-1 flex-shrink-0 overflow-x-auto"
      style={{
        background: "rgba(0,0,0,0.4)",
        borderBottom: `1px solid ${thm.rawAccent}18`,
        fontSize: "0.65rem",
        letterSpacing: "0.05em",
        backdropFilter: "blur(8px)",
        fontFamily: "monospace",
      }}
    >
      <span style={{ color: `${thm.rawAccent}66`, marginRight: 2 }}>LIVE</span>
      <span style={{ color: thm.rawAccent }}>CPM: <strong>{metrics.cpm}</strong></span>
      <span style={{ color: `${thm.rawAccent}88` }}>|</span>
      <span style={{ color: thm.rawAccent }}>LAT: <strong>{metrics.lat}ms</strong></span>
      <span style={{ color: `${thm.rawAccent}88` }}>|</span>
      <span style={{ color: parseFloat(metrics.err) > 5 ? "#f87171" : thm.rawAccent }}>
        ERR: <strong>{metrics.err}%</strong>
      </span>
      <span style={{ color: `${thm.rawAccent}88` }}>|</span>
      <span style={{ color: thm.rawAccent }}>UP: <strong>{metrics.dur}</strong></span>
      <span style={{ color: `${thm.rawAccent}88` }}>|</span>
      <span style={{ color: `${thm.rawAccent}aa`, fontFamily: "monospace", letterSpacing: "0" }}>
        {metrics.spark}
      </span>
      <button
        className="ml-auto"
        style={{ color: `${thm.rawAccent}66`, fontSize: "0.6rem", cursor: "pointer", background: "none", border: "none" }}
        onClick={() => onCommand("metrics.dash")}
      >
        [dash]
      </button>
    </div>
  );
}

/* ================================================================
   PROCESSING INDICATOR
   ================================================================ */
function ProcessingBadge() {
  return (
    <span className="flex items-center gap-1.5 processing-pulse" style={{ color: "var(--accent-color)" }}>
      <span className="spinner-ring" />
      <span style={{ fontSize: "0.7rem", letterSpacing: "0.12em" }}>COMPUTING</span>
    </span>
  );
}

/* ================================================================
   CORNER HUD DECORATORS
   ================================================================ */
function HudCorners() {
  return (
    <>
      <div className="hud-corner hud-corner-tl" />
      <div className="hud-corner hud-corner-tr" />
      <div className="hud-corner hud-corner-bl" />
      <div className="hud-corner hud-corner-br" />
    </>
  );
}

/* ================================================================
   KEYBOARD SHORTCUT OVERLAY
   ================================================================ */
function KeyboardOverlay({ onClose, thm }: { onClose: () => void; thm: { rawAccent: string } }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(8px)" }}
      onClick={onClose}
    >
      <div
        className="glass-panel-heavy rounded-lg p-6 max-w-lg w-full mx-4"
        style={{ border: `1px solid ${thm.rawAccent}44`, maxHeight: "80vh", overflowY: "auto" }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <span style={{ color: thm.rawAccent, fontWeight: 700, letterSpacing: "0.1em" }}>KEYBOARD SHORTCUTS</span>
          <button onClick={onClose} style={{ color: `${thm.rawAccent}88`, cursor: "pointer", background: "none", border: "none", fontSize: "1.2rem" }}>✕</button>
        </div>
        {[
          ["Enter / Ctrl+Enter", "Submit command"],
          ["↑ / ↓", "Navigate history"],
          ["Ctrl+L", "Clear screen"],
          ["Ctrl+C", "Copy input to clipboard"],
          ["Escape", "Clear input"],
          ["Ctrl+K", "Open keyboard shortcuts"],
          ["Ctrl+,", "Toggle settings panel"],
          ["Ctrl+E", "Toggle CA editor"],
          ["Ctrl+M", "Run metrics dashboard"],
          ["Ctrl+P", "Show profile/XP"],
          ["Ctrl+B", "Run benchmark"],
          ["Ctrl+H", "Show command history"],
        ].map(([key, desc]) => (
          <div key={key} className="flex justify-between items-center py-1.5" style={{ borderBottom: `1px solid ${thm.rawAccent}11` }}>
            <kbd style={{
              background: `${thm.rawAccent}18`, border: `1px solid ${thm.rawAccent}44`,
              color: thm.rawAccent, padding: "2px 8px", borderRadius: 4,
              fontFamily: "monospace", fontSize: "0.75rem",
            }}>{key}</kbd>
            <span style={{ color: "rgba(255,255,255,0.6)", fontSize: "0.8rem" }}>{desc}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ================================================================
   XP PROGRESS BAR
   ================================================================ */
function XPBar({ thm }: { thm: { rawAccent: string; rawGlow: string } }) {
  const info = achievementEngine.getLevelInfo();
  const pct = Math.round(info.progress * 100);
  return (
    <div className="flex items-center gap-2" style={{ fontSize: "0.65rem" }}>
      <span style={{ color: `${thm.rawAccent}88` }}>Lv.{info.level}</span>
      <div style={{
        width: 60, height: 4, background: `${thm.rawAccent}22`,
        borderRadius: 2, overflow: "hidden",
      }}>
        <div style={{
          width: `${pct}%`, height: "100%", background: thm.rawAccent,
          boxShadow: `0 0 4px ${thm.rawGlow}`, transition: "width 0.3s ease",
        }} />
      </div>
      <span style={{ color: `${thm.rawAccent}66` }}>{pct}%</span>
    </div>
  );
}

/* ================================================================
   MAIN APP
   ================================================================ */
export default function App() {
  const platform = usePlatform();

  const [settings, setSettings]           = useState<UXSettings>(() => loadSettings());
  const [settingsReady, setSettingsReady]  = useState(false);
  const [history, setHistory]             = useState<HistoryEntry[]>([]);
  const [input, setInput]                 = useState("");
  const [cmdHistory, setCmdHistory]       = useState<string[]>([]);
  const [histIdx, setHistIdx]             = useState(-1);
  const [isProcessing, setIsProcessing]   = useState(false);
  const [showSettings, setShowSettings]   = useState(false);
  const [showCAEditor, setShowCAEditor]   = useState(false);
  const [showKeyboard, setShowKeyboard]   = useState(false);
  const [outputCount, setOutputCount]     = useState(0);
  const [inputFocused, setInputFocused]   = useState(false);
  const [currentToast, setCurrentToast]   = useState<Achievement | null>(null);
  const [toastQueue, setToastQueue]       = useState<Achievement[]>([]);
  const [workspace, setWorkspace]         = useState<"shell" | "lab">("shell");

  const bottomRef    = useRef<HTMLDivElement>(null);
  const inputRef     = useRef<HTMLInputElement>(null);
  const customCSSRef = useRef<HTMLStyleElement | null>(null);

  const thm        = useMemo(() => THEMES[settings.colorTheme],     [settings.colorTheme]);
  const prompt     = useMemo(() => resolvePrompt(settings),          [settings]);
  const fontStack  = useMemo(() => FONT_STACKS[settings.fontFamily], [settings.fontFamily]);
  const widthCls   = useMemo(() => TERMINAL_WIDTH_CLASS[settings.terminalWidth], [settings.terminalWidth]);
  const densityCls = useMemo(() => OUTPUT_DENSITY_CLASS[settings.outputDensity], [settings.outputDensity]);

  // ── Apply theme CSS variables ──
  useEffect(() => { applyThemeVars(thm); }, [thm]);

  // ── Custom CSS injection ──
  useEffect(() => {
    if (!customCSSRef.current) {
      const el = document.createElement("style");
      el.id = "x86-custom-css";
      document.head.appendChild(el);
      customCSSRef.current = el;
    }
    customCSSRef.current.textContent = settings.customCSS || "";
  }, [settings.customCSS]);

  // ── Hydrate settings ──
  useEffect(() => {
    if (!platform.ready) return;
    platform.loadNativeSettings().then(loaded => {
      setSettings(loaded);
      setSettingsReady(true);
      if (loaded.showBanner) {
        setHistory([{ type: "banner", lines: BOOT_BANNER }]);
      }
    });
  }, [platform.ready]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Debounced native store save ──
  const _pendingSave = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!settingsReady) return;
    if (_pendingSave.current) clearTimeout(_pendingSave.current);
    _pendingSave.current = setTimeout(() => {
      platform.saveNativeSettings(settings);
      _pendingSave.current = null;
    }, 300);
    return () => { if (_pendingSave.current) clearTimeout(_pendingSave.current); };
  }, [settings, settingsReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Achievement polling ──
  useEffect(() => {
    const id = setInterval(() => {
      const newAch = achievementEngine.drainNewlyUnlocked();
      if (newAch.length > 0) {
        setToastQueue(q => [...q, ...newAch]);
      }
    }, 500);
    return () => clearInterval(id);
  }, []);

  // ── Toast dequeue ──
  useEffect(() => {
    if (!currentToast && toastQueue.length > 0) {
      setCurrentToast(toastQueue[0]);
      setToastQueue(q => q.slice(1));
    }
  }, [currentToast, toastQueue]);

  // ── Native menu actions (Electron) ──
  // Read the latest workspace/history through a ref so the subscription
  // is made once rather than on every history change.
  const shellTranscriptRef = useRef<(() => string) | null>(null);
  const menuContextRef = useRef({ workspace, history });
  useEffect(() => { menuContextRef.current = { workspace, history }; }, [workspace, history]);

  useEffect(() => platform.onMenuAction(action => {
    const context = menuContextRef.current;
    if (action === "openSettings") {
      setWorkspace("lab");
      setShowSettings(true);
      return;
    }
    if (action === "saveLog") {
      const content = context.workspace === "shell"
        ? shellTranscriptRef.current?.() ?? ""
        : context.history.flatMap(entry => entry.lines).join("\n");
      void platform.saveLog(content).then(result => {
        if (!result.ok && result.error !== "Cancelled") console.warn("[menu] save log failed:", result.error);
        if (context.workspace === "lab" && result.ok) {
          setHistory(prev => [...prev, { type: "output", lines: [`[FILE] Log saved${result.path ? ` to ${result.path}` : ""}`], ts: timestamp() }]);
        }
      });
      return;
    }
    if (action === "openLog") {
      void platform.openLog().then(result => {
        if (!result.ok || result.content === undefined) return;
        const content = result.content;
        setWorkspace("lab");
        setHistory(prev => [...prev, { type: "output", lines: ["[FILE] Log loaded:", ...content.split("\n").slice(0, 200)], ts: timestamp() }]);
      });
    }
  }), [platform]);

  const handleSettingsChange = useCallback((s: UXSettings) => setSettings(s), []);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: settings.reduceMotion ? "auto" : "smooth" });
  }, [settings.reduceMotion]);

  useEffect(() => { scrollToBottom(); }, [history, scrollToBottom]);

  const runCommand = useCallback((cmd: string) => {
    const trimmed = cmd.trim();
    if (!trimmed) return;
    if (isProcessing) return;

    if (trimmed === "__settings__" || trimmed === "settings") {
      setShowSettings(prev => !prev); return;
    }
    if (trimmed === "__ca_editor__" || trimmed === "ca.editor") {
      setShowCAEditor(prev => !prev); return;
    }
    if (trimmed === "paste") {
      platform.readClipboard().then(text => { if (text) setInput(text); }); return;
    }
    if (trimmed === "savelog") {
      const logContent = history.flatMap(e => e.lines).join("\n");
      platform.saveLog(logContent).then(res => {
        if (res.ok) {
          setHistory(prev => [...prev, { type: "output", lines: [`[FILE] Log saved${res.path ? ` to ${res.path}` : ""}`], ts: timestamp() }]);
        }
      });
      return;
    }

    setIsProcessing(true);
    const ts = timestamp();
    const startMs = performance.now();
    setHistory(prev => {
      const next = [...prev, { type: "input" as const, lines: [trimmed], ts }];
      return next.slice(-settings.scrollbackSize);
    });
    setCmdHistory(prev => [trimmed, ...prev.slice(0, 99)]);
    setHistIdx(-1);
    setInput("");

    const applyResult = (result: string[], latencyMs: number) => {
      const isError = result.some(isErrorLine);
      const cmdName = trimmed.split(" ")[0];
      liveMetrics.record(cmdName, latencyMs, isError);
      liveMetrics.snapshot(globalState.tensors.size, globalState.networks.size);

      if (result.length === 1 && result[0] === "__CLEAR__") {
        setHistory(settings.showBanner ? [{ type: "banner", lines: BOOT_BANNER }] : []);
        setOutputCount(0);
      } else if (result.length > 0) {
        const idx = outputCount;
        setOutputCount(c => c + 1);
        setHistory(h => {
          const next = [...h, { type: "output" as const, lines: result, ts: timestamp(), index: idx }];
          return next.slice(-settings.scrollbackSize);
        });
      }
      setIsProcessing(false);
    };

    setTimeout(() => {
      const resultOrPromise = processCommand(trimmed, globalState);
      if (resultOrPromise instanceof Promise) {
        setHistory(h => [...h, { type: "output", lines: ["[FETCH] ⇣ connecting..."], ts: timestamp(), index: -1 }]);
        resultOrPromise
          .then(result => {
            setHistory(h => h.filter(e => !(e.type === "output" && e.index === -1)));
            applyResult(result, performance.now() - startMs);
          })
          .catch(err => {
            setHistory(h => h.filter(e => !(e.type === "output" && e.index === -1)));
            applyResult([`[EXCEPTION] ${err instanceof Error ? err.message : String(err)}`], performance.now() - startMs);
            setIsProcessing(false);
          });
      } else {
        applyResult(resultOrPromise, performance.now() - startMs);
      }
    }, 10);
  }, [settings.showBanner, settings.scrollbackSize, history, platform, outputCount, isProcessing]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (matchesKey(e, settings.submitKey)) {
      e.preventDefault(); runCommand(input); return;
    }
    if (matchesKey(e, settings.historyUp)) {
      e.preventDefault();
      const nextIdx = Math.min(histIdx + 1, cmdHistory.length - 1);
      setHistIdx(nextIdx); setInput(cmdHistory[nextIdx] ?? ""); return;
    }
    if (matchesKey(e, settings.historyDown)) {
      e.preventDefault();
      const nextIdx = Math.max(histIdx - 1, -1);
      setHistIdx(nextIdx); setInput(nextIdx === -1 ? "" : cmdHistory[nextIdx] ?? ""); return;
    }
    if (e.key === "Tab" && settings.autocompleteMode === "tab") {
      e.preventDefault();
      const q = input.toLowerCase();
      const match = ALL_COMPLETIONS.find(c => c.startsWith(q) && c !== q);
      if (match) setInput(match); return;
    }
    if (e.key === " " && e.ctrlKey && settings.autocompleteMode === "ctrl-space") {
      e.preventDefault();
      const q = input.toLowerCase();
      const match = ALL_COMPLETIONS.find(c => c.startsWith(q) && c !== q);
      if (match) setInput(match); return;
    }
    if (e.key === "l" && e.ctrlKey) {
      e.preventDefault();
      setHistory(settings.showBanner ? [{ type: "banner", lines: BOOT_BANNER }] : []);
      return;
    }
    if (e.key === "," && e.ctrlKey) {
      e.preventDefault(); setShowSettings(p => !p); return;
    }
    if (e.key === "e" && e.ctrlKey) {
      e.preventDefault(); setShowCAEditor(p => !p); return;
    }
    if (e.key === "k" && e.ctrlKey) {
      e.preventDefault(); setShowKeyboard(p => !p); return;
    }
    if (e.key === "m" && e.ctrlKey) {
      e.preventDefault(); runCommand("metrics.dash"); return;
    }
    if (e.key === "p" && e.ctrlKey) {
      e.preventDefault(); runCommand("profile"); return;
    }
    if (e.key === "b" && e.ctrlKey) {
      e.preventDefault(); runCommand("benchmark"); return;
    }
    if (e.key === "h" && e.ctrlKey) {
      e.preventDefault(); runCommand("history"); return;
    }
    if (e.key === "c" && e.ctrlKey && input) {
      platform.copyToClipboard(input); return;
    }
    if (e.key === "Escape") { setInput(""); setHistIdx(-1); }
  }, [input, histIdx, cmdHistory, settings, runCommand, platform]);

  if (workspace === "shell") {
    return (
      <div className="app-frame">
        <NativeTitleBar
          title="AI Terminal"
          thm={thm}
          window={platform.window}
          updaterStatus={platform.updaterStatus}
          onCheckUpdates={platform.checkForUpdates}
          onDownload={platform.downloadUpdate}
          onInstall={platform.installUpdate}
          platform={platform.platform.platform}
        />
        <RealTerminal
          platform={platform}
          thm={thm}
          fontStack={fontStack}
          onOpenLab={() => setWorkspace("lab")}
          onOpenSettings={() => { setWorkspace("lab"); setShowSettings(true); }}
          transcriptRef={shellTranscriptRef}
        />
      </div>
    );
  }

  const btnPad = settings.largeClickTargets ? "px-3 py-1.5 text-sm" : "px-2 py-1 text-xs";
  const panelLeft = settings.panelPosition === "left";

  // ── Loading screen ──
  if (!settingsReady) {
    return (
      <div className="min-h-screen flex items-center justify-center"
        style={{ background: "#030712", fontFamily: "'Courier New', monospace" }}>
        <div className="flex flex-col items-center gap-4">
          <div className="text-3xl font-bold" style={{ color: "var(--accent-color)", textShadow: "0 0 20px var(--accent-glow)", fontFamily: "monospace" }}>
            x86_64
          </div>
          <div className="spinner-ring" style={{ width: 24, height: 24, borderWidth: 2 }} />
          <div style={{ color: "var(--accent-color)", fontSize: 11, opacity: 0.5, letterSpacing: "0.2em" }}>
            INITIALIZING
          </div>
        </div>
      </div>
    );
  }

  const reduceMotionClass = settings.reduceMotion ? "reduce-motion" : "";

  return (
    <div
      className={`x86-terminal min-h-screen flex flex-col select-none ${reduceMotionClass} ${settings.colorTheme === "matrix" ? "crt-flicker" : ""}`}
      style={{
        fontFamily: fontStack,
        fontSize: settings.fontSize,
        lineHeight: settings.lineHeight,
        letterSpacing: `${settings.letterSpacing}em`,
        background: "var(--bg-primary)",
        color: thm.defaultOutputColor.replace("text-", ""),
      }}
      onClick={() => inputRef.current?.focus()}
    >
      {/* ── Scanline overlay ── */}
      {settings.scanlineEffect && <div className="scanline-overlay" />}

      {/* ── Plasma background ── */}
      {["purple", "dracula", "tokyo-night", "catppuccin", "rose-pine"].includes(settings.colorTheme) && (
        <div className="plasma-bg pointer-events-none fixed inset-0 z-0" />
      )}

      {/* ── Custom cursor + animation styles ── */}
      <style>{`
        .x86-input { caret-color: ${thm.rawAccent}; }
        ${settings.cursorStyle === "blinking-bar" || settings.cursorStyle === "blinking-block"
          ? `input.x86-input { animation: cursor-blink 1.1s step-end infinite; }`
          : ""}
        ${settings.animateOutput && !settings.reduceMotion ? `
          @keyframes fadeInUp {
            from { opacity: 0; transform: translateY(6px); filter: blur(2px); }
            to   { opacity: 1; transform: none; filter: none; }
          }
          .animate-fadeIn { animation: fadeInUp 0.18s ease-out both; }
        ` : ""}
      `}</style>

      {/* ── Keyboard overlay ── */}
      {showKeyboard && <KeyboardOverlay onClose={() => setShowKeyboard(false)} thm={thm} />}

      {/* ── Achievement Toast ── */}
      {currentToast && (
        <AchievementToast
          achievement={currentToast}
          onDone={() => setCurrentToast(null)}
        />
      )}

      {/* ── Native titlebar (Electron) ── */}
      <NativeTitleBar
        title="AI Terminal — Linux shell · AI copilot · Neural lab"
        thm={thm}
        window={platform.window}
        updaterStatus={platform.updaterStatus}
        onCheckUpdates={platform.checkForUpdates}
        onDownload={platform.downloadUpdate}
        onInstall={platform.installUpdate}
        platform={platform.platform.platform}
      />

      {/* ── Main layout ── */}
      <div className={`flex flex-1 min-h-0 overflow-hidden ${panelLeft ? "flex-row-reverse" : "flex-row"}`}
        style={{ minHeight: "100vh", position: "relative", zIndex: 2 }}>

        {/* ── Settings panel ── */}
        {showSettings && (
          <div
            className="side-panel flex-shrink-0 animate-slide-up"
            style={{ width: settings.sidebarWidth }}
            onClick={e => e.stopPropagation()}
          >
            <SettingsPanel settings={settings} onChange={handleSettingsChange} onClose={() => setShowSettings(false)} />
          </div>
        )}

        {/* ── CA Editor panel ── */}
        {showCAEditor && (
          <div
            className="side-panel flex-shrink-0 animate-slide-up"
            style={{ width: Math.min(600, window.innerWidth * 0.45) }}
            onClick={e => e.stopPropagation()}
          >
            <CAEditor
              settings={settings}
              onOutput={lines => {
                setHistory(h => [...h, { type: "output", lines, ts: timestamp(), index: outputCount }]);
                setOutputCount(c => c + 1);
              }}
              onClose={() => setShowCAEditor(false)}
            />
          </div>
        )}

        {/* ── Terminal column ── */}
        <div className={`terminal-col ${widthCls}`}>

          {/* ── BROWSER HEADER BAR ── */}
          {!isElectron() && (
            <div
              className={`flex items-center justify-between px-4 py-2 flex-shrink-0 relative`}
              style={{
                background: "rgba(0,0,0,0.6)",
                backdropFilter: "blur(12px)",
                WebkitBackdropFilter: "blur(12px)",
                borderBottom: `1px solid ${thm.rawAccent}22`,
                borderRadius: settings.borderRadius > 0
                  ? `${settings.borderRadius}px ${settings.borderRadius}px 0 0`
                  : undefined,
              }}
            >
              {/* Traffic lights */}
              <div className="flex items-center gap-3">
                <div className="flex gap-1.5">
                  {(["bg-red-500", "bg-yellow-500", "bg-green-500"] as const).map((color, i) => (
                    <div key={i} className={`traffic-light w-3 h-3 rounded-full ${color}`}
                      style={{ boxShadow: `0 0 6px ${["#ef4444","#eab308","#22c55e"][i]}66` }} />
                  ))}
                </div>

                {/* Title + XP bar */}
                <div className="flex items-center gap-3">
                  <span
                    className="text-xs tracking-widest uppercase font-medium"
                    style={{ color: thm.rawAccent, textShadow: `0 0 8px ${thm.rawGlow}` }}
                  >
                    x86_64 · Neural Terminal
                  </span>
                  <span className="text-xs" style={{ color: `${thm.rawAccent}55` }}>v6.0</span>
                  <XPBar thm={thm} />
                </div>
              </div>

              {/* Right side controls */}
              <div className="flex items-center gap-2">
                {isProcessing && <ProcessingBadge />}

                <button
                  onClick={e => { e.stopPropagation(); setWorkspace("shell"); }}
                  className={`quick-btn ${btnPad} rounded font-medium transition-all`}
                  style={{
                    background: `${thm.rawAccent}12`,
                    border: `1px solid ${thm.rawAccent}55`,
                    color: thm.rawAccent,
                    borderRadius: settings.borderRadius,
                  }}
                  title="Return to AI shell"
                >&gt;_ shell</button>

                <button
                  onClick={e => { e.stopPropagation(); setShowKeyboard(p => !p); }}
                  className={`quick-btn ${btnPad} rounded font-medium transition-all`}
                  style={{
                    background: "rgba(255,255,255,0.04)",
                    border: `1px solid ${thm.rawAccent}33`,
                    color: thm.rawAccent,
                    borderRadius: settings.borderRadius,
                  }}
                  title="Keyboard shortcuts (Ctrl+K)"
                >⌨</button>

                <button
                  onClick={e => { e.stopPropagation(); setShowCAEditor(p => !p); }}
                  className={`quick-btn ${btnPad} rounded font-medium transition-all`}
                  style={{
                    background: showCAEditor ? `${thm.rawAccent}22` : "rgba(255,255,255,0.04)",
                    border: `1px solid ${showCAEditor ? thm.rawAccent : thm.rawAccent + "33"}`,
                    color: thm.rawAccent,
                    borderRadius: settings.borderRadius,
                    boxShadow: showCAEditor ? `0 0 8px ${thm.rawGlow}` : undefined,
                  }}
                  title="Cellular Automaton Editor (Ctrl+E)"
                >⬡ CA</button>

                <button
                  onClick={e => { e.stopPropagation(); setShowSettings(p => !p); }}
                  className={`quick-btn ${btnPad} rounded font-medium transition-all`}
                  style={{
                    background: showSettings ? `${thm.rawAccent}22` : "rgba(255,255,255,0.04)",
                    border: `1px solid ${showSettings ? thm.rawAccent : thm.rawAccent + "33"}`,
                    color: thm.rawAccent,
                    borderRadius: settings.borderRadius,
                    boxShadow: showSettings ? `0 0 8px ${thm.rawGlow}` : undefined,
                  }}
                  title="Terminal Settings (Ctrl+,)"
                >{showSettings ? "✕ settings" : "⚙ settings"}</button>
              </div>

              {/* Animated accent bar */}
              <div className="accent-bar" style={{ position: "absolute", bottom: 0, left: 0, right: 0 }} />
            </div>
          )}

          {/* ── Electron sub-bar ── */}
          {isElectron() && (
            <div className="flex items-center justify-between px-4 py-2 flex-shrink-0 relative"
              style={{ background: "rgba(0,0,0,0.5)", borderBottom: `1px solid ${thm.rawAccent}22` }}>
              {isProcessing && <ProcessingBadge />}
              <div className="flex items-center gap-2 ml-auto">
                <button onClick={e => { e.stopPropagation(); platform.saveLog(history.flatMap(e => e.lines).join("\n")); }}
                  className={`quick-btn ${btnPad} rounded`}
                  style={{ background: "rgba(255,255,255,0.04)", border: `1px solid ${thm.rawAccent}33`, color: thm.rawAccent, borderRadius: settings.borderRadius }}>
                  ↓ log
                </button>
                <button onClick={e => { e.stopPropagation(); setShowCAEditor(p => !p); }}
                  className={`quick-btn ${btnPad} rounded`}
                  style={{ background: "rgba(255,255,255,0.04)", border: `1px solid ${thm.rawAccent}33`, color: thm.rawAccent, borderRadius: settings.borderRadius }}>
                  ⬡ CA
                </button>
                <button onClick={e => { e.stopPropagation(); setShowSettings(p => !p); }}
                  className={`quick-btn ${btnPad} rounded`}
                  style={{ background: showSettings ? `${thm.rawAccent}22` : "rgba(255,255,255,0.04)", border: `1px solid ${thm.rawAccent}33`, color: thm.rawAccent, borderRadius: settings.borderRadius }}>
                  ⚙ settings
                </button>
              </div>
              <div className="accent-bar" style={{ position: "absolute", bottom: 0, left: 0, right: 0 }} />
            </div>
          )}

          {/* ── Live Metric Bar ── */}
          <LiveMetricBar thm={thm} onCommand={runCommand} />

          {/* ── Quick command strip ── */}
          {settings.showQuickButtons && (
            <div
              className="flex flex-wrap gap-1 px-3 py-2 flex-shrink-0"
              style={{
                background: "rgba(0,0,0,0.35)",
                borderBottom: `1px solid ${thm.rawAccent}18`,
                backdropFilter: "blur(4px)",
              }}
            >
              {QUICK_CMDS.map(qc => (
                <button
                  key={qc.cmd}
                  onClick={e => { e.stopPropagation(); runCommand(qc.cmd); }}
                  className={`quick-btn ${btnPad} rounded flex items-center gap-1`}
                  style={{
                    background: "rgba(255,255,255,0.03)",
                    border: `1px solid ${thm.rawAccent}22`,
                    color: `${thm.rawAccent}bb`,
                    borderRadius: settings.borderRadius,
                    transition: "all 0.15s ease",
                  }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLElement).style.borderColor = thm.rawAccent;
                    (e.currentTarget as HTMLElement).style.color = thm.rawAccent;
                    (e.currentTarget as HTMLElement).style.boxShadow = `0 0 6px ${thm.rawGlow}`;
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLElement).style.borderColor = `${thm.rawAccent}22`;
                    (e.currentTarget as HTMLElement).style.color = `${thm.rawAccent}bb`;
                    (e.currentTarget as HTMLElement).style.boxShadow = "";
                  }}
                >
                  <span style={{ opacity: 0.6, fontSize: "0.65em" }}>{qc.icon}</span>
                  {qc.label}
                </button>
              ))}
            </div>
          )}

          {/* ── TERMINAL OUTPUT ── */}
          <div
            className={`flex-1 overflow-y-auto px-4 py-3 ${densityCls}`}
            style={{ minHeight: 0, position: "relative" }}
          >
            {history.map((entry, ei) => {
              const isOld = settings.dimOutput && ei < history.length - 4;
              const dimStyle = isOld ? { opacity: 0.45 } : {};
              const animClass = settings.animateOutput && !settings.reduceMotion ? "animate-fadeIn" : "";

              if (entry.type === "banner" && settings.showBanner) {
                return (
                  <div key={ei} className="mb-4" style={dimStyle}>
                    {entry.lines.map((line, li) => (
                      <div
                        key={li}
                        className={`boot-line text-xs leading-tight whitespace-pre ${settings.glowEffect ? "phosphor-glow-subtle" : ""}`}
                        style={{
                          color: thm.rawAccent,
                          animationDelay: `${li * 50}ms`,
                          textShadow: settings.glowEffect
                            ? `0 0 6px ${thm.rawGlow}, 0 0 12px ${thm.rawGlow}`
                            : undefined,
                        }}
                      >
                        {line || "\u00A0"}
                      </div>
                    ))}
                  </div>
                );
              }

              if (entry.type === "input") {
                return (
                  <div key={ei} className={`flex items-start gap-2 mt-1 mb-0.5 ${animClass}`} style={dimStyle}>
                    {settings.showTimestamps && (
                      <span className="text-xs flex-shrink-0 mt-0.5" style={{ color: `${thm.rawAccent}44`, fontVariantNumeric: "tabular-nums" }}>
                        {entry.ts}
                      </span>
                    )}
                    {prompt && (
                      <span
                        className="select-none flex-shrink-0 font-bold x86-prompt"
                        style={{
                          color: thm.rawAccent,
                          textShadow: settings.glowEffect ? `0 0 6px ${thm.rawGlow}` : undefined,
                        }}
                      >
                        {prompt}
                      </span>
                    )}
                    <span
                      className="break-all"
                      style={{
                        color: thm.rawAccent,
                        opacity: 0.85,
                        textShadow: settings.glowEffect ? `0 0 4px ${thm.rawGlow}` : undefined,
                      }}
                    >
                      {entry.lines[0]}
                    </span>
                  </div>
                );
              }

              if (entry.type === "output") {
                const hasError = entry.lines.some(isErrorLine);
                return (
                  <div
                    key={ei}
                    className={`output-block ${hasError ? "output-block-error" : "output-block-success"} ${animClass}`}
                    style={{
                      ...dimStyle,
                      marginBottom: settings.outputDensity === "spacious" ? "8px"
                        : settings.outputDensity === "compact" ? "1px" : "3px",
                    } as React.CSSProperties}
                  >
                    {settings.showLineNumbers && (
                      <div className="text-xs mb-0.5" style={{ color: `${thm.rawAccent}33` }}>
                        [{entry.index ?? "?"}]{settings.showTimestamps && ` ${entry.ts}`}
                      </div>
                    )}
                    {entry.lines.map((line, li) => {
                      const colorCls = colorize(line);
                      const hcStyle  = settings.highContrast ? { fontWeight: 500 } : {};
                      const glowStyle = settings.glowEffect
                        ? { textShadow: `0 0 6px ${thm.rawGlow}` }
                        : {};

                      return (
                        <div
                          key={li}
                          className={`leading-relaxed whitespace-pre-wrap break-all ${colorCls}`}
                          style={{
                            fontSize: settings.fontSize,
                            lineHeight: settings.lineHeight,
                            ...hcStyle,
                            ...glowStyle,
                          }}
                        >
                          {line || "\u00A0"}
                        </div>
                      );
                    })}
                  </div>
                );
              }
              return null;
            })}
            <div ref={bottomRef} />
          </div>

          {/* ── SUGGESTION BAR ── */}
          {(settings.autocompleteAlwaysVisible || settings.autocompleteMode !== "tab") && (
            <SuggestionBar
              input={input}
              settings={settings}
              onSelect={cmd => { runCommand(cmd); inputRef.current?.focus(); }}
              onInsert={cmd => { setInput(cmd); inputRef.current?.focus(); }}
            />
          )}

          {/* ── INPUT LINE ── */}
          <div
            className="flex-shrink-0 relative"
            style={{
              background: "rgba(0,0,0,0.55)",
              backdropFilter: "blur(12px)",
              WebkitBackdropFilter: "blur(12px)",
              borderTop: `1px solid ${inputFocused ? thm.rawAccent : thm.rawAccent + "22"}`,
              boxShadow: inputFocused
                ? `0 -2px 20px ${thm.rawGlow}, 0 -1px 0 ${thm.rawAccent}`
                : "none",
              transition: "all 0.2s ease",
              padding: "10px 16px 8px",
            }}
            onClick={e => { e.stopPropagation(); inputRef.current?.focus(); }}
          >
            <HudCorners />

            <div className="x86-input-wrapper flex items-center gap-2">
              {prompt && (
                <span
                  className="select-none whitespace-nowrap font-bold flex-shrink-0"
                  style={{
                    color: thm.rawAccent,
                    textShadow: `0 0 8px ${thm.rawGlow}`,
                    fontFamily: fontStack,
                  }}
                >
                  {prompt}
                </span>
              )}

              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                onFocus={() => setInputFocused(true)}
                onBlur={() => setInputFocused(false)}
                autoFocus
                spellCheck={false}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                className="x86-input flex-1"
                placeholder={settings.inputPlaceholder}
                disabled={isProcessing}
                style={{
                  fontSize: settings.fontSize,
                  color: "rgba(255,255,255,0.9)",
                  fontFamily: fontStack,
                }}
              />

              {input && (
                <button
                  onMouseDown={e => { e.preventDefault(); platform.copyToClipboard(input); }}
                  className={`quick-btn flex-shrink-0 ${btnPad} rounded transition-all`}
                  style={{
                    background: "rgba(255,255,255,0.04)",
                    border: `1px solid ${thm.rawAccent}33`,
                    color: `${thm.rawAccent}88`,
                    borderRadius: settings.borderRadius,
                  }}
                  title="Copy to clipboard"
                >⎘</button>
              )}

              <button
                onMouseDown={e => { e.preventDefault(); if (!isProcessing) runCommand(input); }}
                disabled={isProcessing || !input.trim()}
                className={`quick-btn flex-shrink-0 ${settings.largeClickTargets ? "px-4 py-2 text-sm" : "px-3 py-1 text-xs"} rounded font-bold transition-all`}
                style={{
                  background: isProcessing || !input.trim()
                    ? "rgba(255,255,255,0.03)"
                    : `${thm.rawAccent}18`,
                  border: `1px solid ${isProcessing || !input.trim() ? thm.rawAccent + "22" : thm.rawAccent}`,
                  color: isProcessing || !input.trim() ? `${thm.rawAccent}44` : thm.rawAccent,
                  borderRadius: settings.borderRadius,
                  boxShadow: !isProcessing && input.trim() ? `0 0 8px ${thm.rawGlow}` : "none",
                  letterSpacing: "0.08em",
                }}
                title="Run command"
              >
                {isProcessing ? "..." : "RUN"}
              </button>
            </div>

            {/* ── Status bar ── */}
            {settings.showStatusBar && (
              <div className="status-bar mt-2 flex gap-1.5 flex-wrap items-center pt-1.5">
                <StatusChip label="T:" value={globalState.tensors.size} onClick={() => runCommand("tensor.list")} />
                <StatusChip label="N:" value={globalState.networks.size} onClick={() => runCommand("net.list")} />
                <StatusChip label="O:" value={globalState.optimizers.size} />
                <StatusChip label="F:" value={globalState.fetchStore.size} onClick={() => runCommand("fetch.list")} />
                <StatusChip label="V:" value={globalState.variables.size} onClick={() => runCommand("var.list")} />
                <StatusChip label="A:" value={globalState.aliases.length} glow={globalState.aliases.length > 0} onClick={() => runCommand("alias.list")} />
                <StatusChip label="XP:" value={achievementEngine.getProfile().totalXP} glow onClick={() => runCommand("profile")} />

                {isElectron() && (
                  <span className="status-chip" style={{ color: "#4ade80", borderColor: "#4ade8033" }}>
                    <span className="status-orb" style={{ background: "#4ade80", boxShadow: "0 0 4px #4ade80" }} />
                    native
                  </span>
                )}

                {isProcessing && (
                  <span className="status-chip processing-pulse" style={{ color: thm.rawAccent, borderColor: thm.rawAccent + "44" }}>
                    <span className="spinner-ring" />
                    computing
                  </span>
                )}

                <span className="ml-auto text-xs" style={{ color: `${thm.rawAccent}44`, letterSpacing: "0.08em" }}>
                  {settings.autocompleteMode === "tab"         ? "Tab:complete" :
                   settings.autocompleteMode === "ctrl-space"  ? "Ctrl+Space:complete" :
                   "↑↓ history"}
                  {" · "}
                  {settings.submitKey === "ctrl-enter" ? "Ctrl↵ run" : "↵ run"}
                  {" · Ctrl+K shortcuts"}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
