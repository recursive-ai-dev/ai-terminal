// ============================================================
// NATIVE TITLE BAR v5.0 — Dramatic frameless chrome
// Electron only. Draggable region, traffic lights, updater badge,
// animated accent bar, neon window controls.
// ============================================================
import { isElectron } from "../bridge/electronBridge";
import { WindowControls } from "../bridge/usePlatform";
import { UpdaterStatus }  from "../bridge/electronBridge";
import { ThemePalette }   from "../engine/UXSettings";

interface Props {
  title:          string;
  thm:            ThemePalette;
  window:         WindowControls;
  updaterStatus:  UpdaterStatus;
  onCheckUpdates: () => void;
  onInstall:      () => void;
  onDownload:     () => void;
  platform:       string;
}

function WinBtn({
  color, hoverColor, shadowColor, onClick, title, symbol,
}: {
  color: string;
  hoverColor: string;
  shadowColor: string;
  onClick: () => void;
  title: string;
  symbol: string;
}) {
  return (
    <button
      onClick={e => { e.stopPropagation(); onClick(); }}
      title={title}
      className="traffic-light w-3 h-3 rounded-full flex items-center justify-center
                 text-transparent hover:text-black/60 text-[8px] leading-none
                 transition-all duration-150"
      style={{
        background: color,
        boxShadow: `0 0 4px ${shadowColor}`,
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLElement).style.background = hoverColor;
        (e.currentTarget as HTMLElement).style.boxShadow = `0 0 8px ${shadowColor}`;
        (e.currentTarget as HTMLElement).style.color = "rgba(0,0,0,0.5)";
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLElement).style.background = color;
        (e.currentTarget as HTMLElement).style.boxShadow = `0 0 4px ${shadowColor}`;
        (e.currentTarget as HTMLElement).style.color = "transparent";
      }}
    >
      {symbol}
    </button>
  );
}

function UpdaterBadge({
  status, thm, onCheck, onDownload, onInstall,
}: {
  status: UpdaterStatus;
  thm: ThemePalette;
  onCheck: () => void;
  onDownload: () => void;
  onInstall: () => void;
}) {
  if (status.state === "idle") return (
    <button onClick={onCheck}
      className="text-xs px-2 py-0.5 rounded transition-all"
      style={{ color: `${thm.rawAccent}66`, border: `1px solid ${thm.rawAccent}22` }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = thm.rawAccent; (e.currentTarget as HTMLElement).style.borderColor = thm.rawAccent; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = `${thm.rawAccent}66`; (e.currentTarget as HTMLElement).style.borderColor = `${thm.rawAccent}22`; }}>
      ↻ update
    </button>
  );

  if (status.state === "checking") return (
    <span className="text-xs animate-pulse" style={{ color: `${thm.rawAccent}66` }}>checking...</span>
  );

  if (status.state === "available") return (
    <button onClick={onDownload}
      className="text-xs px-2 py-0.5 rounded animate-pulse"
      style={{ color: "#fbbf24", border: "1px solid #fbbf2444", textShadow: "0 0 8px #fbbf2466" }}>
      ↓ v{status.version}
    </button>
  );

  if (status.state === "downloading") return (
    <span className="text-xs" style={{ color: "#60a5fa" }}>
      ↓ {status.percent}%
    </span>
  );

  if (status.state === "downloaded") return (
    <button onClick={onInstall}
      className="text-xs px-2 py-0.5 rounded font-bold"
      style={{ color: "#4ade80", border: "1px solid #4ade8044", textShadow: "0 0 8px #4ade8066" }}>
      ↻ install v{status.version}
    </button>
  );

  if (status.state === "not-available") return (
    <span className="text-xs" style={{ color: `${thm.rawAccent}44` }}>✓ up to date</span>
  );

  if (status.state === "error") return (
    <span className="text-xs" style={{ color: "#f87171" }} title={status.message}>⚠ update error</span>
  );

  return null;
}

export default function NativeTitleBar({
  title, thm, window: win, updaterStatus,
  onCheckUpdates, onInstall, onDownload, platform,
}: Props) {
  if (!isElectron()) return null;

  return (
    <div
      className="titlebar-drag flex items-center h-9 px-3 flex-shrink-0 select-none relative"
      style={{
        background: "rgba(0,0,0,0.7)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        borderBottom: `1px solid ${thm.rawAccent}22`,
      }}
    >
      {/* Traffic lights */}
      <div className="titlebar-no-drag flex items-center gap-1.5 mr-3 flex-shrink-0">
        {platform !== "darwin" && (
          <>
            <WinBtn color="#ef4444" hoverColor="#f87171" shadowColor="#ef444466" onClick={win.close}    title="Close"    symbol="×" />
            <WinBtn color="#eab308" hoverColor="#fbbf24" shadowColor="#eab30866" onClick={win.minimize} title="Minimize" symbol="−" />
            <WinBtn color="#22c55e" hoverColor="#4ade80" shadowColor="#22c55e66" onClick={win.maximize} title={win.isMaximized ? "Restore" : "Maximize"} symbol={win.isMaximized ? "⧉" : "+"} />
          </>
        )}
      </div>

      {/* Center title */}
      <div
        className="flex-1 text-center text-xs tracking-widest uppercase truncate"
        style={{ color: `${thm.rawAccent}66` }}
      >
        {title}
      </div>

      {/* Right: updater */}
      <div className="titlebar-no-drag flex items-center gap-2 ml-3 flex-shrink-0">
        <UpdaterBadge
          status={updaterStatus} thm={thm}
          onCheck={onCheckUpdates} onDownload={onDownload} onInstall={onInstall}
        />
      </div>

      {/* Animated accent underline */}
      <div className="accent-bar" style={{ position: "absolute", bottom: 0, left: 0, right: 0 }} />
    </div>
  );
}
