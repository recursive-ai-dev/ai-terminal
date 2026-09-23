// ============================================================
// MAIN-PROCESS LOGGER
//
// Appends structured lines to <logs>/main.log and mirrors them to the
// console. The file rotates once it passes MAX_BYTES so a long-running
// session can never fill the disk. Logging must never throw: a failed
// write is reported to stderr once and otherwise ignored.
// ============================================================
import * as fs from "node:fs";
import * as path from "node:path";

type Level = "debug" | "info" | "warn" | "error";

const MAX_BYTES = 5 * 1024 * 1024;
const LEVEL_ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

let logFile: string | null = null;
let minLevel: Level = "info";
let writeFailed = false;

export function initLogger(directory: string, level: Level = "info"): string | null {
  minLevel = level;
  try {
    fs.mkdirSync(directory, { recursive: true });
    logFile = path.join(directory, "main.log");
    rotateIfNeeded();
  } catch (error) {
    logFile = null;
    console.error("[logger] cannot create log directory:", error);
  }
  return logFile;
}

function rotateIfNeeded(): void {
  if (!logFile) return;
  try {
    const { size } = fs.statSync(logFile);
    if (size >= MAX_BYTES) fs.renameSync(logFile, `${logFile}.1`);
  } catch {
    // File does not exist yet — nothing to rotate.
  }
}

function serialize(value: unknown): string {
  if (value instanceof Error) return value.stack || `${value.name}: ${value.message}`;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function write(level: Level, scope: string, message: string, detail?: unknown): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return;
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${message}${detail === undefined ? "" : ` ${serialize(detail)}`}`;

  const sink = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  sink(line);

  if (!logFile) return;
  try {
    rotateIfNeeded();
    fs.appendFileSync(logFile, `${line}\n`, "utf8");
  } catch (error) {
    if (!writeFailed) {
      writeFailed = true;
      console.error("[logger] cannot write log file:", error);
    }
  }
}

export interface ScopedLogger {
  debug(message: string, detail?: unknown): void;
  info(message: string, detail?: unknown): void;
  warn(message: string, detail?: unknown): void;
  error(message: string, detail?: unknown): void;
}

export function createLogger(scope: string): ScopedLogger {
  return {
    debug: (message, detail) => write("debug", scope, message, detail),
    info: (message, detail) => write("info", scope, message, detail),
    warn: (message, detail) => write("warn", scope, message, detail),
    error: (message, detail) => write("error", scope, message, detail),
  };
}
