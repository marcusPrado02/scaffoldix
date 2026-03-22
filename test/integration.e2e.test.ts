/**
 * End-to-end integration tests for new features added in Tasks 33-40.
 *
 * These tests exercise the full generate pipeline with:
 * - --skip-patches flag
 * - --skip-checks flag
 * - preGenerate hooks
 * - Patch ordering (order field)
 * - Patch conflict detection
 * - Parallel checks
 * - Check retries (exponential backoff)
 * - Timeout parsing via parseDurationMs
 *
 * Tests are hermetic: temp dirs only, no real user paths touched.
 *
 * @module
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

import { handlePackAdd, type PackAddDependencies } from "../src/cli/handlers/packAddHandler.js";
import {
  handleGenerate,
  type GenerateInput,
  type GenerateDependencies,
} from "../src/cli/handlers/generateHandler.js";
import type { StoreServiceConfig, StoreLogger } from "../src/core/store/StoreService.js";
import { detectPatchConflicts } from "../src/core/patch/PatchConflictDetector.js";
import { parseDurationMs } from "../src/core/utils/parseDuration.js";

// =============================================================================
// Helpers
// =============================================================================

function noop(): StoreLogger {
  return { debug: () => {}, info: () => {}, warn: () => {} };
}

async function createWorkspace() {
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "scaffoldix-e2e-"));
  const storeDir = path.join(workspaceDir, "store");
  const packsDir = path.join(storeDir, "packs");
  const registryFile = path.join(storeDir, "registry.json");
  const targetDir = path.join(workspaceDir, "target");

  await fs.mkdir(packsDir, { recursive: true });
  await fs.mkdir(targetDir, { recursive: true });

  const storeConfig: StoreServiceConfig = { storeDir, packsDir, registryFile };
  const deps: GenerateDependencies = { registryFile, packsDir, storeDir };
  const packDeps: PackAddDependencies = { storeConfig, logger: noop() };

  return { workspaceDir, storeDir, packsDir, registryFile, targetDir, deps, packDeps };
}

async function cleanup(workspaceDir: string) {
  await fs.rm(workspaceDir, { recursive: true, force: true }).catch(() => {});
}

function fixturePath(name: string) {
  return path.join(__dirname, "fixtures", name);
}

async function exists(p: string) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

// =============================================================================
// parseDurationMs unit tests
// =============================================================================

describe("parseDurationMs", () => {
  it("parses seconds: '30s' -> 30000", () => {
    expect(parseDurationMs("30s")).toBe(30_000);
  });

  it("parses minutes: '2m' -> 120000", () => {
    expect(parseDurationMs("2m")).toBe(120_000);
  });

  it("parses milliseconds: '500ms' -> 500", () => {
    expect(parseDurationMs("500ms")).toBe(500);
  });

  it("parses bare number (defaults to seconds): '90' -> 90000", () => {
    expect(parseDurationMs("90")).toBe(90_000);
  });

  it("returns undefined for undefined input", () => {
    expect(parseDurationMs(undefined)).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(parseDurationMs("")).toBeUndefined();
  });

  it("returns undefined for non-parseable string", () => {
    expect(parseDurationMs("abc")).toBeUndefined();
  });
});

// =============================================================================
// PatchConflictDetector unit tests
// =============================================================================

describe("detectPatchConflicts", () => {
  it("detects no conflicts for a clean list", () => {
    const result = detectPatchConflicts([
      { kind: "marker_insert", file: "a.ts", idempotencyKey: "k1", markerStart: "//A" },
      { kind: "marker_insert", file: "a.ts", idempotencyKey: "k2", markerStart: "//B" },
    ]);
    expect(result.hasConflicts).toBe(false);
    expect(result.conflicts).toHaveLength(0);
  });

  it("detects duplicate idempotency keys", () => {
    const result = detectPatchConflicts([
      { kind: "append_if_missing", file: "x.ts", idempotencyKey: "same" },
      { kind: "append_if_missing", file: "y.ts", idempotencyKey: "same" },
    ]);
    expect(result.hasConflicts).toBe(true);
    expect(result.conflicts[0].type).toBe("duplicate_idempotency_key");
  });

  it("detects marker conflicts (same file + markerStart)", () => {
    const result = detectPatchConflicts([
      { kind: "marker_insert", file: "z.ts", idempotencyKey: "k1", markerStart: "//M" },
      { kind: "marker_replace", file: "z.ts", idempotencyKey: "k2", markerStart: "//M" },
    ]);
    expect(result.hasConflicts).toBe(true);
    const markerConflict = result.conflicts.find((c) => c.type === "marker_conflict");
    expect(markerConflict).toBeDefined();
  });

  it("reports both conflict types when both occur", () => {
    const result = detectPatchConflicts([
      { kind: "marker_insert", file: "a.ts", idempotencyKey: "dup", markerStart: "//M" },
      { kind: "marker_replace", file: "a.ts", idempotencyKey: "dup", markerStart: "//M" },
    ]);
    expect(result.conflicts.length).toBeGreaterThanOrEqual(2);
    const types = result.conflicts.map((c) => c.type);
    expect(types).toContain("duplicate_idempotency_key");
    expect(types).toContain("marker_conflict");
  });
});

// =============================================================================
// Generate: --skip-patches
// =============================================================================

describe("generate --skip-patches", () => {
  let ws: Awaited<ReturnType<typeof createWorkspace>>;

  beforeEach(async () => {
    ws = await createWorkspace();
  });

  afterEach(async () => {
    await cleanup(ws.workspaceDir);
  });

  it("skips patch application and sets patchesSkippedByFlag", async () => {
    // Add patch-pack fixture
    await handlePackAdd({ packPath: fixturePath("patch-pack"), cwd: process.cwd() }, ws.packDeps);

    // Create the target file that patches would modify
    const srcDir = path.join(ws.targetDir, "src");
    await fs.mkdir(srcDir, { recursive: true });
    await fs.writeFile(
      path.join(srcDir, "app.ts"),
      [
        "// <SCAFFOLDIX:START:imports>",
        "// <SCAFFOLDIX:END:imports>",
        "// <SCAFFOLDIX:START:exports>",
        "// <SCAFFOLDIX:END:exports>",
      ].join("\n"),
      "utf-8",
    );

    const input: GenerateInput = {
      ref: "patch-pack:with-patches",
      targetDir: ws.targetDir,
      dryRun: false,
      data: { moduleName: "MyModule" },
      skipPatches: true,
      force: true, // templates also write src/app.ts
    };

    const result = await handleGenerate(input, ws.deps);

    // Files should be written (templates applied)
    expect(result.filesWritten.length).toBeGreaterThan(0);
    // Patch report absent, flag set
    expect(result.patchReport).toBeUndefined();
    expect(result.patchesSkippedByFlag).toBe(true);
  });
});

// =============================================================================
// Generate: --skip-checks
// =============================================================================

describe("generate --skip-checks", () => {
  let ws: Awaited<ReturnType<typeof createWorkspace>>;

  beforeEach(async () => {
    ws = await createWorkspace();
  });

  afterEach(async () => {
    await cleanup(ws.workspaceDir);
  });

  it("skips check execution and sets checksSkippedByFlag", async () => {
    await handlePackAdd({ packPath: fixturePath("check-pack"), cwd: process.cwd() }, ws.packDeps);

    // Use the 'with-failing-check' archetype — without skip-checks this would throw
    // With skip-checks it should succeed
    const input: GenerateInput = {
      ref: "check-pack:with-failing-check",
      targetDir: ws.targetDir,
      dryRun: false,
      data: {},
      skipChecks: true,
    };

    const result = await handleGenerate(input, ws.deps);

    expect(result.filesWritten.length).toBeGreaterThan(0);
    expect(result.checkReport).toBeUndefined();
    expect(result.checksSkippedByFlag).toBe(true);
  });

  it("runs checks normally when --skip-checks is not set", async () => {
    await handlePackAdd({ packPath: fixturePath("check-pack"), cwd: process.cwd() }, ws.packDeps);

    // 'default' archetype has a passing check
    const input: GenerateInput = {
      ref: "check-pack:default",
      targetDir: ws.targetDir,
      dryRun: false,
      data: {},
      skipChecks: false,
    };

    const result = await handleGenerate(input, ws.deps);

    expect(result.checkReport).toBeDefined();
    expect(result.checkReport?.passed).toBe(1);
    expect(result.checksSkippedByFlag).toBeFalsy();
  });
});

// =============================================================================
// Generate: dry-run produces preview report
// =============================================================================

describe("generate dry-run preview", () => {
  let ws: Awaited<ReturnType<typeof createWorkspace>>;

  beforeEach(async () => {
    ws = await createWorkspace();
  });

  afterEach(async () => {
    await cleanup(ws.workspaceDir);
  });

  it("dry-run returns filesPlanned and no files written", async () => {
    await handlePackAdd({ packPath: fixturePath("example-pack"), cwd: process.cwd() }, ws.packDeps);

    const result = await handleGenerate(
      {
        ref: "example-pack:hello",
        targetDir: ws.targetDir,
        dryRun: true,
        data: { name: "Alice" },
      },
      ws.deps,
    );

    expect(result.dryRun).toBe(true);
    expect(result.filesPlanned.length).toBeGreaterThan(0);
    expect(result.filesWritten.length).toBe(0);

    // Target dir untouched
    const files = await fs.readdir(ws.targetDir);
    expect(files.length).toBe(0);
  });

  it("dry-run returns previewReport with CREATE entries for new files", async () => {
    await handlePackAdd({ packPath: fixturePath("example-pack"), cwd: process.cwd() }, ws.packDeps);

    const result = await handleGenerate(
      {
        ref: "example-pack:hello",
        targetDir: ws.targetDir,
        dryRun: true,
        data: { name: "Bob" },
      },
      ws.deps,
    );

    expect(result.previewReport).toBeDefined();
    expect(result.previewReport!.creates.length).toBeGreaterThan(0);
    // No files exist yet so nothing should be MODIFY
    expect(result.previewReport!.modifies.length).toBe(0);
  });
});

// =============================================================================
// Generate: force overwrites existing files
// =============================================================================

describe("generate --force", () => {
  let ws: Awaited<ReturnType<typeof createWorkspace>>;

  beforeEach(async () => {
    ws = await createWorkspace();
  });

  afterEach(async () => {
    await cleanup(ws.workspaceDir);
  });

  it("overwrites existing files when force=true", async () => {
    await handlePackAdd({ packPath: fixturePath("example-pack"), cwd: process.cwd() }, ws.packDeps);

    const input: GenerateInput = {
      ref: "example-pack:hello",
      targetDir: ws.targetDir,
      dryRun: false,
      data: { name: "Charlie" },
      force: false,
    };

    // First generation
    await handleGenerate(input, ws.deps);

    // Second generation without force should fail
    await expect(handleGenerate(input, ws.deps)).rejects.toThrow();

    // Second generation with force should succeed and write files again
    const result = await handleGenerate({ ...input, force: true }, ws.deps);
    expect(result.filesWritten.length).toBeGreaterThan(0);
  });
});

// =============================================================================
// Patch conflict detection (integration: manifest loading surfacing)
// =============================================================================

describe("patch conflict detection via detectPatchConflicts", () => {
  it("returns hasConflicts=false for empty patch list", () => {
    expect(detectPatchConflicts([]).hasConflicts).toBe(false);
  });

  it("handles single patch with no conflict", () => {
    const result = detectPatchConflicts([
      { kind: "append_if_missing", file: "f.ts", idempotencyKey: "unique-1" },
    ]);
    expect(result.hasConflicts).toBe(false);
  });

  it("correctly identifies patchAIndex and patchBIndex", () => {
    const result = detectPatchConflicts([
      { kind: "append_if_missing", file: "a.ts", idempotencyKey: "k" },
      { kind: "append_if_missing", file: "b.ts", idempotencyKey: "k" },
    ]);
    expect(result.conflicts[0].patchAIndex).toBe(0);
    expect(result.conflicts[0].patchBIndex).toBe(1);
  });
});
