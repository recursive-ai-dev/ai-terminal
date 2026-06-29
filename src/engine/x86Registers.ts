// ============================================================
// x86_64 REGISTER FILE SIMULATOR
// General-purpose, XMM/YMM (SIMD), FLAGS, RIP, RSP, RBP
// ============================================================

export type RegName =
  | "rax" | "rbx" | "rcx" | "rdx" | "rsi" | "rdi"
  | "r8"  | "r9"  | "r10" | "r11" | "r12" | "r13" | "r14" | "r15"
  | "rsp" | "rbp" | "rip"
  | "xmm0" | "xmm1" | "xmm2" | "xmm3"
  | "ymm0" | "ymm1";

export type FlagName = "CF" | "ZF" | "SF" | "OF" | "PF" | "AF";

export class RegisterFile {
  private gpr: Map<string, bigint> = new Map();
  private xmm: Map<string, Float32Array> = new Map();
  private ymm: Map<string, Float32Array> = new Map();
  private flags: Map<FlagName, boolean> = new Map();
  private stack: bigint[] = [];

  constructor() {
    const gprs = ["rax","rbx","rcx","rdx","rsi","rdi",
                  "r8","r9","r10","r11","r12","r13","r14","r15",
                  "rsp","rbp","rip"];
    gprs.forEach(r => this.gpr.set(r, 0n));

    // XMM = 128-bit = 4x f32
    ["xmm0","xmm1","xmm2","xmm3"].forEach(r => this.xmm.set(r, new Float32Array(4)));
    // YMM = 256-bit = 8x f32
    ["ymm0","ymm1"].forEach(r => this.ymm.set(r, new Float32Array(8)));

    // FLAGS
    (["CF","ZF","SF","OF","PF","AF"] as FlagName[]).forEach(f => this.flags.set(f, false));
  }

  setGPR(reg: string, val: bigint | number) {
    this.gpr.set(reg, BigInt(val));
  }

  getGPR(reg: string): bigint {
    return this.gpr.get(reg) ?? 0n;
  }

  setXMM(reg: string, vals: number[]) {
    const arr = new Float32Array(4);
    vals.slice(0, 4).forEach((v, i) => arr[i] = v);
    this.xmm.set(reg, arr);
  }

  getXMM(reg: string): Float32Array {
    return this.xmm.get(reg) ?? new Float32Array(4);
  }

  setYMM(reg: string, vals: number[]) {
    const arr = new Float32Array(8);
    vals.slice(0, 8).forEach((v, i) => arr[i] = v);
    this.ymm.set(reg, arr);
  }

  getYMM(reg: string): Float32Array {
    return this.ymm.get(reg) ?? new Float32Array(8);
  }

  setFlag(flag: FlagName, val: boolean) {
    this.flags.set(flag, val);
  }

  getFlag(flag: FlagName): boolean {
    return this.flags.get(flag) ?? false;
  }

  push(val: bigint) {
    this.stack.push(val);
    this.setGPR("rsp", this.getGPR("rsp") - 8n);
  }

  pop(): bigint {
    const val = this.stack.pop() ?? 0n;
    this.setGPR("rsp", this.getGPR("rsp") + 8n);
    return val;
  }

  // SIMD dot product: xmm0 · xmm1 → scalar
  simdDot(a: string, b: string): number {
    const va = this.getXMM(a);
    const vb = this.getXMM(b);
    let sum = 0;
    for (let i = 0; i < 4; i++) sum += va[i] * vb[i];
    return sum;
  }

  // VADDPS: packed float add
  vaddps(dst: string, src1: string, src2: string) {
    const a = this.getYMM(src1);
    const b = this.getYMM(src2);
    const res = new Float32Array(8);
    for (let i = 0; i < 8; i++) res[i] = a[i] + b[i];
    this.setYMM(dst, Array.from(res));
  }

  // VMULPS: packed float mul
  vmulps(dst: string, src1: string, src2: string) {
    const a = this.getYMM(src1);
    const b = this.getYMM(src2);
    const res = new Float32Array(8);
    for (let i = 0; i < 8; i++) res[i] = a[i] * b[i];
    this.setYMM(dst, Array.from(res));
  }

  // CMP and set flags
  cmp(a: bigint, b: bigint) {
    const res = a - b;
    this.setFlag("ZF", res === 0n);
    this.setFlag("SF", res < 0n);
    this.setFlag("CF", a < b);
    this.setFlag("OF", false); // simplified
  }

  dump(): string {
    const lines: string[] = ["━━ x86_64 REGISTER FILE ━━"];
    const gprs = ["rax","rbx","rcx","rdx","rsi","rdi","r8","r9","r10","r11","rsp","rbp","rip"];
    for (const r of gprs) {
      lines.push(`  ${r.padEnd(5)} = 0x${this.getGPR(r).toString(16).padStart(16, "0")}`);
    }
    lines.push("━━ XMM REGISTERS ━━");
    for (const [r, v] of this.xmm.entries()) {
      lines.push(`  ${r.padEnd(5)} = [${Array.from(v).map(x => x.toFixed(4)).join(", ")}]`);
    }
    lines.push("━━ YMM REGISTERS ━━");
    for (const [r, v] of this.ymm.entries()) {
      lines.push(`  ${r.padEnd(5)} = [${Array.from(v).map(x => x.toFixed(4)).join(", ")}]`);
    }
    lines.push("━━ FLAGS ━━");
    const flagStr = (["CF","ZF","SF","OF","PF","AF"] as FlagName[])
      .map(f => `${f}=${this.getFlag(f) ? 1 : 0}`).join("  ");
    lines.push(`  ${flagStr}`);
    return lines.join("\n");
  }
}
