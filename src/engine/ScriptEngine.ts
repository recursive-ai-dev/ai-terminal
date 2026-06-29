// ============================================================
// SCRIPT ENGINE v1.0 — Multi-line terminal scripts
// Supports: variables, loops, conditionals, functions,
// pipe integration, error handling, timing
// ============================================================

export interface ScriptLine {
  lineNum: number;
  raw: string;
  type: "command" | "if" | "else" | "endif" | "loop" | "endloop" | "fn" | "endfn" | "comment" | "blank" | "return" | "break";
}

export interface ScriptFunction {
  name: string;
  params: string[];
  body: ScriptLine[];
}

export interface Script {
  name: string;
  source: string;
  lines: ScriptLine[];
  functions: Map<string, ScriptFunction>;
  createdAt: number;
  runCount: number;
  lastRunMs?: number;
}

export interface ScriptRunResult {
  output: string[];
  success: boolean;
  error?: string;
  durationMs: number;
  linesExecuted: number;
}

export type ScriptStore = Map<string, Script>;

// ── Parser ───────────────────────────────────────────────────

function classifyLine(raw: string): ScriptLine["type"] {
  const t = raw.trim().toLowerCase();
  if (!t || t === "") return "blank";
  if (t.startsWith("#")) return "comment";
  if (t.startsWith("if ") || t === "if") return "if";
  if (t === "else") return "else";
  if (t === "endif" || t === "fi") return "endif";
  if (t.startsWith("loop ") || t.startsWith("repeat ") || t.startsWith("for ")) return "loop";
  if (t === "endloop" || t === "done" || t === "end") return "endloop";
  if (t.startsWith("fn ") || t.startsWith("function ") || t.startsWith("def ")) return "fn";
  if (t === "endfn" || t === "endfunction" || t === "enddef") return "endfn";
  if (t.startsWith("return")) return "return";
  if (t === "break") return "break";
  return "command";
}

export function parseScript(name: string, source: string): Script {
  const rawLines = source.split("\n");
  const lines: ScriptLine[] = rawLines.map((raw, i) => ({
    lineNum: i + 1,
    raw: raw.trim(),
    type: classifyLine(raw.trim()),
  }));

  const functions = new Map<string, ScriptFunction>();
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.type === "fn") {
      const parts = line.raw.replace(/^(fn|function|def)\s+/, "").split(/\s+/);
      const fnName = parts[0] ?? "unnamed";
      const params = parts.slice(1);
      const body: ScriptLine[] = [];
      i++;
      while (i < lines.length && lines[i].type !== "endfn") {
        body.push(lines[i]);
        i++;
      }
      functions.set(fnName, { name: fnName, params, body });
    }
    i++;
  }

  return { name, source, lines, functions, createdAt: Date.now(), runCount: 0 };
}

// ── Variable interpolation ───────────────────────────────────

export function interpolate(text: string, vars: Map<string, number | string>): string {
  return text.replace(/\$\{([^}]+)\}|\$([A-Z_][A-Z0-9_]*)/gi, (_, braced, bare) => {
    const key = braced ?? bare;
    const val = vars.get(key);
    return val !== undefined ? String(val) : `$${key}`;
  });
}

// ── Condition evaluator ──────────────────────────────────────

export function evaluateCondition(expr: string, vars: Map<string, number | string>): boolean {
  const interp = interpolate(expr, vars);
  // Supported: a == b, a != b, a > b, a < b, a >= b, a <= b, !expr, true/false/1/0
  const eqMatch = interp.match(/^(.+?)\s*(==|!=|>=|<=|>|<)\s*(.+)$/);
  if (eqMatch) {
    const [, lhsRaw, op, rhsRaw] = eqMatch;
    const lhs = lhsRaw.trim();
    const rhs = rhsRaw.trim();
    const lNum = parseFloat(lhs);
    const rNum = parseFloat(rhs);
    const numericOp = !isNaN(lNum) && !isNaN(rNum);
    switch (op) {
      case "==": return numericOp ? lNum === rNum : lhs === rhs;
      case "!=": return numericOp ? lNum !== rNum : lhs !== rhs;
      case ">":  return numericOp && lNum > rNum;
      case "<":  return numericOp && lNum < rNum;
      case ">=": return numericOp && lNum >= rNum;
      case "<=": return numericOp && lNum <= rNum;
    }
  }
  if (interp.startsWith("!")) return !evaluateCondition(interp.slice(1).trim(), vars);
  const lower = interp.trim().toLowerCase();
  if (lower === "true" || lower === "1") return true;
  if (lower === "false" || lower === "0" || lower === "") return false;
  const n = parseFloat(interp);
  if (!isNaN(n)) return n !== 0;
  return interp.trim().length > 0;
}

// ── Runner ───────────────────────────────────────────────────

export interface ScriptExecutionContext {
  script: Script;
  vars: Map<string, number | string>;
  depth: number;
  maxDepth: number;
  maxLines: number;
  linesExecuted: number;
  output: string[];
  breakFlag: boolean;
  returnValue?: string;
}

export type CommandExecutor = (cmd: string) => string[] | Promise<string[]>;

export async function executeScript(
  script: Script,
  globalVars: Map<string, number | string>,
  executor: CommandExecutor,
  extraVars?: Record<string, string | number>
): Promise<ScriptRunResult> {
  const t0 = performance.now();
  const ctx: ScriptExecutionContext = {
    script,
    vars: new Map([...globalVars, ...(extraVars ? Object.entries(extraVars) : [])]),
    depth: 0,
    maxDepth: 8,
    maxLines: 500,
    linesExecuted: 0,
    output: [],
    breakFlag: false,
  };

  try {
    await runBlock(script.lines, ctx, executor);
    const durationMs = performance.now() - t0;
    script.runCount++;
    script.lastRunMs = durationMs;
    return { output: ctx.output, success: true, durationMs, linesExecuted: ctx.linesExecuted };
  } catch (e) {
    return {
      output: ctx.output,
      success: false,
      error: e instanceof Error ? e.message : String(e),
      durationMs: performance.now() - t0,
      linesExecuted: ctx.linesExecuted,
    };
  }
}

async function runBlock(
  lines: ScriptLine[],
  ctx: ScriptExecutionContext,
  executor: CommandExecutor
): Promise<void> {
  let i = 0;
  while (i < lines.length) {
    if (ctx.linesExecuted >= ctx.maxLines) throw new Error(`[SCRIPT] Max line limit (${ctx.maxLines}) reached — infinite loop guard`);
    if (ctx.breakFlag) break;

    const line = lines[i];
    ctx.linesExecuted++;

    if (line.type === "blank" || line.type === "comment") { i++; continue; }
    if (line.type === "fn" || line.type === "endfn") { i++; continue; }

    if (line.type === "return") {
      const retExpr = line.raw.replace(/^return\s*/i, "").trim();
      ctx.returnValue = interpolate(retExpr, ctx.vars);
      break;
    }

    if (line.type === "break") { ctx.breakFlag = true; break; }

    // ── IF block ──
    if (line.type === "if") {
      const condExpr = line.raw.replace(/^if\s+/i, "").trim();
      const condResult = evaluateCondition(condExpr, ctx.vars);

      // Collect if/else/endif bounds
      const ifBody: ScriptLine[] = [];
      const elseBody: ScriptLine[] = [];
      let inElse = false;
      let depth = 1;
      i++;
      while (i < lines.length) {
        const l = lines[i];
        if (l.type === "if") depth++;
        if (l.type === "endif") { depth--; if (depth === 0) break; }
        if (l.type === "else" && depth === 1) { inElse = true; i++; continue; }
        if (inElse) elseBody.push(l); else ifBody.push(l);
        i++;
      }
      await runBlock(condResult ? ifBody : elseBody, ctx, executor);
      i++;
      continue;
    }

    // ── LOOP block ──
    if (line.type === "loop") {
      const loopExpr = line.raw.replace(/^(loop|repeat|for)\s+/i, "").trim();
      const count = parseInt(interpolate(loopExpr.split(/\s+/)[0], ctx.vars));
      const safeCount = isNaN(count) ? 0 : Math.min(count, 200);

      const loopBody: ScriptLine[] = [];
      let depth = 1;
      i++;
      while (i < lines.length) {
        const l = lines[i];
        if (l.type === "loop") depth++;
        if (l.type === "endloop") { depth--; if (depth === 0) break; }
        loopBody.push(l);
        i++;
      }

      for (let iter = 0; iter < safeCount; iter++) {
        ctx.vars.set("_ITER", iter);
        ctx.vars.set("_LOOP_I", iter);
        ctx.breakFlag = false;
        await runBlock(loopBody, ctx, executor);
        if (ctx.breakFlag) break;
      }
      ctx.breakFlag = false;
      i++;
      continue;
    }

    // ── COMMAND ──
    if (line.type === "command") {
      const cmd = interpolate(line.raw, ctx.vars);
      if (!cmd) { i++; continue; }

      // ── Built-in: set var = expr ──
      const setMatch = cmd.match(/^set\s+(\w+)\s*=\s*(.+)$/i);
      if (setMatch) {
        const [, varName, valExpr] = setMatch;
        const val = interpolate(valExpr.trim(), ctx.vars);
        const n = parseFloat(val);
        ctx.vars.set(varName, isNaN(n) ? val : n);
        i++; continue;
      }

      // ── Built-in: print ──
      const printMatch = cmd.match(/^print\s+(.*)/i);
      if (printMatch) {
        ctx.output.push(`  ${interpolate(printMatch[1], ctx.vars)}`);
        i++; continue;
      }

      // ── Built-in: sleep (ms) ──
      const sleepMatch = cmd.match(/^sleep\s+(\d+)/i);
      if (sleepMatch) {
        await new Promise<void>(resolve => setTimeout(resolve, Math.min(parseInt(sleepMatch[1]), 2000)));
        i++; continue;
      }

      // ── User-defined function call ──
      const fnCall = cmd.match(/^call\s+(\w+)(?:\s+(.*))?$/i);
      if (fnCall) {
        const fn = ctx.script.functions.get(fnCall[1]);
        if (fn) {
          const argVals = (fnCall[2] ?? "").split(/\s+/).map(a => interpolate(a, ctx.vars));
          const fnVars = new Map(ctx.vars);
          fn.params.forEach((p, idx) => fnVars.set(p, argVals[idx] ?? ""));
          const subCtx: ScriptExecutionContext = { ...ctx, vars: fnVars, output: [] };
          await runBlock(fn.body, subCtx, executor);
          ctx.output.push(...subCtx.output);
          ctx.linesExecuted += subCtx.linesExecuted;
          if (subCtx.returnValue !== undefined) ctx.vars.set("_RETURN", subCtx.returnValue);
        }
        i++; continue;
      }

      // ── External command ──
      try {
        const result = executor(cmd);
        const lines2 = result instanceof Promise ? await result : result;
        ctx.output.push(...lines2);
      } catch (e) {
        ctx.output.push(`  [SCRIPT ERROR] line ${line.lineNum}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    i++;
  }
}

// ── Script store helpers ─────────────────────────────────────

export function renderScriptList(store: ScriptStore): string[] {
  if (store.size === 0) return ["[SCRIPT] No scripts stored. Use: script.save <name> <source>"];
  const lines = ["[SCRIPT] Stored scripts:"];
  for (const [name, s] of store) {
    const lineCount = s.lines.filter(l => l.type !== "blank" && l.type !== "comment").length;
    const runs = s.runCount;
    const lastMs = s.lastRunMs !== undefined ? ` last: ${s.lastRunMs.toFixed(1)}ms` : "";
    lines.push(`  ${name.padEnd(20)} ${lineCount} lines  runs: ${runs}${lastMs}`);
  }
  return lines;
}

export function renderScriptSource(script: Script): string[] {
  const lines: string[] = [`[SCRIPT] ${script.name}  (${script.lines.length} lines)`, ""];
  for (const line of script.lines) {
    const num = String(line.lineNum).padStart(4);
    lines.push(`  ${num}  ${line.raw}`);
  }
  return lines;
}
