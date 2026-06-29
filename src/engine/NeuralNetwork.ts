// ============================================================
// NEURAL NETWORK — MLP with configurable layers + activations
// ============================================================
import { NanoTensor } from "./NanoTensor";

export type Activation = "relu" | "tanh" | "sigmoid" | "linear";

export interface LayerConfig {
  inFeatures: number;
  outFeatures: number;
  activation?: Activation;
  bias?: boolean;
}

export class LinearLayer {
  W: NanoTensor;
  b: NanoTensor | null;
  activation: Activation;
  inF: number;
  outF: number;

  constructor(config: LayerConfig) {
    this.inF = config.inFeatures;
    this.outF = config.outFeatures;
    this.activation = config.activation ?? "relu";

    // He initialization for ReLU, Xavier for tanh/sigmoid
    const scale = config.activation === "relu"
      ? Math.sqrt(2 / config.inFeatures)
      : Math.sqrt(1 / config.inFeatures);

    this.W = NanoTensor.randn([config.inFeatures, config.outFeatures], true, `W[${config.inFeatures}x${config.outFeatures}]`);
    const wData = this.W.data as Float32Array;
    for (let i = 0; i < wData.length; i++) wData[i] *= scale;

    if (config.bias !== false) {
      this.b = new NanoTensor(new Float32Array(config.outFeatures), [1, config.outFeatures], "f32", true, `b[${config.outFeatures}]`);
    } else {
      this.b = null;
    }
  }

  forward(x: NanoTensor): NanoTensor {
    // x: [batch, inF]
    let out = x.matmul(this.W);
    if (this.b) {
      // broadcast bias add
      const outD = out.data as Float32Array;
      const bD = this.b.data as Float32Array;
      const [M, N] = out.shape;
      for (let i = 0; i < M; i++)
        for (let j = 0; j < N; j++)
          outD[i * N + j] += bD[j];
      // attach bias backward
    const bias = this.b;
      const oldOut = out;
      out._children.push(bias);
      const origBack = out._backward;
      out._backward = () => {
        origBack();
        if (bias.requiresGrad) {
          if (!bias.grad) bias.grad = NanoTensor.zeros([1, N]);
          const bG = bias.grad!.data as Float32Array;
          const oG = (oldOut.grad?.data ?? new Float32Array(M * N)) as Float32Array;
          for (let i2 = 0; i2 < M; i2++)
            for (let j2 = 0; j2 < N; j2++)
              bG[j2] += oG[i2 * N + j2];
        }
      };
    }
    // Apply activation
    switch (this.activation) {
      case "relu": return out.relu();
      case "tanh": return out.tanh();
      case "sigmoid": return out.sigmoid();
      default: return out;
    }
  }

  params(): NanoTensor[] {
    return this.b ? [this.W, this.b] : [this.W];
  }

  describe(): string {
    return `Linear(${this.inF} → ${this.outF}, act=${this.activation})`;
  }
}

export class MLP {
  layers: LinearLayer[];
  name: string;
  lossHistory: number[];

  constructor(layerConfigs: LayerConfig[], name = "MLP") {
    this.layers = layerConfigs.map(c => new LinearLayer(c));
    this.name = name;
    this.lossHistory = [];
  }

  forward(x: NanoTensor): NanoTensor {
    let out = x;
    for (const layer of this.layers) out = layer.forward(out);
    return out;
  }

  params(): NanoTensor[] {
    return this.layers.flatMap(l => l.params());
  }

  zeroGrad() {
    for (const p of this.params()) p.zeroGrad();
  }

  describe(): string {
    const lines = [`Network: ${this.name}`];
    this.layers.forEach((l, i) => lines.push(`  Layer ${i}: ${l.describe()}`));
    const total = this.params().reduce((s, p) => s + p.size, 0);
    lines.push(`  Total params: ${total.toLocaleString()}`);
    return lines.join("\n");
  }

  train(
    X: NanoTensor,
    Y: NanoTensor,
    optimizer: import("./Adam").Adam,
    epochs: number,
    onEpoch?: (epoch: number, loss: number) => void
  ): number[] {
    const losses: number[] = [];
    for (let e = 0; e < epochs; e++) {
      optimizer.zeroGrad();
      const pred = this.forward(X);
      const loss = pred.mseLoss(Y);
      loss.backward();
      optimizer.step();
      const lossVal = loss.data[0] as number;
      losses.push(lossVal);
      this.lossHistory.push(lossVal);
      if (onEpoch) onEpoch(e, lossVal);
    }
    return losses;
  }

  predict(X: NanoTensor): number[] {
    const out = this.forward(X);
    return out.toArray();
  }
}

// Factory for common architectures
export function buildNetwork(arch: string, inputDim: number): MLP {
  switch (arch) {
    case "xor":
      return new MLP([
        { inFeatures: inputDim, outFeatures: 8, activation: "tanh" },
        { inFeatures: 8, outFeatures: 4, activation: "tanh" },
        { inFeatures: 4, outFeatures: 1, activation: "sigmoid" },
      ], "XOR-Solver");
    case "regressor":
      return new MLP([
        { inFeatures: inputDim, outFeatures: 32, activation: "relu" },
        { inFeatures: 32, outFeatures: 16, activation: "relu" },
        { inFeatures: 16, outFeatures: 1, activation: "linear" },
      ], "Regressor");
    case "classifier":
      return new MLP([
        { inFeatures: inputDim, outFeatures: 64, activation: "relu" },
        { inFeatures: 64, outFeatures: 32, activation: "relu" },
        { inFeatures: 32, outFeatures: 4, activation: "sigmoid" },
      ], "Classifier");
    default:
      return new MLP([
        { inFeatures: inputDim, outFeatures: 16, activation: "relu" },
        { inFeatures: 16, outFeatures: 1, activation: "linear" },
      ], "Custom");
  }
}
