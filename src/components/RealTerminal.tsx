import { useCallback, useEffect, useRef, useState } from "react";
import { planCommand, riskLabel, type AIPlan } from "../engine/AIAssistant";
import type { UsePlatformResult } from "../bridge/usePlatform";

type Theme = { rawAccent: string; rawGlow: string };

type BrowserCommand = {
  output: string;
  exitCode?: number;
};

function stripAnsi(value: string): string {
  return value
    .replace(/[\u001b\u009b][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[0-9A-ORZcf-nqry=><~]))/g, "")
    .replace(/\r/g, "");
}

function browserCommand(command: string): BrowserCommand {
  const normalized = command.trim().toLowerCase();
  if (normalized === "clear") return { output: "" };
  if (normalized === "pwd") return { output: "/home/user\n" };
  if (normalized === "whoami") return { output: "user\n" };
  if (normalized === "uname -a" || normalized === "uname") return { output: "Linux ai-terminal 6.1.0 x86_64 GNU/Linux\n" };
  if (normalized === "date") return { output: `${new Date().toString()}\n` };
  if (normalized === "help") return { output: "Browser preview commands: pwd, whoami, uname, date, clear, help\nOpen the desktop build for a real Linux shell.\n" };
  if (normalized === "ls" || normalized === "ls -lah") {
    return { output: "total 24K\ndrwxr-xr-x  1 user user 4.0K ai-terminal\ndrwxr-xr-x  1 user user 4.0K projects\ndrwxr-xr-x  1 user user 4.0K Downloads\n" };
  }
  return { output: `browser: command execution is disabled for “${command}”\n         launch the desktop app for a native shell\n`, exitCode: 126 };
}

function riskColor(risk: AIPlan["risk"]): string {
  return risk === "safe" ? "#86efac" : risk === "review" ? "#fbbf24" : "#fb7185";
}

export default function RealTerminal({
  platform,
  thm,
  fontStack,
  onOpenLab,
  onOpenSettings,
}: {
  platform: UsePlatformResult;
  thm: Theme;
  fontStack: string;
  onOpenLab: () => void;
  onOpenSettings: () => void;
}) {
  const [lines, setLines] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [aiInput, setAiInput] = useState("");
  const [plan, setPlan] = useState<AIPlan | null>(null);
  const [aiSource, setAiSource] = useState<"local" | "ollama">("local");
  const [aiBusy, setAiBusy] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [nativeEcho, setNativeEcho] = useState(false);
  const [cwd, setCwd] = useState("~");
  const [status, setStatus] = useState<"connecting" | "connected" | "browser" | "offline">("connecting");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const outputRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const sessionRef = useRef<string | null>(null);

  const append = useCallback((text: string) => {
    const clean = stripAnsi(text);
    if (!clean) return;
    setLines(previous => [...previous, ...clean.split("\n").filter((line, index, array) => line !== "" || index < array.length - 1)].slice(-2000));
  }, []);

  useEffect(() => {
    const removeData = platform.terminal.onData(event => {
      if (event.id === sessionId || !sessionId) append(event.data);
    });
    const removeExit = platform.terminal.onExit(event => {
      if (event.id === sessionId || sessionId === null) {
        append(`\n[process exited${event.code === null ? "" : ` with code ${event.code}`} ]\n`);
        setStatus("offline");
        setSessionId(null);
        sessionRef.current = null;
      }
    });

    let cancelled = false;
    async function connect() {
      if (platform.platform.runtime !== "electron") {
        setStatus("browser");
        setLines([
          "AI TERMINAL // browser preview",
          "────────────────────────────────────────────────────────",
          "Native shell capability: unavailable in a web page",
          "Desktop runtime:      launch the Linux app for a real PTY",
          "",
          "Try: pwd · ls · uname · help",
          "",
        ]);
        return;
      }
      const result = await platform.terminal.start();
      if (cancelled) return;
      if (result.ok && result.id) {
        setSessionId(result.id);
        sessionRef.current = result.id;
        setNativeEcho(result.pty === true);
        setCwd(result.cwd?.replace(/^.*\/home\/[^/]+/, "~") || "~");
        setStatus("connected");
        append(`connected to ${result.shell || "shell"}\n`);
      } else {
        setStatus("offline");
        append(`[terminal] ${result.error || "could not start shell"}\n`);
      }
    }
    void connect();

    return () => {
      cancelled = true;
      removeData();
      removeExit();
      if (sessionRef.current) void platform.terminal.kill(sessionRef.current);
    };
    // Start once for this mounted workspace. The listener callbacks are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight, behavior: "smooth" });
  }, [lines]);

  useEffect(() => {
    if (!sessionId || !outputRef.current || typeof ResizeObserver === "undefined") return;
    const terminalWindow = outputRef.current.parentElement;
    if (!terminalWindow) return;
    const resize = () => {
      const cols = Math.max(20, Math.min(500, Math.floor(terminalWindow.clientWidth / 8)));
      const rows = Math.max(4, Math.min(300, Math.floor(outputRef.current?.clientHeight ? outputRef.current.clientHeight / 20 : 24)));
      void platform.terminal.resize(sessionId, cols, rows);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(terminalWindow);
    resize();
    return () => observer.disconnect();
  }, [platform.terminal, sessionId]);

  const run = useCallback(async (raw: string) => {
    const command = raw.trim();
    if (!command) return;
    setHistory(previous => [command, ...previous.filter(item => item !== command)].slice(0, 100));
    setHistoryIndex(-1);
    setInput("");

    if (command === "clear") {
      setLines([]);
      return;
    }

    if (status === "browser") {
      setLines(previous => [...previous, `user@preview:${cwd}$ ${command}`]);
      const result = browserCommand(command);
      if (result.output) append(result.output);
      return;
    }

    if (!sessionId) {
      append("[terminal] no active shell session\n");
      return;
    }
    if (!nativeEcho) setLines(previous => [...previous, `user@linux:${cwd}$ ${command}`]);
    const result = await platform.terminal.write(sessionId, `${command}\n`);
    if (!result.ok) append(`[terminal] ${result.error || "write failed"}\n`);
  }, [append, cwd, nativeEcho, platform.terminal, sessionId, status]);

  const askAI = useCallback(async () => {
    const request = aiInput.trim();
    if (!request || aiBusy) return;
    const fallback = planCommand(request);
    setPlan(fallback);
    setAiInput("");

    if (platform.platform.runtime !== "electron") return;
    setAiBusy(true);
    try {
      const result = await platform.ai.ask(request);
      if (result.ok) {
        setAiSource("ollama");
        setPlan({
          request,
          title: result.title || fallback.title,
          explanation: result.explanation || fallback.explanation,
          command: result.command || "",
          risk: result.risk || "review",
          notes: result.notes?.length ? result.notes : fallback.notes,
        });
      } else if (result.error) {
        setPlan({ ...fallback, notes: [...fallback.notes, `Local model unavailable: ${result.error}`].slice(0, 4) });
      }
    } finally {
      setAiBusy(false);
    }
  }, [aiBusy, aiInput, platform.ai, platform.platform.runtime]);

  const executePlan = useCallback(() => {
    if (plan?.command) void run(plan.command);
  }, [plan, run]);

  const onInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void run(input);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      const next = Math.min(historyIndex + 1, history.length - 1);
      setHistoryIndex(next);
      setInput(history[next] || "");
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      const next = Math.max(historyIndex - 1, -1);
      setHistoryIndex(next);
      setInput(next === -1 ? "" : history[next] || "");
    } else if (event.key === "c" && event.ctrlKey && sessionId) {
      event.preventDefault();
      void platform.terminal.write(sessionId, "\u0003");
    }
  };

  const statusText = status === "connected" ? "NATIVE SHELL" : status === "browser" ? "BROWSER PREVIEW" : status.toUpperCase();
  const statusColor = status === "connected" ? "#86efac" : status === "browser" ? "#fbbf24" : "#fb7185";

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
          <span className="ai-status"><i style={{ background: statusColor, boxShadow: `0 0 10px ${statusColor}` }} />{statusText}</span>
          <button className="ai-ghost-button" onClick={onOpenSettings}>settings</button>
          <button className="ai-ghost-button" onClick={onOpenLab}>neural lab <span>↗</span></button>
        </div>
      </header>

      <section className="ai-shell-body">
        <div className="ai-terminal-window">
          <div className="ai-terminal-toolbar">
            <div className="ai-window-dots"><i /><i /><i /></div>
            <span className="ai-tab-active"><span className="ai-tab-icon">⌁</span> shell <b>1</b></span>
            <span className="ai-toolbar-path">{cwd}</span>
            <span className="ai-toolbar-hint">Ctrl+C interrupt · ↑↓ history</span>
          </div>
          <div ref={outputRef} className="ai-output" onClick={() => inputRef.current?.focus()}>
            {lines.map((line, index) => (
              <div key={`${index}-${line}`} className={line.startsWith("[") ? "ai-output-system" : ""}>{line || "\u00a0"}</div>
            ))}
            <div className="ai-caret-row"><span className="ai-prompt">user@{status === "browser" ? "preview" : "linux"}:{cwd}$</span><span className="ai-caret" /></div>
          </div>
          <div className="ai-command-row">
            <span className="ai-prompt">user@{status === "browser" ? "preview" : "linux"}:{cwd}$</span>
            <input ref={inputRef} value={input} onChange={event => setInput(event.target.value)} onKeyDown={onInputKeyDown} autoFocus spellCheck={false} placeholder="run a command…" aria-label="Shell command" />
            <button className="ai-run-button" onClick={() => void run(input)} disabled={!input.trim()}>run <span>↵</span></button>
          </div>
        </div>

        <aside className="ai-copilot">
          <div className="ai-panel-kicker"><span className="ai-spark">✦</span> AI COPILOT <span className="ai-local-badge">{aiSource === "ollama" ? "OLLAMA" : "LOCAL RULES"}</span></div>
          <h1>Tell the terminal what you need.</h1>
          <p className="ai-panel-description">Describe an outcome in plain English. I’ll turn it into a command you can inspect before it runs.</p>
          <div className="ai-ask-row">
            <input value={aiInput} onChange={event => setAiInput(event.target.value)} onKeyDown={event => { if (event.key === "Enter") void askAI(); }} placeholder="find files larger than 100MB" aria-label="Ask AI for a command" />
            <button onClick={() => void askAI()} disabled={aiBusy || !aiInput.trim()}>{aiBusy ? "…" : "ask"}</button>
          </div>
          <div className="ai-example-list">
            {[
              "show disk usage",
              "check git status",
              "find large files",
            ].map(example => <button key={example} onClick={() => { setAiInput(example); setPlan(planCommand(example)); }}>{example}<span>→</span></button>)}
          </div>

          {plan && (
            <div className="ai-plan-card" style={{ borderColor: `${riskColor(plan.risk)}55` }}>
              <div className="ai-plan-heading"><span>{plan.title}</span><span style={{ color: riskColor(plan.risk) }}>{riskLabel(plan.risk)}</span></div>
              <p>{plan.explanation}</p>
              {plan.command ? <code>{plan.command}</code> : <div className="ai-no-command">No command generated.</div>}
              {plan.notes.map(note => <div key={note} className="ai-plan-note">{note}</div>)}
              {plan.command && <button className="ai-execute" onClick={executePlan} style={{ background: `${riskColor(plan.risk)}18`, color: riskColor(plan.risk), borderColor: `${riskColor(plan.risk)}66` }}>reviewed — run command <span>↵</span></button>}
            </div>
          )}

          <div className="ai-safety-note"><span>✓</span><div><strong>approval required</strong><br />The copilot never runs a command automatically. Destructive requests are blocked.</div></div>
        </aside>
      </section>

      <footer className="ai-shell-footer">
        <span><b>AI TERMINAL</b> · {platform.platform.runtime === "electron" ? "desktop runtime" : "web preview"}</span>
        <span className="ai-footer-right">native shell is isolated to the desktop app <span className="ai-footer-dot">·</span> neural lab available ↗</span>
      </footer>
    </main>
  );
}
