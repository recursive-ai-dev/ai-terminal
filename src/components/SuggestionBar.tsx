// ============================================================
// SUGGESTION BAR v5.0 — Dramatic neon pill autocomplete
// Keyboard-free, shimmer hover, glow on match, run/fill split
// ============================================================
import { useMemo } from "react";
import { ALL_COMPLETIONS, UXSettings, THEMES } from "../engine/UXSettings";

interface Props {
  input:    string;
  settings: UXSettings;
  onSelect: (cmd: string) => void;
  onInsert: (cmd: string) => void;
}

const DEFAULT_CMDS = [
  "help", "demo xor", "sysinfo", "demo tree",
  "benchmark", "demo registers", "demo adam", "demo fetch",
];

export default function SuggestionBar({ input, settings: s, onSelect, onInsert }: Props) {
  const thm = THEMES[s.colorTheme];

  const suggestions = useMemo(() => {
    const q = input.trim().toLowerCase();
    if (!q) return DEFAULT_CMDS.slice(0, s.autocompleteMaxItems);
    const exact   = ALL_COMPLETIONS.filter(c => c.toLowerCase() === q);
    const matches = ALL_COMPLETIONS.filter(c => c.toLowerCase().startsWith(q) && c !== q);
    return [...exact, ...matches].slice(0, s.autocompleteMaxItems);
  }, [input, s.autocompleteMaxItems]);

  if (!s.autocompleteAlwaysVisible && suggestions.length === 0) return null;

  const padCls = s.largeClickTargets ? "px-3 py-1.5" : "px-2 py-0.5";

  return (
    <div
      className="flex flex-wrap items-center gap-1.5 px-3 py-2 flex-shrink-0"
      style={{
        background: "rgba(0,0,0,0.4)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        borderTop: `1px solid ${thm.rawAccent}18`,
      }}
      onClick={e => e.stopPropagation()}
    >
      {/* Label */}
      <span
        className="text-xs flex-shrink-0 select-none"
        style={{ color: `${thm.rawAccent}44`, letterSpacing: "0.12em", fontVariantCaps: "all-small-caps" }}
      >
        {suggestions.length === 0 ? "no match" : "suggest"}
      </span>

      {/* Separator */}
      <div style={{ width: 1, height: 12, background: `${thm.rawAccent}22`, flexShrink: 0 }} />

      {/* Pills */}
      {suggestions.map(sug => {
        const prefix   = input.trim().toLowerCase();
        const matchLen = prefix.length;
        const matchPart = sug.slice(0, matchLen);
        const restPart  = sug.slice(matchLen);

        return (
          <div
            key={sug}
            className="suggestion-pill flex items-stretch rounded overflow-hidden"
            style={{ borderRadius: Math.max(4, s.borderRadius) }}
          >
            {/* Fill button — sets input, doesn't run */}
            <button
              onMouseDown={e => { e.preventDefault(); onInsert(sug); }}
              className={`${padCls} text-xs transition-all`}
              style={{
                background: "rgba(255,255,255,0.03)",
                color: "rgba(255,255,255,0.7)",
                fontFamily: "inherit",
              }}
              title={`Fill: ${sug}`}
            >
              {matchPart
                ? <span>
                    <span style={{ color: thm.rawAccent, textShadow: `0 0 6px ${thm.rawGlow}` }}>
                      {matchPart}
                    </span>
                    <span style={{ color: "rgba(255,255,255,0.55)" }}>{restPart}</span>
                  </span>
                : <span style={{ color: "rgba(255,255,255,0.55)" }}>{sug}</span>
              }
            </button>

            {/* Divider */}
            <div style={{ width: 1, background: `${thm.rawAccent}22`, flexShrink: 0 }} />

            {/* Run button — executes */}
            <button
              onMouseDown={e => { e.preventDefault(); onSelect(sug); }}
              className={`${padCls} text-xs font-bold transition-all`}
              style={{
                background: `${thm.rawAccent}10`,
                color: thm.rawAccent,
                letterSpacing: "0.06em",
                paddingLeft: 8,
                paddingRight: 8,
              }}
              title={`Run: ${sug}`}
            >
              ▶
            </button>
          </div>
        );
      })}

      {suggestions.length === 0 && (
        <span className="text-xs italic" style={{ color: `${thm.rawAccent}33` }}>
          type to filter · Enter to run
        </span>
      )}
    </div>
  );
}
