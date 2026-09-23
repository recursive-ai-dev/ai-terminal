import { describe, expect, it } from "vitest";
import { checkEndpoint, extractJSON, readAIConfig, sanitizePlan, DEFAULT_ENDPOINT, DEFAULT_TIMEOUT_MS } from "../electron/lib/aiPlan";

describe("checkEndpoint", () => {
  it.each([
    "http://127.0.0.1:11434/api/generate",
    "http://localhost:11434/api/generate",
    "http://[::1]:11434/api/generate",
    "http://127.0.0.2:8080/api/generate",
  ])("allows loopback %s", url => {
    expect(checkEndpoint(url, false).ok).toBe(true);
  });

  it("rejects remote endpoints unless opted in", () => {
    expect(checkEndpoint("https://ai.example.com/api/generate", false).ok).toBe(false);
    expect(checkEndpoint("https://ai.example.com/api/generate", true).ok).toBe(true);
  });

  it("requires https for opted-in remote endpoints", () => {
    expect(checkEndpoint("http://ai.example.com/api/generate", true).ok).toBe(false);
  });

  it("rejects credentials, bad schemes and garbage", () => {
    expect(checkEndpoint("http://user:pw@127.0.0.1:11434/", false).ok).toBe(false);
    expect(checkEndpoint("file:///etc/passwd", true).ok).toBe(false);
    expect(checkEndpoint("not a url", true).ok).toBe(false);
    expect(checkEndpoint("http://127.0.0.1.evil.com/", false).ok).toBe(false);
  });
});

describe("readAIConfig", () => {
  it("uses defaults", () => {
    const config = readAIConfig({});
    expect(config.endpoint).toBe(DEFAULT_ENDPOINT);
    expect(config.timeoutMs).toBe(DEFAULT_TIMEOUT_MS);
    expect(config.allowRemote).toBe(false);
  });

  it("ignores out-of-range timeouts", () => {
    expect(readAIConfig({ AI_TERMINAL_AI_TIMEOUT_MS: "5" }).timeoutMs).toBe(DEFAULT_TIMEOUT_MS);
    expect(readAIConfig({ AI_TERMINAL_AI_TIMEOUT_MS: "45000" }).timeoutMs).toBe(45000);
  });
});

describe("extractJSON", () => {
  it("parses plain and prose-wrapped JSON", () => {
    expect(extractJSON('{"a":1}')).toEqual({ a: 1 });
    expect(extractJSON('Sure! {"a":{"b":2}} hope that helps')).toEqual({ a: { b: 2 } });
  });

  it("rejects arrays, primitives and junk", () => {
    expect(extractJSON("[1,2]")).toBeNull();
    expect(extractJSON("nope")).toBeNull();
    expect(extractJSON(42)).toBeNull();
  });
});

describe("sanitizePlan", () => {
  it("withholds dangerous commands even when the model says safe", () => {
    const plan = sanitizePlan({ title: "clean", command: "rm -rf ~/tmp", risk: "safe" });
    expect(plan.command).toBe("");
    expect(plan.risk).toBe("dangerous");
    expect(plan.notes?.[0]).toMatch(/withheld/);
  });

  it("rejects multi-line commands", () => {
    const plan = sanitizePlan({ command: "ls\nrm -rf ~", risk: "safe" });
    expect(plan.command).toBe("");
    expect(plan.risk).toBe("review");
  });

  it("keeps a safe command and clips long fields", () => {
    const plan = sanitizePlan({ title: "x".repeat(500), explanation: "why", command: "df -h", risk: "safe", notes: ["a", 3, "b"] });
    expect(plan.command).toBe("df -h");
    expect(plan.risk).toBe("safe");
    expect(plan.title?.length).toBe(120);
    expect(plan.notes).toEqual(["a", "b"]);
  });

  it("defaults unknown risk to review", () => {
    expect(sanitizePlan({ command: "uptime", risk: "whatever" }).risk).toBe("review");
  });
});
