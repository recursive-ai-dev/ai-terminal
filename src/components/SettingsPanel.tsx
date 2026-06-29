// ============================================================
// SETTINGS PANEL v4.0 — Complete UX configurator
// Every setting in UXSettings is exposed and wired
// ============================================================
import React, { useState } from "react";
import {
  UXSettings, ColorTheme, FontFamily, AutocompleteMode,
  HistoryUpKey, HistoryDownKey, SubmitKey, PromptStyle,
  CursorStyle, OutputDensity, PanelPosition, TerminalWidth,
  ScrollbackSize, CommandAlias, THEMES, resetSettings, DEFAULT_SETTINGS,
} from "../engine/UXSettings";
import { executeSettingsChange, formatSettingsError } from "../engine/SettingsChain";

interface Props {
  settings: UXSettings;
  onChange: (s: UXSettings) => void;
  onClose: () => void;
}

type TabId = "prompt" | "keys" | "theme" | "font" | "visual" | "layout" | "autocomplete" | "display" | "access" | "aliases" | "css";

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: "prompt",      label: "Prompt",      icon: "▶" },
  { id: "keys",        label: "Keys",         icon: "⌨" },
  { id: "theme",       label: "Theme",        icon: "🎨" },
  { id: "font",        label: "Font",         icon: "A" },
  { id: "visual",      label: "Visual",       icon: "✦" },
  { id: "layout",      label: "Layout",       icon: "⊞" },
  { id: "autocomplete",label: "Complete",     icon: "⇥" },
  { id: "display",     label: "Display",      icon: "☰" },
  { id: "access",      label: "Access",       icon: "♿" },
  { id: "aliases",     label: "Aliases",      icon: "~" },
  { id: "css",         label: "Custom CSS",   icon: "{}" },
];

// ── Primitives ───────────────────────────────────────────────

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 py-1.5 border-b border-gray-800/50 last:border-0">
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs text-gray-300 leading-tight flex-1">{label}</label>
        <div className="flex-shrink-0">{children}</div>
      </div>
      {hint && <p className="text-xs text-gray-600 leading-tight">{hint}</p>}
    </div>
  );
}

function Select<T extends string>({ value, options, onChange }: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void;
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value as T)}
      className="bg-gray-800 border border-gray-600 text-gray-200 text-xs rounded px-2 py-1 min-w-[130px] focus:outline-none focus:border-gray-400"
    >
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

function Toggle({ value, onChange, accentColor }: { value: boolean; onChange: (v: boolean) => void; accentColor?: string }) {
  return (
    <button
      onClick={() => onChange(!value)}
      className={`relative w-10 h-5 rounded-full transition-colors flex-shrink-0 ${value ? (accentColor ?? "bg-green-600") : "bg-gray-700"}`}
      aria-pressed={value}
    >
      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${value ? "translate-x-5" : "translate-x-0.5"}`} />
    </button>
  );
}

function Slider({ value, min, max, step, onChange, display, accent }: {
  value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; display?: string; accent?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className={`w-28 ${accent ?? "accent-green-500"}`}
      />
      <span className="text-xs text-gray-400 w-12 text-right tabular-nums">{display ?? value}</span>
    </div>
  );
}

function TextInput({ value, onChange, placeholder, maxLength, mono }: {
  value: string; onChange: (v: string) => void;
  placeholder?: string; maxLength?: number; mono?: boolean;
}) {
  return (
    <input
      type="text" value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder} maxLength={maxLength ?? 32}
      className={`bg-gray-800 border border-gray-600 text-gray-200 text-xs rounded px-2 py-1 w-36 focus:outline-none focus:border-gray-400 ${mono ? "font-mono" : ""}`}
      spellCheck={false} autoComplete="off"
    />
  );
}

function ColorDot({ color }: { color: string }) {
  return (
    <span
      className="w-3 h-3 rounded-full flex-shrink-0 inline-block border border-white/10"
      style={{ background: color }}
    />
  );
}

// ── Theme definitions ─────────────────────────────────────────

const ALL_THEMES: { value: ColorTheme; label: string; accent: string; bg: string }[] = [
  { value: "green",          label: "Green",          accent: "#4ade80", bg: "#030712" },
  { value: "amber",          label: "Amber",          accent: "#f59e0b", bg: "#0c0a09" },
  { value: "cyan",           label: "Cyan",           accent: "#22d3ee", bg: "#020617" },
  { value: "red",            label: "Red",            accent: "#f87171", bg: "#09090b" },
  { value: "purple",         label: "Purple",         accent: "#a78bfa", bg: "#1e1b4b" },
  { value: "blue",           label: "Blue",           accent: "#38bdf8", bg: "#082f49" },
  { value: "white",          label: "Light/Paper",    accent: "#374151", bg: "#ffffff" },
  { value: "dracula",        label: "Dracula",        accent: "#ff79c6", bg: "#282a36" },
  { value: "solarized-dark", label: "Solarized Dark", accent: "#268bd2", bg: "#002b36" },
  { value: "nord",           label: "Nord",           accent: "#88c0d0", bg: "#2e3440" },
  { value: "monokai",        label: "Monokai",        accent: "#a6e22e", bg: "#272822" },
  { value: "gruvbox",        label: "Gruvbox",        accent: "#b8bb26", bg: "#282828" },
  { value: "tokyo-night",    label: "Tokyo Night",    accent: "#7aa2f7", bg: "#1a1b26" },
  { value: "catppuccin",     label: "Catppuccin",     accent: "#cba6f7", bg: "#1e1e2e" },
  { value: "rose-pine",      label: "Rosé Pine",      accent: "#ebbcba", bg: "#191724" },
  { value: "matrix",         label: "Matrix",         accent: "#00ff41", bg: "#000000" },
];

// ── Main Component ────────────────────────────────────────────

export default function SettingsPanel({ settings: s, onChange, onClose }: Props) {
  const [tab, setTab] = useState<TabId>("prompt");
  const [lastError, setLastError] = useState<string | null>(null);
  const [newAlias, setNewAlias] = useState({ name: "", command: "" });

  const thm = THEMES[s.colorTheme];

  const set = <K extends keyof UXSettings>(key: K, val: UXSettings[K]) => {
    const corrId = `sp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const result = executeSettingsChange(s, { [key]: val } as Partial<UXSettings>, corrId);
    if (result.ok) {
      setLastError(null);
      if (!result.value.wasIdempotent) onChange(result.value.next);
    } else {
      setLastError(formatSettingsError(result.error)[0] ?? "Invalid setting");
    }
  };

  const setMany = (patch: Partial<UXSettings>) => {
    const corrId = `sp-batch-${Date.now().toString(36)}`;
    const result = executeSettingsChange(s, patch, corrId);
    if (result.ok) {
      setLastError(null);
      if (!result.value.wasIdempotent) onChange(result.value.next);
    } else {
      setLastError(formatSettingsError(result.error)[0] ?? "Invalid setting");
    }
  };

  // ── Alias management ──
  const addAlias = () => {
    if (!newAlias.name.trim() || !newAlias.command.trim()) return;
    const next = [...s.aliases.filter(a => a.name !== newAlias.name.trim()), {
      name: newAlias.name.trim(), command: newAlias.command.trim(),
    }];
    set("aliases", next);
    setNewAlias({ name: "", command: "" });
  };

  const removeAlias = (name: string) => {
    set("aliases", s.aliases.filter(a => a.name !== name));
  };

  // ── Shared tab button style ──
  const tabCls = (id: TabId) =>
    `flex flex-col items-center gap-0.5 px-1.5 py-2 text-xs rounded transition-colors cursor-pointer border ${
      tab === id
        ? `${thm.bgTertiary} ${thm.accentColor} border-current`
        : `border-transparent ${thm.dimColor} hover:text-gray-200`
    }`;

  return (
    <div
      className={`flex flex-col h-full ${thm.bgSecondary} border-l ${thm.borderColor}`}
      style={{ width: Math.max(280, s.sidebarWidth), minWidth: 280 }}
      onClick={e => e.stopPropagation()}
    >
      {/* Header */}
      <div className={`flex items-center justify-between px-4 py-3 ${thm.bgTertiary} border-b ${thm.borderColor} flex-shrink-0`}>
        <div>
          <div className={`text-sm font-bold ${thm.accentColor}`}>Terminal Settings</div>
          <div className={`text-xs ${thm.dimColor}`}>Changes apply instantly · auto-saved</div>
        </div>
        <button
          onClick={onClose}
          className={`${thm.dimColor} hover:text-gray-200 text-lg leading-none px-2 py-1 rounded hover:bg-gray-700 transition-colors`}
          title="Close settings"
        >✕</button>
      </div>

      {/* Error banner */}
      {lastError && (
        <div className="px-4 py-2 bg-red-950 border-b border-red-800 flex items-center justify-between gap-2 flex-shrink-0">
          <span className="text-xs text-red-300 flex-1">{lastError}</span>
          <button onClick={() => setLastError(null)} className="text-red-500 hover:text-red-300 text-sm flex-shrink-0">✕</button>
        </div>
      )}

      {/* Tab strip — vertical icon tabs */}
      <div className={`flex-shrink-0 border-b ${thm.borderColor} overflow-x-auto`}>
        <div className="flex gap-0.5 px-2 py-1.5 min-w-max">
          {TABS.map(t => (
            <button key={t.id} className={tabCls(t.id)} onClick={() => setTab(t.id)} title={t.label}>
              <span className="text-sm leading-none">{t.icon}</span>
              <span className="text-[10px] leading-none">{t.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-3 min-h-0">

        {/* ── PROMPT ── */}
        {tab === "prompt" && (
          <div className="space-y-0">
            <Row label="Prompt style" hint="What appears before your input. Choose 'None' to disable.">
              <Select<PromptStyle>
                value={s.promptStyle}
                options={[
                  { value: "custom",    label: "Custom text" },
                  { value: "user@host", label: "user@host" },
                  { value: "path",      label: "~/path" },
                  { value: "minimal",   label: "Single >" },
                  { value: "none",      label: "No prompt" },
                ]}
                onChange={v => set("promptStyle", v)}
              />
            </Row>
            {s.promptStyle === "custom" && (
              <Row label="Custom prompt text" hint="Any characters you can type. No dollar sign required.">
                <TextInput value={s.promptCustom} onChange={v => set("promptCustom", v)} placeholder=">>" maxLength={20} mono />
              </Row>
            )}
            {s.promptStyle === "user@host" && <>
              <Row label="Username (no special chars needed)">
                <TextInput value={s.promptUser} onChange={v => set("promptUser", v)} placeholder="user" maxLength={16} mono />
              </Row>
              <Row label="Hostname">
                <TextInput value={s.promptHost} onChange={v => set("promptHost", v)} placeholder="x86" maxLength={16} mono />
              </Row>
            </>}
            <Row label="Prompt suffix" hint="Character(s) after the prompt symbol. Space is fine.">
              <TextInput value={s.promptSuffix} onChange={v => set("promptSuffix", v)} placeholder=" " maxLength={4} mono />
            </Row>
            <div className={`mt-3 rounded p-2 ${thm.bgTertiary} border ${thm.borderColor}`}>
              <div className={`text-xs ${thm.dimColor} mb-1`}>Preview</div>
              <div className="font-mono text-sm">
                <span className={thm.promptColor}>
                  {s.promptStyle === "custom"    ? (s.promptCustom || ">>")
                  : s.promptStyle === "user@host" ? `${s.promptUser}@${s.promptHost}`
                  : s.promptStyle === "path"      ? `~/${s.promptHost}`
                  : s.promptStyle === "minimal"   ? ">"
                  : ""}
                  {s.promptStyle !== "none" ? s.promptSuffix : ""}
                </span>
                <span className={thm.inputColor}>your command here</span>
              </div>
            </div>
          </div>
        )}

        {/* ── KEYBINDS ── */}
        {tab === "keys" && (
          <div className="space-y-0">
            <Row label="Run command" hint="Key to execute the current input. Ctrl+Enter prevents accidental submits.">
              <Select<SubmitKey>
                value={s.submitKey}
                options={[
                  { value: "Enter",       label: "Enter" },
                  { value: "ctrl-enter",  label: "Ctrl + Enter" },
                ]}
                onChange={v => set("submitKey", v)}
              />
            </Row>
            <Row label="History: older command" hint="Navigate backwards through command history.">
              <Select<HistoryUpKey>
                value={s.historyUp}
                options={[
                  { value: "ArrowUp", label: "Arrow Up" },
                  { value: "ctrl-p",  label: "Ctrl + P" },
                  { value: "ctrl-k",  label: "Ctrl + K" },
                ]}
                onChange={v => set("historyUp", v)}
              />
            </Row>
            <Row label="History: newer command">
              <Select<HistoryDownKey>
                value={s.historyDown}
                options={[
                  { value: "ArrowDown", label: "Arrow Down" },
                  { value: "ctrl-n",    label: "Ctrl + N" },
                  { value: "ctrl-j",    label: "Ctrl + J" },
                ]}
                onChange={v => set("historyDown", v)}
              />
            </Row>
            <Row label="Autocomplete trigger" hint="'Suggestion bar' requires no keyboard — just click.">
              <Select<AutocompleteMode>
                value={s.autocompleteMode}
                options={[
                  { value: "button-only",  label: "Click suggestions" },
                  { value: "tab",          label: "Tab key" },
                  { value: "ctrl-space",   label: "Ctrl + Space" },
                  { value: "arrow-select", label: "Arrow + Enter" },
                ]}
                onChange={v => set("autocompleteMode", v)}
              />
            </Row>
            <div className={`mt-3 rounded p-2 ${thm.bgTertiary} border ${thm.borderColor} text-xs space-y-1`}>
              <div className={`font-bold ${thm.accentColor} mb-1`}>Always-available shortcuts</div>
              <div className={thm.dimColor}>Ctrl+L — clear terminal</div>
              <div className={thm.dimColor}>Escape — clear input</div>
              <div className={thm.dimColor}>Ctrl+C — copy input to clipboard</div>
              <div className={thm.dimColor}>Run button — always visible, no keys needed</div>
            </div>
          </div>
        )}

        {/* ── THEME ── */}
        {tab === "theme" && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-1.5">
              {ALL_THEMES.map(t => (
                <button
                  key={t.value}
                  onClick={() => set("colorTheme", t.value)}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs border transition-all ${
                    s.colorTheme === t.value
                      ? "border-white/40 text-white"
                      : "border-gray-700 text-gray-400 hover:border-gray-500 hover:text-gray-200"
                  }`}
                  style={s.colorTheme === t.value ? { background: t.bg + "cc", borderColor: t.accent + "80" } : {}}
                >
                  <ColorDot color={t.accent} />
                  {t.label}
                  {s.colorTheme === t.value && <span className="ml-auto text-[10px] opacity-70">active</span>}
                </button>
              ))}
            </div>
            <div className="space-y-0 border-t border-gray-800 pt-3">
              <Row label="Dim old output" hint="Fades output lines that have scrolled past.">
                <Toggle value={s.dimOutput} onChange={v => set("dimOutput", v)} />
              </Row>
              <Row label="High contrast" hint="Removes subtle grays; pure contrast.">
                <Toggle value={s.highContrast} onChange={v => set("highContrast", v)} />
              </Row>
            </div>
          </div>
        )}

        {/* ── FONT ── */}
        {tab === "font" && (
          <div className="space-y-0">
            <Row label="Font family">
              <Select<FontFamily>
                value={s.fontFamily}
                options={[
                  { value: "mono-system",     label: "System mono (default)" },
                  { value: "mono-jetbrains",  label: "JetBrains Mono" },
                  { value: "mono-fira",       label: "Fira Code" },
                  { value: "mono-cascadia",   label: "Cascadia Code" },
                  { value: "mono-courier",    label: "Courier New" },
                  { value: "mono-ibm",        label: "IBM Plex Mono" },
                  { value: "mono-hack",       label: "Hack" },
                  { value: "mono-inconsolata",label: "Inconsolata" },
                  { value: "mono-source",     label: "Source Code Pro" },
                  { value: "mono-ubuntu",     label: "Ubuntu Mono" },
                ]}
                onChange={v => set("fontFamily", v)}
              />
            </Row>
            <Row label="Font size" hint={`${s.fontSize}px — range 10–28`}>
              <Slider value={s.fontSize} min={10} max={28} step={1} onChange={v => set("fontSize", v)} display={`${s.fontSize}px`} />
            </Row>
            <Row label="Line height" hint={`${s.lineHeight.toFixed(1)}x — range 1.0–2.4`}>
              <Slider value={s.lineHeight} min={1.0} max={2.4} step={0.1} onChange={v => set("lineHeight", Math.round(v * 10) / 10)} display={`${s.lineHeight.toFixed(1)}x`} />
            </Row>
            <Row label="Letter spacing" hint={`${s.letterSpacing.toFixed(2)}em`}>
              <Slider value={s.letterSpacing} min={-0.05} max={0.2} step={0.01} onChange={v => set("letterSpacing", Math.round(v * 100) / 100)} display={`${s.letterSpacing.toFixed(2)}em`} />
            </Row>
            <div
              className={`mt-3 rounded p-3 ${thm.bgTertiary} border ${thm.borderColor}`}
              style={{ fontSize: s.fontSize, lineHeight: s.lineHeight, letterSpacing: `${s.letterSpacing}em` }}
            >
              <div className={`text-xs ${thm.dimColor} mb-1`}>Live preview</div>
              <div className={thm.defaultOutputColor}>The quick brown fox — 0O1lI —</div>
              <div className={thm.accentColor}>{"tensor.randn [16,16] --name W0"}</div>
              <div className={thm.dimColor}>{"  [TENSOR] shape=[16,16] dtype=f32"}</div>
            </div>
          </div>
        )}

        {/* ── VISUAL EFFECTS ── */}
        {tab === "visual" && (
          <div className="space-y-0">
            <Row label="Scanline overlay" hint="CRT-style horizontal scanline effect.">
              <Toggle value={s.scanlineEffect} onChange={v => set("scanlineEffect", v)} />
            </Row>
            <Row label="Glow effect" hint="Text-shadow glow on output lines matching theme color.">
              <Toggle value={s.glowEffect} onChange={v => set("glowEffect", v)} />
            </Row>
            <Row label="Animate new output" hint="Fade-in effect on each new output block.">
              <Toggle value={s.animateOutput} onChange={v => set("animateOutput", v)} />
            </Row>
            <Row label="Cursor style">
              <Select<CursorStyle>
                value={s.cursorStyle}
                options={[
                  { value: "bar",           label: "| Thin bar" },
                  { value: "block",         label: "█ Block" },
                  { value: "underline",     label: "_ Underline" },
                  { value: "blinking-bar",  label: "| Blinking bar" },
                  { value: "blinking-block",label: "█ Blinking block" },
                ]}
                onChange={v => set("cursorStyle", v)}
              />
            </Row>
            <Row label="Output density" hint="Spacing between output blocks.">
              <Select<OutputDensity>
                value={s.outputDensity}
                options={[
                  { value: "compact",  label: "Compact" },
                  { value: "normal",   label: "Normal" },
                  { value: "spacious", label: "Spacious" },
                ]}
                onChange={v => set("outputDensity", v)}
              />
            </Row>
            <Row label="Panel corner radius" hint={`${s.borderRadius}px — 0 = sharp, 16 = fully rounded`}>
              <Slider value={s.borderRadius} min={0} max={16} step={1} onChange={v => set("borderRadius", v)} display={`${s.borderRadius}px`} />
            </Row>
            <div className={`mt-3 p-3 rounded border ${thm.borderColor} ${thm.bgTertiary} text-xs`} style={{ borderRadius: s.borderRadius }}>
              <span className={thm.dimColor}>corner radius preview — {s.borderRadius}px</span>
            </div>
          </div>
        )}

        {/* ── LAYOUT ── */}
        {tab === "layout" && (
          <div className="space-y-0">
            <Row label="Terminal width" hint="Max width of the terminal column.">
              <Select<TerminalWidth>
                value={s.terminalWidth}
                options={[
                  { value: "full",   label: "Full width" },
                  { value: "2xl",    label: "2XL (1536px)" },
                  { value: "xl",     label: "XL (1280px)" },
                  { value: "lg",     label: "LG (1024px)" },
                  { value: "narrow", label: "Narrow (672px)" },
                ]}
                onChange={v => set("terminalWidth", v)}
              />
            </Row>
            <Row label="Settings panel side" hint="Which side the settings panel appears on.">
              <Select<PanelPosition>
                value={s.panelPosition}
                options={[
                  { value: "right", label: "Right side" },
                  { value: "left",  label: "Left side" },
                ]}
                onChange={v => set("panelPosition", v)}
              />
            </Row>
            <Row label="Settings panel width" hint={`${s.sidebarWidth}px — range 240–480`}>
              <Slider value={s.sidebarWidth} min={240} max={480} step={8} onChange={v => set("sidebarWidth", v)} display={`${s.sidebarWidth}px`} />
            </Row>
            <Row label="Scrollback buffer" hint="How many history entries to keep in memory.">
              <select
                value={String(s.scrollbackSize)}
                onChange={e => set("scrollbackSize", Number(e.target.value) as ScrollbackSize)}
                className="bg-gray-800 border border-gray-600 text-gray-200 text-xs rounded px-2 py-1 min-w-[130px] focus:outline-none focus:border-gray-400"
              >
                <option value="200">200 entries</option>
                <option value="500">500 entries</option>
                <option value="1000">1000 entries</option>
                <option value="5000">5000 entries</option>
              </select>
            </Row>
          </div>
        )}

        {/* ── AUTOCOMPLETE ── */}
        {tab === "autocomplete" && (
          <div className="space-y-0">
            <Row label="Always show suggestions" hint="Suggestion bar visible at all times — no keyboard required.">
              <Toggle value={s.autocompleteAlwaysVisible} onChange={v => set("autocompleteAlwaysVisible", v)} />
            </Row>
            <Row label="Max suggestions" hint={`Showing ${s.autocompleteMaxItems} items max.`}>
              <Slider value={s.autocompleteMaxItems} min={3} max={20} step={1} onChange={v => set("autocompleteMaxItems", v)} />
            </Row>
          </div>
        )}

        {/* ── DISPLAY ── */}
        {tab === "display" && (
          <div className="space-y-0">
            <Row label="Quick-command buttons" hint="Row of clickable command shortcuts above input.">
              <Toggle value={s.showQuickButtons} onChange={v => set("showQuickButtons", v)} />
            </Row>
            <Row label="Status bar" hint="Tensor / Network / Optimizer / Fetch counts at bottom.">
              <Toggle value={s.showStatusBar} onChange={v => set("showStatusBar", v)} />
            </Row>
            <Row label="Boot banner" hint="ASCII art header on startup.">
              <Toggle value={s.showBanner} onChange={v => set("showBanner", v)} />
            </Row>
            <Row label="Timestamps" hint="HH:MM:SS before each output block.">
              <Toggle value={s.showTimestamps} onChange={v => set("showTimestamps", v)} />
            </Row>
            <Row label="Line numbers" hint="Block index before each output group.">
              <Toggle value={s.showLineNumbers} onChange={v => set("showLineNumbers", v)} />
            </Row>
            <Row label="Input placeholder text" hint="Hint shown in empty input box.">
              <TextInput
                value={s.inputPlaceholder}
                onChange={v => set("inputPlaceholder", v)}
                placeholder="enter command..."
                maxLength={80}
              />
            </Row>
          </div>
        )}

        {/* ── ACCESSIBILITY ── */}
        {tab === "access" && (
          <div className="space-y-0">
            <Row label="Large click targets" hint="Increases padding on all buttons. Helpful for touch/pointer devices.">
              <Toggle value={s.largeClickTargets} onChange={v => set("largeClickTargets", v)} />
            </Row>
            <Row label="Reduce motion" hint="Disables scroll animations, fade-ins, pulsing indicators.">
              <Toggle value={s.reduceMotion} onChange={v => set("reduceMotion", v)} />
            </Row>
            <Row label="High contrast" hint="Maximises text/background contrast for readability.">
              <Toggle value={s.highContrast} onChange={v => set("highContrast", v)} />
            </Row>
            <div className={`mt-3 p-3 rounded border ${thm.borderColor} ${thm.bgTertiary} text-xs space-y-1.5`}>
              <div className={`font-bold ${thm.accentColor}`}>Keyboard-free operation</div>
              <div className={thm.dimColor}>• Set autocomplete to "Click suggestions"</div>
              <div className={thm.dimColor}>• Use the "run" button instead of Enter</div>
              <div className={thm.dimColor}>• Set prompt to "No prompt" to avoid any special chars</div>
              <div className={thm.dimColor}>• Quick-command buttons need no typing at all</div>
            </div>
          </div>
        )}

        {/* ── ALIASES ── */}
        {tab === "aliases" && (
          <div className="space-y-3">
            <div className={`text-xs ${thm.dimColor} mb-2`}>
              Aliases expand shorthand into full commands. Type the alias name and it runs the target command.
            </div>

            {/* Add new alias */}
            <div className={`rounded border ${thm.borderColor} ${thm.bgTertiary} p-3 space-y-2`}>
              <div className={`text-xs font-bold ${thm.accentColor}`}>Add / replace alias</div>
              <div className="flex gap-1 items-center">
                <input
                  type="text" value={newAlias.name}
                  onChange={e => setNewAlias(a => ({ ...a, name: e.target.value }))}
                  placeholder="name (e.g. ll)"
                  maxLength={20}
                  className="bg-gray-800 border border-gray-600 text-gray-200 text-xs rounded px-2 py-1 flex-1 font-mono focus:outline-none"
                  spellCheck={false}
                  onKeyDown={e => { if (e.key === "Enter") addAlias(); }}
                />
                <span className={`${thm.dimColor} text-xs flex-shrink-0`}>→</span>
                <input
                  type="text" value={newAlias.command}
                  onChange={e => setNewAlias(a => ({ ...a, command: e.target.value }))}
                  placeholder="command (e.g. tensor.list)"
                  maxLength={120}
                  className="bg-gray-800 border border-gray-600 text-gray-200 text-xs rounded px-2 py-1 flex-1 font-mono focus:outline-none"
                  spellCheck={false}
                  onKeyDown={e => { if (e.key === "Enter") addAlias(); }}
                />
                <button
                  onClick={addAlias}
                  disabled={!newAlias.name.trim() || !newAlias.command.trim()}
                  className={`px-3 py-1 text-xs rounded border ${thm.borderColor} ${thm.accentColor} hover:opacity-80 disabled:opacity-30 flex-shrink-0`}
                >add</button>
              </div>
            </div>

            {/* Existing aliases */}
            {s.aliases.length === 0 ? (
              <div className={`text-xs ${thm.dimColor} text-center py-4`}>No aliases defined</div>
            ) : (
              <div className="space-y-1">
                {s.aliases.map((a: CommandAlias) => (
                  <div
                    key={a.name}
                    className={`flex items-center gap-2 px-2 py-1.5 rounded border ${thm.borderColor} ${thm.bgTertiary} group`}
                  >
                    <span className={`font-mono text-xs ${thm.accentColor} w-20 flex-shrink-0`}>{a.name}</span>
                    <span className={`text-xs ${thm.dimColor} flex-shrink-0`}>→</span>
                    <span className={`font-mono text-xs ${thm.defaultOutputColor} flex-1 truncate`}>{a.command}</span>
                    <button
                      onClick={() => removeAlias(a.name)}
                      className="text-red-500 hover:text-red-300 opacity-0 group-hover:opacity-100 transition-opacity text-xs flex-shrink-0"
                    >✕</button>
                  </div>
                ))}
              </div>
            )}

            <div className={`text-xs ${thm.dimColor} pt-1`}>
              Aliases also set via terminal: <span className={`font-mono ${thm.accentColor}`}>alias ll tensor.list</span>
            </div>
          </div>
        )}

        {/* ── CUSTOM CSS ── */}
        {tab === "css" && (
          <div className="space-y-3">
            <div className={`text-xs ${thm.dimColor}`}>
              Raw CSS injected into the page. Target <code className={thm.accentColor}>.x86-terminal</code> for scoped styles.
              Max 2000 characters.
            </div>
            <textarea
              value={s.customCSS}
              onChange={e => set("customCSS", e.target.value.slice(0, 2000))}
              placeholder={`.x86-terminal {\n  /* your custom CSS here */\n}\n\n/* Example: rainbow prompt */\n.x86-prompt { background: linear-gradient(90deg,#f00,#0f0,#00f); -webkit-background-clip: text; }`}
              rows={14}
              className="w-full bg-gray-800 border border-gray-700 text-gray-300 text-xs font-mono rounded p-2 resize-none focus:outline-none focus:border-gray-500"
              spellCheck={false}
            />
            <div className="flex items-center justify-between">
              <span className={`text-xs ${thm.dimColor}`}>{s.customCSS.length} / 2000 chars</span>
              {s.customCSS && (
                <button
                  onClick={() => set("customCSS", "")}
                  className="text-xs text-red-400 hover:text-red-300"
                >clear CSS</button>
              )}
            </div>
            <div className={`rounded border ${thm.borderColor} ${thm.bgTertiary} p-2 text-xs ${thm.dimColor}`}>
              CSS applies immediately. Refresh to reset if anything breaks, or use "Full reset" below.
            </div>
          </div>
        )}

      </div>

      {/* Footer */}
      <div className={`flex-shrink-0 border-t ${thm.borderColor} ${thm.bgTertiary}`}>
        {/* Quick preset row */}
        <div className={`px-3 py-2 border-b ${thm.borderColor} flex gap-1.5 flex-wrap`}>
          <span className={`text-xs ${thm.dimColor} self-center mr-1`}>Presets:</span>
          <button
            onClick={() => setMany({ scanlineEffect: false, glowEffect: false, animateOutput: false, dimOutput: false, highContrast: false, cursorStyle: "bar", outputDensity: "normal" })}
            className={`text-xs px-2 py-0.5 rounded border ${thm.borderColor} ${thm.dimColor} hover:text-gray-200`}
          >clean</button>
          <button
            onClick={() => setMany({ scanlineEffect: true, glowEffect: true, cursorStyle: "blinking-block", colorTheme: "green", animateOutput: false })}
            className="text-xs px-2 py-0.5 rounded border border-green-800 text-green-500 hover:text-green-300"
          >retro CRT</button>
          <button
            onClick={() => setMany({ colorTheme: "matrix", scanlineEffect: true, glowEffect: true, cursorStyle: "blinking-bar", fontFamily: "mono-system" })}
            className="text-xs px-2 py-0.5 rounded border border-green-900 text-green-400 hover:text-green-200"
          >matrix</button>
          <button
            onClick={() => setMany({ colorTheme: "tokyo-night", glowEffect: false, scanlineEffect: false, animateOutput: true, cursorStyle: "bar", outputDensity: "spacious" })}
            className="text-xs px-2 py-0.5 rounded border border-blue-800 text-blue-400 hover:text-blue-200"
          >tokyo</button>
          <button
            onClick={() => setMany({ highContrast: true, reduceMotion: true, largeClickTargets: true, autocompleteAlwaysVisible: true, autocompleteMode: "button-only", scanlineEffect: false, glowEffect: false })}
            className="text-xs px-2 py-0.5 rounded border border-yellow-800 text-yellow-400 hover:text-yellow-200"
          >accessible</button>
        </div>
        {/* Reset buttons */}
        <div className="flex gap-2 px-3 py-2.5">
          <button
            onClick={() => onChange({ ...DEFAULT_SETTINGS, colorTheme: s.colorTheme })}
            className="flex-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded py-1.5 transition-colors"
          >Reset defaults (keep theme)</button>
          <button
            onClick={() => onChange(resetSettings())}
            className="flex-1 text-xs bg-red-900/80 hover:bg-red-800 text-red-300 rounded py-1.5 transition-colors"
          >Full wipe</button>
        </div>
      </div>
    </div>
  );
}
