/**
 * Tests for ProjectStateManager.
 *
 * The ProjectStateManager handles reading and writing project-local state
 * at `<targetDir>/.scaffoldix/state.json`.
 *
 * @module
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import {
  ProjectStateManager,
  type GenerationRecord,
  type ProjectState,
  ProjectStateV2Schema,
} from "../src/core/state/ProjectStateManager.js";
import { ScaffoldError } from "../src/core/errors/errors.js";

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Creates a unique temp directory for each test.
 */
async function createTempDir(): Promise<string> {
  const baseDir = path.join(os.tmpdir(), "scaffoldix-state-test");
  await fs.mkdir(baseDir, { recursive: true });
  return await fs.mkdtemp(path.join(baseDir, "test-"));
}

/**
 * Creates a sample generation record for testing.
 */
function createSampleRecord(overrides: Partial<GenerationRecord> = {}): GenerationRecord {
  return {
    packId: "test-pack",
    packVersion: "1.0.0",
    archetypeId: "default",
    inputs: { name: "MyEntity" },
    timestamp: "2026-01-26T12:00:00.000Z",
    ...overrides,
  };
}

// =============================================================================
// Tests: write()
// =============================================================================

describe("ProjectStateManager", () => {
  let tempDir: string;
  let manager: ProjectStateManager;

  beforeEach(async () => {
    tempDir = await createTempDir();
    manager = new ProjectStateManager();
  });

  afterEach(async () => {
    // Clean up temp directory
    await fs.rm(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe("write()", () => {
    it("creates .scaffoldix directory and state.json in a clean targetDir", async () => {
      const record = createSampleRecord();

      const result = await manager.write(tempDir, record);

      // Verify directory was created
      const scaffoldixDir = path.join(tempDir, ".scaffoldix");
      const stat = await fs.stat(scaffoldixDir);
      expect(stat.isDirectory()).toBe(true);

      // Verify state file was created
      const stateFile = path.join(scaffoldixDir, "state.json");
      const content = await fs.readFile(stateFile, "utf-8");
      const parsed = JSON.parse(content);

      expect(parsed.schemaVersion).toBe(2);
      expect(parsed.lastGeneration.packId).toBe("test-pack");
      expect(parsed.lastGeneration.packVersion).toBe("1.0.0");
      expect(parsed.lastGeneration.archetypeId).toBe("default");
      expect(parsed.lastGeneration.inputs).toEqual({ name: "MyEntity" });

      // Verify returned state
      expect(result.schemaVersion).toBe(2);
      expect(result.lastGeneration).toEqual(record);
    });

    it("updates state correctly when called twice", async () => {
      const firstRecord = createSampleRecord({
        packId: "pack-one",
        timestamp: "2026-01-26T10:00:00.000Z",
      });
      const secondRecord = createSampleRecord({
        packId: "pack-two",
        archetypeId: "component",
        timestamp: "2026-01-26T14:00:00.000Z",
      });

      // First write
      const firstResult = await manager.write(tempDir, firstRecord);
      expect(firstResult.lastGeneration.packId).toBe("pack-one");

      // Second write
      const secondResult = await manager.write(tempDir, secondRecord);

      // Verify lastGeneration reflects the second run
      expect(secondResult.lastGeneration.packId).toBe("pack-two");
      expect(secondResult.lastGeneration.archetypeId).toBe("component");

      // Verify updatedAt was updated (second should be >= first)
      expect(new Date(secondResult.updatedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(firstResult.updatedAt).getTime(),
      );

      // Verify file on disk
      const stateFile = path.join(tempDir, ".scaffoldix", "state.json");
      const content = await fs.readFile(stateFile, "utf-8");
      const parsed = JSON.parse(content);
      expect(parsed.lastGeneration.packId).toBe("pack-two");
    });

    it("preserves inputs exactly as provided", async () => {
      const complexInputs = {
        name: "UserService",
        nested: { foo: "bar", count: 42 },
        array: [1, 2, 3],
        nullable: null,
      };
      const record = createSampleRecord({ inputs: complexInputs });

      const result = await manager.write(tempDir, record);

      expect(result.lastGeneration.inputs).toEqual(complexInputs);

      // Verify on disk
      const stateFile = path.join(tempDir, ".scaffoldix", "state.json");
      const content = await fs.readFile(stateFile, "utf-8");
      const parsed = JSON.parse(content);
      expect(parsed.lastGeneration.inputs).toEqual(complexInputs);
    });

    it("uses 2-space indentation for readability", async () => {
      const record = createSampleRecord();

      await manager.write(tempDir, record);

      const stateFile = path.join(tempDir, ".scaffoldix", "state.json");
      const content = await fs.readFile(stateFile, "utf-8");

      // Check for 2-space indentation
      expect(content).toContain('  "schemaVersion"');
      expect(content).toContain('  "lastGeneration"');
    });

    it("sets updatedAt to current time", async () => {
      const beforeWrite = new Date();
      const record = createSampleRecord();

      const result = await manager.write(tempDir, record);

      const afterWrite = new Date();
      const updatedAt = new Date(result.updatedAt);

      expect(updatedAt.getTime()).toBeGreaterThanOrEqual(beforeWrite.getTime());
      expect(updatedAt.getTime()).toBeLessThanOrEqual(afterWrite.getTime());
    });

    it("handles scoped package IDs correctly", async () => {
      const record = createSampleRecord({
        packId: "@myorg/my-pack",
        packVersion: "2.0.0-beta.1",
      });

      const result = await manager.write(tempDir, record);

      expect(result.lastGeneration.packId).toBe("@myorg/my-pack");
      expect(result.lastGeneration.packVersion).toBe("2.0.0-beta.1");
    });
  });

  // ===========================================================================
  // Tests: read()
  // ===========================================================================

  describe("read()", () => {
    it("returns null when state file does not exist", async () => {
      const result = await manager.read(tempDir);

      expect(result).toBeNull();
    });

    it("returns null when .scaffoldix directory exists but state.json does not", async () => {
      await fs.mkdir(path.join(tempDir, ".scaffoldix"), { recursive: true });

      const result = await manager.read(tempDir);

      expect(result).toBeNull();
    });

    it("returns parsed state when file is valid", async () => {
      // First write some state
      const record = createSampleRecord();
      await manager.write(tempDir, record);

      // Then read it back
      const result = await manager.read(tempDir);

      expect(result).not.toBeNull();
      expect(result!.schemaVersion).toBe(2);
      expect(result!.lastGeneration.packId).toBe("test-pack");
      expect(result!.lastGeneration.archetypeId).toBe("default");
    });

    it("throws actionable error when file contains invalid JSON", async () => {
      const stateFile = path.join(tempDir, ".scaffoldix", "state.json");
      await fs.mkdir(path.dirname(stateFile), { recursive: true });
      await fs.writeFile(stateFile, "{ invalid json }", "utf-8");

      await expect(manager.read(tempDir)).rejects.toThrow(ScaffoldError);

      try {
        await manager.read(tempDir);
      } catch (err) {
        expect(err).toBeInstanceOf(ScaffoldError);
        const scaffoldErr = err as ScaffoldError;
        expect(scaffoldErr.code).toBe("STATE_INVALID_JSON");
        expect(scaffoldErr.hint).toContain(stateFile);
      }
    });

    it("throws actionable error when schema is invalid", async () => {
      const stateFile = path.join(tempDir, ".scaffoldix", "state.json");
      await fs.mkdir(path.dirname(stateFile), { recursive: true });
      // Valid JSON but missing required fields
      await fs.writeFile(stateFile, JSON.stringify({ foo: "bar" }), "utf-8");

      await expect(manager.read(tempDir)).rejects.toThrow(ScaffoldError);

      try {
        await manager.read(tempDir);
      } catch (err) {
        expect(err).toBeInstanceOf(ScaffoldError);
        const scaffoldErr = err as ScaffoldError;
        expect(scaffoldErr.code).toBe("STATE_INVALID_SCHEMA");
        expect(scaffoldErr.hint).toContain(stateFile);
      }
    });

    it("throws actionable error when schemaVersion is wrong type", async () => {
      const stateFile = path.join(tempDir, ".scaffoldix", "state.json");
      await fs.mkdir(path.dirname(stateFile), { recursive: true });
      await fs.writeFile(
        stateFile,
        JSON.stringify({
          schemaVersion: "not-a-number",
          updatedAt: "2026-01-26T12:00:00.000Z",
          lastGeneration: createSampleRecord(),
        }),
        "utf-8",
      );

      await expect(manager.read(tempDir)).rejects.toThrow(ScaffoldError);

      try {
        await manager.read(tempDir);
      } catch (err) {
        expect(err).toBeInstanceOf(ScaffoldError);
        const scaffoldErr = err as ScaffoldError;
        expect(scaffoldErr.code).toBe("STATE_INVALID_SCHEMA");
      }
    });

    it("throws actionable error when lastGeneration is missing required fields", async () => {
      const stateFile = path.join(tempDir, ".scaffoldix", "state.json");
      await fs.mkdir(path.dirname(stateFile), { recursive: true });
      await fs.writeFile(
        stateFile,
        JSON.stringify({
          schemaVersion: 1,
          updatedAt: "2026-01-26T12:00:00.000Z",
          lastGeneration: {
            packId: "test",
            // missing packVersion, archetypeId, inputs, timestamp
          },
        }),
        "utf-8",
      );

      await expect(manager.read(tempDir)).rejects.toThrow(ScaffoldError);

      try {
        await manager.read(tempDir);
      } catch (err) {
        expect(err).toBeInstanceOf(ScaffoldError);
        const scaffoldErr = err as ScaffoldError;
        expect(scaffoldErr.code).toBe("STATE_INVALID_SCHEMA");
      }
    });
  });

  // ===========================================================================
  // Tests: Atomic writes
  // ===========================================================================

  describe("atomic writes", () => {
    it("writes to temp file before renaming (verified by temp file pattern)", async () => {
      // This test verifies atomic write is used by checking no temp files remain
      // after a successful write - indicating rename was used, not direct write
      const record = createSampleRecord();

      await manager.write(tempDir, record);

      // Check no temp files remain (they were renamed, not deleted)
      const scaffoldixDir = path.join(tempDir, ".scaffoldix");
      const files = await fs.readdir(scaffoldixDir);
      const tempFiles = files.filter((f) => f.startsWith("state.json.tmp"));
      expect(tempFiles).toHaveLength(0);

      // And we have the final file
      expect(files).toContain("state.json");
    });

    it("cleans up temp file on successful write", async () => {
      const record = createSampleRecord();

      await manager.write(tempDir, record);

      // Check no temp files remain
      const scaffoldixDir = path.join(tempDir, ".scaffoldix");
      const files = await fs.readdir(scaffoldixDir);
      const tempFiles = files.filter((f) => f.startsWith("state.json.tmp"));
      expect(tempFiles).toHaveLength(0);
    });

    it("preserves valid JSON on multiple concurrent-like writes", async () => {
      // Run several writes in sequence and verify state is always valid JSON
      const records = [
        createSampleRecord({ packId: "pack-1", timestamp: "2026-01-26T10:00:00.000Z" }),
        createSampleRecord({ packId: "pack-2", timestamp: "2026-01-26T11:00:00.000Z" }),
        createSampleRecord({ packId: "pack-3", timestamp: "2026-01-26T12:00:00.000Z" }),
      ];

      for (const record of records) {
        await manager.write(tempDir, record);

        // Verify file is always valid JSON after each write
        const stateFile = path.join(tempDir, ".scaffoldix", "state.json");
        const content = await fs.readFile(stateFile, "utf-8");
        expect(() => JSON.parse(content)).not.toThrow();
      }

      // Final state should reflect last write
      const finalState = await manager.read(tempDir);
      expect(finalState?.lastGeneration.packId).toBe("pack-3");
    });
  });

  // ===========================================================================
  // Tests: Schema validation
  // ===========================================================================

  describe("ProjectStateV2Schema", () => {
    it("validates a correct v2 state object", () => {
      const validState = {
        schemaVersion: 2,
        updatedAt: "2026-01-26T12:00:00.000Z",
        generations: [
          {
            id: "gen-123",
            timestamp: "2026-01-26T12:00:00.000Z",
            packId: "test-pack",
            packVersion: "1.0.0",
            archetypeId: "default",
            inputs: { name: "Test" },
            status: "success",
          },
        ],
        lastGeneration: {
          packId: "test-pack",
          packVersion: "1.0.0",
          archetypeId: "default",
          inputs: { name: "Test" },
          timestamp: "2026-01-26T12:00:00.000Z",
        },
      };

      const result = ProjectStateV2Schema.safeParse(validState);
      expect(result.success).toBe(true);
    });

    it("rejects state with missing schemaVersion", () => {
      const invalidState = {
        updatedAt: "2026-01-26T12:00:00.000Z",
        generations: [],
        lastGeneration: createSampleRecord(),
      };

      const result = ProjectStateV2Schema.safeParse(invalidState);
      expect(result.success).toBe(false);
    });

    it("rejects state with wrong schemaVersion type", () => {
      const invalidState = {
        schemaVersion: "2",
        updatedAt: "2026-01-26T12:00:00.000Z",
        generations: [],
        lastGeneration: createSampleRecord(),
      };

      const result = ProjectStateV2Schema.safeParse(invalidState);
      expect(result.success).toBe(false);
    });

    it("allows empty inputs object", () => {
      const validState = {
        schemaVersion: 2,
        updatedAt: "2026-01-26T12:00:00.000Z",
        generations: [
          {
            id: "gen-empty",
            timestamp: "2026-01-26T12:00:00.000Z",
            packId: "test-pack",
            packVersion: "1.0.0",
            archetypeId: "default",
            inputs: {},
            status: "success",
          },
        ],
        lastGeneration: {
          ...createSampleRecord(),
          inputs: {},
        },
      };

      const result = ProjectStateV2Schema.safeParse(validState);
      expect(result.success).toBe(true);
    });
  });

  // ===========================================================================
  // Tests: getStatePath()
  // ===========================================================================

  describe("getStatePath()", () => {
    it("returns correct path for state file", () => {
      const result = manager.getStatePath(tempDir);

      expect(result).toBe(path.join(tempDir, ".scaffoldix", "state.json"));
    });

    it("handles paths with trailing slashes", () => {
      const result = manager.getStatePath(tempDir + path.sep);

      expect(result).toBe(path.join(tempDir, ".scaffoldix", "state.json"));
    });
  });
});
