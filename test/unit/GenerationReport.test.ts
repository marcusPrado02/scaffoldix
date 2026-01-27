/**
 * Unit tests for GenerationReport and ProjectStateManager v2 schema.
 *
 * Tests the generation history persistence including patches, hooks, checks.
 *
 * @module
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

import {
  ProjectStateManager,
  type GenerationReport,
  type ProjectStateV2,
  CURRENT_SCHEMA_VERSION,
} from "../../src/core/state/ProjectStateManager.js";

// =============================================================================
// Test Helpers
// =============================================================================

async function createTempDir(): Promise<string> {
  const baseDir = path.join(os.tmpdir(), "scaffoldix-report-test");
  await fs.mkdir(baseDir, { recursive: true });
  return await fs.mkdtemp(path.join(baseDir, "test-"));
}

function createSampleReport(overrides: Partial<GenerationReport> = {}): GenerationReport {
  return {
    id: "gen-123",
    timestamp: "2026-01-27T12:00:00.000Z",
    packId: "test-pack",
    packVersion: "1.0.0",
    archetypeId: "default",
    inputs: { name: "MyEntity" },
    status: "success",
    ...overrides,
  };
}

function createReportWithPatches(): GenerationReport {
  return {
    id: "gen-with-patches",
    timestamp: "2026-01-27T12:00:00.000Z",
    packId: "patch-pack",
    packVersion: "1.0.0",
    archetypeId: "with-patches",
    inputs: { moduleName: "User" },
    status: "success",
    patches: {
      total: 2,
      applied: 2,
      skipped: 0,
      failed: 0,
      items: [
        {
          kind: "marker_insert",
          file: "src/app.ts",
          idempotencyKey: "add-import",
          status: "applied",
          durationMs: 5,
        },
        {
          kind: "marker_replace",
          file: "src/app.ts",
          idempotencyKey: "add-export",
          status: "applied",
          durationMs: 3,
        },
      ],
    },
  };
}

function createReportWithHooks(): GenerationReport {
  return {
    id: "gen-with-hooks",
    timestamp: "2026-01-27T12:00:00.000Z",
    packId: "hook-pack",
    packVersion: "1.0.0",
    archetypeId: "with-hooks",
    inputs: {},
    status: "success",
    hooks: {
      items: [
        {
          command: "npm install",
          status: "success",
          exitCode: 0,
          durationMs: 1500,
        },
        {
          command: "npm run build",
          status: "success",
          exitCode: 0,
          durationMs: 2000,
        },
      ],
    },
  };
}

function createReportWithChecks(): GenerationReport {
  return {
    id: "gen-with-checks",
    timestamp: "2026-01-27T12:00:00.000Z",
    packId: "check-pack",
    packVersion: "1.0.0",
    archetypeId: "with-checks",
    inputs: {},
    status: "success",
    checks: {
      items: [
        {
          command: "npm test",
          status: "success",
          exitCode: 0,
          durationMs: 3000,
        },
      ],
    },
  };
}

function createFailureReport(): GenerationReport {
  return {
    id: "gen-failure",
    timestamp: "2026-01-27T12:00:00.000Z",
    packId: "test-pack",
    packVersion: "1.0.0",
    archetypeId: "default",
    inputs: {},
    status: "failure",
    error: {
      stage: "patches",
      message: "Marker not found in target file",
      details: "Expected marker: // <SCAFFOLDIX:START:imports>",
    },
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("GenerationReport and ProjectStateManager v2", () => {
  let tempDir: string;
  let manager: ProjectStateManager;

  beforeEach(async () => {
    tempDir = await createTempDir();
    manager = new ProjectStateManager();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  // ===========================================================================
  // Schema Version
  // ===========================================================================

  describe("schema version", () => {
    it("CURRENT_SCHEMA_VERSION is 2", () => {
      expect(CURRENT_SCHEMA_VERSION).toBe(2);
    });
  });

  // ===========================================================================
  // recordGeneration() - Success Cases
  // ===========================================================================

  describe("recordGeneration() - success cases", () => {
    it("creates state with generations array on first record", async () => {
      const report = createSampleReport();

      const state = await manager.recordGeneration(tempDir, report);

      expect(state.schemaVersion).toBe(2);
      expect(state.generations).toHaveLength(1);
      expect(state.generations[0].id).toBe("gen-123");
      expect(state.generations[0].status).toBe("success");
    });

    it("appends to generations array on subsequent records (history)", async () => {
      const report1 = createSampleReport({ id: "gen-1", timestamp: "2026-01-27T10:00:00.000Z" });
      const report2 = createSampleReport({ id: "gen-2", timestamp: "2026-01-27T11:00:00.000Z" });
      const report3 = createSampleReport({ id: "gen-3", timestamp: "2026-01-27T12:00:00.000Z" });

      await manager.recordGeneration(tempDir, report1);
      await manager.recordGeneration(tempDir, report2);
      const state = await manager.recordGeneration(tempDir, report3);

      expect(state.generations).toHaveLength(3);
      expect(state.generations[0].id).toBe("gen-1");
      expect(state.generations[1].id).toBe("gen-2");
      expect(state.generations[2].id).toBe("gen-3");
    });

    it("persists patches summary and items", async () => {
      const report = createReportWithPatches();

      const state = await manager.recordGeneration(tempDir, report);

      const gen = state.generations[0];
      expect(gen.patches).toBeDefined();
      expect(gen.patches!.total).toBe(2);
      expect(gen.patches!.applied).toBe(2);
      expect(gen.patches!.items).toHaveLength(2);
      expect(gen.patches!.items[0].kind).toBe("marker_insert");
      expect(gen.patches!.items[0].status).toBe("applied");
    });

    it("persists hooks items", async () => {
      const report = createReportWithHooks();

      const state = await manager.recordGeneration(tempDir, report);

      const gen = state.generations[0];
      expect(gen.hooks).toBeDefined();
      expect(gen.hooks!.items).toHaveLength(2);
      expect(gen.hooks!.items[0].command).toBe("npm install");
      expect(gen.hooks!.items[0].status).toBe("success");
      expect(gen.hooks!.items[0].durationMs).toBe(1500);
    });

    it("persists checks items", async () => {
      const report = createReportWithChecks();

      const state = await manager.recordGeneration(tempDir, report);

      const gen = state.generations[0];
      expect(gen.checks).toBeDefined();
      expect(gen.checks!.items).toHaveLength(1);
      expect(gen.checks!.items[0].command).toBe("npm test");
      expect(gen.checks!.items[0].exitCode).toBe(0);
    });

    it("persists full report with patches, hooks, and checks", async () => {
      const report: GenerationReport = {
        id: "gen-full",
        timestamp: "2026-01-27T12:00:00.000Z",
        packId: "full-pack",
        packVersion: "1.0.0",
        archetypeId: "complete",
        inputs: { name: "Test" },
        status: "success",
        patches: {
          total: 1,
          applied: 1,
          skipped: 0,
          failed: 0,
          items: [
            { kind: "marker_insert", file: "app.ts", idempotencyKey: "key1", status: "applied" },
          ],
        },
        hooks: {
          items: [{ command: "echo done", status: "success", exitCode: 0, durationMs: 10 }],
        },
        checks: {
          items: [{ command: "npm test", status: "success", exitCode: 0, durationMs: 100 }],
        },
      };

      const state = await manager.recordGeneration(tempDir, report);

      const gen = state.generations[0];
      expect(gen.patches?.total).toBe(1);
      expect(gen.hooks?.items).toHaveLength(1);
      expect(gen.checks?.items).toHaveLength(1);
    });

    it("updates updatedAt on each record", async () => {
      const report1 = createSampleReport({ id: "gen-1" });

      const state1 = await manager.recordGeneration(tempDir, report1);
      const updatedAt1 = new Date(state1.updatedAt);

      // Small delay to ensure different timestamps
      await new Promise((r) => setTimeout(r, 10));

      const report2 = createSampleReport({ id: "gen-2" });
      const state2 = await manager.recordGeneration(tempDir, report2);
      const updatedAt2 = new Date(state2.updatedAt);

      expect(updatedAt2.getTime()).toBeGreaterThan(updatedAt1.getTime());
    });
  });

  // ===========================================================================
  // recordGeneration() - Failure Cases
  // ===========================================================================

  describe("recordGeneration() - failure cases", () => {
    it("persists failure report with error details", async () => {
      const report = createFailureReport();

      const state = await manager.recordGeneration(tempDir, report);

      const gen = state.generations[0];
      expect(gen.status).toBe("failure");
      expect(gen.error).toBeDefined();
      expect(gen.error!.stage).toBe("patches");
      expect(gen.error!.message).toContain("Marker not found");
    });

    it("failure report can have partial patches (before failure)", async () => {
      const report: GenerationReport = {
        id: "gen-partial-failure",
        timestamp: "2026-01-27T12:00:00.000Z",
        packId: "test-pack",
        packVersion: "1.0.0",
        archetypeId: "default",
        inputs: {},
        status: "failure",
        patches: {
          total: 2,
          applied: 1,
          skipped: 0,
          failed: 1,
          items: [
            { kind: "marker_insert", file: "a.ts", idempotencyKey: "k1", status: "applied" },
            {
              kind: "marker_insert",
              file: "b.ts",
              idempotencyKey: "k2",
              status: "failed",
              reason: "marker_missing",
            },
          ],
        },
        error: {
          stage: "patches",
          message: "Patch failed",
        },
      };

      const state = await manager.recordGeneration(tempDir, report);

      const gen = state.generations[0];
      expect(gen.patches!.failed).toBe(1);
      expect(gen.patches!.items[1].status).toBe("failed");
      expect(gen.patches!.items[1].reason).toBe("marker_missing");
    });
  });

  // ===========================================================================
  // Backward Compatibility - v1 to v2 Migration
  // ===========================================================================

  describe("backward compatibility - v1 to v2 migration", () => {
    it("reads v1 state and upgrades to v2 on next write", async () => {
      // Write a v1 state file manually
      const v1State = {
        schemaVersion: 1,
        updatedAt: "2026-01-26T10:00:00.000Z",
        lastGeneration: {
          packId: "old-pack",
          packVersion: "0.1.0",
          archetypeId: "legacy",
          inputs: { foo: "bar" },
          timestamp: "2026-01-26T10:00:00.000Z",
        },
      };

      const stateFile = path.join(tempDir, ".scaffoldix", "state.json");
      await fs.mkdir(path.dirname(stateFile), { recursive: true });
      await fs.writeFile(stateFile, JSON.stringify(v1State, null, 2));

      // Read should work (manager handles both v1 and v2)
      const readState = await manager.read(tempDir);
      expect(readState).not.toBeNull();

      // Now record a new generation - should upgrade to v2
      const newReport = createSampleReport({ id: "gen-new" });
      const upgradedState = await manager.recordGeneration(tempDir, newReport);

      // Should be v2 now
      expect(upgradedState.schemaVersion).toBe(2);

      // Should have migrated v1 lastGeneration to generations array
      expect(upgradedState.generations).toHaveLength(2);

      // First entry should be the migrated v1 record
      expect(upgradedState.generations[0].packId).toBe("old-pack");
      expect(upgradedState.generations[0].status).toBe("success"); // Assumed success for migrated

      // Second entry should be the new record
      expect(upgradedState.generations[1].id).toBe("gen-new");
    });

    it("preserves v1 data fields during migration", async () => {
      const v1State = {
        schemaVersion: 1,
        updatedAt: "2026-01-20T08:00:00.000Z",
        lastGeneration: {
          packId: "@org/special-pack",
          packVersion: "2.0.0-beta",
          archetypeId: "component",
          inputs: { name: "Widget", count: 42 },
          timestamp: "2026-01-20T08:00:00.000Z",
        },
      };

      const stateFile = path.join(tempDir, ".scaffoldix", "state.json");
      await fs.mkdir(path.dirname(stateFile), { recursive: true });
      await fs.writeFile(stateFile, JSON.stringify(v1State, null, 2));

      const newReport = createSampleReport({ id: "gen-after-migration" });
      const state = await manager.recordGeneration(tempDir, newReport);

      const migrated = state.generations[0];
      expect(migrated.packId).toBe("@org/special-pack");
      expect(migrated.packVersion).toBe("2.0.0-beta");
      expect(migrated.archetypeId).toBe("component");
      expect(migrated.inputs).toEqual({ name: "Widget", count: 42 });
      expect(migrated.timestamp).toBe("2026-01-20T08:00:00.000Z");
    });
  });

  // ===========================================================================
  // History Bounding
  // ===========================================================================

  describe("history bounding", () => {
    it("keeps only last 50 generations to prevent unbounded growth", async () => {
      // Create 55 reports
      for (let i = 0; i < 55; i++) {
        const report = createSampleReport({
          id: `gen-${i}`,
          timestamp: `2026-01-27T${String(i).padStart(2, "0")}:00:00.000Z`,
        });
        await manager.recordGeneration(tempDir, report);
      }

      const state = (await manager.read(tempDir)) as ProjectStateV2;

      // Should have exactly 50 (the limit)
      expect(state.generations).toHaveLength(50);

      // Oldest entries should be dropped, newest kept
      expect(state.generations[0].id).toBe("gen-5"); // First 5 dropped
      expect(state.generations[49].id).toBe("gen-54"); // Last one kept
    });
  });

  // ===========================================================================
  // State File Format
  // ===========================================================================

  describe("state file format", () => {
    it("writes state with 2-space indentation", async () => {
      const report = createSampleReport();
      await manager.recordGeneration(tempDir, report);

      const stateFile = path.join(tempDir, ".scaffoldix", "state.json");
      const content = await fs.readFile(stateFile, "utf-8");

      expect(content).toContain('  "schemaVersion"');
      expect(content).toContain('  "generations"');
    });

    it("state file ends with newline", async () => {
      const report = createSampleReport();
      await manager.recordGeneration(tempDir, report);

      const stateFile = path.join(tempDir, ".scaffoldix", "state.json");
      const content = await fs.readFile(stateFile, "utf-8");

      expect(content.endsWith("\n")).toBe(true);
    });
  });

  // ===========================================================================
  // read() with v2 schema
  // ===========================================================================

  describe("read() with v2 schema", () => {
    it("returns v2 state with generations array", async () => {
      const report = createSampleReport();
      await manager.recordGeneration(tempDir, report);

      const state = (await manager.read(tempDir)) as ProjectStateV2;

      expect(state.schemaVersion).toBe(2);
      expect(state.generations).toBeDefined();
      expect(Array.isArray(state.generations)).toBe(true);
    });

    it("lastGeneration returns the most recent generation for compat", async () => {
      const report1 = createSampleReport({ id: "gen-old", packId: "old" });
      const report2 = createSampleReport({ id: "gen-new", packId: "new" });

      await manager.recordGeneration(tempDir, report1);
      await manager.recordGeneration(tempDir, report2);

      const state = (await manager.read(tempDir)) as ProjectStateV2;

      // lastGeneration should point to the most recent
      expect(state.lastGeneration.packId).toBe("new");
    });
  });
});
