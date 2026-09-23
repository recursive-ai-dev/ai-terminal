// The neural lab ships self-test suites runnable in-app (`test.train`,
// `test.settings`). Run the same suites in CI so they cannot rot.
import { describe, expect, it } from "vitest";
import { runTrainChainTests } from "../src/engine/TrainChain.test";
import { runSettingsChainTests } from "../src/engine/SettingsChain.test";

function summary(lines: string[]): { passed: number; failed: number; report: string } {
  const report = lines.join("\n");
  const match = report.match(/RESULTS: (\d+) passed \/ (\d+) failed/);
  if (!match) throw new Error(`No RESULTS line in suite output:\n${report}`);
  return { passed: Number(match[1]), failed: Number(match[2]), report };
}

describe("in-app engine suites", () => {
  it("TrainChain contract suite passes", () => {
    const result = summary(runTrainChainTests());
    expect(result.failed, result.report).toBe(0);
    expect(result.passed).toBeGreaterThan(20);
  });

  it("SettingsChain contract suite passes", () => {
    const result = summary(runSettingsChainTests());
    expect(result.failed, result.report).toBe(0);
    expect(result.passed).toBeGreaterThan(20);
  });
});
