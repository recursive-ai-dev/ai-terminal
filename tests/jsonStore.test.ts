import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { JsonStore, MAX_STORE_BYTES } from "../electron/lib/jsonStore";
import { isInside } from "../electron/lib/paths";

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "jsonstore-")); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe("JsonStore", () => {
  it("round-trips values and persists them atomically", () => {
    const file = path.join(dir, "nested", "settings.json");
    const store = new JsonStore({ file });
    store.set("a", { b: [1, 2, 3] });
    expect(new JsonStore({ file }).get("a")).toEqual({ b: [1, 2, 3] });
    expect(fs.readdirSync(path.dirname(file))).toEqual(["settings.json"]); // no temp files left
    if (process.platform !== "win32") expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  it("returns copies, not live references", () => {
    const store = new JsonStore({ file: path.join(dir, "s.json") });
    store.set("a", { n: 1 });
    const value = store.get<{ n: number }>("a")!;
    value.n = 2;
    expect(store.get("a")).toEqual({ n: 1 });
  });

  it("moves a corrupt file aside and starts empty", () => {
    const file = path.join(dir, "s.json");
    fs.writeFileSync(file, "{not json");
    const recovered: Array<string | null> = [];
    const store = new JsonStore({ file, onRecover: (_reason, backup) => recovered.push(backup) });
    expect(store.get("anything")).toBeUndefined();
    expect(recovered[0]).toMatch(/s\.json\.corrupt-\d+$/);
    expect(fs.existsSync(recovered[0]!)).toBe(true);
  });

  it("imports a legacy file once", () => {
    const legacy = path.join(dir, "old.json");
    fs.writeFileSync(legacy, JSON.stringify({ uxSettings: { fontSize: 20 } }));
    const file = path.join(dir, "settings.json");
    expect(new JsonStore({ file, legacyFile: legacy }).get("uxSettings")).toEqual({ fontSize: 20 });
    expect(fs.existsSync(file)).toBe(true);
  });

  it("rejects oversized documents without corrupting state", () => {
    const store = new JsonStore({ file: path.join(dir, "s.json") });
    store.set("ok", 1);
    expect(() => store.set("big", "x".repeat(MAX_STORE_BYTES))).toThrow(/exceed/);
    expect(store.get("big")).toBeUndefined();
    expect(new JsonStore({ file: path.join(dir, "s.json") }).get("ok")).toBe(1);
  });

  it("clears everything", () => {
    const store = new JsonStore({ file: path.join(dir, "s.json") });
    store.set("a", 1);
    store.clear();
    expect(store.get("a")).toBeUndefined();
  });
});

describe("isInside", () => {
  it("guards against prefix confusion and traversal", () => {
    expect(isInside("/home/user", "/home/user/docs/a.txt")).toBe(true);
    expect(isInside("/home/user", "/home/user")).toBe(true);
    expect(isInside("/home/user", "/home/user2/a.txt")).toBe(false);
    expect(isInside("/home/user", "/home/user/../other")).toBe(false);
    expect(isInside("/home/user", "/home/user/..data/x")).toBe(true);
  });
});
