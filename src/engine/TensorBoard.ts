// ============================================================
// TENSORBOARD v1.0 — ASCII TensorBoard for the terminal
// Loss curves, weight distributions, gradient norms, layer stats
// ============================================================
import type { MLP } from "./NeuralNetwork";
import type { NanoTensor } from "./NanoTensor";

export interface TBEntry {
  step: number;
  tag: string;
  value: number;
  ts: number;
}

export interface TBHistogram {
  tag: string;
  values: number[];
  bins: number;
}

class TensorBoardEngine {
  private scalars: Map<string, TBEntry[]> = new Map();
  private histograms: Map<string, TBHistogram> = new Map();
  private step = 0;

  /** Log a scalar value */
  logScalar(tag: string, value: number, step?: number): void {
    const s = step ?? this.step++;
    if (!this.scalars.has(tag)) this.scalars.set(tag, []);
    const entries = this.scalars.get(tag)!;
    entries.push({ step: s, tag, value, ts: Date.now() });
    if (entries.length > 1000) entries.shift();
  }

  /** Log a histogram */
  logHistogram(tag: string, values: number[], bins = 10): void {
    this.histograms.set(tag, { tag, values: [...values], bins });
  }

  /** Log all weights of a network */
  logNetwork(net: MLP, prefix = "net"): void {
    for (let i = 0; i < net.layers.length; i++) {
      const layer = net.layers[i];
      const wData = Array.from(layer.W.data as Float32Array);
      this.logHistogram(`${prefix}/layer${i}/weights`, wData);
      if (layer.b) {
        const bData = Array.from(layer.b.data as Float32Array);
        this.logHistogram(`${prefix}/layer${i}/biases`, bData);
      }
      if (layer.W.grad) {
        const gData = Array.from(layer.W.grad.data as Float32Array);
        this.logHistogram(`${prefix}/layer${i}/grad_W`, gData);
        this.logScalar(`${prefix}/layer${i}/grad_norm`,
          Math.sqrt(gData.reduce((s, x) => s + x * x, 0)));
      }
    }
    if (net.lossHistory && net.lossHistory.length > 0) {
      this.logScalar(`${prefix}/loss`, net.lossHistory[net.lossHistory.length - 1]);
    }
  }

  /** Log a single tensor */
  logTensor(tensor: NanoTensor, tag: string): void {
    const vals = Array.from(tensor.data as Float32Array);
    this.logHistogram(tag, vals);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const std = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
    this.logScalar(`${tag}/mean`, mean);
    this.logScalar(`${tag}/std`, std);
    this.logScalar(`${tag}/norm`, Math.sqrt(vals.reduce((a, b) => a + b * b, 0)));
  }

  /** Render a scalar plot */
  renderScalar(tag: string, width = 60, height = 12): string[] {
    const entries = this.scalars.get(tag);
    if (!entries || entries.length === 0) return [`[TB] No scalar data for '${tag}'`];
    const vals = entries.slice(-width).map(e => e.value);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const range = max - min || 1;
    const grid: string[][] = Array.from({ length: height }, () => Array(vals.length).fill(" "));

    for (let x = 0; x < vals.length; x++) {
      const y = height - 1 - Math.min(height - 1, Math.floor(((vals[x] - min) / range) * (height - 1)));
      grid[y][x] = "●";
      // Draw line to next point
      if (x < vals.length - 1) {
        const nextY = height - 1 - Math.min(height - 1, Math.floor(((vals[x + 1] - min) / range) * (height - 1)));
        const midY = Math.round((y + nextY) / 2);
        if (midY !== y && midY !== nextY) grid[midY][x] = "·";
      }
    }

    const lines: string[] = [
      `┌─ [TB] ${tag} (${entries.length} steps) ${"─".repeat(Math.max(0, 42 - tag.length))}┐`,
    ];
    const yLabels = [max, (max + min) / 2, min];
    for (let r = 0; r < height; r++) {
      const label = r === 0 ? max.toExponential(2).padStart(9)
        : r === Math.floor(height / 2) ? ((max + min) / 2).toExponential(2).padStart(9)
        : r === height - 1 ? min.toExponential(2).padStart(9)
        : " ".repeat(9);
      void yLabels;
      lines.push(`│${label} │ ${grid[r].join("")}`);
    }
    lines.push(`└${"─".repeat(11)}┴${"─".repeat(vals.length + 1)}┘`);
    lines.push(`  steps: ${entries[0].step} → ${entries[entries.length - 1].step}  min=${min.toExponential(3)}  max=${max.toExponential(3)}`);
    return lines;
  }

  /** Render a histogram */
  renderHistogram(tag: string, bins = 10): string[] {
    const hist = this.histograms.get(tag);
    if (!hist) return [`[TB] No histogram data for '${tag}'`];
    const vals = hist.values;
    if (vals.length === 0) return [`[TB] Empty histogram: ${tag}`];

    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const range = max - min || 1;
    const binSize = range / bins;
    const counts = new Array(bins).fill(0);
    for (const v of vals) {
      const b = Math.min(bins - 1, Math.floor((v - min) / binSize));
      counts[b]++;
    }
    const maxCount = Math.max(...counts);
    const barWidth = 30;

    const lines: string[] = [
      `┌─ [TB] ${tag} histogram (n=${vals.length}) ${"─".repeat(Math.max(0, 32 - tag.length))}┐`,
    ];
    for (let i = 0; i < bins; i++) {
      const lo = min + i * binSize;
      const hi = lo + binSize;
      const bar = "█".repeat(Math.round((counts[i] / maxCount) * barWidth));
      const label = `${lo.toFixed(3).padStart(8)} – ${hi.toFixed(3).padStart(8)}`;
      lines.push(`│ ${label} │ ${bar.padEnd(barWidth)} ${String(counts[i]).padStart(5)} │`);
    }
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const std = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
    lines.push(`└${"─".repeat(20)}┴${"─".repeat(barWidth + 2)}┘`);
    lines.push(`  mean=${mean.toFixed(4)}  std=${std.toFixed(4)}  min=${min.toFixed(4)}  max=${max.toFixed(4)}`);
    return lines;
  }

  /** Full network report */
  renderNetworkSummary(netName: string, net: MLP): string[] {
    this.logNetwork(net, netName);
    const lines: string[] = [
      `╔══ [TB] Network: ${netName} ${"═".repeat(Math.max(0, 40 - netName.length))}╗`,
      `║  Layers: ${net.layers.length}  Params: ${net.layers.reduce((s, l) => s + l.W.data.length + (l.b ? l.b.data.length : 0), 0)}`,
    ];

    for (let i = 0; i < net.layers.length; i++) {
      const layer = net.layers[i];
      const wData = Array.from(layer.W.data as Float32Array);
      const mean = wData.reduce((a, b) => a + b, 0) / wData.length;
      const std = Math.sqrt(wData.reduce((a, b) => a + (b - mean) ** 2, 0) / wData.length);
      const norm = Math.sqrt(wData.reduce((a, b) => a + b * b, 0));
      const gradNorm = layer.W.grad
        ? Math.sqrt(Array.from(layer.W.grad.data as Float32Array).reduce((a, b) => a + b * b, 0))
        : null;

      lines.push(`╠── Layer ${i}: ${layer.W.shape[0]}×${layer.W.shape[1]} (${layer.W.data.length} weights)`);
      lines.push(`║   W: mean=${mean.toFixed(4)}  std=${std.toFixed(4)}  norm=${norm.toFixed(4)}`);
      if (gradNorm !== null) lines.push(`║   ∇W norm: ${gradNorm.toFixed(6)}`);
      // Mini weight distribution bar
      const bins = 8;
      const wMin = Math.min(...wData); const wMax = Math.max(...wData);
      const wRange = wMax - wMin || 1;
      const wBinSize = wRange / bins;
      const wCounts = new Array(bins).fill(0);
      for (const v of wData) wCounts[Math.min(bins-1, Math.floor((v - wMin) / wBinSize))]++;
      const wMaxC = Math.max(...wCounts);
      const miniBar = wCounts.map(c => {
        const h = Math.round((c / wMaxC) * 4);
        return ["_","▂","▄","▆","█"][h] ?? "█";
      }).join("");
      lines.push(`║   dist: [${miniBar}]`);
    }

    if (net.lossHistory && net.lossHistory.length > 0) {
      const recent = net.lossHistory.slice(-10);
      lines.push("╠── Loss History (last 10):");
      const lMax = Math.max(...recent);
      const lMin = Math.min(...recent);
      const lRange = lMax - lMin || 1;
      const sparks = recent.map(v => {
        const h = Math.min(7, Math.floor(((v - lMin) / lRange) * 8));
        return ["▁","▂","▃","▄","▅","▆","▇","█"][h];
      }).join("");
      lines.push(`║   ${sparks}  (${lMin.toExponential(3)} → ${lMax.toExponential(3)})`);
    }
    lines.push("╚" + "═".repeat(50) + "╝");
    return lines;
  }

  /** List all logged tags */
  renderTagList(): string[] {
    const scalTags = [...this.scalars.keys()];
    const histTags = [...this.histograms.keys()];
    if (scalTags.length === 0 && histTags.length === 0) {
      return ["[TB] No data logged yet. Use: tb.log, tb.net, tb.tensor"];
    }
    return [
      "[TB] Logged Tags:",
      "  Scalars:",
      ...scalTags.map(t => `    ${t} (${this.scalars.get(t)!.length} pts)`),
      "  Histograms:",
      ...histTags.map(t => `    ${t} (n=${this.histograms.get(t)!.values.length})`),
    ];
  }

  reset(): void {
    this.scalars.clear();
    this.histograms.clear();
    this.step = 0;
  }
}

export const tensorBoard = new TensorBoardEngine();
