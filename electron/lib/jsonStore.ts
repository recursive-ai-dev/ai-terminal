// ============================================================
// JSON STORE — small, crash-safe key/value persistence
//
// • Writes are atomic: data goes to a temp file which is fsynced and
//   renamed over the real file, so a crash never leaves half a file.
// • A corrupt file is moved aside (never silently discarded) and the
//   store starts empty.
// • Values must be plain JSON and the whole document is size-capped.
// ============================================================
import * as fs from "node:fs";
import * as path from "node:path";

export const MAX_STORE_BYTES = 1024 * 1024;

export type JsonObject = Record<string, unknown>;

export interface JsonStoreOptions {
  /** Absolute path of the JSON document. */
  file: string;
  /** Optional file to import once when `file` does not exist yet. */
  legacyFile?: string;
  /** Called when the file had to be recovered (corrupt or unreadable). */
  onRecover?: (reason: string, backupPath: string | null) => void;
}

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

/** Round-trip through JSON so only serialisable data is ever stored. */
export function toJsonValue(value: unknown): unknown {
  if (value === undefined) return undefined;
  const text = JSON.stringify(value);
  if (text === undefined) throw new Error("Value is not JSON-serialisable");
  return JSON.parse(text);
}

export class JsonStore {
  private readonly file: string;
  private readonly legacyFile?: string;
  private readonly onRecover?: JsonStoreOptions["onRecover"];
  private data: JsonObject | null = null;

  constructor(options: JsonStoreOptions) {
    this.file = options.file;
    this.legacyFile = options.legacyFile;
    this.onRecover = options.onRecover;
  }

  get path(): string {
    return this.file;
  }

  private load(): JsonObject {
    if (this.data) return this.data;

    if (!fs.existsSync(this.file) && this.legacyFile && fs.existsSync(this.legacyFile)) {
      const legacy = this.readFile(this.legacyFile);
      this.data = legacy ?? {};
      if (legacy) this.persist();
      return this.data;
    }

    this.data = this.readFile(this.file) ?? {};
    return this.data;
  }

  private readFile(file: string): JsonObject | null {
    let text: string;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      this.onRecover?.(`unreadable: ${(error as Error).message}`, null);
      return null;
    }
    try {
      const parsed: unknown = JSON.parse(text);
      if (isPlainObject(parsed)) return parsed;
      throw new Error("top-level value is not an object");
    } catch (error) {
      const backup = `${file}.corrupt-${Date.now()}`;
      let moved: string | null = null;
      try {
        fs.renameSync(file, backup);
        moved = backup;
      } catch {
        moved = null;
      }
      this.onRecover?.(`corrupt: ${(error as Error).message}`, moved);
      return null;
    }
  }

  private persist(): void {
    const text = `${JSON.stringify(this.data ?? {}, null, 2)}\n`;
    if (Buffer.byteLength(text, "utf8") > MAX_STORE_BYTES) {
      throw new Error(`Settings exceed ${MAX_STORE_BYTES} bytes`);
    }
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temp = `${this.file}.${process.pid}.tmp`;
    const fd = fs.openSync(temp, "w", 0o600);
    try {
      fs.writeSync(fd, text, 0, "utf8");
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    try {
      fs.renameSync(temp, this.file);
    } catch (error) {
      try { fs.unlinkSync(temp); } catch { /* temp already gone */ }
      throw error;
    }
  }

  get<T = unknown>(key: string): T | undefined {
    const value = this.load()[key];
    return value === undefined ? undefined : toJsonValue(value) as T;
  }

  set(key: string, value: unknown): void {
    const data = this.load();
    const previous = data[key];
    const next = toJsonValue(value);
    if (next === undefined) delete data[key];
    else data[key] = next;
    try {
      this.persist();
    } catch (error) {
      // Keep memory consistent with disk when the write fails.
      if (previous === undefined) delete data[key];
      else data[key] = previous;
      throw error;
    }
  }

  clear(): void {
    const previous = this.load();
    this.data = {};
    try {
      this.persist();
    } catch (error) {
      this.data = previous;
      throw error;
    }
  }
}
