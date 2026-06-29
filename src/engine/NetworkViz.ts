// ============================================================
// NETWORK VISUALIZATION ENGINE v1.0
// ASCII topology diagrams, weight heatmaps, loss curves,
// activation maps, gradient flow visualization
// ============================================================

import type { MLP } from "./NeuralNetwork";
import type { NanoTensor } from "./NanoTensor";

// ── ASCII Network Topology ───────────────────────────────────

export function renderNetworkTopology(net: MLP): string[] {
  const layers = net.layers;
  if (!layers || layers.length === 0) return ["[VIZ] No layers to display."];

  const lines: string[] = [];
  const totalWidth = 80;
  const title = `  Network: ${net.name}`;
  lines.push("┌" + "─".repeat(totalWidth - 2) + "┐");
  lines.push("│" + title.padEnd(totalWidth - 2) + "│");
  lines.push("├" + "─".repeat(totalWidth - 2) + "┤");

  // Layer info rows
  let totalParams = 0;
  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i];
    const w = layer.W;
    const b = layer.b;
    const [inF, outF] = [w.shape[0], w.shape[1]];
    const params = inF * outF + outF;
    totalParams += params;

    const act = layer.activation ?? "linear";
    const layerStr = `  Layer ${i}: Linear(${inF} → ${outF})  act=${act}  params=${params}`;
    lines.push("│" + layerStr.padEnd(totalWidth - 2) + "│");

    // Mini weight bar
    const wData = w.data as Float32Array;
    const sampleN = Math.min(16, wData.length);
    const step = Math.max(1, Math.floor(wData.length / sampleN));
    const vals = Array.from({ length: sampleN }, (_, j) => wData[j * step] ?? 0);
    const mn = Math.min(...vals);
    const mx = Math.max(...vals);
    const range = mx - mn || 1;
    const BAR_CHARS = " ▁▂▃▄▅▆▇█";
    const bar = vals.map(v => BAR_CHARS[Math.min(8, Math.floor(((v - mn) / range) * 8))]).join("");
    const biasNorm = b ? Math.abs(b.data[0] as number).toFixed(4) : "n/a";
    const wLine = `    W₀ heatmap: [${bar}]  b[0]=${biasNorm}`;
    lines.push("│" + wLine.padEnd(totalWidth - 2) + "│");

    // Connection visualization between layers
    if (i < layers.length - 1) {
      const nextIn = layers[i + 1].W.shape[0];
      const connStr = `    ${outF} neurons ────→ ${nextIn} neurons`;
      lines.push("│" + connStr.padEnd(totalWidth - 2) + "│");
    }
  }

  lines.push("├" + "─".repeat(totalWidth - 2) + "┤");
  lines.push("│" + `  Total parameters: ${totalParams}`.padEnd(totalWidth - 2) + "│");
  if (net.lossHistory && net.lossHistory.length > 0) {
    const lastLoss = net.lossHistory[net.lossHistory.length - 1].toFixed(6);
    const firstLoss = net.lossHistory[0].toFixed(6);
    const pct = ((1 - parseFloat(lastLoss) / parseFloat(firstLoss)) * 100).toFixed(1);
    lines.push("│" + `  Loss: ${firstLoss} → ${lastLoss}  (${pct}% reduction)`.padEnd(totalWidth - 2) + "│");
  }
  lines.push("└" + "─".repeat(totalWidth - 2) + "┘");
  return lines;
}

// ── Loss Curve (ASCII sparkline) ─────────────────────────────

export function renderLossCurve(lossHistory: number[], width = 72, height = 12): string[] {
  if (!lossHistory || lossHistory.length === 0) return ["[VIZ] No loss history."];

  const data = lossHistory;
  const n = data.length;
  const mn = Math.min(...data);
  const mx = Math.max(...data);
  const range = mx - mn || 1;

  // Downsample to width
  const buckets = Math.min(width, n);
  const sampled: number[] = [];
  for (let i = 0; i < buckets; i++) {
    const idx = Math.floor(i * (n / buckets));
    sampled.push(data[idx]);
  }

  const grid: string[][] = Array.from({ length: height }, () => Array(buckets).fill(" "));

  for (let x = 0; x < buckets; x++) {
    const v = sampled[x];
    const row = Math.floor(((mx - v) / range) * (height - 1));
    const clampedRow = Math.max(0, Math.min(height - 1, row));
    grid[clampedRow][x] = "•";
    // Fill below
    for (let y = clampedRow + 1; y < height; y++) {
      grid[y][x] = "│";
    }
  }

  const lines: string[] = [
    `  Loss Curve  (epochs: ${n}  min: ${mn.toFixed(6)}  max: ${mx.toFixed(6)})`,
    "  " + "─".repeat(buckets + 2),
  ];

  for (let y = 0; y < height; y++) {
    const yVal = mx - (y / (height - 1)) * range;
    const label = yVal.toFixed(4).padStart(8);
    lines.push(`${label} │${grid[y].join("")}│`);
  }
  lines.push("  " + "─".repeat(buckets + 2));
  lines.push(`  epoch 0${" ".repeat(Math.max(0, buckets - 16))}epoch ${n - 1}`);
  return lines;
}

// ── Weight Heatmap ───────────────────────────────────────────

export function renderWeightHeatmap(tensor: NanoTensor, label = "W"): string[] {
  const [rows, cols] = tensor.shape.length >= 2 ? tensor.shape : [1, tensor.shape[0]];
  const data = tensor.data as Float32Array;

  const vals = Array.from(data);
  const mn = Math.min(...vals);
  const mx = Math.max(...vals);
  const range = mx - mn || 1;

  // Unicode block chars for heatmap
  const BLOCKS = " ░▒▓█";
  const maxRows = Math.min(rows, 20);
  const maxCols = Math.min(cols, 40);

  const lines: string[] = [
    `  Weight Heatmap: ${label}  [${rows}×${cols}]  min=${mn.toFixed(4)}  max=${mx.toFixed(4)}`,
    `  ┌${"─".repeat(maxCols + 2)}┐`,
  ];

  for (let r = 0; r < maxRows; r++) {
    let row = "  │ ";
    for (let c = 0; c < maxCols; c++) {
      const v = (data[r * cols + c] ?? 0);
      const norm = (v - mn) / range;
      row += BLOCKS[Math.min(4, Math.floor(norm * 5))];
    }
    if (cols > maxCols) row += "…";
    row += " │";
    lines.push(row);
  }
  if (rows > maxRows) lines.push(`  │ ${"~".repeat(maxCols)} │ (${rows - maxRows} more rows)`);
  lines.push(`  └${"─".repeat(maxCols + 2)}┘`);
  return lines;
}

// ── Gradient Flow Visualization ──────────────────────────────

export function renderGradientFlow(net: MLP): string[] {
  const lines: string[] = ["  Gradient Flow (∂L/∂W per layer):"];
  const layers = net.layers;
  if (!layers || layers.length === 0) return ["[VIZ] No layers."];

  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i];
    const w = layer.W;
    if (!w.grad) {
      lines.push(`  Layer ${i}: [no gradient — run backward first]`);
      continue;
    }
    const grad = w.grad.data as Float32Array;
    const gVals = Array.from(grad);
    const gMax = Math.max(...gVals.map(Math.abs));
    const gMean = gVals.reduce((a, b) => a + Math.abs(b), 0) / gVals.length;
    const gNorm = Math.sqrt(gVals.reduce((a, b) => a + b * b, 0));

    const BAR_W = 30;
    const normGmax = Math.min(1, gMax);
    const bar = "█".repeat(Math.floor(normGmax * BAR_W)).padEnd(BAR_W, "░");

    const arrow = i > 0 ? "←─" : "←─ (input)";
    lines.push(`  Layer ${i} ${arrow}`);
    lines.push(`    ‖∇W‖ = ${gNorm.toFixed(6)}  mean|∇| = ${gMean.toFixed(6)}  max|∇| = ${gMax.toFixed(6)}`);
    lines.push(`    [${bar}] ${(normGmax * 100).toFixed(1)}% of scale`);

    // Vanishing gradient warning
    if (gNorm < 1e-6) lines.push(`    ⚠ VANISHING GRADIENT (‖∇W‖ < 1e-6)`);
    if (gNorm > 100)  lines.push(`    ⚠ EXPLODING GRADIENT (‖∇W‖ > 100)`);
  }
  return lines;
}

// ── Activation Map ───────────────────────────────────────────

export function renderActivationMap(activations: number[], label = "activations", width = 60): string[] {
  if (!activations || activations.length === 0) return ["[VIZ] No activation data."];

  const mn = Math.min(...activations);
  const mx = Math.max(...activations);
  const range = mx - mn || 1;
  const dead = activations.filter(v => Math.abs(v) < 1e-6).length;
  const pctDead = (dead / activations.length * 100).toFixed(1);

  const CHARS = " ·∘○◎●";
  const sampleN = Math.min(width, activations.length);
  const step = Math.max(1, Math.floor(activations.length / sampleN));
  const sampled = Array.from({ length: sampleN }, (_, i) => activations[i * step] ?? 0);

  const mapStr = sampled.map(v => CHARS[Math.min(5, Math.floor(((v - mn) / range) * 6))]).join("");
  const hist = new Array(10).fill(0);
  for (const v of activations) {
    const bin = Math.min(9, Math.floor(((v - mn) / range) * 10));
    hist[bin]++;
  }
  const histMax = Math.max(...hist);
  const histBars = hist.map(h => {
    const BAR_H = 4;
    const filled = Math.round((h / histMax) * BAR_H);
    return "▁▂▃▄▅▆▇█"[filled] ?? " ";
  }).join("");

  return [
    `  Activation Map: ${label}  (n=${activations.length})`,
    `  min=${mn.toFixed(4)}  max=${mx.toFixed(4)}  dead=${pctDead}%`,
    `  [${mapStr}]`,
    `  Histogram: [${histBars}]`,
    `             ${mn.toFixed(2).padEnd(5)}→${mx.toFixed(2).padStart(5)}`,
  ];
}

// ── Full Network Report ──────────────────────────────────────

export function renderFullNetworkReport(net: MLP): string[] {
  const lines: string[] = [
    "╔══════════════════════════════════════════════════════════════════╗",
    `║  NETWORK REPORT: ${net.name.padEnd(46)} ║`,
    "╠══════════════════════════════════════════════════════════════════╣",
  ];
  lines.push(...renderNetworkTopology(net).map(l => l));
  if (net.lossHistory && net.lossHistory.length > 1) {
    lines.push("");
    lines.push(...renderLossCurve(net.lossHistory));
  }
  lines.push(...renderGradientFlow(net));
  return lines;
}
