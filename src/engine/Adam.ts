// ============================================================
// ADAM OPTIMIZER — Full AMSGrad-capable implementation
// ============================================================
import { NanoTensor } from "./NanoTensor";

export interface AdamConfig {
  lr?: number;
  beta1?: number;
  beta2?: number;
  epsilon?: number;
  weightDecay?: number;
  amsgrad?: boolean;
}

export class Adam {
  params: NanoTensor[];
  lr: number;
  beta1: number;
  beta2: number;
  epsilon: number;
  weightDecay: number;
  amsgrad: boolean;
  t: number; // step counter
  m: Float32Array[]; // 1st moment
  v: Float32Array[]; // 2nd moment
  vMax: Float32Array[]; // amsgrad max

  constructor(params: NanoTensor[], config: AdamConfig = {}) {
    this.params = params;
    this.lr = config.lr ?? 0.001;
    this.beta1 = config.beta1 ?? 0.9;
    this.beta2 = config.beta2 ?? 0.999;
    this.epsilon = config.epsilon ?? 1e-8;
    this.weightDecay = config.weightDecay ?? 0;
    this.amsgrad = config.amsgrad ?? false;
    this.t = 0;
    this.m = params.map(p => new Float32Array(p.size));
    this.v = params.map(p => new Float32Array(p.size));
    this.vMax = params.map(p => new Float32Array(p.size));
  }

  step(): string[] {
    this.t++;
    const logs: string[] = [];
    const bc1 = 1 - Math.pow(this.beta1, this.t);
    const bc2 = 1 - Math.pow(this.beta2, this.t);
    const lrT = this.lr * Math.sqrt(bc2) / bc1;

    for (let pi = 0; pi < this.params.length; pi++) {
      const p = this.params[pi];
      if (!p.grad) continue;
      const g = p.grad.data as Float32Array;
      const pD = p.data as Float32Array;
      const m = this.m[pi];
      const v = this.v[pi];
      const vM = this.vMax[pi];
      let gradNorm = 0;

      for (let i = 0; i < p.size; i++) {
        let gi = g[i] + this.weightDecay * pD[i];
        gradNorm += gi * gi;
        m[i] = this.beta1 * m[i] + (1 - this.beta1) * gi;
        v[i] = this.beta2 * v[i] + (1 - this.beta2) * gi * gi;
        let vHat = v[i];
        if (this.amsgrad) {
          vM[i] = Math.max(vM[i], v[i]);
          vHat = vM[i];
        }
        pD[i] -= lrT * m[i] / (Math.sqrt(vHat) + this.epsilon);
      }
      logs.push(`  param[${pi}] |grad|=${Math.sqrt(gradNorm).toFixed(6)} lr_eff=${lrT.toFixed(6)}`);
    }
    return logs;
  }

  zeroGrad() {
    for (const p of this.params) p.zeroGrad();
  }

  state(): string {
    return `Adam(lr=${this.lr}, β1=${this.beta1}, β2=${this.beta2}, ε=${this.epsilon}, wd=${this.weightDecay}, step=${this.t})`;
  }

  resetState() {
    this.t = 0;
    this.m = this.params.map(p => new Float32Array(p.size));
    this.v = this.params.map(p => new Float32Array(p.size));
    this.vMax = this.params.map(p => new Float32Array(p.size));
  }
}
