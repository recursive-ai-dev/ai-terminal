// ============================================================
// LIVE METRICS ENGINE v1.0
// Real-time terminal analytics: throughput, heatmap, sparklines
// ============================================================

export interface MetricSnapshot {
  ts: number;
  commandsPerMin: number;
  totalCommands: number;
  errorRate: number;
  avgLatency: number;
  activeTensors: number;
  activeNetworks: number;
  memEstimateKB: number;
}

export interface CommandFrequency {
  cmd: string;
  count: number;
  lastUsed: number;
  avgLatency: number;
  errorCount: number;
}

export interface SessionMetrics {
  startTime: number;
  totalCommands: number;
  errorCount: number;
  latencies: number[];
  commandFreq: Map<string, CommandFrequency>;
  snapshots: MetricSnapshot[];
  peakCPM: number;             // peak commands per minute
  recentWindow: number[];      // timestamps of last 60s commands
}

function createSession(): SessionMetrics {
  return {
    startTime: Date.now(),
    totalCommands: 0,
    errorCount: 0,
    latencies: [],
    commandFreq: new Map(),
    snapshots: [],
    peakCPM: 0,
    recentWindow: [],
  };
}

class LiveMetricsEngine {
  private session: SessionMetrics = createSession();

  /** Record a command execution */
  record(cmd: string, latencyMs: number, isError: boolean): void {
    const now = Date.now();
    this.session.totalCommands++;
    if (isError) this.session.errorCount++;
    this.session.latencies.push(latencyMs);
    if (this.session.latencies.length > 500) this.session.latencies.shift();

    // Update frequency map
    const existing = this.session.commandFreq.get(cmd);
    if (existing) {
      existing.count++;
      existing.lastUsed = now;
      existing.avgLatency = (existing.avgLatency * (existing.count - 1) + latencyMs) / existing.count;
      if (isError) existing.errorCount++;
    } else {
      this.session.commandFreq.set(cmd, {
        cmd, count: 1, lastUsed: now, avgLatency: latencyMs,
        errorCount: isError ? 1 : 0,
      });
    }

    // Sliding 60s window for CPM
    this.session.recentWindow.push(now);
    this.session.recentWindow = this.session.recentWindow.filter(t => now - t < 60000);
    const cpm = this.session.recentWindow.length;
    if (cpm > this.session.peakCPM) this.session.peakCPM = cpm;

    // Snapshot every 10 commands
    if (this.session.totalCommands % 10 === 0) {
      this.snapshot(0, 0);
    }
  }

  snapshot(tensors: number, networks: number): void {
    const now = Date.now();
    const cpm = this.session.recentWindow.filter(t => now - t < 60000).length;
    const avgLat = this.session.latencies.length
      ? this.session.latencies.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, this.session.latencies.length)
      : 0;
    const errorRate = this.session.totalCommands > 0
      ? this.session.errorCount / this.session.totalCommands
      : 0;

    this.session.snapshots.push({
      ts: now,
      commandsPerMin: cpm,
      totalCommands: this.session.totalCommands,
      errorRate,
      avgLatency: avgLat,
      activeTensors: tensors,
      activeNetworks: networks,
      memEstimateKB: Math.round((tensors * 32 + networks * 256) * 4 / 1024),
    });
    if (this.session.snapshots.length > 100) this.session.snapshots.shift();
  }

  getCPM(): number {
    const now = Date.now();
    return this.session.recentWindow.filter(t => now - t < 60000).length;
  }

  getAvgLatency(): number {
    const lat = this.session.latencies.slice(-20);
    return lat.length ? lat.reduce((a, b) => a + b, 0) / lat.length : 0;
  }

  getErrorRate(): number {
    return this.session.totalCommands > 0
      ? this.session.errorCount / this.session.totalCommands : 0;
  }

  getSessionDuration(): string {
    const ms = Date.now() - this.session.startTime;
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    if (h > 0) return `${h}h ${m % 60}m`;
    if (m > 0) return `${m}m ${s % 60}s`;
    return `${s}s`;
  }

  /** Top N commands by frequency */
  getTopCommands(n = 10): CommandFrequency[] {
    return [...this.session.commandFreq.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, n);
  }

  /** Sparkline of CPM over time (last 20 snapshots) */
  getSparkline(field: keyof MetricSnapshot = "commandsPerMin", width = 20): string {
    const snaps = this.session.snapshots.slice(-width);
    if (snaps.length < 2) return "─".repeat(width);
    const vals = snaps.map(s => s[field] as number);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const range = max - min || 1;
    const blocks = ["▁","▂","▃","▄","▅","▆","▇","█"];
    return vals.map(v => blocks[Math.min(7, Math.floor(((v - min) / range) * 8))]).join("");
  }

  /** ASCII heatmap of command usage (grid by hour/category) */
  renderHeatmap(): string[] {
    const top = this.getTopCommands(20);
    if (top.length === 0) return ["[METRICS] No command data yet."];
    const maxCount = top[0].count;
    const lines: string[] = [
      "╔══════════════════════════════════════════════════╗",
      "║          COMMAND FREQUENCY HEATMAP               ║",
      "╠══════════════════════════════════════════════════╣",
    ];
    for (const cf of top) {
      const ratio = cf.count / maxCount;
      const barLen = Math.max(1, Math.round(ratio * 20));
      const barChar = ratio > 0.75 ? "█" : ratio > 0.5 ? "▓" : ratio > 0.25 ? "▒" : "░";
      const bar = barChar.repeat(barLen) + "▒".repeat(20 - barLen);
      const errPct = cf.errorCount > 0 ? ` ✗${cf.errorCount}` : "";
      lines.push(`║ ${cf.cmd.padEnd(20)} ${bar} ${String(cf.count).padStart(4)}${errPct}`);
    }
    lines.push("╚══════════════════════════════════════════════════╝");
    return lines;
  }

  renderDashboard(tensors: number, networks: number, optimizers: number): string[] {
    this.snapshot(tensors, networks);
    const dur = this.getSessionDuration();
    const cpm = this.getCPM();
    const avgLat = this.getAvgLatency().toFixed(1);
    const errRate = (this.getErrorRate() * 100).toFixed(1);
    const spark = this.getSparkline("commandsPerMin", 24);
    const sparkLat = this.getSparkline("avgLatency", 24);

    return [
      "╔═══════════════════════════════════════════════════════════╗",
      "║              LIVE METRICS DASHBOARD                       ║",
      "╠══════════════════╤════════════════════╤═══════════════════╣",
      `║ Session          │ Commands           │ Performance       ║`,
      `║ Duration: ${dur.padEnd(8)}│ Total:  ${String(this.session.totalCommands).padEnd(11)}│ Avg Lat: ${avgLat.padEnd(8)}ms ║`,
      `║ CPM:     ${String(cpm).padEnd(9)}│ Errors: ${String(this.session.errorCount).padEnd(11)}│ Err Rate: ${errRate.padEnd(7)}%  ║`,
      `║ Peak CPM:${String(this.session.peakCPM).padEnd(9)}│ Tensors:${String(tensors).padEnd(12)}│ Networks: ${String(networks).padEnd(8)} ║`,
      `║ Optimizers:${String(optimizers).padEnd(7)}│ Scripts:${String(0).padEnd(12)}│ Macros:   ${String(0).padEnd(8)} ║`,
      "╠══════════════════╧════════════════════╧═══════════════════╣",
      `║ CPM Sparkline:  ${spark}                      ║`,
      `║ Lat Sparkline:  ${sparkLat}                      ║`,
      "╚═══════════════════════════════════════════════════════════╝",
      "",
      ...this.renderHeatmap().slice(0, 8),
    ];
  }

  getSession(): SessionMetrics { return this.session; }
  reset(): void { this.session = createSession(); }
}

export const liveMetrics = new LiveMetricsEngine();
