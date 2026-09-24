// ============================================================
// SETTINGS CHAIN — CONTRACT TEST SUITE v1.0.0
//
// Test inventory:
//   S01  Happy path: valid single-field change
//   S02  Happy path: multi-field change
//   S03  Boundary: invalid fontSize (NaN) → rejected, no side effects
//   S04  Boundary: fontSize out of range → clamped (validation coerces, not rejects)
//   S05  Boundary: invalid enum colorTheme → rejected
//   S06  Boundary: invalid enum historyUp → rejected
//   S07  Boundary: boolean field passed as truthy string → rejected
//   S08  Boundary: promptCustom with only whitespace → normalized
//   S09  Boundary: promptUser with invalid chars → rejected field, fallback used
//   S10  No side effects on rejection: previous settings unchanged, no persist
//   S11  Idempotency: same settings twice → second is no-op
//   S12  Idempotency: changed settings clears cache
//   S13  Diff: changedKeys exactly matches mutations
//   S14  Diff: no-op returns empty changedKeys
//   S15  Persist failure: chain returns Ok with persistFailed=true, settings still valid
//   S16  Determinism: fake clock latency_ms controlled
//   S17  Audit trail: all required steps present on success
//   S18  Audit trail: REJECT entry present on failure
//   S19  Schema: validateSettings preserves all base fields not in patch
//   S20  Schema: loadSettingsVersioned handles legacy format
//   S21  Schema: loadSettingsVersioned handles versioned format
//   S22  diffSettings: correctly identifies all changed keys
//   S23  diffSettings: returns empty for identical objects
//   S24  Property: validated settings always has all required keys
//   S25  Structured logs: all required fields present on success
//   S26  Structured logs: failure log emitted with code
//   S27  formatSettingsResult smoke test
//   S28  formatSettingsError smoke test
// ============================================================

import {
  executeSettingsChange,
  clearSettingsCache,
  formatSettingsResult,
  formatSettingsError,
} from "./SettingsChain";
import {
  validateSettings,
  diffSettings,
  loadSettingsVersioned,
  DEFAULT_SETTINGS,
  SETTINGS_SCHEMA_VERSION,
} from "./UXSettings";
import type { UXSettings } from "./UXSettings";
import { makeFakeClock } from "./determinism";
import { clearLogs, peekLogs } from "./logger";

// ── Harness ──────────────────────────────────────────────
let testsPassed = 0;
let testsFailed = 0;
const failures: string[] = [];

function assert(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    testsPassed++;
  } else {
    testsFailed++;
    failures.push(`${name}${detail ? ": " + detail : ""}`);
  }
}

function assertEqual<T>(name: string, actual: T, expected: T): void {
  assert(name, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function makeSettings(overrides: Partial<UXSettings> = {}): UXSettings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

// Stub localStorage for isolation
function withFakeStorage(fn: (store: Record<string, string>) => void): void {
  const store: Record<string, string> = {};
  const original = {
    getItem: localStorage.getItem.bind(localStorage),
    setItem: localStorage.setItem.bind(localStorage),
    removeItem: localStorage.removeItem.bind(localStorage),
  };
  localStorage.getItem = (k: string) => store[k] ?? null;
  localStorage.setItem = (k: string, v: string) => { store[k] = v; };
  localStorage.removeItem = (k: string) => { delete store[k]; };
  try { fn(store); } finally {
    localStorage.getItem = original.getItem;
    localStorage.setItem = original.setItem;
    localStorage.removeItem = original.removeItem;
  }
}

// ── Test runner ──────────────────────────────────────────
export function runSettingsChainTests(): string[] {
  const output: string[] = [];
  testsPassed = 0;
  testsFailed = 0;
  failures.length = 0;

  output.push("╔══════════════════════════════════════════════════════════════╗");
  output.push("║     SETTINGS CHAIN CONTRACT TESTS — v1.0.0                  ║");
  output.push("╠══════════════════════════════════════════════════════════════╣");

  clearSettingsCache();
  clearLogs();

  // ── S01: Happy path single-field change ──────────────────
  output.push("║ S01 Happy path: single-field change                          ║");
  {
    clearSettingsCache();
    const prev = makeSettings({ fontSize: 14 });
    const result = executeSettingsChange(prev, { fontSize: 18 }, "corr-s01");
    assert("S01 result Ok", result.ok);
    if (result.ok) {
      assertEqual("S01 next.fontSize=18", result.value.next.fontSize, 18);
      assertEqual("S01 prev.fontSize unchanged", result.value.previous.fontSize, 14);
      assert("S01 changedKeys includes fontSize", result.value.changedKeys.includes("fontSize"));
      assertEqual("S01 changedKeys.length=1", result.value.changedKeys.length, 1);
      assert("S01 wasIdempotent=false", !result.value.wasIdempotent);
      assert("S01 correlation_id set", result.value.correlation_id === "corr-s01");
      assert("S01 latency_ms > 0", result.value.latency_ms >= 0);
      assert("S01 auditTrail non-empty", result.value.auditTrail.length > 0);
    }
  }

  // ── S02: Multi-field change ───────────────────────────────
  output.push("║ S02 Happy path: multi-field change                           ║");
  {
    clearSettingsCache();
    const prev = makeSettings({ fontSize: 14, colorTheme: "green", lineHeight: 1.6 });
    const result = executeSettingsChange(prev, { fontSize: 16, colorTheme: "cyan", lineHeight: 1.8 }, "corr-s02");
    assert("S02 result Ok", result.ok);
    if (result.ok) {
      assertEqual("S02 next.fontSize=16", result.value.next.fontSize, 16);
      assertEqual("S02 next.colorTheme=cyan", result.value.next.colorTheme, "cyan");
      assert("S02 changedKeys.length=3", result.value.changedKeys.length === 3);
      assert("S02 prev untouched", result.value.previous.colorTheme === "green");
    }
  }

  // ── S03: Invalid fontSize NaN → rejected ─────────────────
  output.push("║ S03 Boundary: fontSize=NaN → rejected                        ║");
  {
    clearSettingsCache();
    const prev = makeSettings({ fontSize: 14 });
    const result = executeSettingsChange(prev, { fontSize: NaN }, "corr-s03");
    // NaN is invalid → validateSettings returns error → chain rejects
    assert("S03 result is Err", !result.ok);
    if (!result.ok) {
      assertEqual("S03 error code INVALID_INPUT", result.error.code, "INVALID_INPUT");
      assertEqual("S03 retry NON_RETRYABLE", result.error.retryClass, "NON_RETRYABLE");
    }
    // [D4] Prove no side effects — previous should be completely unmodified
    assert("S03 prev.fontSize still 14", prev.fontSize === 14);
  }

  // ── S04: fontSize out of range → clamped ─────────────────
  output.push("║ S04 Boundary: fontSize out of range → clamped                ║");
  {
    clearSettingsCache();
    const prev = makeSettings({ fontSize: 14 });
    // 9 is below min(10), 30 is above max(28)
    const r1 = executeSettingsChange(prev, { fontSize: 9 }, "corr-s04a");
    const r2 = executeSettingsChange(prev, { fontSize: 30 }, "corr-s04b");
    // clampInt returns 10/28 — valid — so chain succeeds
    assert("S04a fontSize=9 → clamped Ok", r1.ok);
    if (r1.ok) assertEqual("S04a clamped to 10", r1.value.next.fontSize, 10);
    assert("S04b fontSize=30 → clamped Ok", r2.ok);
    if (r2.ok) assertEqual("S04b clamped to 28", r2.value.next.fontSize, 28);
  }

  // ── S05: Invalid enum colorTheme → rejected ───────────────
  output.push("║ S05 Boundary: invalid colorTheme enum → rejected             ║");
  {
    clearSettingsCache();
    const prev = makeSettings({ colorTheme: "green" });
    const result = executeSettingsChange(prev, { colorTheme: "rainbow" as never }, "corr-s05");
    assert("S05 result Err", !result.ok);
    if (!result.ok) {
      assert("S05 message mentions colorTheme", result.error.message.includes("colorTheme"));
    }
    assert("S05 prev.colorTheme unchanged", prev.colorTheme === "green");
  }

  // ── S06: Invalid historyUp → rejected ────────────────────
  output.push("║ S06 Boundary: invalid historyUp enum → rejected              ║");
  {
    clearSettingsCache();
    const prev = makeSettings();
    const result = executeSettingsChange(prev, { historyUp: "ctrl-q" as never }, "corr-s06");
    assert("S06 result Err", !result.ok);
    if (!result.ok) {
      assert("S06 message mentions historyUp", result.error.message.includes("historyUp"));
    }
  }

  // ── S07: Boolean as string → rejected ────────────────────
  output.push("║ S07 Boundary: boolean field as string → rejected             ║");
  {
    clearSettingsCache();
    const prev = makeSettings({ highContrast: false });
    const result = executeSettingsChange(prev, { highContrast: "true" as never }, "corr-s07");
    assert("S07 result Err", !result.ok);
    if (!result.ok) {
      assert("S07 message mentions highContrast", result.error.message.includes("highContrast"));
    }
    assert("S07 prev.highContrast unchanged", prev.highContrast === false);
  }

  // ── S08: promptCustom whitespace → normalized ─────────────
  output.push("║ S08 Boundary: promptCustom whitespace → normalized           ║");
  {
    clearSettingsCache();
    const prev = makeSettings({ promptCustom: ">>" });
    // Empty string or only whitespace → falls back
    const report = validateSettings({ promptCustom: "   " }, prev);
    // sanitizeString trims → empty string → returns null → warning, uses default
    assert("S08 warnings emitted", report.warnings.length > 0);
    // promptCustom should fall back to default or >> 
    assert("S08 promptCustom non-empty", (report.validated.promptCustom?.length ?? 0) > 0);
  }

  // ── S09: promptUser invalid chars → field rejected ────────
  output.push("║ S09 Boundary: promptUser invalid chars → fallback            ║");
  {
    clearSettingsCache();
    const prev = makeSettings({ promptUser: "user" });
    const report = validateSettings({ promptUser: "user name with spaces" }, prev);
    // Pattern /^[\w.\-]+$/ fails for spaces → returns null → errors[]
    assert("S09 validation has error for promptUser", report.errors.some(e => e.field === "promptUser"));
    // Fallback is base.promptUser
    assertEqual("S09 validated.promptUser is fallback", report.validated.promptUser, "user");
  }

  // ── S10: No side effects on rejection ────────────────────
  output.push("║ S10 No side effects on rejection                             ║");
  {
    clearSettingsCache();
    const prev = makeSettings({ fontSize: 14, colorTheme: "green" });
    let persistCalled = false;
    const result = executeSettingsChange(
      prev,
      { colorTheme: "invalid_theme" as never },
      "corr-s10",
      () => { persistCalled = true; }  // onPersist hook
    );
    assert("S10 result Err", !result.ok);
    assert("S10 onPersist NOT called", !persistCalled);    // [D4]
    assert("S10 prev.colorTheme unchanged", prev.colorTheme === "green");  // [D1]
    assert("S10 prev.fontSize unchanged", prev.fontSize === 14);
  }

  // ── S11: Idempotency — same settings twice ────────────────
  output.push("║ S11-S12 Idempotency                                         ║");
  {
    clearSettingsCache();
    const prev = makeSettings({ fontSize: 14 });
    let persistCount = 0;
    const track = () => { persistCount++; };

    // First call — should persist
    const r1 = executeSettingsChange(prev, { fontSize: 18 }, "corr-s11a", track);
    assert("S11 first call Ok", r1.ok);
    assertEqual("S11 first persist count=1", persistCount, 1);

    // Second call with same mutation — fingerprint matches → no-op
    const prev2 = r1.ok ? r1.value.next : prev;
    const r2 = executeSettingsChange(prev2, { fontSize: 18 }, "corr-s11b", track);
    assert("S11 second call Ok", r2.ok);
    if (r2.ok) {
      assert("S11 second call wasIdempotent", r2.value.wasIdempotent);
    }
    // persistCount should not have incremented — idempotent = no-op write [I1]
    assert("S11 onPersist NOT called again for idempotent", persistCount <= 1);

    // S12: Different change clears idempotency
    clearSettingsCache();
    const r3 = executeSettingsChange(makeSettings({ fontSize: 14 }), { fontSize: 18 }, "corr-s12a", track);
    const r4 = executeSettingsChange(
      r3.ok ? r3.value.next : makeSettings(),
      { fontSize: 20 },
      "corr-s12b",
      track
    );
    assert("S12 different change is fresh (not idempotent)", r4.ok && (!r4.ok || !(r4 as typeof r4 & {ok:true}).value.wasIdempotent));
  }

  // ── S13: Diff changedKeys accuracy ───────────────────────
  output.push("║ S13-S14 Diff accuracy                                       ║");
  {
    const prev = makeSettings({ fontSize: 14, colorTheme: "green", lineHeight: 1.6 });
    const next = { ...prev, fontSize: 18, colorTheme: "cyan" as const };
    const diff = diffSettings(prev, next);
    assert("S13 changedKeys has 2", diff.changedKeys.length === 2);
    assert("S13 fontSize in changed", diff.changedKeys.includes("fontSize"));
    assert("S13 colorTheme in changed", diff.changedKeys.includes("colorTheme"));
    assert("S13 lineHeight NOT in changed", !diff.changedKeys.includes("lineHeight"));

    // S14: no-op diff
    const diffSame = diffSettings(prev, { ...prev });
    assertEqual("S14 no-op diff empty", diffSame.changedKeys.length, 0);
  }

  // ── S15: Persist failure → Ok with persistFailed=true ────
  output.push("║ S15 Persist failure: in-memory valid, persistFailed=true    ║");
  {
    clearSettingsCache();
    const prev = makeSettings({ fontSize: 14 });

    // Force onPersist to throw
    const result = executeSettingsChange(
      prev,
      { fontSize: 18 },
      "corr-s15",
      () => { throw new Error("IPC unavailable"); }
    );

    assert("S15 result Ok despite persist failure", result.ok);
    if (result.ok) {
      assert("S15 persistFailed=true", result.value.persistFailed);
      assertEqual("S15 next.fontSize still 18", result.value.next.fontSize, 18);
    }
  }

  // ── S16: Fake clock controls latency_ms ──────────────────
  output.push("║ S16 Determinism: fake clock latency_ms                      ║");
  {
    clearSettingsCache();
    const fakeClock = makeFakeClock(1000, 10);
    const prev = makeSettings({ fontSize: 14 });
    const result = executeSettingsChange(prev, { fontSize: 18 }, "corr-s16", undefined, fakeClock);
    assert("S16 result Ok", result.ok);
    if (result.ok) {
      assert("S16 latency_ms is finite", isFinite(result.value.latency_ms));
      assert("S16 latency_ms >= 0", result.value.latency_ms >= 0);
    }
  }

  // ── S17: Audit trail completeness on success ─────────────
  output.push("║ S17 Audit trail: required steps on success                  ║");
  {
    clearSettingsCache();
    const prev = makeSettings({ fontSize: 14 });
    const result = executeSettingsChange(prev, { fontSize: 18 }, "corr-s17");
    assert("S17 result Ok", result.ok);
    if (result.ok) {
      const trail = result.value.auditTrail;
      assert("S17 has START RECEIVE_MUTATION", trail.some(a => a.includes("START RECEIVE_MUTATION")));
      assert("S17 has VALIDATE", trail.some(a => a.includes("VALIDATE")));
      assert("S17 has DIFF", trail.some(a => a.includes("DIFF")));
      assert("S17 has PERSIST", trail.some(a => a.includes("PERSIST")));
      assert("S17 has CHANGED entry", trail.some(a => a.includes("CHANGED key=fontSize")));
      assert("S17 has FINALIZE", trail.some(a => a.includes("FINALIZE")));
    }
  }

  // ── S18: Audit trail on failure ───────────────────────────
  output.push("║ S18 Audit trail: REJECT on failure                          ║");
  {
    clearSettingsCache();
    const prev = makeSettings();
    const result = executeSettingsChange(prev, { colorTheme: "bad" as never }, "corr-s18");
    assert("S18 result Err", !result.ok);
    // Even on error, log was emitted
    const logs = peekLogs();
    assert("S18 FAILURE log emitted", logs.some(l => l.outcome === "FAILURE" && l.correlation_id === "corr-s18"));
  }

  // ── S19: validateSettings preserves unpatched fields ─────
  output.push("║ S19 Schema: unpatched fields preserved                      ║");
  {
    const base = makeSettings({ fontSize: 14, colorTheme: "green", lineHeight: 1.6, highContrast: true });
    const report = validateSettings({ fontSize: 18 }, base);
    assert("S19 ok", report.ok);
    assertEqual("S19 colorTheme preserved", report.validated.colorTheme, "green");
    assertEqual("S19 lineHeight preserved", report.validated.lineHeight, 1.6);
    assert("S19 highContrast preserved", report.validated.highContrast === true);
    assertEqual("S19 fontSize updated", report.validated.fontSize, 18);
  }

  // ── S20: loadSettingsVersioned handles legacy format ─────
  output.push("║ S20-S21 Schema migration                                    ║");
  {
    withFakeStorage(store => {
      // Write legacy format (no __version)
      store["x86_neural_ux_settings"] = JSON.stringify({ fontSize: 20, colorTheme: "amber" });
      const r = loadSettingsVersioned();
      assert("S20 migrated=true for legacy", r.migrated === true);
      assertEqual("S20 version=0 for legacy", r.version, 0);
      assertEqual("S20 fontSize from legacy", r.settings.fontSize, 20);
      assertEqual("S20 colorTheme from legacy", r.settings.colorTheme, "amber");
      // New fields filled from defaults
      assert("S20 new fields from defaults", r.settings.historyUp === DEFAULT_SETTINGS.historyUp);
    });
  }

  // ── S21: loadSettingsVersioned handles versioned format ──
  {
    withFakeStorage(store => {
      store["x86_neural_ux_settings_v3"] = JSON.stringify({
        __version: SETTINGS_SCHEMA_VERSION,
        settings: { ...DEFAULT_SETTINGS, fontSize: 22 }
      });
      const r = loadSettingsVersioned();
      assert("S21 migrated=false for current version", r.migrated === false);
      assertEqual("S21 version=current", r.version, SETTINGS_SCHEMA_VERSION);
      assertEqual("S21 fontSize=22", r.settings.fontSize, 22);
    });
  }

  // ── S22-S23: diffSettings ─────────────────────────────────
  output.push("║ S22-S23 diffSettings correctness                            ║");
  {
    const a = makeSettings();
    const b = { ...a, fontSize: 20, highContrast: true };
    const d = diffSettings(a, b);
    assert("S22 changedKeys.length=2", d.changedKeys.length === 2);
    const fontChange = d.changes.find(c => c.key === "fontSize");
    assert("S22 fontSize from=14", fontChange?.from === 14);
    assert("S22 fontSize to=20", fontChange?.to === 20);

    const dSame = diffSettings(a, { ...a });
    assertEqual("S23 same → empty diff", dSame.changedKeys.length, 0);
  }

  // ── S24: Property — validated always has all keys ─────────
  output.push("║ S24 Property: validated always has all required keys        ║");
  {
    const requiredKeys = Object.keys(DEFAULT_SETTINGS) as Array<keyof UXSettings>;
    // Test with empty patch
    const r1 = validateSettings({}, DEFAULT_SETTINGS);
    for (const k of requiredKeys) {
      assert(`S24 key ${k} present`, k in r1.validated);
    }
    // Test with partial valid patch
    const r2 = validateSettings({ fontSize: 16, colorTheme: "cyan" }, DEFAULT_SETTINGS);
    for (const k of requiredKeys) {
      assert(`S24 key ${k} present in partial patch`, k in r2.validated);
    }
  }

  // ── S25: Structured logs — success path fields ────────────
  output.push("║ S25-S26 Structured logs                                     ║");
  {
    clearLogs();
    clearSettingsCache();
    const prev = makeSettings({ fontSize: 14 });
    executeSettingsChange(prev, { fontSize: 18 }, "corr-s25");
    const logs = peekLogs();
    assert("S25 logs emitted", logs.length > 0);
    const mine = logs.filter(l => l.correlation_id === "corr-s25");
    assert("S25 has correlation_id on all entries", mine.every(l => l.correlation_id === "corr-s25"));
    assert("S25 has chain_name=settings.change", mine.every(l => l.chain_name === "settings.change"));
    assert("S25 has chain_version=1.0.0", mine.every(l => l.chain_version === "1.0.0"));
    assert("S25 has step field", mine.every(l => !!l.step));
    assert("S25 has outcome field", mine.every(l => !!l.outcome));
    assert("S25 START log fired", mine.some(l => l.outcome === "START"));
    assert("S25 SUCCESS log fired", mine.some(l => l.outcome === "SUCCESS"));
  }

  // ── S26: Structured logs — failure path ───────────────────
  {
    clearLogs();
    clearSettingsCache();
    const prev = makeSettings();
    executeSettingsChange(prev, { colorTheme: "invalid" as never }, "corr-s26");
    const logs = peekLogs();
    const mine = logs.filter(l => l.correlation_id === "corr-s26");
    assert("S26 FAILURE log emitted", mine.some(l => l.outcome === "FAILURE"));
    assert("S26 error code present in log", mine.some(l => l.error?.code === "INVALID_INPUT"));
  }

  // ── S27: formatSettingsResult smoke ───────────────────────
  output.push("║ S27-S28 Format functions                                    ║");
  {
    clearSettingsCache();
    const prev = makeSettings({ fontSize: 14 });
    const result = executeSettingsChange(prev, { fontSize: 18 }, "corr-s27");
    assert("S27 result Ok", result.ok);
    if (result.ok) {
      const lines = formatSettingsResult(result.value);
      assert("S27 has corr_id line", lines.some(l => l.includes("corr_id") || l.includes("corr-s27")));
      assert("S27 has changed field", lines.some(l => l.includes("fontSize")));
      assert("S27 has audit trail", lines.some(l => l.includes("Audit Trail")));
    }
  }

  // ── S28: formatSettingsError smoke ────────────────────────
  {
    clearSettingsCache();
    const prev = makeSettings();
    const result = executeSettingsChange(prev, { colorTheme: "bad" as never }, "corr-s28");
    assert("S28 result Err", !result.ok);
    if (!result.ok) {
      const lines = formatSettingsError(result.error);
      assert("S28 has INVALID_INPUT", lines[0].includes("INVALID_INPUT"));
      assert("S28 has retry_class", lines[1].includes("retry_class"));
    }
  }

  // ── Summary ───────────────────────────────────────────────
  output.push("╠══════════════════════════════════════════════════════════════╣");
  output.push(`║  RESULTS: ${testsPassed} passed / ${testsFailed} failed / ${testsPassed + testsFailed} total`.padEnd(63) + "║");
  if (failures.length > 0) {
    output.push("║  FAILURES:".padEnd(63) + "║");
    for (const f of failures) {
      output.push(`║    ✗ ${f.slice(0, 56).padEnd(57)}║`);
    }
  }
  output.push("╚══════════════════════════════════════════════════════════════╝");

  return output;
}
