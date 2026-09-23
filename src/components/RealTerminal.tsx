import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { planCommand, reviewPlan, riskLabel, type AIPlan } from "../engine/AIAssistant";
import type { UsePlatformResult } from "../bridge/usePlatform";
import { LineEditor, type LineEditorAction } from "../terminal/lineEditor";
import { PREVIEW_BANNER, PREVIEW_PROMPT, runPreviewCommand } from "../terminal/browserShell";

type Theme = { rawAccent: string; rawGlow: string };
type Mode = "pty" | "pipe" | "browser";
type Status = "connecting" | "connected" | "browser" | "exited" | "error";

const SCROLLBACK_LINES = 10_000;

function riskColor(risk: AIPlan["risk"]): string {
  return risk === "safe" ? "#86efac" : risk === "review" ? "#fbbf24" : "#fb7185";
}

function terminalTheme(accent: string): ITheme {
  return {
    background: "#080c13",
    foreground: "#d8e4de",
    cursor: accent,
    cursorAccent: "#080c13",
    selectionBackground: `${accent}55`,
    black: "#1b2230",
    red: "#f87171",
    green: "#86efac",
    yellow: "#fcd34d",
    blue: "#7dd3fc",
    magenta: "#f0abfc",
    cyan: "#67e8f9",
    white: "#d8e4de",
    brightBlack: "#4b5a6a",
    brightRed: "#fca5a5",
    brightGreen: "#bbf7d0",
    brightYellow: "#fde68a",
    brightBlue: "#bae6fd",
    brightMagenta: "#f5d0fe",
    brightCyan: "#a5f3fc",
    brightWhite: "#f8fafc",
  };
}

/** Parse an OSC 7 payload ("file://host/path") into a display path. */
function cwdFromOsc7(payload: string, home: string | null): string | null {
  try {
    const url = new URL(payload);
    if (url.protocol !== "file:") return null;
    const path = decodeURIComponent(url.pathname);
    if (home && (path === home || path.startsWith(`${home}/`))) return `~${path.slice(home.length)}`;
    return path;
  } catch {
    return null;
  }
}

function transcriptOf(term: Terminal): string {
  const buffer = term.buffer.active;
  const lines: string[] = [];
  for (let i = 0; i < buffer.length; i++) {
    const line = buffer.getLine(i);
    if (!line) continue;
    const text = line.translateToString(true);
    // Soft-wrapped rows continue the previous logical line.
    if (line.isWrapped && lines.length > 0) lines[lines.length - 1] += text;
    else lines.push(text);
  }
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return `${lines.join("\n")}\n`;
}

export default function RealTerminal({
  platform,
  thm,
  fontStack,
  onOpenLab,
  onOpenSettings,
  transcriptRef,
}: {
  platform: UsePlatformResult;
  thm: Theme;
  fontStack: string;
  onOpenLab: () => void;
  onOpenSettings: () => void;
  /** Filled with a function returning the terminal's text (for "Save log"). */
  transcriptRef?: MutableRefObject<(() => string) | null>;
}) {
  const [aiInput, setAiInput] = useState("");
  const [plan, setPlan] = useState<AIPlan | null>(null);
  const [aiSource, setAiSource] = useState<"local" | "ollama">("local");
  const [aiBusy, setAiBusy] = useState(false);
  const [confirmDanger, setConfirmDanger] = useState(false);
  const [status, setStatus] = useState<Status>(platform.platform.runtime === "electron" ? "connecting" : "browser");
  const [mode, setMode] = useState<Mode>(platform.platform.runtime === "electron" ? "pty" : "browser");
  const [notice, setNotice] = useState<string | null>(null);
  const [cwd, setCwd] = useState("~");
  const [title, setTitle] = useState("shell");

  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sessionRef = useRef<string | null>(null);
  const modeRef = useRef<Mode>(mode);
  const homeRef = useRef<string | null>(null);
  const editorRef = useRef(new LineEditor());
  const askSeqRef = useRef(0);
  const connectRef = useRef<() => Promise<void>>(async () => undefined);

  const terminal = platform.terminal;
  const isDesktop = platform.platform.runtime === "electron";

  const setModeBoth = useCallback((next: Mode) => {
    modeRef.current = next;
    setMode(next);
  }, []);

  // Apply line-editor actions for sessions without a PTY.
  const applyEditorActions = useCallback((actions: LineEditorAction[]) => {
    const term = termRef.current;
    if (!term) return;
    for (const action of actions) {
      switch (action.type) {
        case "echo":
          term.write(action.data);
          break;
        case "clear":
          term.clear();
          break;
        case "interrupt":
          if (modeRef.current === "browser") term.write(PREVIEW_PROMPT);
          else if (sessionRef.current) void terminal.interrupt(sessionRef.current);
          break;
        case "eof":
          if (modeRef.current === "pipe") term.write("\r\n[use `exit` to close the shell]\r\n");
          break;
        case "submit":
          if (modeRef.current === "browser") {
            const result = runPreviewCommand(action.line);
            if (result.clear) term.clear();
            if (result.output) term.write(result.output);
            term.write(PREVIEW_PROMPT);
          } else if (sessionRef.current) {
            const id = sessionRef.current;
            void terminal.write(id, `${action.line}\n`).then(result => {
              if (!result.ok && sessionRef.current === id) term.write(`\r\n[terminal] ${result.error ?? "write failed"}\r\n`);
            });
          }
          break;
      }
    }
  }, [terminal]);

  // ── Create the terminal emulator once ──
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      fontFamily: fontStack,
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      scrollback: SCROLLBACK_LINES,
      convertEol: modeRef.current !== "pty",
      macOptionIsMeta: true,
      rightClickSelectsWord: true,
      theme: terminalTheme(thm.rawAccent),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    // Links open in the system browser (the main process enforces this).
    term.loadAddon(new WebLinksAddon((_event, uri) => { window.open(uri, "_blank", "noopener,noreferrer"); }));
    term.open(container);
    termRef.current = term;
    fitRef.current = fit;
    try { fit.fit(); } catch { /* container not laid out yet */ }

    const disposables = [
      term.parser.registerOscHandler(7, payload => {
        const next = cwdFromOsc7(payload, homeRef.current);
        if (next) setCwd(next);
        return true;
      }),
      term.onTitleChange(value => setTitle(value.trim().slice(0, 60) || "shell")),
      term.onResize(({ cols, rows }) => {
        if (sessionRef.current && modeRef.current === "pty") void terminal.resize(sessionRef.current, cols, rows);
      }),
      term.onData(data => {
        if (modeRef.current === "pty") {
          if (sessionRef.current) void terminal.write(sessionRef.current, data);
          return;
        }
        if (modeRef.current === "pipe" && !sessionRef.current) return;
        applyEditorActions(editorRef.current.feed(data));
      }),
    ];

    // In the browser the Electron menu does not exist; give the usual
    // terminal copy/paste shortcuts their meaning here.
    if (!isDesktop) {
      term.attachCustomKeyEventHandler(event => {
        if (event.type !== "keydown" || !event.ctrlKey || !event.shiftKey) return true;
        const key = event.key.toLowerCase();
        if (key === "c" && term.hasSelection()) {
          void platform.copyToClipboard(term.getSelection());
          return false;
        }
        if (key === "v") {
          void platform.readClipboard().then(text => { if (text) term.paste(text); });
          return false;
        }
        return true;
      });
    }

    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        try { fit.fit(); } catch { /* hidden */ }
      });
    });
    observer.observe(container);

    if (transcriptRef) transcriptRef.current = () => transcriptOf(term);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      disposables.forEach(disposable => disposable.dispose());
      if (transcriptRef) transcriptRef.current = null;
      termRef.current = null;
      fitRef.current = null;
      term.dispose();
    };
    // The terminal is created once; font/theme updates are applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Live font / theme updates ──
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.fontFamily = fontStack;
    term.options.theme = terminalTheme(thm.rawAccent);
    try { fitRef.current?.fit(); } catch { /* hidden */ }
  }, [fontStack, thm.rawAccent]);

  // ── Shell session lifecycle ──
  useEffect(() => {
    // Per-run flag: a start() that resolves after this effect was torn
    // down (unmount, StrictMode re-run) must not adopt its session.
    let active = true;
    const removeData = terminal.onData(event => {
      if (event.id !== sessionRef.current) return;
      const term = termRef.current;
      if (!term) return;
      // Acknowledge once rendered so the main process can apply backpressure.
      term.write(event.data, () => terminal.ack(event.id, event.data.length));
    });
    const removeExit = terminal.onExit(event => {
      if (event.id !== sessionRef.current) return;
      sessionRef.current = null;
      setStatus("exited");
      const detail = event.signal ? `signal ${event.signal}` : `code ${event.code ?? "?"}`;
      termRef.current?.write(`\r\n\u001b[2m[process exited with ${detail} — press restart for a new shell]\u001b[0m\r\n`);
    });

    async function connect() {
      const term = termRef.current;
      if (!term) return;
      if (!isDesktop) {
        setModeBoth("browser");
        setStatus("browser");
        term.options.convertEol = true;
        term.write(`${PREVIEW_BANNER}\r\n${PREVIEW_PROMPT}`);
        return;
      }

      setStatus("connecting");
      setNotice(null);
      editorRef.current.reset();
      const result = await terminal.start();
      if (!active) {
        if (result.ok && result.id) void terminal.kill(result.id);
        return;
      }
      if (!result.ok || !result.id) {
        setStatus("error");
        term.write(`\r\n\u001b[31m[terminal] ${result.error || "could not start shell"}\u001b[0m\r\n`);
        return;
      }

      sessionRef.current = result.id;
      homeRef.current = result.cwd ?? null;
      setCwd("~");
      const nextMode: Mode = result.pty ? "pty" : "pipe";
      setModeBoth(nextMode);
      term.options.convertEol = nextMode !== "pty";
      setStatus("connected");
      if (nextMode === "pty") {
        void terminal.resize(result.id, term.cols, term.rows);
      } else {
        setNotice(`Limited mode: no pseudo-terminal (${result.ptyUnavailableReason ?? "node-pty unavailable"}). Line-oriented commands work; full-screen programs such as vim or htop do not.`);
      }
      term.focus();
    }

    connectRef.current = connect;
    void connect();

    return () => {
      active = false;
      removeData();
      removeExit();
      const id = sessionRef.current;
      sessionRef.current = null;
      if (id) void terminal.kill(id);
    };
  }, [isDesktop, setModeBoth, terminal]);

  const restart = useCallback(() => {
    const term = termRef.current;
    if (!term) return;
    const previous = sessionRef.current;
    sessionRef.current = null;
    if (previous) void terminal.kill(previous);
    term.reset();
    void connectRef.current();
  }, [terminal]);

  // ── Copilot ──
  const askAI = useCallback(async (raw?: string) => {
    const request = (raw ?? aiInput).trim();
    if (!request) return;
    const seq = ++askSeqRef.current;
    const fallback = planCommand(request);
    setPlan(fallback);
    setAiSource("local");
    setConfirmDanger(false);
    setAiInput("");

    if (!isDesktop) return;
    setAiBusy(true);
    try {
      const result = await platform.ai.ask(request);
      if (seq !== askSeqRef.current) return; // a newer question superseded this one
      if (result.ok) {
        setAiSource("ollama");
        setPlan(reviewPlan({
          request,
          title: result.title || fallback.title,
          explanation: result.explanation || fallback.explanation,
          command: result.command || "",
          risk: result.risk || "review",
          notes: result.notes?.length ? result.notes : fallback.notes,
        }));
      } else if (result.error) {
        setPlan({ ...fallback, notes: [...fallback.notes, `Local model: ${result.error}`].slice(0, 5) });
      }
    } catch (error) {
      if (seq === askSeqRef.current) setPlan({ ...fallback, notes: [...fallback.notes, `Local model: ${String(error)}`].slice(0, 5) });
    } finally {
      if (seq === askSeqRef.current) setAiBusy(false);
    }
  }, [aiInput, isDesktop, platform.ai]);

  /** Put the plan's command on the shell's input line, optionally running it. */
  const applyPlan = useCallback((execute: boolean) => {
    const term = termRef.current;
    if (!plan?.command || !term) return;
    if (execute && plan.risk === "dangerous" && !confirmDanger) {
      setConfirmDanger(true);
      return;
    }
    if (status !== "connected" && status !== "browser") {
      setNotice("There is no running shell. Press restart first.");
      return;
    }
    if (modeRef.current === "pty" && term.buffer.active.type === "alternate") {
      setNotice("A full-screen program is running in the terminal. Exit it before sending a command.");
      return;
    }
    // Ctrl+E, Ctrl+U: move to end of line and clear whatever was typed.
    const keys = `\u0005\u0015${plan.command}${execute ? "\r" : ""}`;
    if (modeRef.current === "pty") {
      if (sessionRef.current) void terminal.write(sessionRef.current, keys);
    } else {
      applyEditorActions(editorRef.current.feed(keys));
    }
    setConfirmDanger(false);
    term.focus();
  }, [applyEditorActions, confirmDanger, plan, status, terminal]);

  const statusText =
    status === "connected" ? (mode === "pty" ? "NATIVE SHELL" : "NATIVE SHELL · LIMITED")
    : status === "browser" ? "BROWSER PREVIEW"
    : status.toUpperCase();
  const statusColor = status === "connected" ? (mode === "pty" ? "#86efac" : "#fbbf24") : status === "browser" ? "#fbbf24" : status === "connecting" ? "#7dd3fc" : "#fb7185";
  const copyHint = platform.platform.platform === "darwin" ? "⌘C / ⌘V copy · paste" : "Ctrl+Shift+C / V copy · paste";

  return (
    <main className="ai-shell" style={{ fontFamily: fontStack, "--shell-accent": thm.rawAccent, "--shell-glow": thm.rawGlow } as React.CSSProperties}>
      <header className="ai-shell-header">
        <div className="ai-brand">
          <div className="ai-mark">&gt;_</div>
          <div>
            <div className="ai-title">AI TERMINAL</div>
            <div className="ai-subtitle">linux-native command workspace</div>
          </div>
        </div>
        <div className="ai-header-actions">
          <span className="ai-status" role="status"><i style={{ background: statusColor, boxShadow: `0 0 10px ${statusColor}` }} />{statusText}</span>
          {(status === "exited" || status === "error") && <button type="button" className="ai-ghost-button" onClick={restart}>restart shell</button>}
          <button type="button" className="ai-ghost-button" onClick={onOpenSettings}>settings</button>
          <button type="button" className="ai-ghost-button" onClick={onOpenLab}>neural lab <span>↗</span></button>
        </div>
      </header>

      <section className="ai-shell-body">
        <div className="ai-terminal-window">
          <div className="ai-terminal-toolbar">
            <div className="ai-window-dots" aria-hidden="true"><i /><i /><i /></div>
            <span className="ai-tab-active" title={title}><span className="ai-tab-icon">⌁</span> {title}</span>
            <span className="ai-toolbar-path" title={cwd}>{cwd}</span>
            <span className="ai-toolbar-hint">{copyHint}</span>
          </div>
          {notice && (
            <div className="ai-terminal-notice" role="note">
              <span>{notice}</span>
              <button type="button" aria-label="Dismiss" onClick={() => setNotice(null)}>×</button>
            </div>
          )}
          <div ref={containerRef} className="ai-xterm" aria-label="Terminal" />
        </div>

        <aside className="ai-copilot">
          <div className="ai-panel-kicker"><span className="ai-spark">✦</span> AI COPILOT <span className="ai-local-badge">{aiSource === "ollama" ? "OLLAMA" : "LOCAL RULES"}</span></div>
          <h1>Tell the terminal what you need.</h1>
          <p className="ai-panel-description">Describe an outcome in plain English. I’ll turn it into a command you can inspect before it runs.</p>
          <form className="ai-ask-row" onSubmit={event => { event.preventDefault(); void askAI(); }}>
            <input value={aiInput} onChange={event => setAiInput(event.target.value)} placeholder="find files larger than 100MB" aria-label="Ask AI for a command" maxLength={1000} />
            <button type="submit" disabled={aiBusy || !aiInput.trim()}>{aiBusy ? "…" : "ask"}</button>
          </form>
          <div className="ai-example-list">
            {["show disk usage", "check git status", "find large files"].map(example => (
              <button type="button" key={example} onClick={() => void askAI(example)}>{example}<span>→</span></button>
            ))}
          </div>

          {plan && (
            <div className="ai-plan-card" style={{ borderColor: `${riskColor(plan.risk)}55` }}>
              <div className="ai-plan-heading"><span>{plan.title}</span><span style={{ color: riskColor(plan.risk) }}>{riskLabel(plan.risk)}</span></div>
              <p>{plan.explanation}</p>
              {plan.command ? <code>{plan.command}</code> : <div className="ai-no-command">No command generated.</div>}
              {plan.notes.map(note => <div key={note} className="ai-plan-note">{note}</div>)}
              {plan.command && (
                <div className="ai-plan-actions">
                  <button type="button" className="ai-insert" onClick={() => applyPlan(false)}>insert into shell</button>
                  <button
                    type="button"
                    className="ai-execute"
                    onClick={() => applyPlan(true)}
                    style={{ background: `${riskColor(plan.risk)}18`, color: riskColor(plan.risk), borderColor: `${riskColor(plan.risk)}66` }}
                  >
                    {confirmDanger ? "confirm — run dangerous command" : "reviewed — run"} <span>↵</span>
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="ai-safety-note"><span>✓</span><div><strong>approval required</strong><br />The copilot never runs a command automatically. Dangerous commands need a second confirmation, and model output that could destroy data is withheld.</div></div>
        </aside>
      </section>

      <footer className="ai-shell-footer">
        <span><b>AI TERMINAL</b> {platform.platform.version} · {isDesktop ? "desktop runtime" : "web preview"}</span>
        <span className="ai-footer-right">{isDesktop ? (mode === "pty" ? "pseudo-terminal" : "pipe fallback") : "native shell is available in the desktop app"} <span className="ai-footer-dot">·</span> neural lab available ↗</span>
      </footer>
    </main>
  );
}
