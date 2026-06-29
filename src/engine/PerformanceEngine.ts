// ============================================================
// PERFORMANCE ENGINE v1.0 — x86_64 CPU simulation
// Virtual memory, L1/L2/L3 cache, instruction pipeline,
// branch predictor, SIMD throughput, TLB, page faults
// ============================================================

export type CacheLevel = "L1" | "L2" | "L3";
export type CachePolicy = "LRU" | "FIFO" | "RANDOM";
export type PipelineStage = "IF" | "ID" | "EX" | "MEM" | "WB";
export type BranchPrediction = "taken" | "not-taken" | "mispredicted";

export interface CacheLine {
  tag: number;
  data: Uint8Array;
  valid: boolean;
  dirty: boolean;
  lruCounter: number;
  accessCount: number;
}

export interface CacheConfig {
  size: number;          // bytes
  lineSize: number;      // bytes
  associativity: number; // ways
  latency: number;       // cycles
  policy: CachePolicy;
}

export interface CacheStats {
  hits: number;
  misses: number;
  evictions: number;
  writebacks: number;
  hitRate: number;
  totalAccesses: number;
  avgLatency: number;
}

export interface PipelineInstruction {
  id: number;
  mnemonic: string;
  stage: PipelineStage;
  cycleEntered: number;
  latency: number;
  stalled: boolean;
  forwarded: boolean;
  branchTaken?: boolean;
}

export interface BranchPredictorState {
  predictions: number;
  mispredictions: number;
  accuracy: number;
  // 2-bit saturating counter table
  table: Uint8Array;
}

export interface TLBEntry {
  virtualPage: number;
  physicalPage: number;
  valid: boolean;
  accessCount: number;
}

export interface MemoryStats {
  totalAllocated: number;
  totalFreed: number;
  pageCount: number;
  pageFaults: number;
  tlbHits: number;
  tlbMisses: number;
  fragmentation: number;
}

export interface SIMDThroughput {
  instruction: string;
  throughput: number;   // instructions/cycle
  latency: number;      // cycles
  portUsage: string;
  simdWidth: number;    // bits
}

// ── Cache Simulator ──────────────────────────────────────────

export class CacheSimulator {
  readonly name: CacheLevel;
  readonly config: CacheConfig;
  private sets: CacheLine[][];
  private stats: CacheStats;
  private globalClock = 0;

  constructor(name: CacheLevel, config: CacheConfig) {
    this.name = name;
    this.config = config;
    const numSets = Math.max(1, (config.size / config.lineSize) / config.associativity);
    this.sets = Array.from({ length: numSets }, () =>
      Array.from({ length: config.associativity }, () => ({
        tag: 0, data: new Uint8Array(config.lineSize),
        valid: false, dirty: false, lruCounter: 0, accessCount: 0,
      }))
    );
    this.stats = { hits: 0, misses: 0, evictions: 0, writebacks: 0, hitRate: 0, totalAccesses: 0, avgLatency: 0 };
  }

  access(address: number, isWrite = false): { hit: boolean; latency: number; evicted?: number } {
    this.globalClock++;
    const lineSize = this.config.lineSize;
    const numSets = this.sets.length;
    const setIdx = Math.floor(address / lineSize) % numSets;
    const tag = Math.floor(address / lineSize / numSets);
    const set = this.sets[setIdx];

    // Check for hit
    for (const line of set) {
      if (line.valid && line.tag === tag) {
        line.lruCounter = this.globalClock;
        line.accessCount++;
        if (isWrite) line.dirty = true;
        this.stats.hits++;
        this.stats.totalAccesses++;
        this.stats.hitRate = this.stats.hits / this.stats.totalAccesses;
        return { hit: true, latency: this.config.latency };
      }
    }

    // Miss — find victim
    this.stats.misses++;
    this.stats.totalAccesses++;
    this.stats.hitRate = this.stats.hits / this.stats.totalAccesses;

    let victimIdx = 0;
    let minLRU = Infinity;
    for (let i = 0; i < set.length; i++) {
      if (!set[i].valid) { victimIdx = i; break; }
      if (this.config.policy === "LRU" && set[i].lruCounter < minLRU) {
        minLRU = set[i].lruCounter; victimIdx = i;
      } else if (this.config.policy === "FIFO" && set[i].lruCounter < minLRU) {
        minLRU = set[i].lruCounter; victimIdx = i;
      } else if (this.config.policy === "RANDOM") {
        victimIdx = Math.floor(Math.random() * set.length);
      }
    }

    const victim = set[victimIdx];
    const evictedAddr = victim.valid ? (victim.tag * numSets + setIdx) * lineSize : undefined;

    if (victim.valid) {
      this.stats.evictions++;
      if (victim.dirty) this.stats.writebacks++;
    }

    victim.tag = tag;
    victim.valid = true;
    victim.dirty = isWrite;
    victim.lruCounter = this.globalClock;
    victim.accessCount = 1;

    return {
      hit: false,
      latency: this.config.latency + 100, // miss penalty
      evicted: evictedAddr,
    };
  }

  getStats(): CacheStats {
    const total = this.stats.totalAccesses || 1;
    return {
      ...this.stats,
      hitRate: this.stats.hits / total,
      avgLatency: (this.stats.hits * this.config.latency + this.stats.misses * (this.config.latency + 100)) / total,
    };
  }

  flush(): void {
    for (const set of this.sets) {
      for (const line of set) {
        line.valid = false; line.dirty = false; line.lruCounter = 0;
      }
    }
    this.stats = { hits: 0, misses: 0, evictions: 0, writebacks: 0, hitRate: 0, totalAccesses: 0, avgLatency: 0 };
    this.globalClock = 0;
  }

  render(): string[] {
    const s = this.getStats();
    const assoc = this.config.associativity;
    const sets = this.sets.length;
    const lines: string[] = [
      `┌─ ${this.name} Cache ──────────────────────────────┐`,
      `│  Size: ${(this.config.size / 1024).toFixed(0)}KB  Lines: ${this.config.lineSize}B  ${assoc}-way  ${this.config.policy}  Lat: ${this.config.latency}cy`,
      `│  Sets: ${sets}  Total lines: ${sets * assoc}`,
      `├─────────────────────────────────────────────────┤`,
      `│  Accesses : ${s.totalAccesses.toString().padStart(8)}`,
      `│  Hits     : ${s.hits.toString().padStart(8)}  (${(s.hitRate * 100).toFixed(1)}%)`,
      `│  Misses   : ${s.misses.toString().padStart(8)}  (${((1 - s.hitRate) * 100).toFixed(1)}%)`,
      `│  Evictions: ${s.evictions.toString().padStart(8)}`,
      `│  Writebacks:${s.writebacks.toString().padStart(7)}`,
      `│  Avg Lat  : ${s.avgLatency.toFixed(1).padStart(7)} cycles`,
      `└─────────────────────────────────────────────────┘`,
    ];
    // Show first 4 sets sample
    if (s.totalAccesses > 0) {
      lines.push(`  Sample (first 4 sets):`);
      for (let i = 0; i < Math.min(4, this.sets.length); i++) {
        const set = this.sets[i];
        const used = set.filter(l => l.valid).length;
        const bar = "█".repeat(used) + "░".repeat(assoc - used);
        lines.push(`  Set[${i}] [${bar}] ${used}/${assoc} ways used`);
      }
    }
    return lines;
  }
}

// ── Pipeline Simulator ──────────────────────────────────────

export class PipelineSimulator {
  private instructions: PipelineInstruction[] = [];
  private cycle = 0;
  private stallCount = 0;
  private flushCount = 0;
  private nextId = 0;
  readonly depth: number;

  constructor(depth = 5) { this.depth = depth; }

  issue(mnemonic: string, latency = 1): PipelineInstruction {
    const instr: PipelineInstruction = {
      id: this.nextId++,
      mnemonic,
      stage: "IF",
      cycleEntered: this.cycle,
      latency,
      stalled: false,
      forwarded: false,
    };
    this.instructions.push(instr);
    return instr;
  }

  tick(): void {
    this.cycle++;
    const stages: PipelineStage[] = ["IF", "ID", "EX", "MEM", "WB"];
    // Advance instructions in reverse to avoid double-advance
    for (let i = this.instructions.length - 1; i >= 0; i--) {
      const instr = this.instructions[i];
      const idx = stages.indexOf(instr.stage);
      if (idx < stages.length - 1) {
        // Check for RAW hazard: if prev instr is in EX stage
        const prevInEX = i > 0 && this.instructions[i - 1].stage === "EX" && !this.instructions[i - 1].forwarded;
        if (instr.stage === "ID" && prevInEX && !instr.forwarded) {
          instr.stalled = true;
          this.stallCount++;
        } else {
          instr.stalled = false;
          instr.stage = stages[idx + 1];
          if (instr.stage === "EX") instr.forwarded = true;
        }
      }
    }
    // Remove completed instructions
    this.instructions = this.instructions.filter(i => i.stage !== "WB" || this.cycle < i.cycleEntered + this.depth + 2);
  }

  flush(reason = "branch misprediction"): void {
    this.flushCount++;
    this.instructions = this.instructions.filter(i => i.stage === "WB");
    console.debug(`[PIPELINE] Flush: ${reason}`);
  }

  getIPC(): number {
    const total = this.nextId;
    const cycles = this.cycle || 1;
    return Math.min(1.0, (total - this.stallCount * 0.3) / cycles);
  }

  render(): string[] {
    const stages: PipelineStage[] = ["IF", "ID", "EX", "MEM", "WB"];
    const lines: string[] = [
      `┌─ 5-Stage Pipeline (Cycle ${this.cycle}) ─────────────┐`,
      `│  IF     ID     EX     MEM    WB`,
      `│  ─────  ─────  ─────  ─────  ─────`,
    ];
    const slots: Record<PipelineStage, string> = { IF: "     ", ID: "     ", EX: "     ", MEM: "     ", WB: "     " };
    for (const instr of this.instructions.slice(-5)) {
      const label = instr.mnemonic.slice(0, 5).padEnd(5);
      if (instr.stalled) {
        slots[instr.stage] = `[${label}]`.slice(0, 5);
      } else {
        slots[instr.stage] = label;
      }
    }
    lines.push(`│  ${stages.map(s => slots[s]).join("  ")}`);
    lines.push(`├─────────────────────────────────────────────────┤`);
    lines.push(`│  IPC: ${this.getIPC().toFixed(2)}  Stalls: ${this.stallCount}  Flushes: ${this.flushCount}`);
    lines.push(`│  Instructions issued: ${this.nextId}`);
    lines.push(`└─────────────────────────────────────────────────┘`);
    return lines;
  }
}

// ── Branch Predictor ─────────────────────────────────────────

export class BranchPredictor {
  private state: BranchPredictorState;
  readonly tableSize: number;
  private history = 0;    // global branch history register

  constructor(tableBits = 10) {
    this.tableSize = 1 << tableBits;
    this.state = {
      predictions: 0,
      mispredictions: 0,
      accuracy: 0,
      table: new Uint8Array(this.tableSize).fill(2), // weakly taken
    };
  }

  predict(pc: number): BranchPrediction {
    const idx = (pc ^ this.history) & (this.tableSize - 1);
    return this.state.table[idx] >= 2 ? "taken" : "not-taken";
  }

  update(pc: number, actuallyTaken: boolean): BranchPrediction {
    const idx = (pc ^ this.history) & (this.tableSize - 1);
    const predicted = this.state.table[idx] >= 2 ? "taken" : "not-taken";
    const wasCorrect = (predicted === "taken") === actuallyTaken;

    // Update 2-bit saturating counter
    if (actuallyTaken && this.state.table[idx] < 3) this.state.table[idx]++;
    if (!actuallyTaken && this.state.table[idx] > 0) this.state.table[idx]--;

    // Update global history
    this.history = ((this.history << 1) | (actuallyTaken ? 1 : 0)) & (this.tableSize - 1);

    this.state.predictions++;
    if (!wasCorrect) {
      this.state.mispredictions++;
      this.state.accuracy = (this.state.predictions - this.state.mispredictions) / this.state.predictions;
      return "mispredicted";
    }
    this.state.accuracy = (this.state.predictions - this.state.mispredictions) / this.state.predictions;
    return predicted;
  }

  getStats(): BranchPredictorState { return { ...this.state, table: this.state.table.slice(0, 8) }; }

  render(): string[] {
    const s = this.getStats();
    const acc = s.predictions > 0 ? ((s.predictions - s.mispredictions) / s.predictions * 100) : 0;
    return [
      `┌─ Branch Predictor (2-bit Saturating, GHR) ──────┐`,
      `│  Table size: ${this.tableSize} entries`,
      `│  Predictions   : ${s.predictions}`,
      `│  Mispredictions: ${s.mispredictions}`,
      `│  Accuracy      : ${acc.toFixed(2)}%`,
      `│  History reg   : 0b${this.history.toString(2).padStart(8, "0")}`,
      `│  Counter sample: [${Array.from(s.table).join(",")}...]`,
      `└─────────────────────────────────────────────────┘`,
    ];
  }
}

// ── Virtual Memory / TLB ─────────────────────────────────────

export class VirtualMemory {
  readonly pageSize: number;
  readonly tlbSize: number;
  private tlb: TLBEntry[];
  private pageTable: Map<number, number>;
  private stats: MemoryStats;
  private nextPhysPage = 0;
  private allocations: Map<number, number>; // vaddr → size
  private freeList: number[];

  constructor(pageSize = 4096, tlbSize = 64) {
    this.pageSize = pageSize;
    this.tlbSize = tlbSize;
    this.tlb = Array.from({ length: tlbSize }, () => ({ virtualPage: 0, physicalPage: 0, valid: false, accessCount: 0 }));
    this.pageTable = new Map();
    this.allocations = new Map();
    this.freeList = [];
    this.stats = { totalAllocated: 0, totalFreed: 0, pageCount: 0, pageFaults: 0, tlbHits: 0, tlbMisses: 0, fragmentation: 0 };
  }

  translate(virtualAddr: number): { physicalAddr: number; tlbHit: boolean; pageFault: boolean } {
    const virtualPage = Math.floor(virtualAddr / this.pageSize);
    const offset = virtualAddr % this.pageSize;

    // TLB lookup
    const tlbIdx = virtualPage % this.tlbSize;
    const entry = this.tlb[tlbIdx];
    if (entry.valid && entry.virtualPage === virtualPage) {
      this.stats.tlbHits++;
      entry.accessCount++;
      return { physicalAddr: entry.physicalPage * this.pageSize + offset, tlbHit: true, pageFault: false };
    }

    // TLB miss — page table walk
    this.stats.tlbMisses++;
    let physPage = this.pageTable.get(virtualPage);
    let pageFault = false;

    if (physPage === undefined) {
      // Page fault — allocate
      physPage = this.freeList.length > 0 ? this.freeList.pop()! : this.nextPhysPage++;
      this.pageTable.set(virtualPage, physPage);
      this.stats.pageFaults++;
      this.stats.pageCount++;
      pageFault = true;
    }

    // Fill TLB
    this.tlb[tlbIdx] = { virtualPage, physicalPage: physPage, valid: true, accessCount: 1 };
    return { physicalAddr: physPage * this.pageSize + offset, tlbHit: false, pageFault };
  }

  malloc(size: number): number {
    const pages = Math.ceil(size / this.pageSize);
    const baseVPage = this.nextPhysPage + 0x1000 + this.allocations.size;
    const vaddr = baseVPage * this.pageSize;
    for (let i = 0; i < pages; i++) {
      this.translate(vaddr + i * this.pageSize);
    }
    this.allocations.set(vaddr, size);
    this.stats.totalAllocated += size;
    return vaddr;
  }

  free(vaddr: number): boolean {
    const size = this.allocations.get(vaddr);
    if (size === undefined) return false;
    const pages = Math.ceil(size / this.pageSize);
    for (let i = 0; i < pages; i++) {
      const vp = Math.floor((vaddr + i * this.pageSize) / this.pageSize);
      const pp = this.pageTable.get(vp);
      if (pp !== undefined) { this.freeList.push(pp); this.pageTable.delete(vp); }
      const tlbIdx = vp % this.tlbSize;
      if (this.tlb[tlbIdx].virtualPage === vp) this.tlb[tlbIdx].valid = false;
    }
    this.allocations.delete(vaddr);
    this.stats.totalFreed += size;
    this.stats.pageCount -= pages;
    this.computeFragmentation();
    return true;
  }

  private computeFragmentation(): void {
    const totalPages = this.nextPhysPage;
    const usedPages = this.pageTable.size;
    this.stats.fragmentation = totalPages > 0 ? (totalPages - usedPages) / totalPages : 0;
  }

  getStats(): MemoryStats {
    this.computeFragmentation();
    return { ...this.stats };
  }

  render(): string[] {
    const s = this.getStats();
    const tlbRate = (s.tlbHits + s.tlbMisses) > 0
      ? (s.tlbHits / (s.tlbHits + s.tlbMisses) * 100).toFixed(1)
      : "0.0";
    return [
      `┌─ Virtual Memory / TLB ──────────────────────────┐`,
      `│  Page size : ${this.pageSize}B  TLB entries: ${this.tlbSize}`,
      `│  Pages     : ${s.pageCount}  Free: ${this.freeList.length}`,
      `│  Allocated : ${(s.totalAllocated / 1024).toFixed(2)}KB  Freed: ${(s.totalFreed / 1024).toFixed(2)}KB`,
      `│  Live allocs: ${this.allocations.size}`,
      `├─────────────────────────────────────────────────┤`,
      `│  TLB hits  : ${s.tlbHits}  misses: ${s.tlbMisses}  rate: ${tlbRate}%`,
      `│  Page faults: ${s.pageFaults}`,
      `│  Fragmentation: ${(s.fragmentation * 100).toFixed(1)}%`,
      `│  Frag map  : [${"█".repeat(Math.min(16, Math.floor(s.pageCount))).padEnd(16, "░")}] ${s.pageCount} pages`,
      `└─────────────────────────────────────────────────┘`,
    ];
  }
}

// ── SIMD Throughput Table ─────────────────────────────────────

export const SIMD_THROUGHPUT_TABLE: SIMDThroughput[] = [
  { instruction: "VADDPS  (AVX2)",  throughput: 2,   latency: 4,  portUsage: "p0/p1",   simdWidth: 256 },
  { instruction: "VMULPS  (AVX2)",  throughput: 2,   latency: 4,  portUsage: "p0/p1",   simdWidth: 256 },
  { instruction: "VFMADD  (AVX2)",  throughput: 2,   latency: 4,  portUsage: "p0/p1",   simdWidth: 256 },
  { instruction: "VDIVPS  (AVX2)",  throughput: 0.5, latency: 13, portUsage: "p0",      simdWidth: 256 },
  { instruction: "VSQRTPS (AVX2)",  throughput: 0.5, latency: 13, portUsage: "p0",      simdWidth: 256 },
  { instruction: "VMOVAPS (AVX2)",  throughput: 2,   latency: 1,  portUsage: "p23/p49", simdWidth: 256 },
  { instruction: "VPERM2  (AVX2)",  throughput: 1,   latency: 3,  portUsage: "p5",      simdWidth: 256 },
  { instruction: "VBLEND  (AVX2)",  throughput: 1,   latency: 1,  portUsage: "p015",    simdWidth: 256 },
  { instruction: "ADDPS   (SSE)",   throughput: 2,   latency: 4,  portUsage: "p0/p1",   simdWidth: 128 },
  { instruction: "MULPS   (SSE)",   throughput: 2,   latency: 4,  portUsage: "p0/p1",   simdWidth: 128 },
  { instruction: "DPPS    (SSE4)",  throughput: 0.5, latency: 13, portUsage: "p0",      simdWidth: 128 },
  { instruction: "MOVAPS  (SSE)",   throughput: 2,   latency: 1,  portUsage: "p23/p49", simdWidth: 128 },
];

export function renderSIMDTable(): string[] {
  const lines = [
    `┌─ x86_64 SIMD Throughput Reference ──────────────────────────┐`,
    `│  Instruction          Tput  Lat   Ports    Width             │`,
    `├─────────────────────────────────────────────────────────────┤`,
  ];
  for (const row of SIMD_THROUGHPUT_TABLE) {
    const tput = row.throughput.toFixed(1).padStart(4);
    const lat  = String(row.latency).padStart(3);
    const port = row.portUsage.padEnd(8);
    const w    = `${row.simdWidth}b`.padStart(5);
    lines.push(`│  ${row.instruction.padEnd(20)} ${tput}  ${lat}cy  ${port} ${w}         │`);
  }
  lines.push(`└─────────────────────────────────────────────────────────────┘`);
  return lines;
}

// ── Global Performance State ──────────────────────────────────

export interface PerfState {
  l1: CacheSimulator;
  l2: CacheSimulator;
  l3: CacheSimulator;
  pipeline: PipelineSimulator;
  branchPredictor: BranchPredictor;
  vmem: VirtualMemory;
  cycleCount: number;
  clockFreqGHz: number;
}

export function createPerfState(): PerfState {
  return {
    l1: new CacheSimulator("L1", { size: 32 * 1024,    lineSize: 64, associativity: 8,  latency: 4,   policy: "LRU" }),
    l2: new CacheSimulator("L2", { size: 256 * 1024,   lineSize: 64, associativity: 8,  latency: 12,  policy: "LRU" }),
    l3: new CacheSimulator("L3", { size: 8192 * 1024,  lineSize: 64, associativity: 16, latency: 40,  policy: "LRU" }),
    pipeline: new PipelineSimulator(5),
    branchPredictor: new BranchPredictor(10),
    vmem: new VirtualMemory(4096, 64),
    cycleCount: 0,
    clockFreqGHz: 3.6,
  };
}
