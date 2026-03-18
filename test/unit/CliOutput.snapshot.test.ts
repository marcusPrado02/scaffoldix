/**
 * Snapshot tests for CLI output formatters.
 *
 * These tests lock in the exact human-readable output of the main CLI
 * formatters so that cosmetic changes to output strings are noticed and
 * intentionally approved by updating snapshots.
 *
 * Covered formatters:
 * - formatGenerateOutput  (GenerateResult → string[])
 * - formatPatchReport     (PatchReport → string)
 * - formatHookReport      (HookReport → string)
 * - formatCheckReport     (CheckReport → string)
 * - formatTraceOutput     (TraceJson → string[])
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import {
  formatGenerateOutput,
  formatPatchReport,
  formatHookReport,
  formatCheckReport,
  formatTraceOutput,
  type GenerateResult,
  type PatchReport,
  type HookReport,
  type CheckReport,
} from "../../src/cli/handlers/generateHandler.js";
import type { TraceJson } from "../../src/core/observability/EngineTrace.js";

// =============================================================================
// formatGenerateOutput snapshots
// =============================================================================

describe("formatGenerateOutput snapshots", () => {
  const baseResult: GenerateResult = {
    packId: "my-pack",
    archetypeId: "component",
    targetDir: "/project/src",
    dryRun: false,
    filesWritten: [
      {
        srcRelativePath: "Component.tsx",
        destRelativePath: "Component.tsx",
        destAbsolutePath: "/project/src/Component.tsx",
        mode: "rendered",
      },
      {
        srcRelativePath: "Component.test.tsx",
        destRelativePath: "Component.test.tsx",
        destAbsolutePath: "/project/src/Component.test.tsx",
        mode: "rendered",
      },
    ],
    filesPlanned: [],
  };

  it("normal generation with 2 files", () => {
    const lines = formatGenerateOutput(baseResult);
    expect(lines.join("\n")).toMatchSnapshot();
  });

  it("dry-run with planned files", () => {
    const dryResult: GenerateResult = {
      ...baseResult,
      dryRun: true,
      filesWritten: [],
      filesPlanned: baseResult.filesWritten,
    };
    const lines = formatGenerateOutput(dryResult);
    expect(lines.join("\n")).toMatchSnapshot();
  });

  it("generation with patch report", () => {
    const patchReport: PatchReport = {
      total: 2,
      applied: 1,
      skipped: 1,
      failed: 0,
      entries: [
        {
          kind: "marker_insert",
          file: "src/app.ts",
          idempotencyKey: "add-import",
          status: "applied",
        },
        {
          kind: "append_if_missing",
          file: "README.md",
          idempotencyKey: "add-badge",
          status: "skipped",
          reason: "already applied",
        },
      ],
    };
    const lines = formatGenerateOutput({ ...baseResult, patchReport });
    expect(lines.join("\n")).toMatchSnapshot();
  });

  it("generation with patches skipped by flag", () => {
    const lines = formatGenerateOutput({ ...baseResult, patchesSkippedByFlag: true });
    expect(lines.join("\n")).toMatchSnapshot();
  });

  it("dry-run with patches skipped for dry-run", () => {
    const lines = formatGenerateOutput({
      ...baseResult,
      dryRun: true,
      filesWritten: [],
      filesPlanned: baseResult.filesWritten,
      patchesSkippedForDryRun: true,
    });
    expect(lines.join("\n")).toMatchSnapshot();
  });

  it("generation with hook report", () => {
    const hookReport: HookReport = {
      total: 2,
      succeeded: 2,
      failed: 0,
      totalDurationMs: 1234,
      success: true,
    };
    const lines = formatGenerateOutput({ ...baseResult, hookReport });
    expect(lines.join("\n")).toMatchSnapshot();
  });

  it("generation with check report", () => {
    const checkReport: CheckReport = {
      total: 3,
      passed: 3,
      failed: 0,
      totalDurationMs: 5678,
      success: true,
    };
    const lines = formatGenerateOutput({ ...baseResult, checkReport });
    expect(lines.join("\n")).toMatchSnapshot();
  });

  it("generation with checks skipped by flag", () => {
    const lines = formatGenerateOutput({ ...baseResult, checksSkippedByFlag: true });
    expect(lines.join("\n")).toMatchSnapshot();
  });

  it("generation with overwritten files (force mode)", () => {
    const lines = formatGenerateOutput({
      ...baseResult,
      filesOverwritten: [baseResult.filesWritten[0]],
    });
    expect(lines.join("\n")).toMatchSnapshot();
  });

  it("large file list (> 20) shows truncated output", () => {
    const manyFiles = Array.from({ length: 25 }, (_, i) => ({
      srcRelativePath: `file${i}.ts`,
      destRelativePath: `file${i}.ts`,
      destAbsolutePath: `/project/src/file${i}.ts`,
      mode: "rendered" as const,
    }));
    const lines = formatGenerateOutput({ ...baseResult, filesWritten: manyFiles });
    expect(lines.join("\n")).toMatchSnapshot();
  });
});

// =============================================================================
// formatPatchReport snapshots
// =============================================================================

describe("formatPatchReport snapshots", () => {
  it("all applied", () => {
    const report: PatchReport = {
      total: 2,
      applied: 2,
      skipped: 0,
      failed: 0,
      entries: [
        { kind: "marker_insert", file: "app.ts", idempotencyKey: "k1", status: "applied" },
        { kind: "marker_replace", file: "app.ts", idempotencyKey: "k2", status: "applied" },
      ],
    };
    expect(formatPatchReport(report)).toMatchSnapshot();
  });

  it("mixed applied/skipped/failed", () => {
    const report: PatchReport = {
      total: 3,
      applied: 1,
      skipped: 1,
      failed: 1,
      entries: [
        { kind: "marker_insert", file: "a.ts", idempotencyKey: "k1", status: "applied" },
        {
          kind: "append_if_missing",
          file: "b.ts",
          idempotencyKey: "k2",
          status: "skipped",
          reason: "already applied",
        },
        {
          kind: "marker_replace",
          file: "c.ts",
          idempotencyKey: "k3",
          status: "failed",
          reason: "marker not found",
        },
      ],
    };
    expect(formatPatchReport(report)).toMatchSnapshot();
  });

  it("empty entries", () => {
    const report: PatchReport = {
      total: 0,
      applied: 0,
      skipped: 0,
      failed: 0,
      entries: [],
    };
    expect(formatPatchReport(report)).toMatchSnapshot();
  });
});

// =============================================================================
// formatHookReport snapshots
// =============================================================================

describe("formatHookReport snapshots", () => {
  it("all succeeded under 1s", () => {
    const report: HookReport = {
      total: 2,
      succeeded: 2,
      failed: 0,
      totalDurationMs: 456,
      success: true,
    };
    expect(formatHookReport(report)).toMatchSnapshot();
  });

  it("partial failure over 1s", () => {
    const report: HookReport = {
      total: 3,
      succeeded: 2,
      failed: 1,
      totalDurationMs: 2345,
      success: false,
    };
    expect(formatHookReport(report)).toMatchSnapshot();
  });
});

// =============================================================================
// formatCheckReport snapshots
// =============================================================================

describe("formatCheckReport snapshots", () => {
  it("all passed", () => {
    const report: CheckReport = {
      total: 3,
      passed: 3,
      failed: 0,
      totalDurationMs: 999,
      success: true,
    };
    expect(formatCheckReport(report)).toMatchSnapshot();
  });

  it("one failed", () => {
    const report: CheckReport = {
      total: 2,
      passed: 1,
      failed: 1,
      totalDurationMs: 5000,
      success: false,
    };
    expect(formatCheckReport(report)).toMatchSnapshot();
  });
});

// =============================================================================
// formatTraceOutput snapshots
// =============================================================================

describe("formatTraceOutput snapshots", () => {
  it("returns empty array for empty trace", () => {
    const trace: TraceJson = { trace: [], totalDurationMs: 0 };
    const lines = formatTraceOutput(trace);
    expect(lines).toHaveLength(0);
    expect(lines).toMatchSnapshot();
  });

  it("formats multi-phase trace with alignment", () => {
    const trace: TraceJson = {
      trace: [
        { name: "resolve pack", durationMs: 12 },
        { name: "load manifest", durationMs: 34 },
        { name: "render templates", durationMs: 1234 },
        { name: "apply patches", durationMs: 567 },
      ],
      totalDurationMs: 1847,
    };
    const lines = formatTraceOutput(trace);
    expect(lines.join("\n")).toMatchSnapshot();
  });

  it("handles in-progress phase (no durationMs)", () => {
    const trace: TraceJson = {
      trace: [
        { name: "resolve pack", durationMs: 5 },
        { name: "render templates" }, // no durationMs = in progress
      ],
      totalDurationMs: 5,
    };
    const lines = formatTraceOutput(trace);
    expect(lines.join("\n")).toMatchSnapshot();
  });
});
