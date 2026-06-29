// ============================================================
// UX SETTINGS ENGINE v3.0 — Typed config, localStorage persistence
// Covers: accessibility, keybinds, prompt, theme, font, autocomplete,
//         visual effects, layout, aliases, custom CSS, output density
// ============================================================

export type FontFamily =
  | "mono-jetbrains" | "mono-fira" | "mono-cascadia" | "mono-courier"
  | "mono-system" | "mono-ibm" | "mono-hack" | "mono-inconsolata"
  | "mono-source" | "mono-ubuntu";

export type ColorTheme =
  | "green" | "amber" | "cyan" | "red" | "white" | "purple" | "blue"
  | "dracula" | "solarized-dark" | "nord" | "monokai" | "gruvbox"
  | "tokyo-night" | "catppuccin" | "rose-pine" | "matrix";

export type AutocompleteMode = "tab" | "ctrl-space" | "button-only" | "arrow-select";
export type HistoryUpKey    = "ArrowUp" | "ctrl-p" | "ctrl-k";
export type HistoryDownKey  = "ArrowDown" | "ctrl-n" | "ctrl-j";
export type SubmitKey       = "Enter" | "ctrl-enter";
export type PromptStyle     = "custom" | "user@host" | "path" | "minimal" | "none";
export type CursorStyle     = "block" | "underline" | "bar" | "blinking-block" | "blinking-bar";
export type OutputDensity   = "compact" | "normal" | "spacious";
export type PanelPosition   = "right" | "left";
export type TerminalWidth   = "full" | "lg" | "xl" | "2xl" | "narrow";
export type ScrollbackSize  = 200 | 500 | 1000 | 5000;

export interface CommandAlias {
  name: string;        // the alias shorthand
  command: string;     // the full command it expands to
}

export interface UXSettings {
  // ── Prompt ──
  promptStyle: PromptStyle;
  promptCustom: string;
  promptUser: string;
  promptHost: string;
  promptSuffix: string;          // e.g. " " or " > " after prompt symbol

  // ── Keybinds ──
  autocompleteMode: AutocompleteMode;
  historyUp: HistoryUpKey;
  historyDown: HistoryDownKey;
  submitKey: SubmitKey;

  // ── Font ──
  fontFamily: FontFamily;
  fontSize: number;              // px, range 10–28
  lineHeight: number;            // multiplier, range 1.0–2.4
  letterSpacing: number;         // em, range -0.05 to 0.2

  // ── Theme ──
  colorTheme: ColorTheme;
  dimOutput: boolean;
  showTimestamps: boolean;
  showLineNumbers: boolean;
  customCSS: string;             // raw CSS injected into <style>

  // ── Visual Effects ──
  scanlineEffect: boolean;       // CRT scanline overlay
  glowEffect: boolean;           // text-shadow glow on output
  borderRadius: number;          // px, 0–16 for panel corners
  cursorStyle: CursorStyle;
  outputDensity: OutputDensity;  // line gap between output blocks
  animateOutput: boolean;        // fade-in new output lines

  // ── Layout ──
  terminalWidth: TerminalWidth;  // max-width of terminal column
  panelPosition: PanelPosition;  // settings panel left or right
  sidebarWidth: number;          // px, 240–480

  // ── Autocomplete ──
  autocompleteMaxItems: number;
  autocompleteAlwaysVisible: boolean;

  // ── Accessibility ──
  highContrast: boolean;
  reduceMotion: boolean;
  largeClickTargets: boolean;

  // ── UX / Display ──
  showQuickButtons: boolean;
  showStatusBar: boolean;
  showBanner: boolean;
  inputPlaceholder: string;
  soundEnabled: boolean;
  scrollbackSize: ScrollbackSize;

  // ── Command Aliases ──
  aliases: CommandAlias[];
}

export const DEFAULT_SETTINGS: UXSettings = {
  promptStyle: "custom",
  promptCustom: ">>",
  promptUser: "user",
  promptHost: "x86",
  promptSuffix: " ",

  autocompleteMode: "button-only",
  historyUp: "ArrowUp",
  historyDown: "ArrowDown",
  submitKey: "Enter",

  fontFamily: "mono-system",
  fontSize: 14,
  lineHeight: 1.6,
  letterSpacing: 0,

  colorTheme: "green",
  dimOutput: false,
  showTimestamps: false,
  showLineNumbers: false,
  customCSS: "",

  scanlineEffect: false,
  glowEffect: false,
  borderRadius: 4,
  cursorStyle: "bar",
  outputDensity: "normal",
  animateOutput: false,

  terminalWidth: "full",
  panelPosition: "right",
  sidebarWidth: 320,

  autocompleteMaxItems: 10,
  autocompleteAlwaysVisible: true,

  highContrast: false,
  reduceMotion: false,
  largeClickTargets: false,

  showQuickButtons: true,
  showStatusBar: true,
  showBanner: true,
  inputPlaceholder: "enter command — or pick from suggestions below",
  soundEnabled: false,
  scrollbackSize: 500,

  aliases: [
    { name: "ll",  command: "tensor.list" },
    { name: "cls", command: "clear" },
    { name: "nls", command: "net.list" },
    { name: "ols", command: "adam.info" },
  ],
};

// ── Schema versioning ──
export const SETTINGS_SCHEMA_VERSION = 3;

export interface PersistedSettingsBlob {
  __version: number;
  settings: UXSettings;
}

export type FieldValidationResult =
  | { ok: true; value: unknown }
  | { ok: false; field: string; reason: string; rejected: unknown };

export interface SettingsValidationReport {
  ok: boolean;
  validated: UXSettings;
  errors: Array<{ field: string; reason: string; rejected: unknown; fallback: unknown }>;
  warnings: string[];
}

export function fingerprintSettings(s: UXSettings): string {
  return JSON.stringify(s);
}

const VALID_FONT_FAMILIES = new Set<FontFamily>([
  "mono-jetbrains","mono-fira","mono-cascadia","mono-courier","mono-system",
  "mono-ibm","mono-hack","mono-inconsolata","mono-source","mono-ubuntu",
]);
const VALID_COLOR_THEMES = new Set<ColorTheme>([
  "green","amber","cyan","red","white","purple","blue",
  "dracula","solarized-dark","nord","monokai","gruvbox",
  "tokyo-night","catppuccin","rose-pine","matrix",
]);
const VALID_AC_MODES      = new Set<AutocompleteMode>(["tab","ctrl-space","button-only","arrow-select"]);
const VALID_HISTORY_UP    = new Set<HistoryUpKey>(["ArrowUp","ctrl-p","ctrl-k"]);
const VALID_HISTORY_DOWN  = new Set<HistoryDownKey>(["ArrowDown","ctrl-n","ctrl-j"]);
const VALID_SUBMIT_KEYS   = new Set<SubmitKey>(["Enter","ctrl-enter"]);
const VALID_PROMPT_STYLES = new Set<PromptStyle>(["custom","user@host","path","minimal","none"]);
const VALID_CURSOR_STYLES = new Set<CursorStyle>(["block","underline","bar","blinking-block","blinking-bar"]);
const VALID_OUTPUT_DENSITY= new Set<OutputDensity>(["compact","normal","spacious"]);
const VALID_PANEL_POS     = new Set<PanelPosition>(["right","left"]);
const VALID_TERM_WIDTH    = new Set<TerminalWidth>(["full","lg","xl","2xl","narrow"]);
const VALID_SCROLLBACK    = new Set<ScrollbackSize>([200, 500, 1000, 5000]);

function clampInt(v: unknown, min: number, max: number): number | null {
  const n = typeof v === "number" ? v : parseFloat(String(v));
  if (!isFinite(n)) return null;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function clampFloat(v: unknown, min: number, max: number, dp: number): number | null {
  const n = typeof v === "number" ? v : parseFloat(String(v));
  if (!isFinite(n)) return null;
  const clamped = Math.max(min, Math.min(max, n));
  const factor = Math.pow(10, dp);
  return Math.round(clamped * factor) / factor;
}

function sanitizeString(v: unknown, maxLen: number, pattern?: RegExp): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim().slice(0, maxLen);
  if (pattern && !pattern.test(trimmed)) return null;
  return trimmed;
}

export function validateSettings(
  raw: Partial<UXSettings>,
  base: UXSettings = DEFAULT_SETTINGS
): SettingsValidationReport {
  const errors: SettingsValidationReport["errors"] = [];
  const warnings: string[] = [];
  const out = { ...base };

  function field<K extends keyof UXSettings>(
    key: K,
    validate: (v: unknown) => UXSettings[K] | null,
    fallback: UXSettings[K]
  ): void {
    if (!(key in raw)) return;
    const raw_val = raw[key];
    const result = validate(raw_val);
    if (result === null) {
      errors.push({ field: key, reason: `invalid value`, rejected: raw_val, fallback });
      out[key] = fallback;
    } else {
      out[key] = result;
    }
  }

  field("promptStyle",       v => VALID_PROMPT_STYLES.has(v as PromptStyle) ? v as PromptStyle : null, base.promptStyle);
  field("fontFamily",        v => VALID_FONT_FAMILIES.has(v as FontFamily) ? v as FontFamily : null, base.fontFamily);
  field("colorTheme",        v => VALID_COLOR_THEMES.has(v as ColorTheme) ? v as ColorTheme : null, base.colorTheme);
  field("autocompleteMode",  v => VALID_AC_MODES.has(v as AutocompleteMode) ? v as AutocompleteMode : null, base.autocompleteMode);
  field("historyUp",         v => VALID_HISTORY_UP.has(v as HistoryUpKey) ? v as HistoryUpKey : null, base.historyUp);
  field("historyDown",       v => VALID_HISTORY_DOWN.has(v as HistoryDownKey) ? v as HistoryDownKey : null, base.historyDown);
  field("submitKey",         v => VALID_SUBMIT_KEYS.has(v as SubmitKey) ? v as SubmitKey : null, base.submitKey);
  field("cursorStyle",       v => VALID_CURSOR_STYLES.has(v as CursorStyle) ? v as CursorStyle : null, base.cursorStyle);
  field("outputDensity",     v => VALID_OUTPUT_DENSITY.has(v as OutputDensity) ? v as OutputDensity : null, base.outputDensity);
  field("panelPosition",     v => VALID_PANEL_POS.has(v as PanelPosition) ? v as PanelPosition : null, base.panelPosition);
  field("terminalWidth",     v => VALID_TERM_WIDTH.has(v as TerminalWidth) ? v as TerminalWidth : null, base.terminalWidth);
  field("scrollbackSize",    v => VALID_SCROLLBACK.has(v as ScrollbackSize) ? v as ScrollbackSize : null, base.scrollbackSize);

  field("fontSize",          v => clampInt(v, 10, 28), base.fontSize);
  field("lineHeight",        v => clampFloat(v, 1.0, 2.4, 1), base.lineHeight);
  field("letterSpacing",     v => clampFloat(v, -0.05, 0.2, 3), base.letterSpacing);
  field("borderRadius",      v => clampInt(v, 0, 16), base.borderRadius);
  field("sidebarWidth",      v => clampInt(v, 240, 480), base.sidebarWidth);
  field("autocompleteMaxItems", v => clampInt(v, 3, 20), base.autocompleteMaxItems);

  field("promptCustom",      v => sanitizeString(v, 20) ?? (warnings.push("promptCustom reset"), ">>"), base.promptCustom);
  field("promptUser",        v => sanitizeString(v, 16, /^[\w.\-]+$/) ?? null, base.promptUser);
  field("promptHost",        v => sanitizeString(v, 16, /^[\w.\-]+$/) ?? null, base.promptHost);
  field("promptSuffix",      v => sanitizeString(v, 4) ?? " ", base.promptSuffix);
  field("inputPlaceholder",  v => sanitizeString(v, 80) ?? base.inputPlaceholder, base.inputPlaceholder);
  field("customCSS",         v => sanitizeString(v, 2000) ?? "", base.customCSS);

  const boolKeys: Array<keyof UXSettings> = [
    "dimOutput","showTimestamps","showLineNumbers","autocompleteAlwaysVisible",
    "highContrast","reduceMotion","largeClickTargets","showQuickButtons",
    "showStatusBar","showBanner","soundEnabled","scanlineEffect","glowEffect",
    "animateOutput",
  ];
  for (const k of boolKeys) {
    field(k, v => typeof v === "boolean" ? v : null, base[k] as UXSettings[typeof k]);
  }

  // Aliases: validate array of {name, command}
  if ("aliases" in raw && Array.isArray(raw.aliases)) {
    const valid = (raw.aliases as unknown[]).filter(
      a => typeof a === "object" && a !== null &&
        typeof (a as CommandAlias).name === "string" &&
        typeof (a as CommandAlias).command === "string" &&
        (a as CommandAlias).name.length > 0 &&
        (a as CommandAlias).command.length > 0
    ) as CommandAlias[];
    out.aliases = valid.slice(0, 40); // max 40 aliases
  }

  return { ok: errors.length === 0, validated: out, errors, warnings };
}

export interface SettingsDiff {
  changedKeys: string[];
  changes: Array<{ key: string; from: unknown; to: unknown }>;
}

export function diffSettings(prev: UXSettings, next: UXSettings): SettingsDiff {
  const changes: SettingsDiff["changes"] = [];
  for (const k of Object.keys(next) as Array<keyof UXSettings>) {
    if (JSON.stringify(prev[k]) !== JSON.stringify(next[k])) {
      changes.push({ key: k, from: prev[k], to: next[k] });
    }
  }
  return { changedKeys: changes.map(c => c.key), changes };
}

const STORAGE_KEY = "x86_neural_ux_settings_v3";

export function loadSettingsVersioned(): { settings: UXSettings; migrated: boolean; version: number } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { settings: { ...DEFAULT_SETTINGS }, migrated: false, version: 0 };
    const parsed = JSON.parse(raw) as Partial<PersistedSettingsBlob & UXSettings>;
    if ("__version" in parsed && typeof parsed.__version === "number") {
      const version = parsed.__version;
      const rawSettings = (parsed as PersistedSettingsBlob).settings ?? parsed;
      const report = validateSettings(rawSettings as Partial<UXSettings>);
      return { settings: { ...DEFAULT_SETTINGS, ...report.validated }, migrated: version < SETTINGS_SCHEMA_VERSION, version };
    }
    const report = validateSettings(parsed as Partial<UXSettings>);
    return { settings: { ...DEFAULT_SETTINGS, ...report.validated }, migrated: true, version: 0 };
  } catch {
    return { settings: { ...DEFAULT_SETTINGS }, migrated: false, version: 0 };
  }
}

export function loadSettings(): UXSettings {
  return loadSettingsVersioned().settings;
}

export function saveSettings(s: UXSettings): void {
  try {
    const blob: PersistedSettingsBlob = { __version: SETTINGS_SCHEMA_VERSION, settings: s };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(blob));
  } catch { /* unavailable */ }
}

export function resetSettings(): UXSettings {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  return { ...DEFAULT_SETTINGS };
}

export function resolvePrompt(s: UXSettings): string {
  let base = "";
  switch (s.promptStyle) {
    case "custom":    base = s.promptCustom || ">>"; break;
    case "user@host": base = `${s.promptUser}@${s.promptHost}`; break;
    case "path":      base = `~/${s.promptHost}`; break;
    case "minimal":   base = ">"; break;
    case "none":      return "";
    default:          base = ">>";
  }
  return base + (s.promptSuffix ?? " ");
}

// ── Theme palettes ─────────────────────────────────────────
export interface ThemePalette {
  promptColor: string;
  inputColor: string;
  bannerColor: string;
  defaultOutputColor: string;
  bgPrimary: string;
  bgSecondary: string;
  bgTertiary: string;
  borderColor: string;
  cursorColor: string;
  accentColor: string;
  dimColor: string;
  errorColor: string;
  successColor: string;
  warningColor: string;
  // raw CSS color values for effects
  rawAccent: string;
  rawGlow: string;
}

export const THEMES: Record<ColorTheme, ThemePalette> = {
  green: {
    promptColor:"text-green-500", inputColor:"text-white", bannerColor:"text-cyan-400",
    defaultOutputColor:"text-green-200", bgPrimary:"bg-gray-950", bgSecondary:"bg-gray-900",
    bgTertiary:"bg-gray-800", borderColor:"border-gray-700", cursorColor:"caret-green-400",
    accentColor:"text-green-400", dimColor:"text-gray-600", errorColor:"text-red-400",
    successColor:"text-green-300", warningColor:"text-yellow-300",
    rawAccent:"#4ade80", rawGlow:"#4ade8066",
  },
  amber: {
    promptColor:"text-amber-500", inputColor:"text-amber-100", bannerColor:"text-amber-400",
    defaultOutputColor:"text-amber-200", bgPrimary:"bg-stone-950", bgSecondary:"bg-stone-900",
    bgTertiary:"bg-stone-800", borderColor:"border-stone-700", cursorColor:"caret-amber-400",
    accentColor:"text-amber-400", dimColor:"text-stone-600", errorColor:"text-red-400",
    successColor:"text-amber-300", warningColor:"text-orange-300",
    rawAccent:"#f59e0b", rawGlow:"#f59e0b66",
  },
  cyan: {
    promptColor:"text-cyan-400", inputColor:"text-cyan-100", bannerColor:"text-cyan-300",
    defaultOutputColor:"text-cyan-200", bgPrimary:"bg-slate-950", bgSecondary:"bg-slate-900",
    bgTertiary:"bg-slate-800", borderColor:"border-slate-700", cursorColor:"caret-cyan-400",
    accentColor:"text-cyan-400", dimColor:"text-slate-600", errorColor:"text-red-400",
    successColor:"text-cyan-300", warningColor:"text-yellow-300",
    rawAccent:"#22d3ee", rawGlow:"#22d3ee66",
  },
  red: {
    promptColor:"text-red-500", inputColor:"text-red-100", bannerColor:"text-red-400",
    defaultOutputColor:"text-red-200", bgPrimary:"bg-zinc-950", bgSecondary:"bg-zinc-900",
    bgTertiary:"bg-zinc-800", borderColor:"border-zinc-700", cursorColor:"caret-red-400",
    accentColor:"text-red-400", dimColor:"text-zinc-600", errorColor:"text-orange-400",
    successColor:"text-green-400", warningColor:"text-yellow-400",
    rawAccent:"#f87171", rawGlow:"#f8717166",
  },
  white: {
    promptColor:"text-gray-900", inputColor:"text-gray-900", bannerColor:"text-gray-700",
    defaultOutputColor:"text-gray-800", bgPrimary:"bg-white", bgSecondary:"bg-gray-50",
    bgTertiary:"bg-gray-100", borderColor:"border-gray-300", cursorColor:"caret-gray-900",
    accentColor:"text-gray-700", dimColor:"text-gray-400", errorColor:"text-red-600",
    successColor:"text-green-600", warningColor:"text-yellow-600",
    rawAccent:"#374151", rawGlow:"#37415122",
  },
  purple: {
    promptColor:"text-purple-400", inputColor:"text-purple-100", bannerColor:"text-violet-400",
    defaultOutputColor:"text-purple-200", bgPrimary:"bg-indigo-950", bgSecondary:"bg-indigo-900",
    bgTertiary:"bg-indigo-800", borderColor:"border-indigo-700", cursorColor:"caret-purple-400",
    accentColor:"text-violet-400", dimColor:"text-indigo-700", errorColor:"text-red-400",
    successColor:"text-green-400", warningColor:"text-yellow-400",
    rawAccent:"#a78bfa", rawGlow:"#a78bfa66",
  },
  blue: {
    promptColor:"text-blue-400", inputColor:"text-blue-100", bannerColor:"text-sky-400",
    defaultOutputColor:"text-blue-200", bgPrimary:"bg-sky-950", bgSecondary:"bg-sky-900",
    bgTertiary:"bg-sky-800", borderColor:"border-sky-700", cursorColor:"caret-blue-400",
    accentColor:"text-sky-400", dimColor:"text-sky-800", errorColor:"text-red-400",
    successColor:"text-green-400", warningColor:"text-yellow-400",
    rawAccent:"#38bdf8", rawGlow:"#38bdf866",
  },
  dracula: {
    promptColor:"text-pink-400", inputColor:"text-purple-100", bannerColor:"text-pink-300",
    defaultOutputColor:"text-purple-100", bgPrimary:"bg-[#282a36]", bgSecondary:"bg-[#21222c]",
    bgTertiary:"bg-[#44475a]", borderColor:"border-[#44475a]", cursorColor:"caret-pink-400",
    accentColor:"text-pink-400", dimColor:"text-[#6272a4]", errorColor:"text-red-400",
    successColor:"text-green-400", warningColor:"text-yellow-300",
    rawAccent:"#ff79c6", rawGlow:"#ff79c666",
  },
  "solarized-dark": {
    promptColor:"text-[#268bd2]", inputColor:"text-[#839496]", bannerColor:"text-[#2aa198]",
    defaultOutputColor:"text-[#839496]", bgPrimary:"bg-[#002b36]", bgSecondary:"bg-[#073642]",
    bgTertiary:"bg-[#094557]", borderColor:"border-[#094557]", cursorColor:"caret-[#268bd2]",
    accentColor:"text-[#268bd2]", dimColor:"text-[#586e75]", errorColor:"text-[#dc322f]",
    successColor:"text-[#859900]", warningColor:"text-[#b58900]",
    rawAccent:"#268bd2", rawGlow:"#268bd266",
  },
  nord: {
    promptColor:"text-[#88c0d0]", inputColor:"text-[#eceff4]", bannerColor:"text-[#81a1c1]",
    defaultOutputColor:"text-[#d8dee9]", bgPrimary:"bg-[#2e3440]", bgSecondary:"bg-[#3b4252]",
    bgTertiary:"bg-[#434c5e]", borderColor:"border-[#434c5e]", cursorColor:"caret-[#88c0d0]",
    accentColor:"text-[#88c0d0]", dimColor:"text-[#4c566a]", errorColor:"text-[#bf616a]",
    successColor:"text-[#a3be8c]", warningColor:"text-[#ebcb8b]",
    rawAccent:"#88c0d0", rawGlow:"#88c0d066",
  },
  monokai: {
    promptColor:"text-[#a6e22e]", inputColor:"text-[#f8f8f2]", bannerColor:"text-[#66d9e8]",
    defaultOutputColor:"text-[#f8f8f2]", bgPrimary:"bg-[#272822]", bgSecondary:"bg-[#1e1f1c]",
    bgTertiary:"bg-[#3e3d32]", borderColor:"border-[#3e3d32]", cursorColor:"caret-[#a6e22e]",
    accentColor:"text-[#a6e22e]", dimColor:"text-[#75715e]", errorColor:"text-[#f92672]",
    successColor:"text-[#a6e22e]", warningColor:"text-[#e6db74]",
    rawAccent:"#a6e22e", rawGlow:"#a6e22e66",
  },
  gruvbox: {
    promptColor:"text-[#b8bb26]", inputColor:"text-[#ebdbb2]", bannerColor:"text-[#83a598]",
    defaultOutputColor:"text-[#ebdbb2]", bgPrimary:"bg-[#282828]", bgSecondary:"bg-[#1d2021]",
    bgTertiary:"bg-[#3c3836]", borderColor:"border-[#504945]", cursorColor:"caret-[#b8bb26]",
    accentColor:"text-[#b8bb26]", dimColor:"text-[#665c54]", errorColor:"text-[#fb4934]",
    successColor:"text-[#b8bb26]", warningColor:"text-[#fabd2f]",
    rawAccent:"#b8bb26", rawGlow:"#b8bb2666",
  },
  "tokyo-night": {
    promptColor:"text-[#7aa2f7]", inputColor:"text-[#c0caf5]", bannerColor:"text-[#bb9af7]",
    defaultOutputColor:"text-[#a9b1d6]", bgPrimary:"bg-[#1a1b26]", bgSecondary:"bg-[#16161e]",
    bgTertiary:"bg-[#24283b]", borderColor:"border-[#292e42]", cursorColor:"caret-[#7aa2f7]",
    accentColor:"text-[#7aa2f7]", dimColor:"text-[#414868]", errorColor:"text-[#f7768e]",
    successColor:"text-[#9ece6a]", warningColor:"text-[#e0af68]",
    rawAccent:"#7aa2f7", rawGlow:"#7aa2f766",
  },
  catppuccin: {
    promptColor:"text-[#cba6f7]", inputColor:"text-[#cdd6f4]", bannerColor:"text-[#89dceb]",
    defaultOutputColor:"text-[#cdd6f4]", bgPrimary:"bg-[#1e1e2e]", bgSecondary:"bg-[#181825]",
    bgTertiary:"bg-[#313244]", borderColor:"border-[#45475a]", cursorColor:"caret-[#cba6f7]",
    accentColor:"text-[#cba6f7]", dimColor:"text-[#585b70]", errorColor:"text-[#f38ba8]",
    successColor:"text-[#a6e3a1]", warningColor:"text-[#f9e2af]",
    rawAccent:"#cba6f7", rawGlow:"#cba6f766",
  },
  "rose-pine": {
    promptColor:"text-[#ebbcba]", inputColor:"text-[#e0def4]", bannerColor:"text-[#31748f]",
    defaultOutputColor:"text-[#e0def4]", bgPrimary:"bg-[#191724]", bgSecondary:"bg-[#1f1d2e]",
    bgTertiary:"bg-[#26233a]", borderColor:"border-[#403d52]", cursorColor:"caret-[#ebbcba]",
    accentColor:"text-[#ebbcba]", dimColor:"text-[#6e6a86]", errorColor:"text-[#eb6f92]",
    successColor:"text-[#9ccfd8]", warningColor:"text-[#f6c177]",
    rawAccent:"#ebbcba", rawGlow:"#ebbcba66",
  },
  matrix: {
    promptColor:"text-[#00ff41]", inputColor:"text-[#00ff41]", bannerColor:"text-[#00ff41]",
    defaultOutputColor:"text-[#00cc33]", bgPrimary:"bg-black", bgSecondary:"bg-[#001100]",
    bgTertiary:"bg-[#002200]", borderColor:"border-[#003300]", cursorColor:"caret-[#00ff41]",
    accentColor:"text-[#00ff41]", dimColor:"text-[#003300]", errorColor:"text-[#ff0000]",
    successColor:"text-[#00ff41]", warningColor:"text-[#aaff00]",
    rawAccent:"#00ff41", rawGlow:"#00ff4199",
  },
};

// ── Font stacks ─────────────────────────────────────────────
export const FONT_STACKS: Record<FontFamily, string> = {
  "mono-system":     "'Courier New', 'Lucida Console', monospace",
  "mono-jetbrains":  "'JetBrains Mono', 'Fira Code', monospace",
  "mono-fira":       "'Fira Code', 'Fira Mono', monospace",
  "mono-cascadia":   "'Cascadia Code', 'Consolas', monospace",
  "mono-courier":    "'Courier New', monospace",
  "mono-ibm":        "'IBM Plex Mono', 'Courier New', monospace",
  "mono-hack":       "'Hack', 'DejaVu Sans Mono', monospace",
  "mono-inconsolata":"'Inconsolata', 'Lucida Console', monospace",
  "mono-source":     "'Source Code Pro', 'Courier New', monospace",
  "mono-ubuntu":     "'Ubuntu Mono', 'Courier New', monospace",
};

// ── Terminal width class map ─────────────────────────────────
export const TERMINAL_WIDTH_CLASS: Record<TerminalWidth, string> = {
  full:   "",
  narrow: "max-w-2xl mx-auto",
  lg:     "max-w-4xl mx-auto",
  xl:     "max-w-6xl mx-auto",
  "2xl":  "max-w-7xl mx-auto",
};

// ── Output density gap ──────────────────────────────────────
export const OUTPUT_DENSITY_CLASS: Record<OutputDensity, string> = {
  compact:  "space-y-0",
  normal:   "space-y-0.5",
  spacious: "space-y-2",
};

// ── All completions list ─────────────────────────────────────
export const ALL_COMPLETIONS = [
  // Tensor
  "tensor","tensor.randn","tensor.zeros","tensor.ones","tensor.add","tensor.mul",
  "tensor.matmul","tensor.scale","tensor.relu","tensor.tanh","tensor.sigmoid",
  "tensor.softmax","tensor.backward","tensor.grad","tensor.info","tensor.list",
  "tensor.norm","tensor.mse",
  // Network
  "net.build","net.describe","net.forward","net.train","net.predict","net.list","net.loss_history",
  // Adam
  "adam.create","adam.step","adam.zero_grad","adam.info",
  // Registers
  "reg.set","reg.get","reg.dump","reg.push","reg.pop","reg.cmp","reg.xmm","reg.ymm",
  "reg.simd.dot","reg.simd.vaddps","reg.simd.vmulps",
  // Tree
  "tree.load","tree.eval","tree.chain","tree.print","tree.list",
  // Fetch
  "fetch","fetch.get","fetch.head","fetch.post","fetch.spider","fetch.show",
  "fetch.save","fetch.links","fetch.list","fetch.drop","fetch.headers","wget","wget.spider",
  // Math
  "math.eval","math.sin","math.cos","math.tan","math.sqrt","math.log","math.pow",
  "math.abs","math.ceil","math.floor","math.round","math.pi","math.e",
  // JSON
  "json.parse","json.format","json.get","json.keys","json.validate",
  // String ops
  "str.upper","str.lower","str.reverse","str.length","str.split","str.replace",
  "str.trim","str.contains","str.count","str.repeat","str.pad",
  // Base64 / Hash
  "base64.encode","base64.decode","hash.djb2","hash.fnv","hash.sdbm",
  // Time
  "time.now","time.stamp","time.since","time.format",
  // Variables
  "var.set","var.get","var.list","var.del","var.clear",
  // Utils
  "calc","uuid","ascii","grep","sort","count","pipe","uniq","wc",
  // Matrix
  "matrix.create","matrix.add","matrix.mul","matrix.det","matrix.transpose","matrix.identity",
  // Color
  "color.hex","color.rgb","color.hsl","color.mix","color.palette",
  // Stats
  "stat.mean","stat.median","stat.std","stat.min","stat.max","stat.histogram",
  // System
  "demo","demo xor","demo tree","demo registers","demo adam","demo fetch",
  "benchmark","sysinfo","help","clear","history","reset",
  "seed","logs","logs.clear","test","test.train",
  "whoami","echo","alias","alias.list","alias.del",
  "savelog","paste","settings",
];

// ── Key matcher ──────────────────────────────────────────────
export function matchesKey(
  e: React.KeyboardEvent,
  binding: HistoryUpKey | HistoryDownKey | SubmitKey
): boolean {
  switch (binding) {
    case "ArrowUp":    return e.key === "ArrowUp"   && !e.ctrlKey;
    case "ArrowDown":  return e.key === "ArrowDown"  && !e.ctrlKey;
    case "ctrl-p":     return e.key === "p" && e.ctrlKey;
    case "ctrl-n":     return e.key === "n" && e.ctrlKey;
    case "ctrl-k":     return e.key === "k" && e.ctrlKey;
    case "ctrl-j":     return e.key === "j" && e.ctrlKey;
    case "Enter":      return e.key === "Enter" && !e.ctrlKey;
    case "ctrl-enter": return e.key === "Enter" && e.ctrlKey;
    default:           return false;
  }
}
