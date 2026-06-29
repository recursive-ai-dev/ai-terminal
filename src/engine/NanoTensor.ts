// ============================================================
// NANOTENSOR ENGINE — x86_64 Register-Aware Tensor Primitives
// ============================================================
import { getGlobalRNG } from "./determinism";

export type Shape = number[];
export type DType = "f32" | "f64" | "i32";

export class NanoTensor {
  data: Float32Array | Float64Array | Int32Array;
  shape: Shape;
  strides: number[];
  dtype: DType;
  grad: NanoTensor | null = null;
  requiresGrad: boolean;
  _op: string;
  _children: NanoTensor[];
  _backward: () => void;
  label: string;

  constructor(
    data: number[] | Float32Array | Float64Array | Int32Array,
    shape: Shape,
    dtype: DType = "f32",
    requiresGrad = false,
    label = ""
  ) {
    this.dtype = dtype;
    this.shape = shape;
    this.strides = NanoTensor.computeStrides(shape);
    this.requiresGrad = requiresGrad;
    this._op = "";
    this._children = [];
    this._backward = () => {};
    this.label = label;

    if (data instanceof Float32Array || data instanceof Float64Array || data instanceof Int32Array) {
      this.data = data as any;
    } else {
      if (dtype === "f64") this.data = new Float64Array(data);
      else if (dtype === "i32") this.data = new Int32Array(data);
      else this.data = new Float32Array(data);
    }
  }

  static computeStrides(shape: Shape): number[] {
    const strides = new Array(shape.length).fill(1);
    for (let i = shape.length - 2; i >= 0; i--) {
      strides[i] = strides[i + 1] * shape[i + 1];
    }
    return strides;
  }

  get size(): number {
    return this.shape.reduce((a, b) => a * b, 1);
  }

  static zeros(shape: Shape, dtype: DType = "f32", requiresGrad = false): NanoTensor {
    const size = shape.reduce((a, b) => a * b, 1);
    return new NanoTensor(new Float32Array(size), shape, dtype, requiresGrad);
  }

  static ones(shape: Shape, dtype: DType = "f32"): NanoTensor {
    const size = shape.reduce((a, b) => a * b, 1);
    const data = new Float32Array(size).fill(1);
    return new NanoTensor(data, shape, dtype);
  }

  static randn(shape: Shape, requiresGrad = false, label = ""): NanoTensor {
    const size = shape.reduce((a, b) => a * b, 1);
    const data = new Float32Array(size);
    const rng = getGlobalRNG();
    // Box-Muller via injected RNG — deterministic when seeded
    for (let i = 0; i < size; i += 2) {
      const u1 = rng.next() || 1e-10;
      const u2 = rng.next();
      const r = Math.sqrt(-2 * Math.log(u1));
      const theta = 2 * Math.PI * u2;
      data[i] = r * Math.cos(theta);
      if (i + 1 < size) data[i + 1] = r * Math.sin(theta);
    }
    return new NanoTensor(data, shape, "f32", requiresGrad, label);
  }

  static fromScalar(val: number, requiresGrad = false): NanoTensor {
    return new NanoTensor([val], [1], "f32", requiresGrad);
  }

  at(indices: number[]): number {
    let idx = 0;
    for (let i = 0; i < indices.length; i++) idx += indices[i] * this.strides[i];
    return this.data[idx];
  }

  setAt(indices: number[], val: number) {
    let idx = 0;
    for (let i = 0; i < indices.length; i++) idx += indices[i] * this.strides[i];
    this.data[idx] = val;
  }

  reshape(newShape: Shape): NanoTensor {
    const out = new NanoTensor(this.data.slice(), newShape, this.dtype, this.requiresGrad);
    return out;
  }

  // ── Elementwise Add (with autograd) ──
  add(other: NanoTensor): NanoTensor {
    const out = NanoTensor.zeros(this.shape, this.dtype, this.requiresGrad || other.requiresGrad);
    for (let i = 0; i < this.size; i++) {
      out.data[i] = (this.data[i] as number) + (other.data[i] as number);
    }
    out._op = "add";
    out._children = [this, other];
    out._backward = () => {
      if (this.requiresGrad) {
        if (!this.grad) this.grad = NanoTensor.zeros(this.shape);
        for (let i = 0; i < this.size; i++) this.grad!.data[i] += (out.grad?.data[i] ?? 0);
      }
      if (other.requiresGrad) {
        if (!other.grad) other.grad = NanoTensor.zeros(other.shape);
        for (let i = 0; i < other.size; i++) other.grad!.data[i] += (out.grad?.data[i] ?? 0);
      }
    };
    return out;
  }

  // ── Elementwise Mul ──
  mul(other: NanoTensor): NanoTensor {
    const out = NanoTensor.zeros(this.shape, this.dtype, this.requiresGrad || other.requiresGrad);
    for (let i = 0; i < this.size; i++) {
      out.data[i] = (this.data[i] as number) * (other.data[i] as number);
    }
    out._op = "mul";
    out._children = [this, other];
    out._backward = () => {
      if (this.requiresGrad) {
        if (!this.grad) this.grad = NanoTensor.zeros(this.shape);
        for (let i = 0; i < this.size; i++) this.grad!.data[i] += (out.grad?.data[i] ?? 0) * (other.data[i] as number);
      }
      if (other.requiresGrad) {
        if (!other.grad) other.grad = NanoTensor.zeros(other.shape);
        for (let i = 0; i < other.size; i++) other.grad!.data[i] += (out.grad?.data[i] ?? 0) * (this.data[i] as number);
      }
    };
    return out;
  }

  // ── Scalar Mul ──
  scale(s: number): NanoTensor {
    const out = NanoTensor.zeros(this.shape, this.dtype, this.requiresGrad);
    for (let i = 0; i < this.size; i++) out.data[i] = (this.data[i] as number) * s;
    out._op = "scale";
    out._children = [this];
    out._backward = () => {
      if (this.requiresGrad) {
        if (!this.grad) this.grad = NanoTensor.zeros(this.shape);
        for (let i = 0; i < this.size; i++) this.grad!.data[i] += (out.grad?.data[i] ?? 0) * s;
      }
    };
    return out;
  }

  // ── Matrix Multiply [M,K] x [K,N] → [M,N] ──
  matmul(other: NanoTensor): NanoTensor {
    const [M, K] = this.shape;
    const [K2, N] = other.shape;
    if (K !== K2) throw new Error(`matmul shape mismatch: [${M},${K}] x [${K2},${N}]`);
    const out = NanoTensor.zeros([M, N], this.dtype, this.requiresGrad || other.requiresGrad);
    // Tiled matmul — cache-line aware (simulated x86_64 L1 tile=16)
    const TILE = 16;
    const d = out.data as Float32Array;
    const a = this.data as Float32Array;
    const b = other.data as Float32Array;
    for (let i = 0; i < M; i += TILE) {
      for (let j = 0; j < N; j += TILE) {
        for (let k = 0; k < K; k += TILE) {
          const iMax = Math.min(i + TILE, M);
          const jMax = Math.min(j + TILE, N);
          const kMax = Math.min(k + TILE, K);
          for (let ii = i; ii < iMax; ii++) {
            for (let kk = k; kk < kMax; kk++) {
              const aVal = a[ii * K + kk];
              for (let jj = j; jj < jMax; jj++) {
                d[ii * N + jj] += aVal * b[kk * N + jj];
              }
            }
          }
        }
      }
    }
    out._op = "matmul";
    out._children = [this, other];
    out._backward = () => {
      // dL/dA = dL/dOut @ B^T
      if (this.requiresGrad) {
        if (!this.grad) this.grad = NanoTensor.zeros(this.shape);
        const gA = this.grad!.data as Float32Array;
        const gOut = (out.grad?.data ?? new Float32Array(M * N)) as Float32Array;
        for (let ii = 0; ii < M; ii++)
          for (let kk = 0; kk < K; kk++)
            for (let jj = 0; jj < N; jj++)
              gA[ii * K + kk] += gOut[ii * N + jj] * b[kk * N + jj];
      }
      // dL/dB = A^T @ dL/dOut
      if (other.requiresGrad) {
        if (!other.grad) other.grad = NanoTensor.zeros(other.shape);
        const gB = other.grad!.data as Float32Array;
        const gOut = (out.grad?.data ?? new Float32Array(M * N)) as Float32Array;
        for (let kk = 0; kk < K; kk++)
          for (let jj = 0; jj < N; jj++)
            for (let ii = 0; ii < M; ii++)
              gB[kk * N + jj] += a[ii * K + kk] * gOut[ii * N + jj];
      }
    };
    return out;
  }

  // ── ReLU ──
  relu(): NanoTensor {
    const out = NanoTensor.zeros(this.shape, this.dtype, this.requiresGrad);
    for (let i = 0; i < this.size; i++) out.data[i] = Math.max(0, this.data[i] as number);
    out._op = "relu";
    out._children = [this];
    out._backward = () => {
      if (this.requiresGrad) {
        if (!this.grad) this.grad = NanoTensor.zeros(this.shape);
        for (let i = 0; i < this.size; i++)
          this.grad!.data[i] += ((this.data[i] as number) > 0 ? 1 : 0) * ((out.grad?.data[i] ?? 0) as number);
      }
    };
    return out;
  }

  // ── Sigmoid ──
  sigmoid(): NanoTensor {
    const out = NanoTensor.zeros(this.shape, this.dtype, this.requiresGrad);
    for (let i = 0; i < this.size; i++) {
      const s = 1 / (1 + Math.exp(-(this.data[i] as number)));
      out.data[i] = s;
    }
    out._op = "sigmoid";
    out._children = [this];
    out._backward = () => {
      if (this.requiresGrad) {
        if (!this.grad) this.grad = NanoTensor.zeros(this.shape);
        for (let i = 0; i < this.size; i++) {
          const s = out.data[i] as number;
          this.grad!.data[i] += s * (1 - s) * ((out.grad?.data[i] ?? 0) as number);
        }
      }
    };
    return out;
  }

  // ── Tanh ──
  tanh(): NanoTensor {
    const out = NanoTensor.zeros(this.shape, this.dtype, this.requiresGrad);
    for (let i = 0; i < this.size; i++) out.data[i] = Math.tanh(this.data[i] as number);
    out._op = "tanh";
    out._children = [this];
    out._backward = () => {
      if (this.requiresGrad) {
        if (!this.grad) this.grad = NanoTensor.zeros(this.shape);
        for (let i = 0; i < this.size; i++) {
          const t = out.data[i] as number;
          this.grad!.data[i] += (1 - t * t) * ((out.grad?.data[i] ?? 0) as number);
        }
      }
    };
    return out;
  }

  // ── Softmax (row-wise for 2D) ──
  softmax(): NanoTensor {
    const [M, N] = this.shape.length === 2 ? this.shape : [1, this.size];
    const out = NanoTensor.zeros([M, N], this.dtype, this.requiresGrad);
    const a = this.data as Float32Array;
    const o = out.data as Float32Array;
    for (let i = 0; i < M; i++) {
      let maxVal = -Infinity;
      for (let j = 0; j < N; j++) maxVal = Math.max(maxVal, a[i * N + j]);
      let sum = 0;
      for (let j = 0; j < N; j++) { o[i * N + j] = Math.exp(a[i * N + j] - maxVal); sum += o[i * N + j]; }
      for (let j = 0; j < N; j++) o[i * N + j] /= sum;
    }
    out._op = "softmax";
    out._children = [this];
    return out;
  }

  // ── MSE Loss ──
  mseLoss(target: NanoTensor): NanoTensor {
    const out = NanoTensor.zeros([1], this.dtype, this.requiresGrad);
    let loss = 0;
    for (let i = 0; i < this.size; i++) {
      const diff = (this.data[i] as number) - (target.data[i] as number);
      loss += diff * diff;
    }
    out.data[0] = loss / this.size;
    out._op = "mse";
    out._children = [this];
    out._backward = () => {
      if (this.requiresGrad) {
        if (!this.grad) this.grad = NanoTensor.zeros(this.shape);
        const scale = 2 / this.size * ((out.grad?.data[0] ?? 1) as number);
        for (let i = 0; i < this.size; i++)
          this.grad!.data[i] += scale * ((this.data[i] as number) - (target.data[i] as number));
      }
    };
    return out;
  }

  // ── Topological Backward ──
  backward() {
    const topo: NanoTensor[] = [];
    const visited = new Set<NanoTensor>();
    const build = (v: NanoTensor) => {
      if (!visited.has(v)) {
        visited.add(v);
        for (const child of v._children) build(child);
        topo.push(v);
      }
    };
    build(this);
    if (!this.grad) this.grad = NanoTensor.ones([1]);
    for (const node of topo.reverse()) node._backward();
  }

  zeroGrad() {
    this.grad = null;
  }

  toArray(): number[] {
    return Array.from(this.data as Float32Array);
  }

  toString(): string {
    const arr = this.toArray();
    const fmt = arr.map(v => v.toFixed(4)).join(", ");
    return `Tensor(shape=[${this.shape}], dtype=${this.dtype})\n  [${fmt}]`;
  }

  norm(): number {
    let s = 0;
    for (let i = 0; i < this.size; i++) s += (this.data[i] as number) ** 2;
    return Math.sqrt(s);
  }

  sum(): number {
    let s = 0;
    for (let i = 0; i < this.size; i++) s += this.data[i] as number;
    return s;
  }

  mean(): number {
    return this.sum() / this.size;
  }
}
