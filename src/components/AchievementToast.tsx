// ============================================================
// ACHIEVEMENT TOAST v1.0 — Animated unlock notification
// ============================================================
import { useEffect, useState } from "react";
import type { Achievement } from "../engine/AchievementEngine";

interface Props {
  achievement: Achievement;
  onDone: () => void;
}

const TIER_COLORS: Record<string, string> = {
  bronze:   "#cd7f32",
  silver:   "#c0c0c0",
  gold:     "#ffd700",
  platinum: "#e5e4e2",
  legendary:"#ff6ef7",
};

const TIER_GLOW: Record<string, string> = {
  bronze:   "#cd7f3244",
  silver:   "#c0c0c044",
  gold:     "#ffd70066",
  platinum: "#e5e4e244",
  legendary:"#ff6ef788",
};

export default function AchievementToast({ achievement, onDone }: Props) {
  const [visible, setVisible] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const t1 = setTimeout(() => setVisible(true), 30);
    const t2 = setTimeout(() => setLeaving(true), 3800);
    const t3 = setTimeout(() => onDone(), 4200);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [onDone]);

  const color = TIER_COLORS[achievement.tier] ?? "#4ade80";
  const glow  = TIER_GLOW[achievement.tier]  ?? "#4ade8044";

  return (
    <div
      style={{
        position: "fixed",
        top: 20,
        right: 20,
        zIndex: 99999,
        width: 320,
        background: "rgba(0,0,0,0.92)",
        border: `1px solid ${color}`,
        borderRadius: 8,
        padding: "12px 16px",
        boxShadow: `0 0 24px ${glow}, 0 4px 32px rgba(0,0,0,0.8)`,
        backdropFilter: "blur(16px)",
        transform: visible && !leaving ? "translateX(0) scale(1)" : "translateX(360px) scale(0.92)",
        opacity: visible && !leaving ? 1 : 0,
        transition: leaving
          ? "transform 0.4s ease-in, opacity 0.4s ease-in"
          : "transform 0.5s cubic-bezier(0.34,1.56,0.64,1), opacity 0.3s ease-out",
        pointerEvents: "none",
        fontFamily: "'JetBrains Mono', 'Courier New', monospace",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: "50%",
            background: `radial-gradient(circle, ${color}33, transparent)`,
            border: `1px solid ${color}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 14,
            boxShadow: `0 0 8px ${glow}`,
            flexShrink: 0,
          }}
        >
          {achievement.icon}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "0.6rem", letterSpacing: "0.15em", color: color, opacity: 0.8, textTransform: "uppercase" }}>
            Achievement Unlocked
          </div>
          <div style={{ fontSize: "0.85rem", fontWeight: 700, color: color, textShadow: `0 0 8px ${glow}`, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {achievement.name}
          </div>
        </div>
        <div style={{
          fontSize: "0.65rem",
          background: `${color}22`,
          border: `1px solid ${color}44`,
          color: color,
          padding: "2px 6px",
          borderRadius: 4,
          fontWeight: 700,
          letterSpacing: "0.05em",
          flexShrink: 0,
        }}>
          +{achievement.xp} XP
        </div>
      </div>

      {/* Description */}
      <div style={{ fontSize: "0.72rem", color: "rgba(255,255,255,0.6)", paddingLeft: 36 }}>
        {achievement.description}
      </div>

      {/* Tier badge */}
      <div style={{ marginTop: 6, paddingLeft: 36, display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{
          fontSize: "0.6rem",
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          color: color,
          border: `1px solid ${color}44`,
          padding: "1px 5px",
          borderRadius: 3,
        }}>
          {achievement.tier}
        </span>
        <span style={{ fontSize: "0.6rem", color: "rgba(255,255,255,0.35)", letterSpacing: "0.05em" }}>
          {achievement.category}
        </span>
      </div>

      {/* Progress bar — drains as toast disappears */}
      <div style={{ marginTop: 8, height: 2, background: "rgba(255,255,255,0.08)", borderRadius: 1, overflow: "hidden" }}>
        <div
          style={{
            height: "100%",
            background: color,
            boxShadow: `0 0 4px ${glow}`,
            width: leaving ? "0%" : "100%",
            transition: leaving ? "width 0.4s ease-in" : "width 3.8s linear",
          }}
        />
      </div>
    </div>
  );
}
