/**
 * Contract tests for core/ module public APIs.
 *
 * These tests pin the observable behaviour of core modules so that
 * internal refactors do not accidentally change semantics.  They are
 * intentionally high-level and stable — a breaking change here signals
 * a real API regression.
 *
 * Modules covered:
 * - PatchConflictDetector   (conflict types, report shape)
 * - parseDurationMs         (accepted formats, rejected inputs)
 * - CheckRunner             (sequential / parallel modes, timeout flag)
 * - HookRunner              (sequential run, timeout flag)
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";

import {
  detectPatchConflicts,
  type AnalyzablePatch,
  type PatchConflictReport,
} from "../../../src/core/patch/PatchConflictDetector.js";
import { parseDurationMs } from "../../../src/core/utils/parseDuration.js";
import { CheckRunner, type RunChecksParams } from "../../../src/core/checks/CheckRunner.js";
import { HookRunner, type RunHooksParams } from "../../../src/core/hooks/HookRunner.js";

// =============================================================================
// PatchConflictDetector contract
// =============================================================================

describe("PatchConflictDetector contract", () => {
  // ---- return shape --------------------------------------------------------

  it("always returns a PatchConflictReport with hasConflicts boolean and conflicts array", () => {
    const report: PatchConflictReport = detectPatchConflicts([]);
    expect(typeof report.hasConflicts).toBe("boolean");
    expect(Array.isArray(report.conflicts)).toBe(true);
  });

  it("hasConflicts === (conflicts.length > 0)", () => {
    const clean = detectPatchConflicts([
      { kind: "append_if_missing", file: "a.ts", idempotencyKey: "k1" },
    ]);
    expect(clean.hasConflicts).toBe(false);
    expect(clean.conflicts.length).toBe(0);

    const dirty = detectPatchConflicts([
      { kind: "append_if_missing", file: "a.ts", idempotencyKey: "dup" },
      { kind: "append_if_missing", file: "b.ts", idempotencyKey: "dup" },
    ]);
    expect(dirty.hasConflicts).toBe(true);
    expect(dirty.conflicts.length).toBeGreaterThan(0);
  });

  // ---- duplicate_idempotency_key -------------------------------------------

  it("reports duplicate_idempotency_key when two patches share the same key", () => {
    const patches: AnalyzablePatch[] = [
      { kind: "marker_insert", file: "x.ts", idempotencyKey: "shared", markerStart: "//A" },
      { kind: "append_if_missing", file: "y.ts", idempotencyKey: "shared" },
    ];
    const { conflicts } = detectPatchConflicts(patches);
    const conflict = conflicts.find((c) => c.type === "duplicate_idempotency_key");
    expect(conflict).toBeDefined();
    expect(conflict!.patchAIndex).toBe(0);
    expect(conflict!.patchBIndex).toBe(1);
    expect(conflict!.patchAKey).toBe("shared");
    expect(conflict!.patchBKey).toBe("shared");
  });

  // ---- marker_conflict -------------------------------------------------------

  it("reports marker_conflict when two marker patches share file + markerStart", () => {
    const patches: AnalyzablePatch[] = [
      { kind: "marker_insert", file: "a.ts", idempotencyKey: "k1", markerStart: "//MARK" },
      { kind: "marker_replace", file: "a.ts", idempotencyKey: "k2", markerStart: "//MARK" },
    ];
    const { conflicts } = detectPatchConflicts(patches);
    const conflict = conflicts.find((c) => c.type === "marker_conflict");
    expect(conflict).toBeDefined();
    expect(conflict!.file).toBe("a.ts");
  });

  it("does NOT report marker_conflict for same markerStart in different files", () => {
    const patches: AnalyzablePatch[] = [
      { kind: "marker_insert", file: "a.ts", idempotencyKey: "k1", markerStart: "//MARK" },
      { kind: "marker_insert", file: "b.ts", idempotencyKey: "k2", markerStart: "//MARK" },
    ];
    const { conflicts } = detectPatchConflicts(patches);
    const markerConflicts = conflicts.filter((c) => c.type === "marker_conflict");
    expect(markerConflicts).toHaveLength(0);
  });

  it("does NOT report marker_conflict for append_if_missing (no markers)", () => {
    const patches: AnalyzablePatch[] = [
      { kind: "append_if_missing", file: "a.ts", idempotencyKey: "k1" },
      { kind: "append_if_missing", file: "a.ts", idempotencyKey: "k2" },
    ];
    const { conflicts } = detectPatchConflicts(patches);
    const markerConflicts = conflicts.filter((c) => c.type === "marker_conflict");
    expect(markerConflicts).toHaveLength(0);
  });

  it("each conflict object has required fields", () => {
    const patches: AnalyzablePatch[] = [
      { kind: "append_if_missing", file: "z.ts", idempotencyKey: "k" },
      { kind: "append_if_missing", file: "z.ts", idempotencyKey: "k" },
    ];
    const { conflicts } = detectPatchConflicts(patches);
    const c = conflicts[0];
    expect(typeof c.type).toBe("string");
    expect(typeof c.message).toBe("string");
    expect(typeof c.patchAIndex).toBe("number");
    expect(typeof c.patchBIndex).toBe("number");
    expect(typeof c.patchAKey).toBe("string");
    expect(typeof c.patchBKey).toBe("string");
    expect(typeof c.file).toBe("string");
  });
});

// =============================================================================
// parseDurationMs contract
// =============================================================================

describe("parseDurationMs contract", () => {
  // ---- accepted formats ----------------------------------------------------

  it.each([
    ["500ms", 500],
    ["1s", 1_000],
    ["30s", 30_000],
    ["1m", 60_000],
    ["2m", 120_000],
    ["1h", 3_600_000],
    ["90", 90_000], // bare number → seconds
    ["0.5s", 500], // fractional seconds
    ["1.5m", 90_000], // fractional minutes
  ])("parseDurationMs('%s') === %i", (input, expected) => {
    expect(parseDurationMs(input)).toBe(expected);
  });

  // ---- rejected inputs -------------------------------------------------------

  it.each([[undefined], [""], ["   "], ["abc"], ["30x"], ["m"]])(
    "parseDurationMs(%o) === undefined",
    (input) => {
      expect(parseDurationMs(input as string | undefined)).toBeUndefined();
    },
  );
});

// =============================================================================
// CheckRunner contract
// =============================================================================

describe("CheckRunner contract", () => {
  let tmpDir: string;

  async function mkTmp() {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "scaffoldix-cr-contract-"));
  }

  async function rmTmp() {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }

  const silentLogger = {
    info: () => {},
    error: () => {},
    stdout: () => {},
    stderr: () => {},
    outputBlock: () => {},
  };

  it("returns empty summary for zero commands", async () => {
    await mkTmp();
    try {
      const runner = new CheckRunner();
      const result = await runner.runChecks({
        commands: [],
        cwd: tmpDir,
        logger: silentLogger,
      });
      expect(result.total).toBe(0);
      expect(result.passed).toBe(0);
      expect(result.failed).toBe(0);
      expect(result.success).toBe(true);
      expect(result.results).toHaveLength(0);
    } finally {
      await rmTmp();
    }
  });

  it("sequential: passes all commands and sets success=true", async () => {
    await mkTmp();
    try {
      const runner = new CheckRunner();
      const params: RunChecksParams = {
        commands: ['node -e "process.exit(0)"', 'node -e "process.exit(0)"'],
        cwd: tmpDir,
        logger: silentLogger,
        parallel: false,
      };
      const result = await runner.runChecks(params);
      expect(result.success).toBe(true);
      expect(result.passed).toBe(2);
      expect(result.failed).toBe(0);
      expect(result.total).toBe(2);
    } finally {
      await rmTmp();
    }
  });

  it("sequential: throws on failure (fail-fast)", async () => {
    await mkTmp();
    try {
      const runner = new CheckRunner();
      await expect(
        runner.runChecks({
          commands: ['node -e "process.exit(1)"', 'node -e "process.exit(0)"'],
          cwd: tmpDir,
          logger: silentLogger,
          parallel: false,
        }),
      ).rejects.toThrow();
    } finally {
      await rmTmp();
    }
  });

  it("parallel: runs all commands even if some fail, then throws", async () => {
    await mkTmp();
    try {
      const runner = new CheckRunner();
      await expect(
        runner.runChecks({
          commands: ['node -e "process.exit(1)"', 'node -e "process.exit(0)"'],
          cwd: tmpDir,
          logger: silentLogger,
          parallel: true,
        }),
      ).rejects.toThrow();
    } finally {
      await rmTmp();
    }
  });

  it("parallel: all passing commands → success=true", async () => {
    await mkTmp();
    try {
      const runner = new CheckRunner();
      const result = await runner.runChecks({
        commands: ['node -e "process.exit(0)"', 'node -e "process.exit(0)"'],
        cwd: tmpDir,
        logger: silentLogger,
        parallel: true,
      });
      expect(result.success).toBe(true);
      expect(result.passed).toBe(2);
    } finally {
      await rmTmp();
    }
  });

  it("result objects have expected shape", async () => {
    await mkTmp();
    try {
      const runner = new CheckRunner();
      const result = await runner.runChecks({
        commands: ['node -e "process.exit(0)"'],
        cwd: tmpDir,
        logger: silentLogger,
      });
      const r = result.results[0];
      expect(typeof r.command).toBe("string");
      expect(typeof r.success).toBe("boolean");
      expect(typeof r.exitCode).toBe("number");
      expect(typeof r.durationMs).toBe("number");
      expect(typeof r.capturedOutput).toBe("string");
    } finally {
      await rmTmp();
    }
  });
});

// =============================================================================
// HookRunner contract
// =============================================================================

describe("HookRunner contract", () => {
  let tmpDir: string;

  async function mkTmp() {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "scaffoldix-hr-contract-"));
  }

  async function rmTmp() {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }

  const silentLogger = { info: () => {}, error: () => {} };

  it("returns empty summary for zero commands", async () => {
    await mkTmp();
    try {
      const runner = new HookRunner();
      const result = await runner.runPostGenerate({
        commands: [],
        cwd: tmpDir,
        logger: silentLogger,
      });
      expect(result.total).toBe(0);
      expect(result.success).toBe(true);
      expect(result.results).toHaveLength(0);
    } finally {
      await rmTmp();
    }
  });

  it("runs a passing hook and records durationMs", async () => {
    await mkTmp();
    try {
      const runner = new HookRunner();
      const params: RunHooksParams = {
        commands: ['node -e "process.exit(0)"'],
        cwd: tmpDir,
        logger: silentLogger,
      };
      const result = await runner.runPostGenerate(params);
      expect(result.success).toBe(true);
      expect(result.succeeded).toBe(1);
      expect(result.results[0].durationMs).toBeGreaterThanOrEqual(0);
    } finally {
      await rmTmp();
    }
  });

  it("throws ScaffoldError when a hook exits non-zero", async () => {
    await mkTmp();
    try {
      const runner = new HookRunner();
      await expect(
        runner.runPostGenerate({
          commands: ['node -e "process.exit(42)"'],
          cwd: tmpDir,
          logger: silentLogger,
        }),
      ).rejects.toThrow();
    } finally {
      await rmTmp();
    }
  });

  it("hook result objects have expected shape", async () => {
    await mkTmp();
    try {
      const runner = new HookRunner();
      const result = await runner.runPostGenerate({
        commands: ['node -e "process.exit(0)"'],
        cwd: tmpDir,
        logger: silentLogger,
      });
      const r = result.results[0];
      expect(typeof r.command).toBe("string");
      expect(typeof r.success).toBe("boolean");
      expect(typeof r.exitCode).toBe("number");
      expect(typeof r.durationMs).toBe("number");
    } finally {
      await rmTmp();
    }
  });
});
