import { describe, expect, it } from "vitest";
import { planCommand, reviewPlan } from "../src/engine/AIAssistant";

describe("planCommand (local rules)", () => {
  it.each([
    ["show disk usage", "df -h", "safe"],
    ["check git status", "git status --short --branch", "safe"],
    ["list files", "ls -lah", "safe"],
  ])("%s → %s", (request, command, risk) => {
    const plan = planCommand(request);
    expect(plan.command).toBe(command);
    expect(plan.risk).toBe(risk);
  });

  it("never generates a command for destructive requests", () => {
    const plan = planCommand("delete everything in downloads");
    expect(plan.command).toBe("");
    expect(plan.risk).toBe("dangerous");
  });

  it("marks package installs as dangerous (sudo)", () => {
    const plan = planCommand("install package htop");
    expect(plan.command).toBe("sudo apt install 'htop'");
    expect(plan.risk).toBe("dangerous");
  });

  it("does not guess arbitrary shell for unknown requests", () => {
    expect(planCommand("make me a sandwich").command).toBe("");
  });

  it("quotes search terms and keeps ~ expandable", () => {
    const plan = planCommand("search for 'it''s' in folder ~/src");
    expect(plan.command).toContain("~/");
    expect(plan.command).not.toContain("'~/");
  });
});

describe("reviewPlan", () => {
  const base = { request: "x", title: "t", explanation: "e", notes: [] as string[] };

  it("raises the risk of a model plan that claims to be safe", () => {
    const plan = reviewPlan({ ...base, command: "rm -rf build", risk: "safe" });
    expect(plan.risk).toBe("dangerous");
  });

  it("strips commands containing newlines", () => {
    const plan = reviewPlan({ ...base, command: "ls\nrm -rf ~", risk: "safe" });
    expect(plan.command).toBe("");
    expect(plan.risk).toBe("review");
  });

  it("keeps safe commands safe", () => {
    expect(reviewPlan({ ...base, command: "uptime", risk: "safe" }).risk).toBe("safe");
  });
});
