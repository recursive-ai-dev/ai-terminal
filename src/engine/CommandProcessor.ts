// ============================================================
// COMMAND PROCESSOR v4.0 — Fully integrated dispatcher
// 100+ commands: Tensor, Net, Adam, Registers, Tree, Fetch,
// Math, JSON, String, Base64, Hash, Time, Var, Calc, UUID,
// ASCII, Grep, Sort, Stat, Matrix, Color, Pipe, Alias, CA
// ============================================================
import { NanoTensor } from "./NanoTensor";
import { Adam } from "./Adam";
import { MLP, buildNetwork } from "./NeuralNetwork";
import { evaluate, backwardChain, buildExampleTree, printTree } from "./TreeLogic";
import { RegisterFile } from "./x86Registers";
import { executeTrainChain, clearTrainCache, formatTrainResult, formatTrainError } from "./TrainChain";
import {
  executeAdamStep, formatAdamStepResult, formatAdamStepError,
  executeBackward, formatBackwardResult,
} from "./AdamChain";
import { cryptoUUID, seedGlobalRNG } from "./determinism";
import { drainToLines, clearLogs } from "./logger";
import { runTrainChainTests } from "./TrainChain.test";
import {
  wgetFetch, wgetHead, wgetPost, wgetSpider,
  saveBlobDownload, extractLinks,
  formatFetchResponse, formatFetchError, formatSpiderResult,
  formatBytes, renderProgress,
} from "./WgetEngine";
import {
  executeCAChain as _executeCAChain,
  formatCAError as _formatCAError,
  detectLanguage as _detectLanguage,
  gridToSource as _gridToSource,
  tokenize as _caTokenize,
  computeGridStats as _computeGridStats,
} from "./CAChain";
import type { CommandAlias } from "./UXSettings";
import {
  createPerfState, renderSIMDTable,
  type PerfState,
} from "./PerformanceEngine";
import {
  renderScriptList,
  type ScriptStore,
} from "./ScriptEngine";
import {
  renderNetworkTopology, renderLossCurve, renderWeightHeatmap,
  renderGradientFlow, renderFullNetworkReport, renderActivationMap,
} from "./NetworkViz";
import { achievementEngine, type AchievementCategory } from "./AchievementEngine";
import { tensorBoard } from "./TensorBoard";
import { liveMetrics } from "./LiveMetrics";

export interface TerminalState {
  tensors:    Map<string, NanoTensor>;
  networks:   Map<string, MLP>;
  optimizers: Map<string, Adam>;
  registers:  RegisterFile;
  variables:  Map<string, number | string>;
  history:    string[];
  fetchStore: Map<string, string>;
  aliases:    CommandAlias[];
  pipeBuffer: string[];
  // ── New subsystems ──
  perf:       PerfState;
  scripts:    ScriptStore;
  macros:     Map<string, string[]>;   // name → command list
  sessions:   Map<string, { history: string[]; created: number }>;
  activeSession: string;
}

function createState(): TerminalState {
  return {
    tensors:    new Map(),
    networks:   new Map(),
    optimizers: new Map(),
    registers:  new RegisterFile(),
    variables:  new Map(),
    history:    [],
    fetchStore: new Map(),
    aliases:    [],
    pipeBuffer: [],
    perf:          createPerfState(),
    scripts:       new Map(),
    macros:        new Map(),
    sessions:      new Map([["default", { history: [], created: Date.now() }]]),
    activeSession: "default",
  };
}

export const globalState: TerminalState = createState();

export type CommandResult = string[] | Promise<string[]>;

function fmt(n: number, d = 6): string { return n.toFixed(d); }

// ── Tokenizer with quoted string support ─────────────────────
function tokenize(line: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inQuote = false;
  for (const ch of line) {
    if (ch === '"') { inQuote = !inQuote; continue; }
    if (ch === " " && !inQuote) {
      if (current) tokens.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

// ── Flag parser --key value ──────────────────────────────────
function parseFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--") && i + 1 < args.length && !args[i + 1].startsWith("--")) {
      flags[args[i].slice(2)] = args[i + 1]; i++;
    } else if (args[i].startsWith("--")) {
      flags[args[i].slice(2)] = "true";
    }
  }
  return flags;
}

// ── Pipe chain splitter ─────────────────────────────────────
function splitPipe(input: string): string[] {
  const parts: string[] = [];
  let cur = "";
  let inQ = false;
  for (const ch of input) {
    if (ch === '"') { inQ = !inQ; cur += ch; continue; }
    if (ch === "|" && !inQ) { parts.push(cur.trim()); cur = ""; }
    else cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

// ── Rate string parser (wget compat) ─────────────────────────
function parseRateString(s: string): number {
  const lower = s.toLowerCase();
  if (lower.endsWith("k")) return parseFloat(lower) * 1024;
  if (lower.endsWith("m")) return parseFloat(lower) * 1024 * 1024;
  return parseFloat(s);
}

function parseBytes(s: string): number {
  return parseRateString(s);
}

// ── Main dispatch ─────────────────────────────────────────────
export function processCommand(input: string, state: TerminalState = globalState): CommandResult {
  const raw = input.trim();
  if (!raw || raw.startsWith("#")) return [];
  state.history.push(raw);

  // ── Pipe chain: cmd1 | cmd2 | cmd3 ──
  const parts = splitPipe(raw);
  if (parts.length > 1) {
    // [D1] Async pipe — returns Promise<string[]>
    return executePipeChain(parts, state);
  }

  const tokens = tokenize(raw);
  const cmd = tokens[0]?.toLowerCase();
  const args = tokens.slice(1);

  // ── Alias resolution (before switch) ──
  const aliasSet = state.aliases.length > 0 ? state.aliases : [];
  const aliasMatch = aliasSet.find(a => a.name === cmd);
  if (aliasMatch) {
    const expanded = aliasMatch.command + (args.length ? " " + args.join(" ") : "");
    return processCommand(expanded, state);
  }

  // ── Achievement tracking ──
  achievementEngine.track(cmd ?? "unknown");
  // Drain newly unlocked achievements (they'll be picked up by App.tsx polling)

  try {
    switch (cmd) {
      // ─── SYSTEM ───────────────────────────────────────────
      case "help":     return helpText();
      case "clear":    return ["__CLEAR__"];
      case "whoami":   return ["root@x86_64-neural-terminal"];
      case "echo":     return [args.join(" ")];
      case "history":  return state.history.slice(-30).map((h, i) => `  ${String(i+1).padStart(3)}  ${h}`);
      case "sysinfo":  return cmdSysinfo();
      case "reset": {
        Object.assign(state, createState());
        clearTrainCache(); clearLogs();
        return ["[RESET] Terminal state cleared — all tensors, networks, optimizers, variables removed."];
      }

      // ─── TENSOR OPS ───────────────────────────────────────
      case "tensor":           return cmdTensor(args, state);
      case "tensor.add":       return cmdTensorBinOp("add",     args, state);
      case "tensor.mul":       return cmdTensorBinOp("mul",     args, state);
      case "tensor.matmul":    return cmdTensorBinOp("matmul",  args, state);
      case "tensor.scale":     return cmdTensorScale(args, state);
      case "tensor.relu":      return cmdTensorUnary("relu",    args, state);
      case "tensor.tanh":      return cmdTensorUnary("tanh",    args, state);
      case "tensor.sigmoid":   return cmdTensorUnary("sigmoid", args, state);
      case "tensor.softmax":   return cmdTensorUnary("softmax", args, state);
      case "tensor.backward":  return cmdTensorBackward(args, state);
      case "tensor.grad":      return cmdTensorGrad(args, state);
      case "tensor.info":      return cmdTensorInfo(args, state);
      case "tensor.list":      return cmdTensorList(state);
      case "tensor.randn":     return cmdTensorRandn(args, state);
      case "tensor.zeros":     return cmdTensorZeros(args, state);
      case "tensor.ones":      return cmdTensorOnes(args, state);
      case "tensor.norm":      return cmdTensorNorm(args, state);
      case "tensor.mse":       return cmdTensorMSE(args, state);

      // ─── NETWORK OPS ──────────────────────────────────────
      case "net.build":        return cmdNetBuild(args, state);
      case "net.describe":     return cmdNetDescribe(args, state);
      case "net.forward":      return cmdNetForward(args, state);
      case "net.predict":      return cmdNetPredict(args, state);
      case "net.list":         return cmdNetList(state);
      case "net.loss_history": return cmdNetLossHistory(args, state);
      case "net.train":        return cmdNetTrainV2(args, state);

      // ─── ADAM OPS ─────────────────────────────────────────
      case "adam.create":      return cmdAdamCreate(args, state);
      case "adam.step":        return cmdAdamStep(args, state);
      case "adam.zero_grad":   return cmdAdamZeroGrad(args, state);
      case "adam.info":        return cmdAdamInfo(args, state);

      // ─── x86_64 REGISTERS ─────────────────────────────────
      case "reg.set":          return cmdRegSet(args, state);
      case "reg.get":          return cmdRegGet(args, state);
      case "reg.dump":         return [state.registers.dump()];
      case "reg.push":         return cmdRegPush(args, state);
      case "reg.pop":          return cmdRegPop(args, state);
      case "reg.cmp":          return cmdRegCmp(args, state);
      case "reg.xmm":          return cmdRegXMM(args, state);
      case "reg.ymm":          return cmdRegYMM(args, state);
      case "reg.simd.dot":     return cmdRegSIMDDot(args, state);
      case "reg.simd.vaddps":  return cmdRegVADDPS(args, state);
      case "reg.simd.vmulps":  return cmdRegVMULPS(args, state);

      // ─── TREE LOGIC ───────────────────────────────────────
      case "tree.load":        return cmdTreeLoad(args, state);
      case "tree.eval":        return cmdTreeEval(args, state);
      case "tree.chain":       return cmdTreeChain(args, state);
      case "tree.print":       return cmdTreePrint(args, state);
      case "tree.list":        return ["Available trees: modus_ponens, neural_valid, xor_decision, default"];

      // ─── HTTP / WGET ───────────────────────────────────────
      case "fetch":
      case "wget":
      case "fetch.get":        return cmdFetchGet(args, state);
      case "fetch.head":       return cmdFetchHead(args, state);
      case "fetch.post":       return cmdFetchPost(args, state);
      case "fetch.spider":
      case "wget.spider":      return cmdFetchSpider(args, state);
      case "fetch.show":       return cmdFetchShow(args, state);
      case "fetch.save":       return cmdFetchSave(args, state);
      case "fetch.links":      return cmdFetchLinks(args, state);
      case "fetch.list":       return cmdFetchList(state);
      case "fetch.drop":       return cmdFetchDrop(args, state);
      case "fetch.headers":    return cmdFetchHeaders(args, state);

      // ─── MATH ─────────────────────────────────────────────
      case "math.eval":
      case "calc":             return cmdMathEval(args, state);
      case "math.sin":         return cmdMathFn("sin",   args);
      case "math.cos":         return cmdMathFn("cos",   args);
      case "math.tan":         return cmdMathFn("tan",   args);
      case "math.sqrt":        return cmdMathFn("sqrt",  args);
      case "math.log":         return cmdMathFn("log",   args);
      case "math.log2":        return cmdMathFn("log2",  args);
      case "math.log10":       return cmdMathFn("log10", args);
      case "math.exp":         return cmdMathFn("exp",   args);
      case "math.abs":         return cmdMathFn("abs",   args);
      case "math.ceil":        return cmdMathFn("ceil",  args);
      case "math.floor":       return cmdMathFn("floor", args);
      case "math.round":       return cmdMathFn("round", args);
      case "math.pow":         return cmdMathPow(args);
      case "math.pi":          return [`[MATH] π = ${Math.PI}`];
      case "math.e":           return [`[MATH] e = ${Math.E}`];
      case "math.fib":         return cmdMathFib(args);
      case "math.primes":      return cmdMathPrimes(args);
      case "math.factors":     return cmdMathFactors(args);
      case "math.gcd":         return cmdMathGcd(args);
      case "math.lcm":         return cmdMathLcm(args);
      case "math.hex":         return cmdMathConvert("hex",  args);
      case "math.bin":         return cmdMathConvert("bin",  args);
      case "math.oct":         return cmdMathConvert("oct",  args);

      // ─── JSON ─────────────────────────────────────────────
      case "json.parse":       return cmdJsonParse(args, state);
      case "json.format":      return cmdJsonFormat(args, state);
      case "json.get":         return cmdJsonGet(args, state);
      case "json.keys":        return cmdJsonKeys(args, state);
      case "json.validate":    return cmdJsonValidate(args);
      case "json.minify":      return cmdJsonMinify(args, state);

      // ─── STRING OPS ───────────────────────────────────────
      case "str.upper":        return cmdStr("upper",    args);
      case "str.lower":        return cmdStr("lower",    args);
      case "str.reverse":      return cmdStr("reverse",  args);
      case "str.length":       return cmdStr("length",   args);
      case "str.split":        return cmdStrSplit(args);
      case "str.replace":      return cmdStrReplace(args);
      case "str.trim":         return cmdStr("trim",     args);
      case "str.contains":     return cmdStrContains(args);
      case "str.count":        return cmdStrCountOccurrences(args);
      case "str.repeat":       return cmdStrRepeat(args);
      case "str.pad":          return cmdStrPad(args);
      case "str.slice":        return cmdStrSlice(args);
      case "str.words":        return cmdStr("words",    args);
      case "str.lines":        return cmdStr("lines",    args);

      // ─── BASE64 ───────────────────────────────────────────
      case "base64.encode":    return cmdBase64Encode(args);
      case "base64.decode":    return cmdBase64Decode(args);
      case "base64.url":       return cmdBase64Url(args);

      // ─── HASH ─────────────────────────────────────────────
      case "hash.djb2":        return cmdHash("djb2",  args);
      case "hash.fnv":         return cmdHash("fnv",   args);
      case "hash.sdbm":        return cmdHash("sdbm",  args);
      case "hash.crc32":       return cmdHash("crc32", args);
      case "hash.all":         return cmdHashAll(args);

      // ─── TIME ─────────────────────────────────────────────
      case "time.now":         return cmdTimeNow();
      case "time.stamp":       return [`[TIME] Unix timestamp: ${Math.floor(Date.now() / 1000)}`];
      case "time.ms":          return [`[TIME] Milliseconds since epoch: ${Date.now()}`];
      case "time.format":      return cmdTimeFormat(args);
      case "time.since":       return cmdTimeSince(args);
      case "time.perf":        return [`[TIME] performance.now() = ${performance.now().toFixed(4)}ms`];

      // ─── VARIABLES ────────────────────────────────────────
      case "var.set":          return cmdVarSet(args, state);
      case "var.get":          return cmdVarGet(args, state);
      case "var.list":         return cmdVarList(state);
      case "var.del":          return cmdVarDel(args, state);
      case "var.clear":        { state.variables.clear(); return ["[VAR] All variables cleared."]; }
      case "var.inc":          return cmdVarInc(args, state);
      case "var.dec":          return cmdVarDec(args, state);

      // ─── ALIASES ──────────────────────────────────────────
      case "alias":            return cmdAliasSet(args, state);
      case "alias.list":       return cmdAliasList(state);
      case "alias.del":        return cmdAliasDel(args, state);

      // ─── UTILITY ──────────────────────────────────────────
      case "uuid":             return cmdUUID(args);
      case "ascii":            return cmdAscii(args);
      case "grep":             return cmdGrep(args, state);
      case "sort":             return cmdSort(args, state);
      case "count":
      case "wc":               return cmdCount(args, state);
      case "uniq":             return cmdUniq(args, state);
      case "pipe":             return ["[PIPE] Use: cmd1 | cmd2 | cmd3  — pipe output between commands"];
      case "head":             return cmdHead(args, state);
      case "tail":             return cmdTail(args, state);
      case "rev":              return cmdRev(args, state);
      case "tee":              return cmdTee(args, state);

      // ─── MATRIX ───────────────────────────────────────────
      case "matrix.create":    return cmdMatrixCreate(args, state);
      case "matrix.add":       return cmdMatrixOp("add", args, state);
      case "matrix.mul":       return cmdMatrixOp("mul", args, state);
      case "matrix.det":       return cmdMatrixDet(args, state);
      case "matrix.transpose": return cmdMatrixTranspose(args, state);
      case "matrix.identity":  return cmdMatrixIdentity(args, state);
      case "matrix.show":      return cmdMatrixShow(args, state);

      // ─── COLOR ────────────────────────────────────────────
      case "color.hex":        return cmdColorHex(args);
      case "color.rgb":        return cmdColorRgb(args);
      case "color.hsl":        return cmdColorHsl(args);
      case "color.mix":        return cmdColorMix(args);
      case "color.palette":    return cmdColorPalette(args);
      case "color.contrast":   return cmdColorContrast(args);

      // ─── STATS ────────────────────────────────────────────
      case "stat.mean":        return cmdStat("mean",      args);
      case "stat.median":      return cmdStat("median",    args);
      case "stat.std":         return cmdStat("std",       args);
      case "stat.variance":    return cmdStat("variance",  args);
      case "stat.min":         return cmdStat("min",       args);
      case "stat.max":         return cmdStat("max",       args);
      case "stat.sum":         return cmdStat("sum",       args);
      case "stat.range":       return cmdStat("range",     args);
      case "stat.histogram":   return cmdStatHistogram(args);
      case "stat.percentile":  return cmdStatPercentile(args);
      case "stat.normalize":   return cmdStatNormalize(args);
      case "stat.zscore":      return cmdStatZScore(args);
      case "stat.all":         return cmdStatAll(args);

      // ─── PERFORMANCE ENGINE ───────────────────────────────
      case "perf.cache":      return cmdPerfCache(state);
      case "perf.l1":         return state.perf.l1.render();
      case "perf.l2":         return state.perf.l2.render();
      case "perf.l3":         return state.perf.l3.render();
      case "perf.pipeline":   return state.perf.pipeline.render();
      case "perf.branch":     return state.perf.branchPredictor.render();
      case "perf.mem":        return state.perf.vmem.render();
      case "perf.simd":       return renderSIMDTable();
      case "perf.full":       return cmdPerfFull(state);
      case "perf.reset":      { state.perf = createPerfState(); return ["[PERF] Performance state reset."]; }
      case "perf.access":     return cmdPerfAccess(args, state);
      case "perf.malloc":     return cmdPerfMalloc(args, state);
      case "perf.free":       return cmdPerfFree(args, state);
      case "perf.branch.sim": return cmdPerfBranchSim(args, state);
      case "perf.pipeline.issue": return cmdPerfPipelineIssue(args, state);
      case "perf.pipeline.tick":  return cmdPerfPipelineTick(state);

      // ─── VISUALIZATION ────────────────────────────────────
      case "viz.net":         return cmdVizNet(args, state);
      case "viz.loss":        return cmdVizLoss(args, state);
      case "viz.weights":     return cmdVizWeights(args, state);
      case "viz.gradients":   return cmdVizGradients(args, state);
      case "viz.activations": return cmdVizActivations(args, state);
      case "viz.report":      return cmdVizReport(args, state);

      // ─── SCRIPT ENGINE ────────────────────────────────────
      case "script.list":     return renderScriptList(state.scripts);
      case "script.save":     return cmdScriptSave(args, state);
      case "script.show":     return cmdScriptShow(args, state);
      case "script.run":      return cmdScriptRun(args, state);
      case "script.del":      return cmdScriptDel(args, state);
      case "script.new":      return cmdScriptHelp();

      // ─── MACROS ───────────────────────────────────────────
      case "macro.set":       return cmdMacroSet(args, state);
      case "macro.run":       return cmdMacroRun(args, state);
      case "macro.list":      return cmdMacroList(state);
      case "macro.del":       return cmdMacroDel(args, state);

      // ─── SESSIONS ─────────────────────────────────────────
      case "session.list":    return cmdSessionList(state);
      case "session.new":     return cmdSessionNew(args, state);
      case "session.switch":  return cmdSessionSwitch(args, state);
      case "session.del":     return cmdSessionDel(args, state);
      case "session.info":    return cmdSessionInfo(state);

      // ─── CELLULAR AUTOMATON ───────────────────────────────
      case "ca":
      case "ca.analyze":       return cmdCA(["analyze", ...args], state);
      case "ca.correct":       return cmdCA(["correct", ...args], state);
      case "ca.dag":           return cmdCA(["dag",     ...args], state);
      case "ca.audit":         return cmdCA(["audit",   ...args], state);
      case "ca.step":          return cmdCA(["step",    ...args], state);
      case "ca.full":          return cmdCA(["full",    ...args], state);
      case "ca.detect":        return cmdCADetect(args);
      case "ca.tokenize":      return cmdCATokenize(args);
      case "ca.editor":        return ["[CA] Open the CA Editor via the quick-launch bar or 'ca editor' button."];

      // ─── DEMO / BENCHMARK ─────────────────────────────────
      case "demo":             return cmdDemo(args, state);
      case "benchmark":        return cmdBenchmark(state);

      // ─── OBSERVABILITY ────────────────────────────────────
      case "logs":             return cmdLogs();
      case "logs.clear":       { clearLogs(); return ["[LOGS] Log buffer cleared."]; }

      // ─── DETERMINISM ──────────────────────────────────────
      case "seed":             return cmdSeed(args);

      // ─── ACHIEVEMENTS / PROFILE ───────────────────────────
      case "ach":
      case "ach.list":         return cmdAchievements(["list", ...args]);
      case "ach.profile":
      case "profile":          return cmdAchievements(["profile"]);
      case "ach.challenges":
      case "challenges":       return cmdAchievements(["challenges"]);
      case "ach.xp":
      case "xp":               return cmdAchievements(["xp"]);

      // ─── TENSORBOARD ──────────────────────────────────────
      case "tb.log":           return cmdTBLog(args);
      case "tb.scalar":        return cmdTBScalar(args);
      case "tb.plot":          return cmdTBPlot(args);
      case "tb.hist":          return cmdTBHist(args);
      case "tb.net":           return cmdTBNet(args, state);
      case "tb.tensor":        return cmdTBTensor(args, state);
      case "tb.summary":       return cmdTBSummary(args, state);
      case "tb.list":          return tensorBoard.renderTagList();
      case "tb.reset":         { tensorBoard.reset(); return ["[TB] TensorBoard cleared."]; }

      // ─── LIVE METRICS ─────────────────────────────────────
      case "metrics.dash":
      case "metrics":          return cmdMetricsDash(state);
      case "metrics.heatmap":  return liveMetrics.renderHeatmap();
      case "metrics.top":      return cmdMetricsTop();
      case "metrics.spark":    return cmdMetricsSpark();
      case "metrics.reset":    { liveMetrics.reset(); return ["[METRICS] Metrics reset."]; }

      // ─── TENSOR EXTRAS ────────────────────────────────────
      case "tensor.plot":      return cmdTensorPlot(args, state);
      case "tensor.compare":   return cmdTensorCompare(args, state);
      case "tensor.stats":     return cmdTensorStats(args, state);
      case "tensor.clamp":     return cmdTensorClamp(args, state);
      case "tensor.abs":       return cmdTensorAbs(args, state);
      case "tensor.sum":       return cmdTensorSum(args, state);
      case "tensor.mean":      return cmdTensorMean(args, state);
      case "tensor.max":       return cmdTensorMax(args, state);
      case "tensor.min":       return cmdTensorMinVal(args, state);
      case "tensor.flatten":   return cmdTensorFlatten(args, state);
      case "tensor.copy":      return cmdTensorCopy(args, state);
      case "tensor.fill":      return cmdTensorFill(args, state);

      // ─── NETWORK EXTRAS ───────────────────────────────────
      case "net.copy":         return cmdNetCopy(args, state);
      case "net.params":       return cmdNetParams(args, state);
      case "net.freeze":       return cmdNetFreeze(args, state);
      case "net.unfreeze":     return cmdNetUnfreeze(args, state);
      case "net.reset":        return cmdNetReset(args, state);
      case "net.ensemble":     return cmdNetEnsemble(args, state);

      // ─── CONVERT ──────────────────────────────────────────
      case "convert.temp":     return cmdConvertTemp(args);
      case "convert.bytes":    return cmdConvertBytes(args);
      case "convert.angle":    return cmdConvertAngle(args);
      case "convert.time":     return cmdConvertTime(args);
      case "convert.speed":    return cmdConvertSpeed(args);

      // ─── FORMAT OUTPUT ────────────────────────────────────
      case "fmt.table":        return cmdFmtTable(args, state);
      case "fmt.csv":          return cmdFmtCsv(args, state);
      case "fmt.yaml":         return cmdFmtYaml(args, state);
      case "fmt.json":         return cmdFmtJson(args, state);

      // ─── TESTS ────────────────────────────────────────────
      case "test":             return cmdTest(args);
      case "test.train":       return runTrainChainTests();

      default:
        return [`[ERROR] Unknown command: '${cmd}'. Type 'help' for all commands.`];
    }
  } catch (err: unknown) {
    return [`[EXCEPTION] ${err instanceof Error ? err.message : String(err)}`];
  }
}

// ════════════════════════════════════════════════════════════
// PIPE CHAIN EXECUTOR
// ════════════════════════════════════════════════════════════
// ── Pipe chain constants ──────────────────────────────────
const MAX_PIPE_STAGES = 10;

async function executePipeChain(parts: string[], state: TerminalState): Promise<string[]> {
  // [B1] Guard: max stages
  if (parts.length > MAX_PIPE_STAGES) {
    return [`[PIPE ERROR] Too many stages: ${parts.length} > max ${MAX_PIPE_STAGES}`];
  }
  // [B2] Guard: all stages non-empty
  for (let i = 0; i < parts.length; i++) {
    if (!parts[i].trim()) {
      return [`[PIPE ERROR] Stage ${i + 1} is empty`];
    }
  }

  // [D2] Local buffer — never stored on TerminalState
  let buffer: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i].trim();

    if (i === 0) {
      // First stage: execute normally
      try {
        const result = processCommand(part, state);
        // [D1] Async commands are properly awaited
        buffer = result instanceof Promise ? await result : result;
      } catch (e) {
        return [`[PIPE ERROR] Stage 1 threw: ${e instanceof Error ? e.message : String(e)}`];
      }
    } else {
      // Inject piped data — check if command accepts stdin
      const tokens = tokenize(part);
      const cmd = tokens[0]?.toLowerCase();
      // For filter/transform commands, pass buffer as input
      const piped = applyPipeTransform(cmd, tokens.slice(1), buffer, state);
      if (piped !== null) {
        buffer = piped;
      } else {
        // Not a pipe-aware command — run as normal, provide buffer via local var
        const localBuffer = buffer;
        void localBuffer; // available to sub-commands via closure if needed
        state.pipeBuffer = buffer;
        const result = processCommand(part, state);
        if (result instanceof Promise) return ["[PIPE] Async in pipe chain not supported."];
        buffer = result;
      }
    }
  }
  return buffer;
}

function applyPipeTransform(
  cmd: string, args: string[], input: string[], state: TerminalState
): string[] | null {
  switch (cmd) {
    case "grep": {
      const pattern = args[0];
      if (!pattern) return input;
      try {
        const re = new RegExp(pattern, "i");
        return input.filter(l => re.test(l));
      } catch { return [`[ERROR] Invalid regex: ${args[0]}`]; }
    }
    case "sort": {
      const reverse = args.includes("--reverse") || args.includes("-r");
      const sorted = [...input].sort((a, b) => a.localeCompare(b));
      return reverse ? sorted.reverse() : sorted;
    }
    case "uniq": {
      const seen = new Set<string>();
      return input.filter(l => { if (seen.has(l)) return false; seen.add(l); return true; });
    }
    case "count":
    case "wc":   return [`[PIPE] ${input.length} lines`];
    case "head": {
      const n = parseInt(args[0] ?? "10");
      return input.slice(0, isNaN(n) ? 10 : n);
    }
    case "tail": {
      const n = parseInt(args[0] ?? "10");
      return input.slice(-(isNaN(n) ? 10 : n));
    }
    case "rev":  return input.map(l => l.split("").reverse().join(""));
    case "str.upper": return input.map(l => l.toUpperCase());
    case "str.lower": return input.map(l => l.toLowerCase());
    case "str.trim":  return input.map(l => l.trim());
    case "tee": {
      const varName = args[0];
      if (varName) state.variables.set(varName, input.join("\n"));
      return input;
    }
    default: return null;
  }
}

// ════════════════════════════════════════════════════════════
// MATH COMMANDS
// ════════════════════════════════════════════════════════════

function cmdMathEval(args: string[], state: TerminalState): string[] {
  const expr = args.join(" ");
  if (!expr) return [
    "Usage: calc <expression>",
    "  calc 2 + 2",
    "  calc 3.14 * 2",
    "  calc (10 / 3) * 4",
    "  calc 2 ** 10",
    "  Variables resolved: var.set x 42  then  calc x * 2",
  ];

  try {
    // Substitute variables
    let resolved = expr;
    for (const [k, v] of state.variables.entries()) {
      resolved = resolved.replace(new RegExp(`\\b${k}\\b`, "g"), String(v));
    }

    // Safe expression evaluator — only allow math chars
    const safe = resolved.replace(/[^0-9+\-*/().%^ \t]/g, "");
    if (!safe.trim()) return ["[MATH] Expression contains invalid characters."];

    // Replace ** with Math.pow equivalent via Function
    const jsExpr = safe.replace(/\^/g, "**");

    // eslint-disable-next-line no-new-func
    const result = Function(`"use strict"; return (${jsExpr})`)() as number;

    if (!isFinite(result)) return [`[MATH] Result: ${result} (overflow or division by zero)`];

    const lines = [`[MATH] ${expr} = ${result}`];
    if (Number.isInteger(result)) {
      lines.push(`  hex: 0x${(result >>> 0).toString(16).toUpperCase()}`);
      lines.push(`  bin: 0b${(result >>> 0).toString(2)}`);
    }
    return lines;
  } catch (e) {
    return [`[MATH] Error: ${(e as Error).message}`];
  }
}

function cmdMathFn(fn: string, args: string[]): string[] {
  const n = parseFloat(args[0] ?? "");
  if (isNaN(n)) return [`Usage: math.${fn} <number>`];
  const fnMap: Record<string, (x: number) => number> = {
    sin: Math.sin, cos: Math.cos, tan: Math.tan, sqrt: Math.sqrt,
    log: Math.log, log2: Math.log2, log10: Math.log10, exp: Math.exp,
    abs: Math.abs, ceil: Math.ceil, floor: Math.floor, round: Math.round,
  };
  const result = fnMap[fn]?.(n);
  if (result === undefined) return [`[MATH] Unknown function: ${fn}`];
  return [`[MATH] ${fn}(${n}) = ${result}`];
}

function cmdMathPow(args: string[]): string[] {
  const [a, b] = [parseFloat(args[0] ?? ""), parseFloat(args[1] ?? "")];
  if (isNaN(a) || isNaN(b)) return ["Usage: math.pow <base> <exponent>"];
  return [`[MATH] ${a} ^ ${b} = ${Math.pow(a, b)}`];
}

function cmdMathFib(args: string[]): string[] {
  const n = parseInt(args[0] ?? "10");
  if (isNaN(n) || n < 1 || n > 70) return ["Usage: math.fib <n>  (n: 1–70)"];
  const seq: number[] = [0, 1];
  for (let i = 2; i < n; i++) seq.push(seq[i-1] + seq[i-2]);
  return [`[MATH] Fibonacci(${n}): ${seq.slice(0, n).join(", ")}`];
}

function cmdMathPrimes(args: string[]): string[] {
  const limit = parseInt(args[0] ?? "50");
  if (isNaN(limit) || limit < 2 || limit > 10000) return ["Usage: math.primes <limit>  (max 10000)"];
  const sieve = new Array(limit + 1).fill(true);
  sieve[0] = sieve[1] = false;
  for (let i = 2; i * i <= limit; i++) {
    if (sieve[i]) for (let j = i*i; j <= limit; j += i) sieve[j] = false;
  }
  const primes = sieve.map((v, i) => v ? i : -1).filter(x => x > 0);
  return [`[MATH] Primes up to ${limit} (${primes.length} total): ${primes.join(", ")}`];
}

function cmdMathFactors(args: string[]): string[] {
  const n = parseInt(args[0] ?? "");
  if (isNaN(n) || n < 1) return ["Usage: math.factors <n>"];
  const factors: number[] = [];
  let x = n;
  for (let i = 2; i * i <= x; i++) {
    while (x % i === 0) { factors.push(i); x = Math.floor(x / i); }
  }
  if (x > 1) factors.push(x);
  return [`[MATH] factors(${n}) = ${factors.join(" × ")}`];
}

function cmdMathGcd(args: string[]): string[] {
  const [a, b] = [parseInt(args[0] ?? ""), parseInt(args[1] ?? "")];
  if (isNaN(a) || isNaN(b)) return ["Usage: math.gcd <a> <b>"];
  const gcd = (x: number, y: number): number => y === 0 ? x : gcd(y, x % y);
  return [`[MATH] gcd(${a}, ${b}) = ${gcd(Math.abs(a), Math.abs(b))}`];
}

function cmdMathLcm(args: string[]): string[] {
  const [a, b] = [parseInt(args[0] ?? ""), parseInt(args[1] ?? "")];
  if (isNaN(a) || isNaN(b)) return ["Usage: math.lcm <a> <b>"];
  const gcd = (x: number, y: number): number => y === 0 ? x : gcd(y, x % y);
  const g = gcd(Math.abs(a), Math.abs(b));
  return [`[MATH] lcm(${a}, ${b}) = ${Math.abs(a * b) / g}`];
}

function cmdMathConvert(base: "hex" | "bin" | "oct", args: string[]): string[] {
  const n = parseInt(args[0] ?? "");
  if (isNaN(n)) return [`Usage: math.${base} <integer>`];
  const m: Record<string, string> = {
    hex: `0x${(n >>> 0).toString(16).toUpperCase()}`,
    bin: `0b${(n >>> 0).toString(2)}`,
    oct: `0o${(n >>> 0).toString(8)}`,
  };
  return [`[MATH] ${n} = ${m[base]}`];
}

// ════════════════════════════════════════════════════════════
// JSON COMMANDS
// ════════════════════════════════════════════════════════════

function cmdJsonParse(args: string[], state: TerminalState): string[] {
  const raw = args[0]; const name = args[1];
  if (!raw) return ["Usage: json.parse <json-string> [var-name]  — parse and optionally store"];
  try {
    const parsed = JSON.parse(raw);
    const lines = [`[JSON] Parsed OK — type: ${Array.isArray(parsed) ? "array" : typeof parsed}`];
    if (name) {
      state.variables.set(name, JSON.stringify(parsed));
      lines.push(`  Stored as variable: ${name}`);
    }
    lines.push(`  Preview: ${JSON.stringify(parsed).slice(0, 200)}`);
    return lines;
  } catch (e) { return [`[JSON] Parse error: ${(e as Error).message}`]; }
}

function cmdJsonFormat(args: string[], state: TerminalState): string[] {
  const raw = args[0] ?? (state.pipeBuffer.length ? state.pipeBuffer.join("") : "");
  if (!raw) return ["Usage: json.format <json-string>  — pretty-print JSON"];
  try {
    const parsed = JSON.parse(raw);
    const pretty = JSON.stringify(parsed, null, 2);
    return [`[JSON] Formatted:`, ...pretty.split("\n").map(l => `  ${l}`)];
  } catch (e) { return [`[JSON] Parse error: ${(e as Error).message}`]; }
}

function cmdJsonGet(args: string[], _state: TerminalState): string[] {
  const raw = args[0]; const path = args[1];
  if (!raw || !path) return ["Usage: json.get <json-string> <dot.path>  e.g. json.get data.items.0"];
  try {
    let obj = JSON.parse(raw);
    const parts = path.split(".");
    for (const p of parts) {
      if (obj === null || obj === undefined) break;
      obj = (obj as Record<string, unknown>)[p];
    }
    return [`[JSON] ${path} = ${JSON.stringify(obj)}`];
  } catch (e) { return [`[JSON] Error: ${(e as Error).message}`]; }
}

function cmdJsonKeys(args: string[], state: TerminalState): string[] {
  const raw = args[0] ?? (state.pipeBuffer.length ? state.pipeBuffer.join("") : "");
  if (!raw) return ["Usage: json.keys <json-object-string>"];
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed !== "object") return ["[JSON] Not an object"];
    const keys = Object.keys(parsed);
    return [`[JSON] Keys (${keys.length}): ${keys.join(", ")}`];
  } catch (e) { return [`[JSON] Error: ${(e as Error).message}`]; }
}

function cmdJsonValidate(args: string[]): string[] {
  const raw = args[0];
  if (!raw) return ["Usage: json.validate <json-string>"];
  try {
    JSON.parse(raw);
    return ["[JSON] Valid JSON"];
  } catch (e) { return [`[JSON] Invalid JSON: ${(e as Error).message}`]; }
}

function cmdJsonMinify(args: string[], state: TerminalState): string[] {
  const raw = args[0] ?? (state.pipeBuffer.length ? state.pipeBuffer.join("") : "");
  if (!raw) return ["Usage: json.minify <json-string>"];
  try {
    const minified = JSON.stringify(JSON.parse(raw));
    return [`[JSON] Minified (${minified.length} chars):`, `  ${minified.slice(0, 500)}`];
  } catch (e) { return [`[JSON] Error: ${(e as Error).message}`]; }
}

// ════════════════════════════════════════════════════════════
// STRING COMMANDS
// ════════════════════════════════════════════════════════════

function cmdStr(op: string, args: string[]): string[] {
  const s = args.join(" ");
  if (!s) return [`Usage: str.${op} <text>`];
  switch (op) {
    case "upper":   return [`[STR] ${s.toUpperCase()}`];
    case "lower":   return [`[STR] ${s.toLowerCase()}`];
    case "reverse": return [`[STR] ${s.split("").reverse().join("")}`];
    case "trim":    return [`[STR] "${s.trim()}"`];
    case "length":  return [`[STR] Length: ${s.length} chars`];
    case "words":   return [`[STR] Words: ${s.trim().split(/\s+/).length}`];
    case "lines":   return [`[STR] Lines: ${s.split("\n").length}`];
    default:        return [`[STR] Unknown op: ${op}`];
  }
}

function cmdStrSplit(args: string[]): string[] {
  const text = args[0]; const delim = args[1] ?? " ";
  if (!text) return ["Usage: str.split <text> [delimiter]"];
  const parts = text.split(delim);
  return [`[STR] Split by '${delim}' → ${parts.length} parts:`, ...parts.map((p, i) => `  [${i}] "${p}"`)];
}

function cmdStrReplace(args: string[]): string[] {
  const [text, find, replace] = args;
  if (!text || !find) return ["Usage: str.replace <text> <find> <replace>"];
  const rep = replace ?? "";
  let result = text;
  while (result.includes(find)) result = result.split(find).join(rep);
  return [`[STR] ${result}`];
}

function cmdStrContains(args: string[]): string[] {
  const [text, needle] = args;
  if (!text || !needle) return ["Usage: str.contains <text> <substring>"];
  const found = text.includes(needle);
  return [`[STR] '${text}' ${found ? "contains" : "does NOT contain"} '${needle}'`];
}

function cmdStrCountOccurrences(args: string[]): string[] {
  const [text, needle] = args;
  if (!text || !needle) return ["Usage: str.count <text> <substring>"];
  const count = text.split(needle).length - 1;
  return [`[STR] '${needle}' appears ${count} time(s) in text`];
}

function cmdStrRepeat(args: string[]): string[] {
  const [text, nStr] = args;
  const n = parseInt(nStr ?? "2");
  if (!text || isNaN(n) || n > 200) return ["Usage: str.repeat <text> <n>  (max 200)"];
  return [`[STR] ${text.repeat(n)}`];
}

function cmdStrPad(args: string[]): string[] {
  const [text, widthStr, side, fillChar] = args;
  const width = parseInt(widthStr ?? "20");
  if (!text || isNaN(width)) return ["Usage: str.pad <text> <width> [left|right] [char]"];
  const fill = fillChar ?? " ";
  const result = side === "right" ? text.padEnd(width, fill) : text.padStart(width, fill);
  return [`[STR] "${result}"`];
}

function cmdStrSlice(args: string[]): string[] {
  const [text, startStr, endStr] = args;
  const start = parseInt(startStr ?? "0");
  const end = endStr ? parseInt(endStr) : undefined;
  if (!text) return ["Usage: str.slice <text> <start> [end]"];
  return [`[STR] "${text.slice(start, end)}"`];
}

// ════════════════════════════════════════════════════════════
// BASE64
// ════════════════════════════════════════════════════════════

function cmdBase64Encode(args: string[]): string[] {
  const text = args.join(" ");
  if (!text) return ["Usage: base64.encode <text>"];
  try {
    const encoded = btoa(unescape(encodeURIComponent(text)));
    return [`[BASE64] Encoded: ${encoded}`];
  } catch { return ["[BASE64] Encoding failed — check input"]; }
}

function cmdBase64Decode(args: string[]): string[] {
  const text = args[0];
  if (!text) return ["Usage: base64.decode <base64-string>"];
  try {
    const decoded = decodeURIComponent(escape(atob(text)));
    return [`[BASE64] Decoded: ${decoded}`];
  } catch { return ["[BASE64] Decode failed — invalid base64"]; }
}

function cmdBase64Url(args: string[]): string[] {
  const text = args.join(" ");
  if (!text) return ["Usage: base64.url <text>  — URL-safe base64 encode"];
  try {
    const encoded = btoa(unescape(encodeURIComponent(text)))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
    return [`[BASE64] URL-safe: ${encoded}`];
  } catch { return ["[BASE64] Encoding failed"]; }
}

// ════════════════════════════════════════════════════════════
// HASH
// ════════════════════════════════════════════════════════════

function djb2(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) + s.charCodeAt(i);
  return h >>> 0;
}

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function sdbm(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = s.charCodeAt(i) + (h << 6) + (h << 16) - h;
  }
  return h >>> 0;
}

function crc32(s: string): number {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < s.length; i++) {
    crc ^= s.charCodeAt(i);
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function cmdHash(algo: string, args: string[]): string[] {
  const text = args.join(" ");
  if (!text) return [`Usage: hash.${algo} <text>`];
  const hashFns: Record<string, (s: string) => number> = { djb2, fnv: fnv1a, sdbm, crc32 };
  const fn = hashFns[algo];
  if (!fn) return [`[HASH] Unknown algorithm: ${algo}`];
  const h = fn(text);
  return [`[HASH] ${algo}("${text.slice(0, 40)}") = ${h} (0x${h.toString(16).toUpperCase().padStart(8, "0")})`];
}

function cmdHashAll(args: string[]): string[] {
  const text = args.join(" ");
  if (!text) return ["Usage: hash.all <text>"];
  return [
    `[HASH] Input: "${text.slice(0, 40)}${text.length > 40 ? "..." : ""}"`,
    `  DJB2  : ${djb2(text)}   (0x${djb2(text).toString(16).toUpperCase().padStart(8, "0")})`,
    `  FNV1a : ${fnv1a(text)}   (0x${fnv1a(text).toString(16).toUpperCase().padStart(8, "0")})`,
    `  SDBM  : ${sdbm(text)}   (0x${sdbm(text).toString(16).toUpperCase().padStart(8, "0")})`,
    `  CRC32 : ${crc32(text)}   (0x${crc32(text).toString(16).toUpperCase().padStart(8, "0")})`,
  ];
}

// ════════════════════════════════════════════════════════════
// TIME COMMANDS
// ════════════════════════════════════════════════════════════

function cmdTimeNow(): string[] {
  const now = new Date();
  return [
    `[TIME] Current time`,
    `  Local    : ${now.toLocaleString()}`,
    `  ISO 8601 : ${now.toISOString()}`,
    `  UTC      : ${now.toUTCString()}`,
    `  Unix     : ${Math.floor(now.getTime() / 1000)}`,
    `  Ms epoch : ${now.getTime()}`,
  ];
}

function cmdTimeFormat(args: string[]): string[] {
  const format = args[0];
  if (!format) return ["Usage: time.format <format>  e.g. time.format YYYY-MM-DD"];
  const now = new Date();
  const result = format
    .split("YYYY").join(String(now.getFullYear()))
    .split("MM").join(String(now.getMonth() + 1).padStart(2, "0"))
    .split("DD").join(String(now.getDate()).padStart(2, "0"))
    .split("HH").join(String(now.getHours()).padStart(2, "0"))
    .split("mm").join(String(now.getMinutes()).padStart(2, "0"))
    .split("SS").join(String(now.getSeconds()).padStart(2, "0"));
  return [`[TIME] ${result}`];
}

function cmdTimeSince(args: string[]): string[] {
  const ts = args[0];
  if (!ts) return ["Usage: time.since <unix-timestamp>  — show elapsed time"];
  const then = parseInt(ts) * 1000;
  const diffMs = Date.now() - then;
  const s = Math.floor(diffMs / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  return [`[TIME] Since ${ts}: ${d}d ${h % 24}h ${m % 60}m ${s % 60}s`];
}

// ════════════════════════════════════════════════════════════
// VARIABLE COMMANDS
// ════════════════════════════════════════════════════════════

function cmdVarSet(args: string[], state: TerminalState): string[] {
  const [name, ...valParts] = args;
  if (!name || valParts.length === 0) return ["Usage: var.set <name> <value>"];
  const val = valParts.join(" ");
  const num = parseFloat(val);
  state.variables.set(name, isNaN(num) ? val : num);
  return [`[VAR] ${name} = ${isNaN(num) ? `"${val}"` : num}`];
}

function cmdVarGet(args: string[], state: TerminalState): string[] {
  const [name] = args;
  if (!name) return ["Usage: var.get <name>"];
  const val = state.variables.get(name);
  if (val === undefined) return [`[VAR] '${name}' is not set`];
  return [`[VAR] ${name} = ${val}`];
}

function cmdVarList(state: TerminalState): string[] {
  if (state.variables.size === 0) return ["[VAR] No variables set. Use var.set <name> <value>"];
  const lines = [`[VAR] Variables (${state.variables.size}):`];
  for (const [k, v] of state.variables.entries()) {
    lines.push(`  ${k.padEnd(16)} = ${String(v).slice(0, 60)}`);
  }
  return lines;
}

function cmdVarDel(args: string[], state: TerminalState): string[] {
  const [name] = args;
  if (!name) return ["Usage: var.del <name>"];
  const existed = state.variables.has(name);
  state.variables.delete(name);
  return [existed ? `[VAR] Deleted: ${name}` : `[VAR] '${name}' was not set`];
}

function cmdVarInc(args: string[], state: TerminalState): string[] {
  const [name, amtStr] = args;
  if (!name) return ["Usage: var.inc <name> [amount]"];
  const cur = parseFloat(String(state.variables.get(name) ?? "0"));
  const amt = parseFloat(amtStr ?? "1");
  state.variables.set(name, cur + amt);
  return [`[VAR] ${name} = ${cur + amt}`];
}

function cmdVarDec(args: string[], state: TerminalState): string[] {
  const [name, amtStr] = args;
  if (!name) return ["Usage: var.dec <name> [amount]"];
  const cur = parseFloat(String(state.variables.get(name) ?? "0"));
  const amt = parseFloat(amtStr ?? "1");
  state.variables.set(name, cur - amt);
  return [`[VAR] ${name} = ${cur - amt}`];
}

// ════════════════════════════════════════════════════════════
// ALIAS COMMANDS
// ════════════════════════════════════════════════════════════

function cmdAliasSet(args: string[], state: TerminalState): string[] {
  const [name, ...cmdParts] = args;
  if (!name || cmdParts.length === 0) return [
    "Usage: alias <name> <command>",
    "  alias ll tensor.list",
    "  alias nls net.list",
    "  alias.list — show all aliases",
  ];
  const command = cmdParts.join(" ");
  const existing = state.aliases.findIndex(a => a.name === name);
  if (existing >= 0) state.aliases[existing] = { name, command };
  else state.aliases.push({ name, command });
  return [`[ALIAS] ${name} = ${command}`];
}

function cmdAliasList(state: TerminalState): string[] {
  if (state.aliases.length === 0) return ["[ALIAS] No aliases defined. Use: alias <name> <command>"];
  const lines = [`[ALIAS] ${state.aliases.length} aliases:`];
  for (const a of state.aliases) {
    lines.push(`  ${a.name.padEnd(12)} -> ${a.command}`);
  }
  return lines;
}

function cmdAliasDel(args: string[], state: TerminalState): string[] {
  const [name] = args;
  if (!name) return ["Usage: alias.del <name>"];
  const before = state.aliases.length;
  state.aliases = state.aliases.filter(a => a.name !== name);
  return [state.aliases.length < before ? `[ALIAS] Deleted: ${name}` : `[ALIAS] '${name}' not found`];
}

// ════════════════════════════════════════════════════════════
// UUID
// ════════════════════════════════════════════════════════════

function cmdUUID(args: string[]): string[] {
  const n = parseInt(args[0] ?? "1");
  const count = isNaN(n) ? 1 : Math.min(n, 20);
  const ids: string[] = [];
  for (let i = 0; i < count; i++) ids.push(cryptoUUID.generate());
  return [`[UUID] Generated ${count}:`, ...ids.map(id => `  ${id}`)];
}

// ════════════════════════════════════════════════════════════
// ASCII
// ════════════════════════════════════════════════════════════

function cmdAscii(args: string[]): string[] {
  const text = args.join(" ");
  if (!text) {
    return [
      "[ASCII] Usage: ascii <text>  — show ASCII codes",
      "  ascii hello",
    ];
  }
  const lines = [`[ASCII] "${text}" — ${text.length} chars:`];
  const row1 = text.split("").map(c => c.padStart(4)).join("");
  const row2 = text.split("").map(c => String(c.charCodeAt(0)).padStart(4)).join("");
  const row3 = text.split("").map(c => ("0x" + c.charCodeAt(0).toString(16).toUpperCase()).padStart(4)).join("");
  lines.push(`  Char:${row1}`);
  lines.push(`  Dec :${row2}`);
  lines.push(`  Hex :${row3}`);
  return lines;
}

// ════════════════════════════════════════════════════════════
// GREP / SORT / COUNT / UNIQ
// ════════════════════════════════════════════════════════════

function cmdGrep(args: string[], state: TerminalState): string[] {
  const pattern = args[0];
  const source = args[1];
  if (!pattern) return ["Usage: grep <pattern> [var-name|pipe]  — filter lines matching regex"];
  const lines = source
    ? String(state.variables.get(source) ?? "").split("\n")
    : state.pipeBuffer;
  if (lines.length === 0) return ["[GREP] No input. Pipe from another command or provide a var name."];
  try {
    const re = new RegExp(pattern, "i");
    const matched = lines.filter(l => re.test(l));
    return matched.length > 0
      ? [`[GREP] ${matched.length}/${lines.length} matches:`, ...matched]
      : [`[GREP] No matches for '${pattern}'`];
  } catch { return [`[GREP] Invalid regex: ${pattern}`]; }
}

function cmdSort(args: string[], state: TerminalState): string[] {
  const source = args.find(a => !a.startsWith("--"));
  const reverse = args.includes("--reverse") || args.includes("-r");
  const numeric = args.includes("--numeric") || args.includes("-n");
  const lines = source
    ? String(state.variables.get(source) ?? "").split("\n")
    : state.pipeBuffer;
  if (lines.length === 0) return ["[SORT] No input to sort."];
  const sorted = [...lines].sort((a, b) =>
    numeric ? parseFloat(a) - parseFloat(b) : a.localeCompare(b)
  );
  if (reverse) sorted.reverse();
  return [`[SORT] Sorted ${sorted.length} lines:`, ...sorted];
}

function cmdCount(args: string[], state: TerminalState): string[] {
  const source = args[0];
  const text = source
    ? String(state.variables.get(source) ?? "")
    : state.pipeBuffer.join("\n");
  if (!text) return ["[WC] No input. Pipe from another command or provide a var name."];
  const lines = text.split("\n").length;
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const chars = text.length;
  return [`[WC] Lines: ${lines}  Words: ${words}  Chars: ${chars}`];
}

function cmdUniq(args: string[], state: TerminalState): string[] {
  const source = args[0];
  const lines = source
    ? String(state.variables.get(source) ?? "").split("\n")
    : state.pipeBuffer;
  if (lines.length === 0) return ["[UNIQ] No input."];
  const seen = new Set<string>();
  const unique = lines.filter(l => { if (seen.has(l)) return false; seen.add(l); return true; });
  return [`[UNIQ] ${unique.length}/${lines.length} unique:`, ...unique];
}

function cmdHead(args: string[], state: TerminalState): string[] {
  const n = parseInt(args.find(a => !a.startsWith("-")) ?? "10");
  const count = isNaN(n) ? 10 : n;
  const src = state.pipeBuffer;
  if (!src.length) return ["[HEAD] No pipe input."];
  return [`[HEAD] First ${count} lines:`, ...src.slice(0, count)];
}

function cmdTail(args: string[], state: TerminalState): string[] {
  const n = parseInt(args.find(a => !a.startsWith("-")) ?? "10");
  const count = isNaN(n) ? 10 : n;
  const src = state.pipeBuffer;
  if (!src.length) return ["[TAIL] No pipe input."];
  return [`[TAIL] Last ${count} lines:`, ...src.slice(-count)];
}

function cmdRev(args: string[], state: TerminalState): string[] {
  const src = args.length ? [args.join(" ")] : state.pipeBuffer;
  return src.map(l => l.split("").reverse().join(""));
}

function cmdTee(args: string[], state: TerminalState): string[] {
  const name = args[0];
  if (!name) return ["Usage: tee <var-name>  — copy pipe buffer to variable"];
  state.variables.set(name, state.pipeBuffer.join("\n"));
  return [`[TEE] Stored ${state.pipeBuffer.length} lines in variable '${name}'`, ...state.pipeBuffer];
}

// ════════════════════════════════════════════════════════════
// MATRIX COMMANDS (using NanoTensor)
// ════════════════════════════════════════════════════════════

function cmdMatrixCreate(args: string[], state: TerminalState): string[] {
  const [name, rowsStr, colsStr, ...vals] = args;
  const rows = parseInt(rowsStr ?? ""); const cols = parseInt(colsStr ?? "");
  if (!name || isNaN(rows) || isNaN(cols)) return ["Usage: matrix.create <name> <rows> <cols> [values...]"];
  const data = vals.length === rows * cols
    ? vals.map(Number)
    : Array.from({ length: rows * cols }, (_, i) => i);
  const t = new NanoTensor(data, [rows, cols], "f32", false, name);
  state.tensors.set(name, t);
  return [`[MATRIX] Created ${name} [${rows}x${cols}]`, ...formatMatrix(t)];
}

function cmdMatrixOp(op: "add" | "mul", args: string[], state: TerminalState): string[] {
  const [out, a, b] = args;
  if (!out || !a || !b) return [`Usage: matrix.${op} <out> <A> <B>`];
  const A = state.tensors.get(a); const B = state.tensors.get(b);
  if (!A) return [`[MATRIX] Tensor '${a}' not found`];
  if (!B) return [`[MATRIX] Tensor '${b}' not found`];
  try {
    const result = op === "add" ? A.add(B) : A.matmul(B);
    result.label = out;
    state.tensors.set(out, result);
    return [`[MATRIX] ${out} = ${a} ${op === "add" ? "+" : "x"} ${b}  [${result.shape.join("x")}]`, ...formatMatrix(result)];
  } catch (e) { return [`[MATRIX] Error: ${(e as Error).message}`]; }
}

function cmdMatrixDet(args: string[], state: TerminalState): string[] {
  const [name] = args;
  if (!name) return ["Usage: matrix.det <tensor>  — compute determinant (2x2 or 3x3)"];
  const t = state.tensors.get(name);
  if (!t) return [`[MATRIX] Tensor '${name}' not found`];
  const [r, c] = t.shape;
  if (r !== c || (r !== 2 && r !== 3)) return [`[MATRIX] det only supports 2x2 and 3x3 matrices`];
  const d = t.data as Float32Array;
  let det = 0;
  if (r === 2) {
    det = d[0]*d[3] - d[1]*d[2];
  } else {
    det = d[0]*(d[4]*d[8]-d[5]*d[7]) - d[1]*(d[3]*d[8]-d[5]*d[6]) + d[2]*(d[3]*d[7]-d[4]*d[6]);
  }
  return [`[MATRIX] det(${name}) = ${det.toFixed(6)}`];
}

function cmdMatrixTranspose(args: string[], state: TerminalState): string[] {
  const [out, name] = args;
  if (!out || !name) return ["Usage: matrix.transpose <out> <tensor>"];
  const t = state.tensors.get(name);
  if (!t) return [`[MATRIX] Tensor '${name}' not found`];
  const [rows, cols] = t.shape;
  const d = t.data as Float32Array;
  const result = new Float32Array(rows * cols);
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) result[j * rows + i] = d[i * cols + j];
  const transposed = new NanoTensor(result, [cols, rows], "f32", false, out);
  state.tensors.set(out, transposed);
  return [`[MATRIX] ${out} = transpose(${name}) [${cols}x${rows}]`, ...formatMatrix(transposed)];
}

function cmdMatrixIdentity(args: string[], state: TerminalState): string[] {
  const [name, nStr] = args;
  const n = parseInt(nStr ?? "");
  if (!name || isNaN(n) || n < 1 || n > 16) return ["Usage: matrix.identity <name> <n>  (n: 1-16)"];
  const data = new Float32Array(n * n);
  for (let i = 0; i < n; i++) data[i * n + i] = 1;
  const t = new NanoTensor(data, [n, n], "f32", false, name);
  state.tensors.set(name, t);
  return [`[MATRIX] ${name} = I[${n}x${n}]`, ...formatMatrix(t)];
}

function cmdMatrixShow(args: string[], state: TerminalState): string[] {
  const [name] = args;
  if (!name) return ["Usage: matrix.show <tensor>"];
  const t = state.tensors.get(name);
  if (!t) return [`[MATRIX] Tensor '${name}' not found`];
  return [`[MATRIX] ${name} [${t.shape.join("x")}]`, ...formatMatrix(t)];
}

function formatMatrix(t: NanoTensor): string[] {
  const [rows, cols] = t.shape.length >= 2 ? t.shape : [1, t.shape[0]];
  const d = t.data as Float32Array;
  const lines: string[] = [];
  for (let i = 0; i < Math.min(rows, 12); i++) {
    const row = Array.from({ length: cols }, (_, j) => d[i * cols + j].toFixed(3).padStart(8));
    lines.push(`  [${row.join("")} ]`);
  }
  if (rows > 12) lines.push(`  ... ${rows - 12} more rows`);
  return lines;
}

// ════════════════════════════════════════════════════════════
// COLOR COMMANDS
// ════════════════════════════════════════════════════════════

function hexToRgb(hex: string): [number, number, number] | null {
  const clean = hex.replace(/^#/, "");
  if (clean.length !== 6) return null;
  const r = parseInt(clean.slice(0,2), 16);
  const g = parseInt(clean.slice(2,4), 16);
  const b = parseInt(clean.slice(4,6), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
  return [r, g, b];
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

function luminance(r: number, g: number, b: number): number {
  const sRGB = [r, g, b].map(c => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * sRGB[0] + 0.7152 * sRGB[1] + 0.0722 * sRGB[2];
}

function cmdColorHex(args: string[]): string[] {
  const hex = args[0];
  if (!hex) return ["Usage: color.hex <#RRGGBB>  — parse hex color"];
  const rgb = hexToRgb(hex);
  if (!rgb) return [`[COLOR] Invalid hex: ${hex}`];
  const [r, g, b] = rgb;
  const [h, s, l] = rgbToHsl(r, g, b);
  return [
    `[COLOR] ${hex}`,
    `  RGB   : rgb(${r}, ${g}, ${b})`,
    `  HSL   : hsl(${h}deg, ${s}%, ${l}%)`,
    `  Lum   : ${luminance(r, g, b).toFixed(4)}`,
    `  Swatch: ${"█".repeat(20)}  ← ${hex}`,
  ];
}

function cmdColorRgb(args: string[]): string[] {
  const [r, g, b] = [parseInt(args[0] ?? ""), parseInt(args[1] ?? ""), parseInt(args[2] ?? "")];
  if (isNaN(r) || isNaN(g) || isNaN(b)) return ["Usage: color.rgb <r> <g> <b>"];
  const hex = `#${[r, g, b].map(c => Math.max(0, Math.min(255, c)).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
  const [h, s, l] = rgbToHsl(r, g, b);
  return [`[COLOR] rgb(${r}, ${g}, ${b}) = ${hex}  hsl(${h}, ${s}%, ${l}%)`];
}

function cmdColorHsl(args: string[]): string[] {
  const [h, s, l] = [parseFloat(args[0] ?? ""), parseFloat(args[1] ?? ""), parseFloat(args[2] ?? "")];
  if (isNaN(h) || isNaN(s) || isNaN(l)) return ["Usage: color.hsl <h> <s> <l>  — convert HSL to RGB/hex"];
  const sn = s / 100, ln = l / 100;
  const a = sn * Math.min(ln, 1 - ln);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return Math.round((ln - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255);
  };
  const [r, g, b] = [f(0), f(8), f(4)];
  const hex = `#${[r, g, b].map(c => c.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
  return [`[COLOR] hsl(${h}, ${s}%, ${l}%) = ${hex}  rgb(${r}, ${g}, ${b})`];
}

function cmdColorMix(args: string[]): string[] {
  const [hex1, hex2, ratioStr] = args;
  if (!hex1 || !hex2) return ["Usage: color.mix <#hex1> <#hex2> [ratio 0-1]"];
  const rgb1 = hexToRgb(hex1); const rgb2 = hexToRgb(hex2);
  if (!rgb1 || !rgb2) return ["[COLOR] Invalid hex values"];
  const t = parseFloat(ratioStr ?? "0.5");
  const [r, g, b] = rgb1.map((c, i) => Math.round(c * (1 - t) + rgb2[i] * t)) as [number, number, number];
  const hex = `#${[r, g, b].map(c => c.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
  return [`[COLOR] mix(${hex1}, ${hex2}, ${t}) = ${hex}  rgb(${r}, ${g}, ${b})`];
}

function cmdColorPalette(args: string[]): string[] {
  const hex = args[0];
  if (!hex) return ["Usage: color.palette <#hex>  — generate 5-color palette"];
  const rgb = hexToRgb(hex);
  if (!rgb) return [`[COLOR] Invalid hex: ${hex}`];
  const [, s, l] = rgbToHsl(...rgb);
  const lines = [`[COLOR] Palette from ${hex}:`];
  const variants = [
    { name: "Lighter", lAdj: Math.min(95, l + 30) },
    { name: "Light  ", lAdj: Math.min(90, l + 15) },
    { name: "Base   ", lAdj: l },
    { name: "Dark   ", lAdj: Math.max(5, l - 15) },
    { name: "Darker ", lAdj: Math.max(5, l - 30) },
  ];
  const [h] = rgbToHsl(...rgb);
  for (const v of variants) {
    const { hex: newHex } = (() => {
      const sn = s / 100, ln = v.lAdj / 100;
      const a = sn * Math.min(ln, 1 - ln);
      const f = (n: number) => {
        const k = (n + h / 30) % 12;
        return Math.round((ln - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255);
      };
      const [r2, g2, b2] = [f(0), f(8), f(4)];
      return { hex: `#${[r2, g2, b2].map(c => c.toString(16).padStart(2, "0")).join("").toUpperCase()}` };
    })();
    lines.push(`  ${v.name} : ${newHex}  ${"█".repeat(12)}`);
  }
  return lines;
}

function cmdColorContrast(args: string[]): string[] {
  const [hex1, hex2] = args;
  if (!hex1 || !hex2) return ["Usage: color.contrast <#hex1> <#hex2>"];
  const rgb1 = hexToRgb(hex1); const rgb2 = hexToRgb(hex2);
  if (!rgb1 || !rgb2) return ["[COLOR] Invalid hex values"];
  const l1 = luminance(...rgb1); const l2 = luminance(...rgb2);
  const lighter = Math.max(l1, l2); const darker = Math.min(l1, l2);
  const ratio = (lighter + 0.05) / (darker + 0.05);
  const wcag = ratio >= 7 ? "AAA" : ratio >= 4.5 ? "AA" : ratio >= 3 ? "AA Large" : "Fail";
  return [`[COLOR] Contrast ratio ${hex1} / ${hex2}`, `  Ratio: ${ratio.toFixed(2)}:1`, `  WCAG : ${wcag}`];
}

// ════════════════════════════════════════════════════════════
// STATS COMMANDS
// ════════════════════════════════════════════════════════════

function parseNumbers(args: string[]): number[] | null {
  const nums = args.join(" ").split(/[\s,]+/).map(Number).filter(n => isFinite(n));
  return nums.length === 0 ? null : nums;
}

function cmdStat(op: string, args: string[]): string[] {
  const nums = parseNumbers(args);
  if (!nums) return [`Usage: stat.${op} <n1> <n2> ... — e.g. stat.mean 1 2 3 4 5`];
  const sorted = [...nums].sort((a, b) => a - b);
  const sum = nums.reduce((a, b) => a + b, 0);
  const mean = sum / nums.length;
  switch (op) {
    case "mean":    return [`[STAT] mean = ${mean.toFixed(6)}`];
    case "median": {
      const m = sorted.length % 2 === 0
        ? (sorted[sorted.length/2-1] + sorted[sorted.length/2]) / 2
        : sorted[Math.floor(sorted.length/2)];
      return [`[STAT] median = ${m.toFixed(6)}`];
    }
    case "std": {
      const variance = nums.reduce((a, b) => a + (b - mean)**2, 0) / nums.length;
      return [`[STAT] std = ${Math.sqrt(variance).toFixed(6)}`];
    }
    case "variance": {
      const variance = nums.reduce((a, b) => a + (b - mean)**2, 0) / nums.length;
      return [`[STAT] variance = ${variance.toFixed(6)}`];
    }
    case "min":   return [`[STAT] min = ${sorted[0]}`];
    case "max":   return [`[STAT] max = ${sorted[sorted.length - 1]}`];
    case "sum":   return [`[STAT] sum = ${sum}`];
    case "range": return [`[STAT] range = ${sorted[sorted.length-1] - sorted[0]}`];
    default:      return [`[STAT] Unknown op: ${op}`];
  }
}

function cmdStatHistogram(args: string[]): string[] {
  const nums = parseNumbers(args);
  if (!nums || nums.length < 2) return ["Usage: stat.histogram <n1> <n2> ...  (min 2 values)"];
  const min = Math.min(...nums), max = Math.max(...nums);
  const bins = Math.min(10, nums.length);
  const binSize = (max - min) / bins;
  const counts = new Array(bins).fill(0);
  for (const n of nums) {
    const idx = Math.min(Math.floor((n - min) / binSize), bins - 1);
    counts[idx]++;
  }
  const maxCount = Math.max(...counts);
  const lines = [`[STAT] Histogram (${nums.length} values, ${bins} bins):`];
  for (let i = 0; i < bins; i++) {
    const lo = min + i * binSize;
    const hi = lo + binSize;
    const bar = "█".repeat(Math.round((counts[i] / maxCount) * 20));
    lines.push(`  ${lo.toFixed(2).padStart(8)}-${hi.toFixed(2).padEnd(8)}  ${bar.padEnd(20)} ${counts[i]}`);
  }
  return lines;
}

function cmdStatPercentile(args: string[]): string[] {
  const p = parseFloat(args[0] ?? "");
  const nums = parseNumbers(args.slice(1));
  if (isNaN(p) || !nums) return ["Usage: stat.percentile <p> <n1> <n2> ..."];
  const sorted = [...nums].sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  const val = sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
  return [`[STAT] P${p} = ${val.toFixed(6)}`];
}

function cmdStatNormalize(args: string[]): string[] {
  const nums = parseNumbers(args);
  if (!nums) return ["Usage: stat.normalize <n1> <n2> ...  — min-max normalize to [0,1]"];
  const min = Math.min(...nums), max = Math.max(...nums);
  const range = max - min;
  const normalized = range === 0 ? nums.map(() => 0) : nums.map(n => (n - min) / range);
  return [`[STAT] Normalized: ${normalized.map(n => n.toFixed(4)).join(", ")}`];
}

function cmdStatZScore(args: string[]): string[] {
  const nums = parseNumbers(args);
  if (!nums) return ["Usage: stat.zscore <n1> <n2> ...  — z-score standardize"];
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  const std = Math.sqrt(nums.reduce((a, b) => a + (b - mean)**2, 0) / nums.length);
  if (std === 0) return ["[STAT] z-score: all values identical (std = 0)"];
  return [`[STAT] Z-scores: ${nums.map(n => ((n - mean) / std).toFixed(4)).join(", ")}`];
}

function cmdStatAll(args: string[]): string[] {
  const nums = parseNumbers(args);
  if (!nums || nums.length < 1) return ["Usage: stat.all <n1> <n2> ...  — full stats summary"];
  const sorted = [...nums].sort((a, b) => a - b);
  const sum = nums.reduce((a, b) => a + b, 0);
  const mean = sum / nums.length;
  const variance = nums.reduce((a, b) => a + (b - mean)**2, 0) / nums.length;
  const std = Math.sqrt(variance);
  const median = sorted.length % 2 === 0
    ? (sorted[sorted.length/2-1] + sorted[sorted.length/2]) / 2
    : sorted[Math.floor(sorted.length/2)];
  return [
    `[STAT] Summary (${nums.length} values):`,
    `  Min      : ${sorted[0]}`,
    `  Max      : ${sorted[sorted.length-1]}`,
    `  Range    : ${sorted[sorted.length-1] - sorted[0]}`,
    `  Sum      : ${sum}`,
    `  Mean     : ${mean.toFixed(6)}`,
    `  Median   : ${median.toFixed(6)}`,
    `  Variance : ${variance.toFixed(6)}`,
    `  Std Dev  : ${std.toFixed(6)}`,
    `  P25      : ${sorted[Math.floor(sorted.length * 0.25)]}`,
    `  P75      : ${sorted[Math.floor(sorted.length * 0.75)]}`,
  ];
}

// ════════════════════════════════════════════════════════════
// FETCH / WGET
// ════════════════════════════════════════════════════════════

async function cmdFetchGet(args: string[], state: TerminalState): Promise<string[]> {
  const url = args[0];
  if (!url) return [
    "Usage: fetch <url> [options]",
    "  --output <name>        store result key",
    "  --timeout <ms>         timeout (default 30000)",
    "  --retries <n>          retry count (default 3)",
    "  --limit-rate <B/s>     throttle rate",
    "  --user-agent <str>     custom User-Agent",
    "  --range-start <N>      resume from byte offset",
    "  --max-bytes <N>        quota guard",
    "  --user <u> --password  Basic auth",
    "  --no-redirect          don't follow redirects",
    "  --verbose              show all headers",
    "  --save                 browser file download",
  ];
  const flags = parseFlags(args.slice(1));
  const auth = flags["user"] && flags["password"]
    ? { user: flags["user"], password: flags["password"] } : undefined;
  const limitRate = flags["limit-rate"] ? parseRateString(flags["limit-rate"]) : undefined;
  const extraHeaders: Record<string, string> = {};
  if (flags["header"]) {
    const p = flags["header"].split(":");
    if (p.length >= 2) extraHeaders[p[0].trim()] = p.slice(1).join(":").trim();
  }
  const result = await wgetFetch({
    url, method: "GET", headers: extraHeaders,
    outputName: flags["output"],
    timeout: flags["timeout"] ? parseInt(flags["timeout"]) : undefined,
    retries: flags["retries"] ? parseInt(flags["retries"]) : undefined,
    limitRate, userAgent: flags["user-agent"],
    rangeStart: flags["range-start"] ? parseInt(flags["range-start"]) : undefined,
    maxBytes: flags["max-bytes"] ? parseBytes(flags["max-bytes"]) : undefined,
    auth, ifModifiedSince: flags["if-modified-since"],
    followRedirects: !("no-redirect" in flags),
    saveBlob: "save" in flags,
  });
  if (!result.ok) return formatFetchError(result.error);
  const resp = result.value;
  state.fetchStore.set(resp.outputName, resp.body);
  if ("save" in flags) saveBlobDownload(resp.body, resp.outputName, resp.contentType);
  const lines = formatFetchResponse(resp, "verbose" in flags);
  lines.push(`  Stored as: '${resp.outputName}'`);
  return lines;
}

async function cmdFetchHead(args: string[], _state: TerminalState): Promise<string[]> {
  const url = args[0];
  if (!url) return ["Usage: fetch.head <url> [--verbose]"];
  const flags = parseFlags(args.slice(1));
  const result = await wgetHead(url, {});
  if (!result.ok) return formatFetchError(result.error);
  const resp = result.value;
  const lines = [
    `[HEAD] ${resp.status} ${resp.statusText}  ${resp.url}`,
    `  Content-Type   : ${resp.contentType}`,
    `  Content-Length : ${resp.contentLength !== null ? formatBytes(resp.contentLength) : "unknown"}`,
    `  Range Support  : ${resp.rangeSupported ? "yes — resumable" : "no"}`,
    `  Last-Modified  : ${resp.lastModified ?? "not provided"}`,
    `  ETag           : ${resp.etag ?? "not provided"}`,
    `  Elapsed        : ${resp.elapsed_ms.toFixed(0)}ms`,
  ];
  if ("verbose" in flags) {
    lines.push("  Headers:");
    for (const [k, v] of Object.entries(resp.headers)) lines.push(`    ${k}: ${v}`);
  }
  return lines;
}

async function cmdFetchPost(args: string[], state: TerminalState): Promise<string[]> {
  const url = args[0]; const body = args[1];
  if (!url || !body) return ["Usage: fetch.post <url> <body> [--content-type application/json]"];
  const flags = parseFlags(args.slice(2));
  const result = await wgetPost(url, body, flags["content-type"] ?? "application/json");
  if (!result.ok) return formatFetchError(result.error);
  const resp = result.value;
  const outName = flags["output"] ?? resp.outputName;
  state.fetchStore.set(outName, resp.body);
  return [...formatFetchResponse(resp, "verbose" in flags), `  Stored as: '${outName}'`];
}

async function cmdFetchSpider(args: string[], _state: TerminalState): Promise<string[]> {
  const url = args[0];
  if (!url) return ["Usage: fetch.spider <url> [--depth 2] [--max-pages 50]"];
  const flags = parseFlags(args.slice(1));
  const visitLog: string[] = [`[SPIDER] Crawling ${url}...`];
  const result = await wgetSpider(
    url,
    flags["depth"] ? parseInt(flags["depth"]) : 2,
    flags["max-pages"] ? parseInt(flags["max-pages"]) : 50,
    (u, d) => visitLog.push(`  [d=${d}] ${u}`)
  );
  if (!result.ok) return formatFetchError(result.error);
  return [...visitLog.slice(0, 5), "  ...", ...formatSpiderResult(result.value)];
}

function cmdFetchShow(args: string[], state: TerminalState): string[] {
  const name = args[0];
  if (!name) {
    if (state.fetchStore.size === 0) return ["[FETCH] Store is empty. Run: fetch <url>"];
    return ["Usage: fetch.show <name> [--lines n] [--offset n]", ...cmdFetchList(state)];
  }
  const body = state.fetchStore.get(name);
  if (!body) return [`[ERROR] No fetch result '${name}'. Use fetch.list`];
  const flags = parseFlags(args.slice(1));
  const lineCount = flags["lines"] ? parseInt(flags["lines"]) : 40;
  const offset = flags["offset"] ? parseInt(flags["offset"]) : 0;
  const allLines = body.split("\n");
  const slice = allLines.slice(offset, offset + lineCount);
  return [
    `[FETCH SHOW] '${name}' (${allLines.length} lines, showing ${offset}–${offset + slice.length})`,
    ...slice.map(l => `  ${l}`),
    ...(allLines.length > offset + lineCount
      ? [`  ... ${allLines.length - offset - lineCount} more (--offset ${offset + lineCount})`]
      : []),
  ];
}

function cmdFetchSave(args: string[], state: TerminalState): string[] {
  const name = args[0];
  if (!name) return ["Usage: fetch.save <name> [filename]"];
  const body = state.fetchStore.get(name);
  if (!body) return [`[ERROR] No fetch result '${name}'`];
  saveBlobDownload(body, args[1] ?? name);
  return [`[FETCH] Download triggered: ${args[1] ?? name} (${formatBytes(new TextEncoder().encode(body).length)})`];
}

function cmdFetchLinks(args: string[], state: TerminalState): string[] {
  const name = args[0];
  if (!name) return ["Usage: fetch.links <name>"];
  const body = state.fetchStore.get(name);
  if (!body) return [`[ERROR] No fetch result '${name}'`];
  const links = extractLinks(body, "https://placeholder.local/");
  if (links.length === 0) return [`[LINKS] No links found in '${name}'`];
  const lines = [`[LINKS] '${name}' — ${links.length} links:`];
  links.forEach((l, i) => lines.push(`  ${String(i+1).padStart(3)}. ${l}`));
  return lines;
}

function cmdFetchList(state: TerminalState): string[] {
  if (state.fetchStore.size === 0) return ["[FETCH] Store empty. Run: fetch <url>"];
  const lines = [`[FETCH] Store (${state.fetchStore.size} entries):`];
  for (const [name, body] of state.fetchStore.entries()) {
    lines.push(`  ${name.padEnd(24)} ${formatBytes(new TextEncoder().encode(body).length)}`);
  }
  return lines;
}

function cmdFetchDrop(args: string[], state: TerminalState): string[] {
  const name = args[0];
  if (!name) return ["Usage: fetch.drop <name>"];
  const existed = state.fetchStore.has(name);
  state.fetchStore.delete(name);
  return [existed ? `[FETCH] Dropped: ${name}` : `[ERROR] '${name}' not in store`];
}

async function cmdFetchHeaders(args: string[], _state: TerminalState): Promise<string[]> {
  return cmdFetchHead([args[0], "--verbose"], _state);
}

// ════════════════════════════════════════════════════════════
// TENSOR COMMANDS
// ════════════════════════════════════════════════════════════

function cmdTensor(args: string[], state: TerminalState): string[] {
  if (args.length === 0) return ["Usage: tensor <name> [val1 val2 ...] [--shape M N] [--grad]"];
  const name = args[0];
  const flags = parseFlags(args.slice(1));
  const dataArgs = args.slice(1).filter(a => !a.startsWith("--") &&
    a !== flags["shape"] && a !== flags["shape"]?.split(" ")[1]);
  const requiresGrad = "grad" in flags;
  let shape: number[] | undefined;
  if (flags["shape"]) shape = flags["shape"].split(",").map(Number);

  if (dataArgs.length > 0) {
    const data = dataArgs.map(Number).filter(n => !isNaN(n));
    const sh = shape ?? [data.length];
    const t = new NanoTensor(data, sh, "f32", requiresGrad, name);
    state.tensors.set(name, t);
    return [`[TENSOR] ${name}: shape=[${sh}] data=[${data.map(v => v.toFixed(4)).join(", ")}]`];
  }

  const t = NanoTensor.randn([4], requiresGrad, name);
  state.tensors.set(name, t);
  return [`[TENSOR] ${name}: randn shape=[4] → [${Array.from(t.data as Float32Array).map(v => v.toFixed(4)).join(", ")}]`];
}

function cmdTensorRandn(args: string[], state: TerminalState): string[] {
  const [name, ...dims] = args;
  if (!name) return ["Usage: tensor.randn <name> <d1> [d2 ...]"];
  const shape = dims.map(Number).filter(n => !isNaN(n) && n > 0);
  if (shape.length === 0) shape.push(4);
  const t = NanoTensor.randn(shape, false, name);
  state.tensors.set(name, t);
  return [`[TENSOR] ${name}: randn [${shape}]  norm=${t.norm().toFixed(4)}`];
}

function cmdTensorZeros(args: string[], state: TerminalState): string[] {
  const [name, ...dims] = args;
  if (!name) return ["Usage: tensor.zeros <name> <d1> [d2 ...]"];
  const shape = dims.map(Number).filter(n => !isNaN(n) && n > 0);
  if (shape.length === 0) shape.push(4);
  const t = NanoTensor.zeros(shape, "f32", false);
  t.label = name;
  state.tensors.set(name, t);
  return [`[TENSOR] ${name}: zeros [${shape}]`];
}

function cmdTensorOnes(args: string[], state: TerminalState): string[] {
  const [name, ...dims] = args;
  if (!name) return ["Usage: tensor.ones <name> <d1> [d2 ...]"];
  const shape = dims.map(Number).filter(n => !isNaN(n) && n > 0);
  if (shape.length === 0) shape.push(4);
  const t = NanoTensor.ones(shape, "f32");
  t.label = name;
  state.tensors.set(name, t);
  return [`[TENSOR] ${name}: ones [${shape}]`];
}

function cmdTensorBinOp(op: "add" | "mul" | "matmul", args: string[], state: TerminalState): string[] {
  const [out, aName, bName] = args;
  if (!out || !aName || !bName) return [`Usage: tensor.${op} <out> <a> <b>`];
  const A = state.tensors.get(aName); const B = state.tensors.get(bName);
  if (!A) return [`[ERROR] Tensor '${aName}' not found`];
  if (!B) return [`[ERROR] Tensor '${bName}' not found`];
  try {
    const r = op === "add" ? A.add(B) : op === "mul" ? A.mul(B) : A.matmul(B);
    r.label = out;
    state.tensors.set(out, r);
    return [`[TENSOR] ${out} = ${aName} ${op} ${bName}  shape=[${r.shape}]  norm=${r.norm().toFixed(4)}`];
  } catch (e) { return [`[ERROR] ${(e as Error).message}`]; }
}

function cmdTensorScale(args: string[], state: TerminalState): string[] {
  const [out, name, sStr] = args;
  if (!out || !name || !sStr) return ["Usage: tensor.scale <out> <tensor> <scalar>"];
  const t = state.tensors.get(name);
  if (!t) return [`[ERROR] Tensor '${name}' not found`];
  const s = parseFloat(sStr);
  if (isNaN(s)) return ["[ERROR] scalar must be a number"];
  const r = t.scale(s);
  r.label = out;
  state.tensors.set(out, r);
  return [`[TENSOR] ${out} = ${name} * ${s}  norm=${r.norm().toFixed(4)}`];
}

function cmdTensorUnary(op: string, args: string[], state: TerminalState): string[] {
  const [out, name] = args;
  if (!out || !name) return [`Usage: tensor.${op} <out> <tensor>`];
  const t = state.tensors.get(name);
  if (!t) return [`[ERROR] Tensor '${name}' not found`];
  const opFns: Record<string, (t: NanoTensor) => NanoTensor> = {
    relu: t => t.relu(), tanh: t => t.tanh(),
    sigmoid: t => t.sigmoid(), softmax: t => t.softmax(),
  };
  const fn = opFns[op];
  if (!fn) return [`[ERROR] Unknown op: ${op}`];
  const r = fn(t);
  r.label = out;
  state.tensors.set(out, r);
  return [`[TENSOR] ${out} = ${op}(${name})  norm=${r.norm().toFixed(4)}`];
}

function cmdTensorBackward(args: string[], state: TerminalState): string[] {
  const [name] = args;
  if (!name) return ["Usage: tensor.backward <tensor>"];
  const t = state.tensors.get(name);
  if (!t) return [`[ERROR] Tensor '${name}' not found`];
  const corrId = cryptoUUID.generate();
  const result = executeBackward(t, corrId);
  if (!result.ok) {
    return [
      `[AUTOGRAD ERROR] [${result.error.code}] ${result.error.message}`,
      `  retry: ${result.error.retryClass}`,
    ];
  }
  return [
    ...formatBackwardResult(result.value),
    ...t._children.filter(c => c.grad).map(c => `  ${c.label || "(anon)"} grad.norm=${c.grad!.norm().toFixed(4)}`),
  ];
}

function cmdTensorGrad(args: string[], state: TerminalState): string[] {
  const [name] = args;
  if (!name) return ["Usage: tensor.grad <tensor>"];
  const t = state.tensors.get(name);
  if (!t) return [`[ERROR] Tensor '${name}' not found`];
  if (!t.grad) return [`[GRAD] ${name}: no gradient (call tensor.backward first)`];
  return [`[GRAD] ${name}.grad: shape=[${t.grad.shape}]  norm=${t.grad.norm().toFixed(4)}`];
}

function cmdTensorInfo(args: string[], state: TerminalState): string[] {
  const [name] = args;
  if (!name) return ["Usage: tensor.info <tensor>"];
  const t = state.tensors.get(name);
  if (!t) return [`[ERROR] Tensor '${name}' not found`];
  const arr = Array.from(t.data as Float32Array);
  return [
    `[TENSOR] ${name}:`,
    `  Shape      : [${t.shape}]`,
    `  DType      : ${t.dtype}`,
    `  Size       : ${t.size}`,
    `  RequiresGrad: ${t.requiresGrad}`,
    `  Norm       : ${t.norm().toFixed(6)}`,
    `  Mean       : ${t.mean().toFixed(6)}`,
    `  Min        : ${Math.min(...arr).toFixed(6)}`,
    `  Max        : ${Math.max(...arr).toFixed(6)}`,
    `  Op         : ${t._op || "(leaf)"}`,
    `  Data (first 12): [${arr.slice(0, 12).map(v => v.toFixed(4)).join(", ")}${arr.length > 12 ? "..." : ""}]`,
  ];
}

function cmdTensorList(state: TerminalState): string[] {
  if (state.tensors.size === 0) return ["[TENSOR] No tensors. Use: tensor.randn <name> <d1> [d2]"];
  const lines = [`[TENSOR] Tensors (${state.tensors.size}):`];
  for (const [name, t] of state.tensors.entries()) {
    lines.push(`  ${name.padEnd(20)} [${t.shape}]  dtype=${t.dtype}  norm=${t.norm().toFixed(4)}  grad=${t.requiresGrad}`);
  }
  return lines;
}

function cmdTensorNorm(args: string[], state: TerminalState): string[] {
  const [name] = args;
  if (!name) return ["Usage: tensor.norm <tensor>"];
  const t = state.tensors.get(name);
  if (!t) return [`[ERROR] Tensor '${name}' not found`];
  return [`[NORM] ${name}: L2 norm = ${t.norm().toFixed(6)}`];
}

function cmdTensorMSE(args: string[], state: TerminalState): string[] {
  const [out, pred, target] = args;
  if (!out || !pred || !target) return ["Usage: tensor.mse <out> <pred> <target>"];
  const P = state.tensors.get(pred); const T = state.tensors.get(target);
  if (!P) return [`[ERROR] Tensor '${pred}' not found`];
  if (!T) return [`[ERROR] Tensor '${target}' not found`];
  const loss = P.mseLoss(T);
  loss.label = out;
  state.tensors.set(out, loss);
  return [`[MSE] ${out} = mse(${pred}, ${target}) = ${(loss.data[0] as number).toFixed(6)}`];
}

// ════════════════════════════════════════════════════════════
// NETWORK COMMANDS
// ════════════════════════════════════════════════════════════

function cmdNetBuild(args: string[], state: TerminalState): string[] {
  const [name, arch, inDimStr] = args;
  if (!name || !arch) return ["Usage: net.build <name> <xor|regressor|classifier> [inDim]"];
  const inDim = inDimStr ? parseInt(inDimStr) : undefined;
  try {
    const net = buildNetwork(arch, inDim ?? 2);
    net.name = name;
    state.networks.set(name, net);
    const paramCount = net.params().reduce((s, p) => s + p.size, 0);
    return [
      `[NET] Built '${name}' (${arch})`,
      `  Params: ${paramCount}`,
      `  Layers: ${net.layers.length}`,
    ];
  } catch (e) { return [`[ERROR] ${(e as Error).message}`]; }
}

function cmdNetDescribe(args: string[], state: TerminalState): string[] {
  const [name] = args;
  if (!name) return ["Usage: net.describe <network>"];
  const net = state.networks.get(name);
  if (!net) return [`[ERROR] Network '${name}' not found`];
  const paramCount = net.params().reduce((s, p) => s + p.size, 0);
  const lines = [`[NET] ${name}:`, `  Layers: ${net.layers.length}  Params: ${paramCount}`];
  net.layers.forEach((l, i) => {
    lines.push(`  Layer ${i}: [${l.W.shape}] act=${l.activation}`);
  });
  return lines;
}

function cmdNetForward(args: string[], state: TerminalState): string[] {
  const [name, xName] = args;
  if (!name || !xName) return ["Usage: net.forward <network> <X_tensor>"];
  const net = state.networks.get(name);
  if (!net) return [`[ERROR] Network '${name}' not found`];
  const X = state.tensors.get(xName);
  if (!X) return [`[ERROR] Tensor '${xName}' not found`];
  try {
    const out = net.forward(X);
    const outName = `${name}_out`;
    state.tensors.set(outName, out);
    return [`[NET] forward(${name}, ${xName}) → ${outName} shape=[${out.shape}]`];
  } catch (e) { return [`[ERROR] ${(e as Error).message}`]; }
}

function cmdNetPredict(args: string[], state: TerminalState): string[] {
  const [name, xName] = args;
  if (!name || !xName) return ["Usage: net.predict <network> <X_tensor>"];
  const net = state.networks.get(name);
  if (!net) return [`[ERROR] Network '${name}' not found`];
  const X = state.tensors.get(xName);
  if (!X) return [`[ERROR] Tensor '${xName}' not found`];
  try {
    const preds = net.predict(X);
    return [`[PREDICT] ${name}(${xName}) =`, `  [${preds.map(v => v.toFixed(4)).join(", ")}]`];
  } catch (e) { return [`[ERROR] ${(e as Error).message}`]; }
}

function cmdNetList(state: TerminalState): string[] {
  if (state.networks.size === 0) return ["[NET] No networks. Use: net.build <name> <arch>"];
  const lines = [`[NET] Networks (${state.networks.size}):`];
  for (const [name, net] of state.networks.entries()) {
    const p = net.params().reduce((s, t) => s + t.size, 0);
    lines.push(`  ${name.padEnd(20)} layers=${net.layers.length}  params=${p}`);
  }
  return lines;
}

function cmdNetLossHistory(args: string[], state: TerminalState): string[] {
  const [name] = args;
  if (!name) return ["Usage: net.loss_history <network>"];
  const net = state.networks.get(name);
  if (!net) return [`[ERROR] Network '${name}' not found`];
  if (!net.lossHistory?.length) return [`[NET] ${name}: no loss history yet`];
  const hist = net.lossHistory;
  const maxLoss = Math.max(...hist);
  const lines = [`[NET] ${name} loss history (${hist.length} epochs):`];
  hist.slice(-20).forEach((loss, i) => {
    const bar = "█".repeat(Math.round((loss / maxLoss) * 30));
    lines.push(`  ${String(hist.length - 20 + i).padStart(4)}  ${bar.padEnd(30)}  ${loss.toFixed(6)}`);
  });
  return lines;
}

// ════════════════════════════════════════════════════════════
// ADAM COMMANDS
// ════════════════════════════════════════════════════════════

function cmdAdamCreate(args: string[], state: TerminalState): string[] {
  const [name, netName, lrStr, b1Str, b2Str] = args;
  if (!name || !netName) return ["Usage: adam.create <name> <network> [lr] [b1] [b2]"];
  const net = state.networks.get(netName);
  if (!net) return [`[ERROR] Network '${netName}' not found`];
  const lr = lrStr ? parseFloat(lrStr) : 0.001;
  const b1 = b1Str ? parseFloat(b1Str) : 0.9;
  const b2 = b2Str ? parseFloat(b2Str) : 0.999;
  const opt = new Adam(net.params(), { lr, beta1: b1, beta2: b2 });
  state.optimizers.set(name, opt);
  return [`[ADAM] Created '${name}' lr=${lr} β1=${b1} β2=${b2} params=${net.params().length}`];
}

function cmdAdamStep(args: string[], state: TerminalState): string[] {
  const [name] = args;
  if (!name) return ["Usage: adam.step <optimizer>"];
  const opt = state.optimizers.get(name);
  if (!opt) return [`[ERROR] Optimizer '${name}' not found`];
  const corrId = cryptoUUID.generate();
  const result = executeAdamStep(opt, corrId);
  if (!result.ok) return formatAdamStepError(result.error);
  return formatAdamStepResult(result.value);
}

function cmdAdamZeroGrad(args: string[], state: TerminalState): string[] {
  const [name] = args;
  if (!name) return ["Usage: adam.zero_grad <optimizer>"];
  const opt = state.optimizers.get(name);
  if (!opt) return [`[ERROR] Optimizer '${name}' not found`];
  opt.zeroGrad();
  return [`[ADAM] zero_grad(${name})`];
}

function cmdAdamInfo(args: string[], state: TerminalState): string[] {
  if (state.optimizers.size === 0) return ["[ADAM] No optimizers. Use: adam.create <name> <network>"];
  const name = args[0];
  if (!name) {
    const lines = [`[ADAM] Optimizers (${state.optimizers.size}):`];
    for (const [n, opt] of state.optimizers.entries()) {
      lines.push(`  ${n.padEnd(16)} t=${opt.t}  lr=${opt.lr}  params=${opt.params.length}`);
    }
    return lines;
  }
  const opt = state.optimizers.get(name);
  if (!opt) return [`[ERROR] Optimizer '${name}' not found`];
  return [
    `[ADAM] ${name}:`,
    `  Step (t)   : ${opt.t}`,
    `  LR         : ${opt.lr}`,
    `  Beta1      : ${opt.beta1}`,
    `  Beta2      : ${opt.beta2}`,
    `  Epsilon    : ${opt.epsilon}`,
    `  Params     : ${opt.params.length}`,
  ];
}

// ════════════════════════════════════════════════════════════
// REGISTER COMMANDS
// ════════════════════════════════════════════════════════════

function cmdRegSet(args: string[], state: TerminalState): string[] {
  const [reg, valStr] = args;
  if (!reg || !valStr) return ["Usage: reg.set <register> <value>"];
  const val = parseFloat(valStr);
  if (isNaN(val)) return ["[ERROR] value must be a number"];
  state.registers.setGPR(reg.toLowerCase(), val);
  return [`[REG] ${reg.toLowerCase()} = ${val}`];
}

function cmdRegGet(args: string[], state: TerminalState): string[] {
  const [reg] = args;
  if (!reg) return ["Usage: reg.get <register>"];
  try {
    const val = state.registers.getGPR(reg.toLowerCase());
    return [`[REG] ${reg.toLowerCase()} = ${val}`];
  } catch (e) { return [`[ERROR] ${(e as Error).message}`]; }
}

function cmdRegPush(args: string[], state: TerminalState): string[] {
  const [reg] = args;
  if (!reg) return ["Usage: reg.push <register>"];
  try {
    const val = state.registers.getGPR(reg.toLowerCase());
    state.registers.push(val);
    return [`[STACK] PUSH ${reg.toLowerCase()}=${val}  RSP=${state.registers.getGPR("rsp")}`];
  } catch (e) { return [`[ERROR] ${(e as Error).message}`]; }
}

function cmdRegPop(args: string[], state: TerminalState): string[] {
  const [reg] = args;
  if (!reg) return ["Usage: reg.pop <register>"];
  try {
    const val = state.registers.pop();
    state.registers.setGPR(reg.toLowerCase(), val);
    return [`[STACK] POP → ${reg.toLowerCase()}=${val}  RSP=${state.registers.getGPR("rsp")}`];
  } catch (e) { return [`[ERROR] ${(e as Error).message}`]; }
}

function cmdRegCmp(args: string[], state: TerminalState): string[] {
  const [a, b] = args;
  if (!a || !b) return ["Usage: reg.cmp <regA|val> <regB|val>"];
  const av = parseFloat(a); const bv = parseFloat(b);
  const A = isNaN(av) ? state.registers.getGPR(a.toLowerCase()) : BigInt(Math.trunc(av));
  const B = isNaN(bv) ? state.registers.getGPR(b.toLowerCase()) : BigInt(Math.trunc(bv));
  state.registers.cmp(A as bigint, B as bigint);
  return [
    `[CMP] ${a}=${A} vs ${b}=${B}`,
    `  ZF=${state.registers.getFlag("ZF")?1:0}  SF=${state.registers.getFlag("SF")?1:0}  CF=${state.registers.getFlag("CF")?1:0}  OF=${state.registers.getFlag("OF")?1:0}`,
    `  ${A === B ? "EQUAL" : A < B ? "A < B" : "A > B"}`,
  ];
}

function cmdRegXMM(args: string[], state: TerminalState): string[] {
  const [reg, ...vals] = args;
  if (!reg) return ["Usage: reg.xmm <reg> [f1 f2 f3 f4]  — get/set XMM register (4×f32)"];
  if (vals.length === 4) {
    const floats = vals.map(Number) as [number, number, number, number];
    state.registers.setXMM(reg.toLowerCase(), floats);
    return [`[XMM] ${reg.toLowerCase()} = [${floats.join(", ")}]`];
  }
  const xmm = state.registers.getXMM(reg.toLowerCase());
  return [`[XMM] ${reg.toLowerCase()} = [${Array.from(xmm).join(", ")}]`];
}

function cmdRegYMM(args: string[], state: TerminalState): string[] {
  const [reg, ...vals] = args;
  if (!reg) return ["Usage: reg.ymm <reg> [f1..f8]  — get/set YMM register (8×f32)"];
  if (vals.length === 8) {
    const floats = vals.map(Number) as [number,number,number,number,number,number,number,number];
    state.registers.setYMM(reg.toLowerCase(), floats);
    return [`[YMM] ${reg.toLowerCase()} = [${floats.join(", ")}]`];
  }
  const ymm = state.registers.getYMM(reg.toLowerCase());
  return [`[YMM] ${reg.toLowerCase()} = [${Array.from(ymm).join(", ")}]`];
}

function cmdRegSIMDDot(args: string[], state: TerminalState): string[] {
  const [a, b] = args;
  if (!a || !b) return ["Usage: reg.simd.dot <xmm_a> <xmm_b>"];
  const dot = state.registers.simdDot(a.toLowerCase(), b.toLowerCase());
  return [`[SIMD] DPPS ${a}·${b} = ${dot}`];
}

function cmdRegVADDPS(args: string[], state: TerminalState): string[] {
  const [dst, src1, src2] = args;
  if (!dst || !src1 || !src2) return ["Usage: reg.simd.vaddps <dst> <src1> <src2>"];
  state.registers.vaddps(dst.toLowerCase(), src1.toLowerCase(), src2.toLowerCase());
  const result = state.registers.getYMM(dst.toLowerCase());
  return [`[SIMD] VADDPS ${dst} = ${src1} + ${src2} = [${Array.from(result).join(", ")}]`];
}

function cmdRegVMULPS(args: string[], state: TerminalState): string[] {
  const [dst, src1, src2] = args;
  if (!dst || !src1 || !src2) return ["Usage: reg.simd.vmulps <dst> <src1> <src2>"];
  state.registers.vmulps(dst.toLowerCase(), src1.toLowerCase(), src2.toLowerCase());
  const result = state.registers.getYMM(dst.toLowerCase());
  return [`[SIMD] VMULPS ${dst} = ${src1} * ${src2} = [${Array.from(result).join(", ")}]`];
}

// ════════════════════════════════════════════════════════════
// TREE LOGIC
// ════════════════════════════════════════════════════════════

const loadedTrees = new Map<string, ReturnType<typeof buildExampleTree>>();

function cmdTreeLoad(args: string[], _state: TerminalState): string[] {
  const [varName, treeName] = args;
  if (!varName || !treeName) return ["Usage: tree.load <var> <modus_ponens|neural_valid|xor_decision|default>"];
  try {
    const tree = buildExampleTree(treeName);
    loadedTrees.set(varName, tree);
    return [`[TREE] Loaded '${treeName}' as '${varName}'`];
  } catch (e) { return [`[ERROR] ${(e as Error).message}`]; }
}

function cmdTreeEval(args: string[], _state: TerminalState): string[] {
  const [varName] = args;
  if (!varName) return ["Usage: tree.eval <var>  — evaluate loaded tree"];
  const tree = loadedTrees.get(varName);
  if (!tree) return [`[ERROR] Tree '${varName}' not loaded. Use tree.load first.`];
  const result = evaluate(tree);
  return [
    `[TREE] eval('${varName}')`,
    `  Conclusion : ${result.conclusion}`,
    `  Confidence : ${(result.confidence * 100).toFixed(1)}%`,
    ...result.trace.map(t => `  ${t}`),
  ];
}

function cmdTreeChain(args: string[], _state: TerminalState): string[] {
  const [varName, goal] = args;
  if (!varName || !goal) return ["Usage: tree.chain <var> <goal>"];
  const tree = loadedTrees.get(varName);
  if (!tree) return [`[ERROR] Tree '${varName}' not loaded`];
  const chain = backwardChain(tree, new Map([[goal, true as const]]));
  return [`[BACKWARD] Chain for goal='${goal}':`, ...chain.map(s => `  ${s}`)];
}

function cmdTreePrint(args: string[], _state: TerminalState): string[] {
  const [varName] = args;
  if (!varName) return ["Usage: tree.print <var>"];
  const tree = loadedTrees.get(varName);
  if (!tree) return [`[ERROR] Tree '${varName}' not loaded`];
  return [printTree(tree)];
}

// ════════════════════════════════════════════════════════════
// CA COMMANDS
// ════════════════════════════════════════════════════════════

function cmdCA(args: string[], _state: TerminalState): string[] {
  const mode = (args[0] ?? "full") as import("./CAChain").CAMode;
  const validModes = ["analyze","correct","dag","audit","step","full"];
  if (!validModes.includes(mode)) {
    return [
      "Usage: ca <mode> <source> [--lang python|js|html|css] [--gen N]",
      "  Modes: analyze | correct | dag | audit | step | full",
    ];
  }
  const remaining = args.slice(1);
  const flags: Record<string, string> = {};
  const sourceParts: string[] = [];
  for (let i = 0; i < remaining.length; i++) {
    if (remaining[i] === "--lang" && remaining[i+1]) flags["lang"] = remaining[++i];
    else if (remaining[i] === "--gen" && remaining[i+1]) flags["gen"] = remaining[++i];
    else sourceParts.push(remaining[i]);
  }
  const source = sourceParts.join(" ");
  if (!source.trim()) return [`[CA] Mode '${mode}' requires source code in quotes.`];
  const lang = flags["lang"] as import("./CASyntax").Language | undefined;
  const corrId = cryptoUUID.generate();
  const result = _executeCAChain({ source, lang, mode, maxGenerations: flags["gen"] ? parseInt(flags["gen"]) : 8 }, corrId);
  if (!result.ok) return _formatCAError(result.error);
  return result.value.displayLines;
}

function cmdCADetect(args: string[]): string[] {
  const source = args.join(" ");
  if (!source.trim()) return ["Usage: ca.detect <source>"];
  return [`[CA] Detected language: ${_detectLanguage(source)}`];
}

function cmdCATokenize(args: string[]): string[] {
  const source = args.join(" ");
  if (!source.trim()) return ["Usage: ca.tokenize <source>"];
  try {
    const { grid, errors } = _caTokenize(source);
    const stats = _computeGridStats(grid);
    const lines = [
      `[CA] Tokenized: ${stats.totalCells} cells  lang=${grid.lang}`,
      `  Alive=${stats.alive}  Error=${stats.error}  Mutating=${stats.mutating}`,
      `  Avg entropy=${stats.avgEntropy.toFixed(4)}`,
    ];
    if (errors.length > 0) lines.push(`  Errors: ${errors.join(", ")}`);
    const visible = grid.cells.filter(c => c.type !== "WHITESPACE").slice(0, 20);
    visible.forEach(c => lines.push(`  [${c.type.padEnd(10)}] '${c.token.slice(0,20).padEnd(20)}' S=${c.state} E=${c.entropy.toFixed(3)}`));
    return lines;
  } catch (e) { return [`[CA ERROR] ${e instanceof Error ? e.message : String(e)}`]; }
}

// ════════════════════════════════════════════════════════════
// DEMO + BENCHMARK
// ════════════════════════════════════════════════════════════

function cmdDemo(args: string[], state: TerminalState): string[] {
  const which = args[0]?.toLowerCase();
  if (!which) return [
    "[DEMO] Available demos:",
    "  demo xor        — XOR problem with MLP + Adam",
    "  demo tree       — Tree-Logic inference chain",
    "  demo registers  — x86_64 SIMD operations",
    "  demo adam       — Adam optimizer convergence f(x)=(x-3)^2",
    "  demo fetch      — HTTP fetch command examples",
    "  demo math       — Math command showcase",
    "  demo pipe       — Pipe chaining examples",
    "  demo stat       — Statistics commands showcase",
    "  demo color      — Color conversion showcase",
    "  demo alias      — Alias system showcase",
  ];

  const output: string[] = [];

  if (which === "xor") {
    output.push("[DEMO] XOR Problem — MLP + Adam");
    const X = new NanoTensor([0,0,0,1,1,0,1,1],[4,2],"f32",true,"X_xor");
    const Y = new NanoTensor([0,1,1,0],[4,1],"f32",false,"Y_xor");
    state.tensors.set("X_xor", X); state.tensors.set("Y_xor", Y);
    const net = buildNetwork("xor", 2); net.name = "xor_demo";
    state.networks.set("xor_demo", net);
    const opt = new Adam(net.params(), { lr: 0.05 });
    state.optimizers.set("opt_xor", opt);
    const corrId = cryptoUUID.generate();
    const result = executeTrainChain({ networkName:"xor_demo",xTensorName:"X_xor",yTensorName:"Y_xor",optimizerName:"opt_xor",epochs:200,logEveryN:40 }, state, corrId);
    if (result.ok) {
      output.push(...formatTrainResult(result.value));
      const preds = net.predict(X);
      output.push("  Predictions:"); [[0,0],[0,1],[1,0],[1,1]].forEach(([a,b],i) => {
        output.push(`    [${a},${b}] → ${fmt(preds[i],4)}  (expected ${[0,1,1,0][i]})`);
      });
    } else output.push(...formatTrainError(result.error));

  } else if (which === "tree") {
    output.push("[DEMO] Tree-Logic: Neural Network Validity Check");
    const tree = buildExampleTree("neural_valid");
    const result = evaluate(tree);
    output.push(printTree(tree));
    output.push(`  Conclusion: ${result.conclusion}  Confidence: ${(result.confidence * 100).toFixed(1)}%`);
    output.push(...result.trace);

  } else if (which === "registers") {
    output.push("[DEMO] x86_64 SIMD Operations");
    state.registers.setXMM("xmm0",[1.0,2.0,3.0,4.0]); state.registers.setXMM("xmm1",[4.0,3.0,2.0,1.0]);
    const dot = state.registers.simdDot("xmm0","xmm1");
    output.push(`  DPPS xmm0·xmm1 = ${dot}  (expected 20.0)`);
    state.registers.setYMM("ymm0",[1,2,3,4,5,6,7,8]); state.registers.setYMM("ymm1",[8,7,6,5,4,3,2,1]);
    state.registers.vaddps("ymm0","ymm0","ymm1");
    output.push(`  VADDPS ymm0+ymm1 = [${Array.from(state.registers.getYMM("ymm0")).join(", ")}]  (all 9s)`);

  } else if (which === "adam") {
    output.push("[DEMO] Adam Optimizer: minimize f(x) = (x-3)^2");
    const x = new NanoTensor([0.0],[1],"f32",true,"x_param");
    state.tensors.set("x_param", x);
    const opt = new Adam([x], { lr: 0.1 });
    for (let step = 0; step < 50; step++) {
      x.zeroGrad();
      if (!x.grad) x.grad = NanoTensor.zeros([1]);
      x.grad.data[0] = 2 * ((x.data[0] as number) - 3);
      opt.step();
      if (step % 10 === 0) output.push(`  step ${step}: x=${fmt(x.data[0] as number,4)} f(x)=${fmt((x.data[0] as number - 3)**2,4)}`);
    }
    output.push(`  Final x=${fmt(x.data[0] as number,6)}  (target=3.0)`);

  } else if (which === "fetch") {
    output.push("[DEMO] HTTP / Fetch commands — run these:");
    ["fetch https://httpbin.org/get","fetch https://httpbin.org/headers --verbose",
     "fetch.head https://httpbin.org/get","fetch.post https://httpbin.org/post data",
     "fetch.spider https://example.com --depth 1","fetch.list"].forEach(c => output.push(`  ${c}`));

  } else if (which === "math") {
    output.push("[DEMO] Math commands:");
    [["calc 2 ** 10", "1024"],["math.sin 1.5708","~1.0"],["math.fib 12","fib sequence"],
     ["math.primes 30","primes"],["math.gcd 48 18","6"],["math.hex 255","0xFF"]
    ].forEach(([cmd, desc]) => output.push(`  ${cmd.padEnd(24)} — ${desc}`));

  } else if (which === "pipe") {
    output.push("[DEMO] Pipe chaining — run these:");
    ["tensor.list | grep xor","stat.all 1 2 3 4 5 | grep mean",
     "sysinfo | grep Tensor","history | tail 5",
     "tensor.list | sort | head 3",
    ].forEach(c => output.push(`  ${c}`));

  } else if (which === "stat") {
    output.push("[DEMO] Statistics:");
    const nums = "1 4 9 16 25 36 49 64 81 100";
    output.push(...cmdStatAll(nums.split(" ")));

  } else if (which === "color") {
    output.push("[DEMO] Color commands:");
    output.push(...cmdColorHex(["#4ade80"]));
    output.push(...cmdColorContrast(["#4ade80","#000000"]));
    output.push(...cmdColorPalette(["#7aa2f7"]));

  } else if (which === "alias") {
    output.push("[DEMO] Aliases:");
    output.push(...cmdAliasSet(["ll","tensor.list"], state));
    output.push(...cmdAliasSet(["nls","net.list"], state));
    output.push(...cmdAliasList(state));
    output.push("  Now type 'll' to run tensor.list");

  } else {
    output.push(`[ERROR] Unknown demo: '${which}'. Try: demo xor|tree|registers|adam|fetch|math|pipe|stat|color|alias`);
  }

  return output;
}

function cmdBenchmark(_state: TerminalState): string[] {
  const output: string[] = ["[BENCHMARK] NanoTensor Performance"];
  const cases: Array<[string, () => void]> = [
    ["matmul [64x64]",    () => { NanoTensor.randn([64,64]).matmul(NanoTensor.randn([64,64])); }],
    ["matmul [128x128]",  () => { NanoTensor.randn([128,128]).matmul(NanoTensor.randn([128,128])); }],
    ["fwd+bwd [1000]",    () => { const e = NanoTensor.randn([1000],true); e.mul(NanoTensor.randn([1000],true)).relu().tanh().backward(); }],
    ["MLP 50 epochs",     () => { const net = buildNetwork("regressor",16); const X = NanoTensor.randn([32,16],true); const Y = NanoTensor.randn([32,1]); net.train(X,Y,new Adam(net.params(),{lr:0.001}),50); }],
    ["hash.all x1000",    () => { for (let i = 0; i < 1000; i++) fnv1a("benchmark_test_string_" + i); }],
    ["stat.all [10000]",  () => { const nums = Array.from({length:1000},(_,i)=>String(i)); cmdStatAll(nums); }],
  ];
  for (const [label, fn] of cases) {
    const t0 = performance.now();
    fn();
    output.push(`  ${label.padEnd(24)} ${(performance.now() - t0).toFixed(2)}ms`);
  }
  return output;
}

// ════════════════════════════════════════════════════════════
// NET TRAIN V2 (contracted chain)
// ════════════════════════════════════════════════════════════

function cmdNetTrainV2(args: string[], state: TerminalState): string[] {
  const [netName, xName, yName, optName, epochsStr, ...flags] = args;
  if (!netName || !xName || !yName || !optName) {
    return ["Usage: net.train <net> <X> <Y> <optimizer> <epochs> [--maxgrad F] [--logn N] [--ikey K]"];
  }
  const epochs = parseInt(epochsStr ?? "10");
  let maxGradNorm = 10.0, logEveryN: number | undefined, iKey: string | undefined;
  for (let i = 0; i < flags.length; i++) {
    if (flags[i] === "--maxgrad" && flags[i+1]) maxGradNorm = parseFloat(flags[++i]);
    if (flags[i] === "--logn" && flags[i+1]) logEveryN = parseInt(flags[++i]);
    if (flags[i] === "--ikey" && flags[i+1]) iKey = flags[++i];
  }
  const correlationId = cryptoUUID.generate();
  const result = executeTrainChain({
    networkName: netName, xTensorName: xName, yTensorName: yName,
    optimizerName: optName, epochs, maxGradNorm, logEveryN, idempotencyKey: iKey,
  }, state, correlationId);
  return result.ok ? formatTrainResult(result.value) : formatTrainError(result.error);
}

// ════════════════════════════════════════════════════════════
// OBSERVABILITY + DETERMINISM + TEST
// ════════════════════════════════════════════════════════════

function cmdLogs(): string[] {
  const lines = drainToLines();
  return lines.length === 0 ? ["[LOGS] Log buffer empty."] : ["[LOGS] Structured logs:", ...lines];
}

function cmdSeed(args: string[]): string[] {
  const seed = parseInt(args[0] ?? "");
  if (isNaN(seed)) return ["Usage: seed <integer>"];
  seedGlobalRNG(seed);
  return [`[RNG] Seeded with ${seed} — next randn() calls are deterministic.`];
}

function cmdTest(args: string[]): string[] {
  const suite = args[0] ?? "train";
  if (suite === "train") return runTrainChainTests();
  return [`[TEST] Unknown suite '${suite}'. Available: train`];
}

function cmdSysinfo(): string[] {
  return [
    "╔══════════════════════════════════════════════════════════╗",
    "║         x86_64 Neural Terminal v4.0.0                    ║",
    "╠══════════════════════════════════════════════════════════╣",
    "║  Architecture  : x86_64                                  ║",
    "║  ISA           : SSE4.2 + AVX2 (simulated)               ║",
    "║  Tensor Engine : NanoTensor (f32/f64/i32, autograd)      ║",
    "║  Optimizer     : Adam (AMSGrad, bias-corrected)          ║",
    "║  Neural Net    : MLP (ReLU/Tanh/Sigmoid, He/Xavier init) ║",
    "║  Reasoning     : Tree-Logic (AND/OR/NOT/IMPLY/XOR)       ║",
    "║  HTTP Engine   : WgetEngine (GET/HEAD/POST/Spider/Range) ║",
    "║  CA Editor     : CellularAutomaton (Python/JS/HTML/CSS)  ║",
    "╠══════════════════════════════════════════════════════════╣",
    "║  NEW in v4.0:                                            ║",
    "║  Math          : calc, math.*, fib, primes, factors      ║",
    "║  JSON          : json.parse/format/get/keys/validate     ║",
    "║  Strings       : str.upper/lower/split/replace/pad/...   ║",
    "║  Base64        : base64.encode/decode/url                ║",
    "║  Hash          : djb2/fnv1a/sdbm/crc32                   ║",
    "║  Time          : time.now/stamp/format/since/perf        ║",
    "║  Variables     : var.set/get/list/del/inc/dec            ║",
    "║  Aliases       : alias / alias.list / alias.del          ║",
    "║  Pipe Chains   : cmd1 | grep | sort | head | tail        ║",
    "║  Matrix        : matrix.create/add/mul/det/transpose     ║",
    "║  Color         : color.hex/rgb/hsl/mix/palette/contrast  ║",
    "║  Stats         : stat.mean/std/histogram/percentile/...  ║",
    "║  Utils         : uuid, ascii, grep, sort, uniq, wc       ║",
    "╚══════════════════════════════════════════════════════════╝",
  ];
}

function helpText(): string[] {
  return [
    "╔═══════════════════════════════════════════════════════════════════╗",
    "║          x86_64 NEURAL TERMINAL v4.0 — COMMAND REFERENCE         ║",
    "╠═══════════════════════════════════════════════════════════════════╣",
    "║ TENSOR    tensor tensor.randn/zeros/ones/add/mul/matmul/scale     ║",
    "║           tensor.relu/tanh/sigmoid/softmax/backward/grad/info    ║",
    "║           tensor.list/norm/mse                                   ║",
    "╠═══════════════════════════════════════════════════════════════════╣",
    "║ NETWORK   net.build net.train net.forward net.predict            ║",
    "║           net.describe net.list net.loss_history                 ║",
    "╠═══════════════════════════════════════════════════════════════════╣",
    "║ ADAM      adam.create adam.step adam.zero_grad adam.info         ║",
    "╠═══════════════════════════════════════════════════════════════════╣",
    "║ REGISTERS reg.set/get/dump/push/pop/cmp/xmm/ymm                 ║",
    "║           reg.simd.dot/vaddps/vmulps                            ║",
    "╠═══════════════════════════════════════════════════════════════════╣",
    "║ TREE      tree.load/eval/chain/print/list                       ║",
    "╠═══════════════════════════════════════════════════════════════════╣",
    "║ HTTP      fetch fetch.get/head/post/spider/show/save/links      ║",
    "║           fetch.list/drop/headers  wget wget.spider             ║",
    "╠═══════════════════════════════════════════════════════════════════╣",
    "║ MATH      calc math.eval sin/cos/tan/sqrt/log/exp/abs           ║",
    "║           math.pow/fib/primes/factors/gcd/lcm/hex/bin/oct      ║",
    "╠═══════════════════════════════════════════════════════════════════╣",
    "║ JSON      json.parse/format/get/keys/validate/minify            ║",
    "╠═══════════════════════════════════════════════════════════════════╣",
    "║ STRINGS   str.upper/lower/reverse/length/split/replace/trim     ║",
    "║           str.contains/count/repeat/pad/slice/words/lines       ║",
    "╠═══════════════════════════════════════════════════════════════════╣",
    "║ BASE64    base64.encode/decode/url                              ║",
    "╠═══════════════════════════════════════════════════════════════════╣",
    "║ HASH      hash.djb2/fnv/sdbm/crc32/all                         ║",
    "╠═══════════════════════════════════════════════════════════════════╣",
    "║ TIME      time.now/stamp/ms/format/since/perf                   ║",
    "╠═══════════════════════════════════════════════════════════════════╣",
    "║ VARS      var.set/get/list/del/clear/inc/dec                    ║",
    "╠═══════════════════════════════════════════════════════════════════╣",
    "║ ALIASES   alias <name> <cmd>  alias.list  alias.del             ║",
    "╠═══════════════════════════════════════════════════════════════════╣",
    "║ PIPE      cmd | grep <re> | sort | uniq | head | tail | wc      ║",
    "║           cmd | str.upper | rev | tee <var>                     ║",
    "╠═══════════════════════════════════════════════════════════════════╣",
    "║ MATRIX    matrix.create/add/mul/det/transpose/identity/show     ║",
    "╠═══════════════════════════════════════════════════════════════════╣",
    "║ COLOR     color.hex/rgb/hsl/mix/palette/contrast                ║",
    "╠═══════════════════════════════════════════════════════════════════╣",
    "║ STATS     stat.mean/median/std/variance/min/max/sum/range       ║",
    "║           stat.histogram/percentile/normalize/zscore/all        ║",
    "╠═══════════════════════════════════════════════════════════════════╣",
    "║ CA EDITOR ca ca.analyze/correct/dag/audit/step/full             ║",
    "║           ca.detect  ca.tokenize  ca.editor                     ║",
    "╠═══════════════════════════════════════════════════════════════════╣",
    "║ UTILS     uuid [n]  ascii  grep  sort  wc  uniq  head  tail     ║",
    "║           rev  tee  pipe  echo  history  seed                   ║",
    "╠═══════════════════════════════════════════════════════════════════╣",
    "║ SYSTEM    demo sysinfo benchmark reset clear logs test          ║",
    "╚═══════════════════════════════════════════════════════════════════╝",
  ];
}

export { renderProgress };

// ════════════════════════════════════════════════════════════
// PERF ENGINE COMMANDS (implementations)
// ════════════════════════════════════════════════════════════

function cmdPerfCache(state: TerminalState): string[] {
  return [
    ...state.perf.l1.render(),
    ...state.perf.l2.render(),
    ...state.perf.l3.render(),
  ];
}

function cmdPerfFull(state: TerminalState): string[] {
  return [
    "[PERF] Full Performance Report",
    ...state.perf.l1.render(),
    ...state.perf.l2.render(),
    ...state.perf.l3.render(),
    ...state.perf.pipeline.render(),
    ...state.perf.branchPredictor.render(),
    ...state.perf.vmem.render(),
    ...renderSIMDTable(),
  ];
}

function cmdPerfAccess(args: string[], state: TerminalState): string[] {
  const [addrStr] = args;
  const addr = parseInt(addrStr ?? "0", 16) || parseInt(addrStr ?? "0");
  if (isNaN(addr)) return ["Usage: perf.access <addr_hex>"];
  try {
    const result = state.perf.l1.access(addr);
    return [
      `[PERF] L1 cache access: 0x${addr.toString(16).toUpperCase()}`,
      `  Hit: ${result.hit}  Latency: ${result.latency} cycles`,
      ...state.perf.l1.render().slice(0, 3),
    ];
  } catch (e) {
    return [`[PERF] Access error: ${(e as Error).message}`];
  }
}

function cmdPerfMalloc(args: string[], state: TerminalState): string[] {
  const [sizeStr] = args;
  const size = parseInt(sizeStr ?? "64");
  if (isNaN(size) || size <= 0) return ["Usage: perf.malloc <size_bytes>"];
  try {
    const addr = state.perf.vmem.malloc(size);
    return [`[PERF] malloc(${size}) → 0x${addr.toString(16).toUpperCase()}`];
  } catch (e) {
    return [`[PERF] malloc error: ${(e as Error).message}`];
  }
}

function cmdPerfFree(args: string[], state: TerminalState): string[] {
  const [addrStr] = args;
  const addr = parseInt(addrStr ?? "0", 16) || parseInt(addrStr ?? "0");
  if (isNaN(addr)) return ["Usage: perf.free <addr_hex>"];
  try {
    state.perf.vmem.free(addr);
    return [`[PERF] free(0x${addr.toString(16).toUpperCase()}) — OK`];
  } catch (e) {
    return [`[PERF] free error: ${(e as Error).message}`];
  }
}

function cmdPerfBranchSim(args: string[], state: TerminalState): string[] {
  const [pcStr, takenStr] = args;
  if (!pcStr) return ["Usage: perf.branch.sim <pc_hex> <taken:0|1>"];
  const pc = parseInt(pcStr, 16) || parseInt(pcStr);
  const taken = takenStr === "1" || takenStr === "true";
  try {
    const prediction = state.perf.branchPredictor.predict(pc);
    const result = state.perf.branchPredictor.update(pc, taken);
    return [
      `[PERF] Branch PC=0x${pc.toString(16).toUpperCase()} actually_taken=${taken}`,
      `  Predicted : ${prediction}`,
      `  Outcome   : ${result}`,
      ...state.perf.branchPredictor.render().slice(0, 4),
    ];
  } catch (e) {
    return [`[PERF] Branch sim error: ${(e as Error).message}`];
  }
}

function cmdPerfPipelineIssue(args: string[], state: TerminalState): string[] {
  const instrType = args[0] ?? "alu";
  try {
    const result = state.perf.pipeline.issue(instrType);
    return [
      `[PERF] Issue ${instrType} → ${JSON.stringify(result)}`,
      ...state.perf.pipeline.render().slice(0, 4),
    ];
  } catch (e) {
    return [`[PERF] Pipeline issue error: ${(e as Error).message}`];
  }
}

function cmdPerfPipelineTick(state: TerminalState): string[] {
  try {
    state.perf.pipeline.tick();
    return [`[PERF] Pipeline tick`, ...state.perf.pipeline.render().slice(0, 4)];
  } catch (e) {
    return [`[PERF] Pipeline tick error: ${(e as Error).message}`];
  }
}

// ════════════════════════════════════════════════════════════
// VIZ COMMANDS (implementations)
// ════════════════════════════════════════════════════════════

function cmdVizNet(args: string[], state: TerminalState): string[] {
  const [name] = args;
  if (!name) return ["Usage: viz.net <network>"];
  const net = state.networks.get(name);
  if (!net) return [`[ERROR] Network '${name}' not found`];
  return renderNetworkTopology(net);
}

function cmdVizLoss(args: string[], state: TerminalState): string[] {
  const [name] = args;
  if (!name) return ["Usage: viz.loss <network>"];
  const net = state.networks.get(name);
  if (!net) return [`[ERROR] Network '${name}' not found`];
  return renderLossCurve(net.lossHistory ?? []);
}

function cmdVizWeights(args: string[], state: TerminalState): string[] {
  const [name, layerStr] = args;
  if (!name) return ["Usage: viz.weights <network> [layer_index]"];
  const net = state.networks.get(name);
  if (!net) return [`[ERROR] Network '${name}' not found`];
  const layerIdx = layerStr !== undefined ? parseInt(layerStr) : 0;
  const idx = isNaN(layerIdx) ? 0 : layerIdx;
  if (!net.layers[idx]) return [`[ERROR] Layer ${idx} not found in '${name}'`];
  return renderWeightHeatmap(net.layers[idx].W, `${name}.layers[${idx}].W`);
}

function cmdVizGradients(args: string[], state: TerminalState): string[] {
  const [name] = args;
  if (!name) return ["Usage: viz.gradients <network>"];
  const net = state.networks.get(name);
  if (!net) return [`[ERROR] Network '${name}' not found`];
  return renderGradientFlow(net);
}

function cmdVizActivations(args: string[], state: TerminalState): string[] {
  const [name, xName] = args;
  if (!name || !xName) return ["Usage: viz.activations <network> <X_tensor>"];
  const net = state.networks.get(name);
  if (!net) return [`[ERROR] Network '${name}' not found`];
  const X = state.tensors.get(xName);
  if (!X) return [`[ERROR] Tensor '${xName}' not found`];
  try {
    const out = net.forward(X);
    const activations = Array.from(out.data as Float32Array);
    return renderActivationMap(activations, `${name}(${xName})`);
  } catch (e) { return [`[ERROR] ${(e as Error).message}`]; }
}

function cmdVizReport(args: string[], state: TerminalState): string[] {
  const [name] = args;
  if (!name) return ["Usage: viz.report <network>"];
  const net = state.networks.get(name);
  if (!net) return [`[ERROR] Network '${name}' not found`];
  return renderFullNetworkReport(net);
}

// ════════════════════════════════════════════════════════════
// SCRIPT COMMANDS (implementations)
// ════════════════════════════════════════════════════════════

function cmdScriptSave(args: string[], state: TerminalState): string[] {
  const [name, ...cmdParts] = args;
  if (!name || cmdParts.length === 0) return [
    "Usage: script.save <name> <cmd1> ; <cmd2> ; ...",
    "  script.save myscript tensor.randn a 4 ; tensor.randn b 4 ; tensor.add c a b",
  ];
  const commands = cmdParts.join(" ").split(";").map(c => c.trim()).filter(Boolean);
  const source = commands.join("\n");
  // Use the Script interface correctly: store commands in source, parse lines
  const lines = commands.map((raw, i) => ({
    lineNum: i + 1,
    raw,
    type: "command" as const,
  }));
  state.scripts.set(name, {
    name,
    source,
    lines,
    functions: new Map(),
    createdAt: Date.now(),
    runCount: 0,
  });
  return [`[SCRIPT] Saved '${name}' (${commands.length} steps): ${commands.join(" | ")}`];
}

function cmdScriptShow(args: string[], state: TerminalState): string[] {
  const [name] = args;
  if (!name) return ["Usage: script.show <name>"];
  const script = state.scripts.get(name);
  if (!script) return [`[SCRIPT] '${name}' not found. Use script.list`];
  const cmds = script.source.split("\n").filter(Boolean);
  return [
    `[SCRIPT] ${name} (${cmds.length} steps, run ${script.runCount}x):`,
    ...cmds.map((c: string, i: number) => `  ${String(i + 1).padStart(2)}. ${c}`),
  ];
}

function cmdScriptRun(args: string[], state: TerminalState): string[] {
  const [name] = args;
  if (!name) return ["Usage: script.run <name>"];
  const script = state.scripts.get(name);
  if (!script) return [`[SCRIPT] '${name}' not found`];
  const cmds = script.source.split("\n").filter(Boolean);
  const output: string[] = [`[SCRIPT] Running '${name}' (${cmds.length} steps)...`];
  script.runCount++;
  for (const cmd of cmds) {
    const result = processCommand(cmd, state);
    if (result instanceof Promise) {
      output.push(`  [async] ${cmd} — async commands not supported in scripts`);
    } else {
      output.push(`  > ${cmd}`);
      output.push(...result.slice(0, 5));
    }
  }
  achievementEngine.track("script.run");
  return output;
}

function cmdScriptDel(args: string[], state: TerminalState): string[] {
  const [name] = args;
  if (!name) return ["Usage: script.del <name>"];
  const existed = state.scripts.has(name);
  state.scripts.delete(name);
  return [existed ? `[SCRIPT] Deleted '${name}'` : `[SCRIPT] '${name}' not found`];
}

function cmdScriptHelp(): string[] {
  return [
    "[SCRIPT] Script Engine — save and run command sequences",
    "  script.save <name> <cmd1> ; <cmd2>   — save a script",
    "  script.run  <name>                   — run a script",
    "  script.show <name>                   — show script contents",
    "  script.list                          — list all scripts",
    "  script.del  <name>                   — delete a script",
    "",
    "Example:",
    "  script.save build_xor net.build xor_net xor 2 ; adam.create opt xor_net 0.01",
    "  script.run build_xor",
  ];
}

// ════════════════════════════════════════════════════════════
// MACRO COMMANDS (implementations)
// ════════════════════════════════════════════════════════════

function cmdMacroSet(args: string[], state: TerminalState): string[] {
  const [name, ...cmds] = args;
  if (!name || cmds.length === 0) return ["Usage: macro.set <name> <cmd1> [cmd2 ...]"];
  state.macros.set(name, cmds);
  return [`[MACRO] Set '${name}': ${cmds.join(", ")}`];
}

function cmdMacroRun(args: string[], state: TerminalState): string[] {
  const [name] = args;
  if (!name) return ["Usage: macro.run <name>"];
  const cmds = state.macros.get(name);
  if (!cmds) return [`[MACRO] '${name}' not found`];
  const output: string[] = [`[MACRO] Running '${name}'`];
  for (const cmd of cmds) {
    const result = processCommand(cmd, state);
    if (!(result instanceof Promise)) output.push(...result.slice(0, 3));
  }
  return output;
}

function cmdMacroList(state: TerminalState): string[] {
  if (state.macros.size === 0) return ["[MACRO] No macros. Use: macro.set <name> <cmd1> [cmd2 ...]"];
  const lines = [`[MACRO] ${state.macros.size} macros:`];
  for (const [name, cmds] of state.macros.entries()) {
    lines.push(`  ${name.padEnd(16)}: ${cmds.join(" | ")}`);
  }
  return lines;
}

function cmdMacroDel(args: string[], state: TerminalState): string[] {
  const [name] = args;
  if (!name) return ["Usage: macro.del <name>"];
  const existed = state.macros.has(name);
  state.macros.delete(name);
  return [existed ? `[MACRO] Deleted '${name}'` : `[MACRO] '${name}' not found`];
}

// ════════════════════════════════════════════════════════════
// SESSION COMMANDS (implementations)
// ════════════════════════════════════════════════════════════

function cmdSessionList(state: TerminalState): string[] {
  const lines = [`[SESSION] Sessions (${state.sessions.size}):`];
  for (const [name, s] of state.sessions.entries()) {
    const active = name === state.activeSession ? " ← active" : "";
    lines.push(`  ${name.padEnd(16)} cmds=${s.history.length}  created=${new Date(s.created).toLocaleTimeString()}${active}`);
  }
  return lines;
}

function cmdSessionNew(args: string[], state: TerminalState): string[] {
  const [name] = args;
  if (!name) return ["Usage: session.new <name>"];
  if (state.sessions.has(name)) return [`[SESSION] '${name}' already exists`];
  state.sessions.set(name, { history: [], created: Date.now() });
  return [`[SESSION] Created '${name}'`];
}

function cmdSessionSwitch(args: string[], state: TerminalState): string[] {
  const [name] = args;
  if (!name) return ["Usage: session.switch <name>"];
  if (!state.sessions.has(name)) return [`[SESSION] '${name}' not found`];
  state.activeSession = name;
  return [`[SESSION] Switched to '${name}'`];
}

function cmdSessionDel(args: string[], state: TerminalState): string[] {
  const [name] = args;
  if (!name) return ["Usage: session.del <name>"];
  if (name === "default") return ["[SESSION] Cannot delete default session"];
  const existed = state.sessions.has(name);
  state.sessions.delete(name);
  if (state.activeSession === name) state.activeSession = "default";
  return [existed ? `[SESSION] Deleted '${name}'` : `[SESSION] '${name}' not found`];
}

function cmdSessionInfo(state: TerminalState): string[] {
  const s = state.sessions.get(state.activeSession);
  if (!s) return [`[SESSION] Active session '${state.activeSession}' not found`];
  return [
    `[SESSION] Active: '${state.activeSession}'`,
    `  Commands: ${s.history.length}`,
    `  Created : ${new Date(s.created).toLocaleString()}`,
    `  All     : ${[...state.sessions.keys()].join(", ")}`,
  ];
}

// ════════════════════════════════════════════════════════════
// ACHIEVEMENT COMMANDS
// ════════════════════════════════════════════════════════════

function cmdAchievements(args: string[]): string[] {
  const sub = args[0];
  if (!sub || sub === "list") {
    const cat = args[1] as AchievementCategory | undefined;
    return achievementEngine.renderAchievements(cat);
  }
  if (sub === "profile") return achievementEngine.renderProfile();
  if (sub === "challenges") return achievementEngine.renderChallenges();
  if (sub === "xp") {
    const info = achievementEngine.getLevelInfo();
    const p = achievementEngine.getProfile();
    return [
      `[ACH] XP: ${p.totalXP}  Level: ${info.level} (${info.title})`,
      `  Progress to next: ${info.nextXP} XP remaining`,
      `  Progress: ${"█".repeat(Math.round(info.progress * 20))}${"░".repeat(20 - Math.round(info.progress * 20))}`,
    ];
  }
  return achievementEngine.renderAchievements();
}

export { achievementEngine };

// ════════════════════════════════════════════════════════════
// TENSORBOARD COMMANDS
// ════════════════════════════════════════════════════════════

function cmdTBLog(args: string[]): string[] {
  const [tag, valStr, stepStr] = args;
  if (!tag || !valStr) return ["Usage: tb.log <tag> <value> [step]"];
  const value = parseFloat(valStr);
  const step  = stepStr !== undefined ? parseInt(stepStr) : undefined;
  if (isNaN(value)) return [`[TB] Invalid value: ${valStr}`];
  tensorBoard.logScalar(tag, value, step);
  return [`[TB] Logged scalar: ${tag} = ${value}${step !== undefined ? ` @ step ${step}` : ""}`];
}

function cmdTBScalar(args: string[]): string[] {
  return cmdTBLog(args);
}

function cmdTBPlot(args: string[]): string[] {
  const [tag, widthStr, heightStr] = args;
  if (!tag) return ["Usage: tb.plot <tag> [width] [height]"];
  const w = widthStr ? parseInt(widthStr) : 60;
  const h = heightStr ? parseInt(heightStr) : 12;
  return tensorBoard.renderScalar(tag, isNaN(w) ? 60 : w, isNaN(h) ? 12 : h);
}

function cmdTBHist(args: string[]): string[] {
  const [tag, binsStr] = args;
  if (!tag) return ["Usage: tb.hist <tag> [bins]"];
  const bins = binsStr ? parseInt(binsStr) : 10;
  return tensorBoard.renderHistogram(tag, isNaN(bins) ? 10 : bins);
}

function cmdTBNet(args: string[], state: TerminalState): string[] {
  const [name] = args;
  if (!name) return ["Usage: tb.net <network>  — log + summarize network in TensorBoard"];
  const net = state.networks.get(name);
  if (!net) return [`[TB] Network '${name}' not found`];
  return tensorBoard.renderNetworkSummary(name, net);
}

function cmdTBTensor(args: string[], state: TerminalState): string[] {
  const [name, tag] = args;
  if (!name) return ["Usage: tb.tensor <tensor_name> [tag]"];
  const t = state.tensors.get(name);
  if (!t) return [`[TB] Tensor '${name}' not found`];
  const resolvedTag = tag ?? name;
  tensorBoard.logTensor(t, resolvedTag);
  return [
    `[TB] Logged tensor '${name}' as '${resolvedTag}'`,
    `  Use: tb.hist ${resolvedTag}  or  tb.plot ${resolvedTag}/mean`,
  ];
}

function cmdTBSummary(args: string[], state: TerminalState): string[] {
  const [name] = args;
  if (!name) {
    // Summary of all networks
    const lines = ["[TB] TensorBoard Summary"];
    for (const [netName, net] of state.networks.entries()) {
      lines.push(...tensorBoard.renderNetworkSummary(netName, net).slice(0, 6));
    }
    return lines.length > 1 ? lines : ["[TB] No networks to summarize."];
  }
  const net = state.networks.get(name);
  if (!net) return [`[TB] Network '${name}' not found`];
  return tensorBoard.renderNetworkSummary(name, net);
}

// ════════════════════════════════════════════════════════════
// LIVE METRICS COMMANDS
// ════════════════════════════════════════════════════════════

function cmdMetricsDash(state: TerminalState): string[] {
  return liveMetrics.renderDashboard(
    state.tensors.size,
    state.networks.size,
    state.optimizers.size
  );
}

function cmdMetricsTop(): string[] {
  const top = liveMetrics.getTopCommands(15);
  if (top.length === 0) return ["[METRICS] No command data yet."];
  const lines = ["[METRICS] Top Commands:"];
  for (const cf of top) {
    const latStr = cf.avgLatency.toFixed(1).padStart(7);
    lines.push(`  ${cf.cmd.padEnd(24)} ×${String(cf.count).padStart(5)}  avg ${latStr}ms`);
  }
  return lines;
}

function cmdMetricsSpark(): string[] {
  return [
    "[METRICS] Sparklines:",
    `  CPM:     ${liveMetrics.getSparkline("commandsPerMin", 40)}`,
    `  Latency: ${liveMetrics.getSparkline("avgLatency",     40)}`,
    `  Errors:  ${liveMetrics.getSparkline("errorRate",      40)}`,
  ];
}

// ════════════════════════════════════════════════════════════
// TENSOR EXTRAS
// ════════════════════════════════════════════════════════════

function cmdTensorPlot(args: string[], state: TerminalState): string[] {
  const [name, widthStr, heightStr] = args;
  if (!name) return ["Usage: tensor.plot <name> [width] [height]"];
  const t = state.tensors.get(name);
  if (!t) return [`[TENSOR] '${name}' not found`];
  const w = widthStr ? parseInt(widthStr) : 50;
  const h = heightStr ? parseInt(heightStr) : 10;
  const vals = Array.from(t.data as Float32Array);
  if (vals.length === 0) return ["[TENSOR] Empty tensor"];
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;
  const width = isNaN(w) ? 50 : Math.min(w, vals.length);
  const height = isNaN(h) ? 10 : h;
  // Downsample if needed
  const step = Math.max(1, Math.floor(vals.length / width));
  const sampled = [];
  for (let i = 0; i < vals.length; i += step) sampled.push(vals[i]);
  const grid: string[][] = Array.from({ length: height }, () => Array(sampled.length).fill(" "));
  for (let x = 0; x < sampled.length; x++) {
    const y = height - 1 - Math.min(height - 1, Math.floor(((sampled[x] - min) / range) * (height - 1)));
    grid[y][x] = "●";
  }
  const lines = [`[TENSOR] Plot: ${name} (n=${vals.length})  min=${min.toFixed(4)}  max=${max.toFixed(4)}`];
  for (const row of grid) lines.push(`  ${row.join("")}`);
  return lines;
}

function cmdTensorCompare(args: string[], state: TerminalState): string[] {
  const [name1, name2] = args;
  if (!name1 || !name2) return ["Usage: tensor.compare <t1> <t2>"];
  const t1 = state.tensors.get(name1);
  const t2 = state.tensors.get(name2);
  if (!t1) return [`[TENSOR] '${name1}' not found`];
  if (!t2) return [`[TENSOR] '${name2}' not found`];
  const d1 = Array.from(t1.data as Float32Array);
  const d2 = Array.from(t2.data as Float32Array);
  const n = Math.min(d1.length, d2.length);
  let mse = 0;
  let maxDiff = 0;
  for (let i = 0; i < n; i++) {
    const diff = d1[i] - d2[i];
    mse += diff * diff;
    maxDiff = Math.max(maxDiff, Math.abs(diff));
  }
  mse /= n;
  const cosine = d1.slice(0, n).reduce((s, v, i) => s + v * d2[i], 0)
    / (Math.sqrt(d1.reduce((s, v) => s + v * v, 0)) * Math.sqrt(d2.reduce((s, v) => s + v * v, 0)) || 1);
  return [
    `[TENSOR] Compare: ${name1} vs ${name2}`,
    `  Shape: ${t1.shape.join("×")} vs ${t2.shape.join("×")}`,
    `  MSE:      ${mse.toExponential(4)}`,
    `  Max diff: ${maxDiff.toExponential(4)}`,
    `  Cosine:   ${cosine.toFixed(6)}`,
    `  Equal:    ${mse < 1e-7 ? "✓ YES" : "✗ NO"}`,
  ];
}

function cmdTensorStats(args: string[], state: TerminalState): string[] {
  const [name] = args;
  if (!name) return ["Usage: tensor.stats <name>"];
  const t = state.tensors.get(name);
  if (!t) return [`[TENSOR] '${name}' not found`];
  const d = Array.from(t.data as Float32Array);
  const n = d.length;
  const mean = d.reduce((a, b) => a + b, 0) / n;
  const variance = d.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const std = Math.sqrt(variance);
  const sorted = [...d].sort((a, b) => a - b);
  const median = sorted[Math.floor(n / 2)];
  const p25 = sorted[Math.floor(n * 0.25)];
  const p75 = sorted[Math.floor(n * 0.75)];
  const nanCount = d.filter(x => isNaN(x)).length;
  const infCount = d.filter(x => !isFinite(x) && !isNaN(x)).length;
  return [
    `[TENSOR] Stats: ${name} shape=${t.shape.join("×")}  n=${n}`,
    `  mean=${mean.toFixed(6)}  std=${std.toFixed(6)}  var=${variance.toFixed(6)}`,
    `  min=${sorted[0].toFixed(6)}  p25=${p25.toFixed(6)}  median=${median.toFixed(6)}  p75=${p75.toFixed(6)}  max=${sorted[n-1].toFixed(6)}`,
    `  norm=${Math.sqrt(d.reduce((a, b) => a + b * b, 0)).toFixed(6)}`,
    nanCount > 0 ? `  ⚠ NaN count: ${nanCount}` : "  ✓ No NaNs",
    infCount > 0 ? `  ⚠ Inf count: ${infCount}` : "  ✓ No Infs",
  ];
}

function cmdTensorClamp(args: string[], state: TerminalState): string[] {
  const [name, minStr, maxStr, outName] = args;
  if (!name || !minStr || !maxStr) return ["Usage: tensor.clamp <name> <min> <max> [output_name]"];
  const t = state.tensors.get(name);
  if (!t) return [`[TENSOR] '${name}' not found`];
  const lo = parseFloat(minStr); const hi = parseFloat(maxStr);
  if (isNaN(lo) || isNaN(hi)) return ["[TENSOR] Invalid clamp bounds"];
  const d = new Float32Array(t.data as Float32Array);
  for (let i = 0; i < d.length; i++) d[i] = Math.min(hi, Math.max(lo, d[i]));
  const out = new (t.constructor as typeof NanoTensor)(d, [...t.shape], t.dtype, false, outName ?? `${name}_clamped`);
  const outName2 = outName ?? `${name}_clamped`;
  state.tensors.set(outName2, out);
  return [`[TENSOR] Clamped '${name}' → '${outName2}' (range [${lo}, ${hi}])`];
}

function cmdTensorAbs(args: string[], state: TerminalState): string[] {
  const [name, outName] = args;
  if (!name) return ["Usage: tensor.abs <name> [output_name]"];
  const t = state.tensors.get(name);
  if (!t) return [`[TENSOR] '${name}' not found`];
  const d = new Float32Array(t.data as Float32Array);
  for (let i = 0; i < d.length; i++) d[i] = Math.abs(d[i]);
  const key = outName ?? `${name}_abs`;
  state.tensors.set(key, new NanoTensor(d, [...t.shape], t.dtype, false, key));
  return [`[TENSOR] |${name}| → '${key}'`];
}

function cmdTensorSum(args: string[], state: TerminalState): string[] {
  const [name] = args;
  if (!name) return ["Usage: tensor.sum <name>"];
  const t = state.tensors.get(name);
  if (!t) return [`[TENSOR] '${name}' not found`];
  const sum = Array.from(t.data as Float32Array).reduce((a, b) => a + b, 0);
  return [`[TENSOR] sum(${name}) = ${sum.toFixed(8)}`];
}

function cmdTensorMean(args: string[], state: TerminalState): string[] {
  const [name] = args;
  if (!name) return ["Usage: tensor.mean <name>"];
  const t = state.tensors.get(name);
  if (!t) return [`[TENSOR] '${name}' not found`];
  const d = Array.from(t.data as Float32Array);
  const mean = d.reduce((a, b) => a + b, 0) / d.length;
  return [`[TENSOR] mean(${name}) = ${mean.toFixed(8)}`];
}

function cmdTensorMax(args: string[], state: TerminalState): string[] {
  const [name] = args;
  if (!name) return ["Usage: tensor.max <name>"];
  const t = state.tensors.get(name);
  if (!t) return [`[TENSOR] '${name}' not found`];
  const d = Array.from(t.data as Float32Array);
  const max = Math.max(...d);
  const idx = d.indexOf(max);
  return [`[TENSOR] max(${name}) = ${max.toFixed(8)} at index ${idx}`];
}

function cmdTensorMinVal(args: string[], state: TerminalState): string[] {
  const [name] = args;
  if (!name) return ["Usage: tensor.min <name>"];
  const t = state.tensors.get(name);
  if (!t) return [`[TENSOR] '${name}' not found`];
  const d = Array.from(t.data as Float32Array);
  const min = Math.min(...d);
  const idx = d.indexOf(min);
  return [`[TENSOR] min(${name}) = ${min.toFixed(8)} at index ${idx}`];
}

function cmdTensorFlatten(args: string[], state: TerminalState): string[] {
  const [name, outName] = args;
  if (!name) return ["Usage: tensor.flatten <name> [output_name]"];
  const t = state.tensors.get(name);
  if (!t) return [`[TENSOR] '${name}' not found`];
  const key = outName ?? `${name}_flat`;
  const flat = new NanoTensor(new Float32Array(t.data as Float32Array), [t.data.length], t.dtype, false, key);
  state.tensors.set(key, flat);
  return [`[TENSOR] flatten(${name}) → '${key}' shape=[${t.data.length}]`];
}

function cmdTensorCopy(args: string[], state: TerminalState): string[] {
  const [name, outName] = args;
  if (!name || !outName) return ["Usage: tensor.copy <src> <dst>"];
  const t = state.tensors.get(name);
  if (!t) return [`[TENSOR] '${name}' not found`];
  const copy = new NanoTensor(new Float32Array(t.data as Float32Array), [...t.shape], t.dtype, t.requiresGrad, outName);
  state.tensors.set(outName, copy);
  return [`[TENSOR] Copied '${name}' → '${outName}'`];
}

function cmdTensorFill(args: string[], state: TerminalState): string[] {
  const [name, valStr] = args;
  if (!name || !valStr) return ["Usage: tensor.fill <name> <value>"];
  const t = state.tensors.get(name);
  if (!t) return [`[TENSOR] '${name}' not found`];
  const val = parseFloat(valStr);
  if (isNaN(val)) return [`[TENSOR] Invalid value: ${valStr}`];
  (t.data as Float32Array).fill(val);
  return [`[TENSOR] Filled '${name}' with ${val} (${t.data.length} elements)`];
}

// ════════════════════════════════════════════════════════════
// NETWORK EXTRAS
// ════════════════════════════════════════════════════════════

function cmdNetCopy(args: string[], state: TerminalState): string[] {
  const [srcName, dstName] = args;
  if (!srcName || !dstName) return ["Usage: net.copy <src> <dst>"];
  const net = state.networks.get(srcName);
  if (!net) return [`[NET] Network '${srcName}' not found`];
  // Deep copy by rebuilding with same architecture
  const layerDefs = net.layers.map(l => ({
    inFeatures: l.inF, outFeatures: l.outF, activation: l.activation
  }));
  const { MLP: MLPCtor } = require ? { MLP: null } : { MLP: null };
  void MLPCtor;
  const copy = new MLP(layerDefs);
  // Copy weights
  for (let i = 0; i < net.layers.length; i++) {
    (copy.layers[i].W.data as Float32Array).set(net.layers[i].W.data as Float32Array);
    if (net.layers[i].b && copy.layers[i].b) {
      (copy.layers[i].b!.data as Float32Array).set(net.layers[i].b!.data as Float32Array);
    }
  }
  copy.lossHistory = [...(net.lossHistory ?? [])];
  state.networks.set(dstName, copy);
  return [`[NET] Copied '${srcName}' → '${dstName}' (${net.layers.length} layers)`];
}

function cmdNetParams(args: string[], state: TerminalState): string[] {
  const [name] = args;
  if (!name) return ["Usage: net.params <name>"];
  const net = state.networks.get(name);
  if (!net) return [`[NET] '${name}' not found`];
  let total = 0;
  const lines = [`[NET] Parameters: ${name}`];
  for (let i = 0; i < net.layers.length; i++) {
    const l = net.layers[i];
    const wP = l.W.data.length;
    const bP = l.b ? l.b.data.length : 0;
    total += wP + bP;
    lines.push(`  Layer ${i}: W=${wP}  b=${bP}  → ${wP+bP} params`);
  }
  lines.push(`  Total: ${total} parameters (${(total * 4 / 1024).toFixed(2)}KB)`);
  return lines;
}

function cmdNetFreeze(args: string[], state: TerminalState): string[] {
  const [name] = args;
  if (!name) return ["Usage: net.freeze <name>  — disable gradient updates"];
  const net = state.networks.get(name);
  if (!net) return [`[NET] '${name}' not found`];
  for (const l of net.layers) {
    l.W.requiresGrad = false;
    if (l.b) l.b.requiresGrad = false;
  }
  return [`[NET] Frozen '${name}' — gradients disabled for all layers`];
}

function cmdNetUnfreeze(args: string[], state: TerminalState): string[] {
  const [name] = args;
  if (!name) return ["Usage: net.unfreeze <name>  — re-enable gradient updates"];
  const net = state.networks.get(name);
  if (!net) return [`[NET] '${name}' not found`];
  for (const l of net.layers) {
    l.W.requiresGrad = true;
    if (l.b) l.b.requiresGrad = true;
  }
  return [`[NET] Unfrozen '${name}' — gradients enabled`];
}

function cmdNetReset(args: string[], state: TerminalState): string[] {
  const [name] = args;
  if (!name) return ["Usage: net.reset <name>  — reinitialize weights"];
  const net = state.networks.get(name);
  if (!net) return [`[NET] '${name}' not found`];
  const layerDefs = net.layers.map(l => ({
    inFeatures: l.inF, outFeatures: l.outF, activation: l.activation
  }));
  const newNet = new MLP(layerDefs);
  newNet.lossHistory = [];
  state.networks.set(name, newNet);
  return [`[NET] Reset '${name}' — weights reinitialized, loss history cleared`];
}

function cmdNetEnsemble(args: string[], state: TerminalState): string[] {
  const [xName, ...netNames] = args;
  if (!xName || netNames.length < 2) return ["Usage: net.ensemble <X_tensor> <net1> <net2> [net3 ...]"];
  const X = state.tensors.get(xName);
  if (!X) return [`[NET] Tensor '${xName}' not found`];
  const outputs: number[][] = [];
  const errors: string[] = [];
  for (const name of netNames) {
    const net = state.networks.get(name);
    if (!net) { errors.push(`[NET] '${name}' not found`); continue; }
    try {
      const out = net.forward(X);
      outputs.push(Array.from(out.data as Float32Array));
    } catch (e) { errors.push(`[NET] '${name}' forward error: ${(e as Error).message}`); }
  }
  if (outputs.length === 0) return [...errors, "[NET] No valid outputs for ensemble"];
  const n = outputs[0].length;
  const ensemble = new Float32Array(n);
  for (const o of outputs) for (let i = 0; i < n; i++) ensemble[i] += o[i] / outputs.length;
  const ensName = `ensemble_out`;
  state.tensors.set(ensName, new NanoTensor(ensemble, [1, n], "f32", false, ensName));
  return [
    `[NET] Ensemble (${outputs.length} networks) → '${ensName}'`,
    `  Output: [${Array.from(ensemble).map(v => v.toFixed(4)).join(", ")}]`,
    ...errors,
  ];
}

// ════════════════════════════════════════════════════════════
// CONVERT COMMANDS
// ════════════════════════════════════════════════════════════

function cmdConvertTemp(args: string[]): string[] {
  const [valStr, from] = args;
  if (!valStr || !from) return ["Usage: convert.temp <value> <C|F|K>"];
  const v = parseFloat(valStr);
  if (isNaN(v)) return ["[CONVERT] Invalid value"];
  const unit = from.toUpperCase();
  let celsius: number;
  if (unit === "C") celsius = v;
  else if (unit === "F") celsius = (v - 32) * 5 / 9;
  else if (unit === "K") celsius = v - 273.15;
  else return [`[CONVERT] Unknown unit: ${from} (use C, F, K)`];
  const f = celsius * 9 / 5 + 32;
  const k = celsius + 273.15;
  return [
    `[CONVERT] Temperature: ${v}${unit}`,
    `  Celsius:    ${celsius.toFixed(4)} °C`,
    `  Fahrenheit: ${f.toFixed(4)} °F`,
    `  Kelvin:     ${k.toFixed(4)} K`,
  ];
}

function cmdConvertBytes(args: string[]): string[] {
  const [valStr, unit] = args;
  if (!valStr) return ["Usage: convert.bytes <value> [B|KB|MB|GB|TB]"];
  const v = parseFloat(valStr);
  const u = (unit ?? "B").toUpperCase();
  const mult: Record<string, number> = { B: 1, KB: 1024, MB: 1024**2, GB: 1024**3, TB: 1024**4 };
  const bytes = v * (mult[u] ?? 1);
  return [
    `[CONVERT] Storage: ${v} ${u}`,
    `  Bytes: ${bytes.toFixed(0)}`,
    `  KB:    ${(bytes / 1024).toFixed(4)}`,
    `  MB:    ${(bytes / 1024**2).toFixed(4)}`,
    `  GB:    ${(bytes / 1024**3).toFixed(6)}`,
  ];
}

function cmdConvertAngle(args: string[]): string[] {
  const [valStr, unit] = args;
  if (!valStr) return ["Usage: convert.angle <value> <deg|rad|grad>"];
  const v = parseFloat(valStr);
  const u = (unit ?? "deg").toLowerCase();
  let rad: number;
  if (u === "deg") rad = v * Math.PI / 180;
  else if (u === "rad") rad = v;
  else if (u === "grad") rad = v * Math.PI / 200;
  else return [`[CONVERT] Unknown unit: ${unit}`];
  return [
    `[CONVERT] Angle: ${v} ${u}`,
    `  Radians: ${rad.toFixed(6)}`,
    `  Degrees: ${(rad * 180 / Math.PI).toFixed(4)}`,
    `  Grads:   ${(rad * 200 / Math.PI).toFixed(4)}`,
    `  Turns:   ${(rad / (2 * Math.PI)).toFixed(6)}`,
  ];
}

function cmdConvertTime(args: string[]): string[] {
  const [valStr, unit] = args;
  if (!valStr) return ["Usage: convert.time <value> <ms|s|min|h|d>"];
  const v = parseFloat(valStr);
  const u = (unit ?? "s").toLowerCase();
  const toMs: Record<string, number> = { ms: 1, s: 1000, min: 60000, h: 3600000, d: 86400000 };
  const ms = v * (toMs[u] ?? 1000);
  return [
    `[CONVERT] Time: ${v} ${u}`,
    `  Milliseconds: ${ms.toFixed(2)}`,
    `  Seconds:      ${(ms / 1000).toFixed(4)}`,
    `  Minutes:      ${(ms / 60000).toFixed(6)}`,
    `  Hours:        ${(ms / 3600000).toFixed(8)}`,
    `  Days:         ${(ms / 86400000).toFixed(10)}`,
  ];
}

function cmdConvertSpeed(args: string[]): string[] {
  const [valStr, unit] = args;
  if (!valStr) return ["Usage: convert.speed <value> <mph|kph|ms|knots>"];
  const v = parseFloat(valStr);
  const u = (unit ?? "kph").toLowerCase();
  const toMs2: Record<string, number> = { mph: 0.44704, kph: 1/3.6, ms: 1, knots: 0.514444, mps: 1 };
  const ms2 = v * (toMs2[u] ?? 1);
  return [
    `[CONVERT] Speed: ${v} ${u}`,
    `  m/s:   ${ms2.toFixed(4)}`,
    `  km/h:  ${(ms2 * 3.6).toFixed(4)}`,
    `  mph:   ${(ms2 / 0.44704).toFixed(4)}`,
    `  knots: ${(ms2 / 0.514444).toFixed(4)}`,
  ];
}

// ════════════════════════════════════════════════════════════
// FORMAT OUTPUT COMMANDS
// ════════════════════════════════════════════════════════════

function cmdFmtTable(args: string[], state: TerminalState): string[] {
  // fmt.table <var_name>  — formats a JSON array of objects as table
  const [varName] = args;
  const raw = varName
    ? String(state.variables.get(varName) ?? "")
    : state.pipeBuffer.join("");
  if (!raw) return ["Usage: fmt.table <json_var>  or pipe JSON array"];
  try {
    const data = JSON.parse(raw);
    if (!Array.isArray(data) || data.length === 0) return ["[FMT] Expected non-empty JSON array"];
    const keys = Object.keys(data[0]);
    const widths = keys.map(k => Math.max(k.length, ...data.map((r: Record<string, unknown>) => String(r[k] ?? "").length)));
    const sep = "+" + widths.map(w => "-".repeat(w + 2)).join("+") + "+";
    const header = "|" + keys.map((k, i) => ` ${k.padEnd(widths[i])} `).join("|") + "|";
    const rows = data.map((r: Record<string, unknown>) =>
      "|" + keys.map((k, i) => ` ${String(r[k] ?? "").padEnd(widths[i])} `).join("|") + "|"
    );
    return [sep, header, sep, ...rows, sep];
  } catch (e) {
    return [`[FMT] Error: ${(e as Error).message}`];
  }
}

function cmdFmtCsv(args: string[], state: TerminalState): string[] {
  const [varName] = args;
  const raw = varName
    ? String(state.variables.get(varName) ?? "")
    : state.pipeBuffer.join("");
  if (!raw) return ["Usage: fmt.csv <json_var>"];
  try {
    const data = JSON.parse(raw);
    if (!Array.isArray(data) || data.length === 0) return ["[FMT] Expected non-empty JSON array"];
    const keys = Object.keys(data[0]);
    const lines = [keys.join(",")];
    for (const row of data) {
      lines.push(keys.map(k => JSON.stringify((row as Record<string, unknown>)[k] ?? "")).join(","));
    }
    return lines;
  } catch (e) {
    return [`[FMT] Error: ${(e as Error).message}`];
  }
}

function cmdFmtYaml(args: string[], state: TerminalState): string[] {
  const [varName] = args;
  const raw = varName
    ? String(state.variables.get(varName) ?? "")
    : state.pipeBuffer.join("");
  if (!raw) return ["Usage: fmt.yaml <json_var>"];
  try {
    const obj = JSON.parse(raw);
    const toYaml = (v: unknown, indent = 0): string => {
      const pad = "  ".repeat(indent);
      if (v === null) return "null";
      if (typeof v === "boolean" || typeof v === "number") return String(v);
      if (typeof v === "string") return v.includes("\n") ? `|\n${v.split("\n").map(l => pad + "  " + l).join("\n")}` : v;
      if (Array.isArray(v)) return v.map(item => `\n${pad}- ${toYaml(item, indent + 1)}`).join("");
      if (typeof v === "object") {
        return Object.entries(v as Record<string, unknown>)
          .map(([k, val]) => {
            const rendered = toYaml(val, indent + 1);
            const isComplex = typeof val === "object" && val !== null;
            return `\n${pad}${k}:${isComplex ? rendered : " " + rendered}`;
          }).join("");
      }
      return String(v);
    };
    return toYaml(obj).split("\n").filter(l => l.trim());
  } catch (e) {
    return [`[FMT] Error: ${(e as Error).message}`];
  }
}

function cmdFmtJson(args: string[], state: TerminalState): string[] {
  const [varName, indentStr] = args;
  const raw = varName
    ? String(state.variables.get(varName) ?? "")
    : state.pipeBuffer.join("");
  if (!raw) return ["Usage: fmt.json <json_var> [indent=2]"];
  const indent = parseInt(indentStr ?? "2");
  try {
    const formatted = JSON.stringify(JSON.parse(raw), null, isNaN(indent) ? 2 : indent);
    return formatted.split("\n");
  } catch (e) {
    return [`[FMT] Error: ${(e as Error).message}`];
  }
}
