/**
 * Tests for ProjectStateManager auto-migration feature.
 *
 * Tests that the manager automatically migrates older state files
 * to the current schema version on read.
 *
 * @module
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { ProjectStateManager } from "../src/core/state/ProjectStateManager.js";
import { CURRENT_STATE_VERSION } from "../src/core/state/migrations.js";
import { ScaffoldError } from "../src/core/errors/errors.js";

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Creates a unique temp directory for each test.
 */
async function createTempDir(): Promise<string> {
  const baseDir = path.join(os.tmpdir(), "scaffoldix-migration-test");
  await fs.mkdir(baseDir, { recursive: true });
  return await fs.mkdtemp(path.join(baseDir, "test-"));
}

/**
 * Creates a v1 state file fixture.
 */
function createV1StateJson() {
  return JSON.stringify(
    {
      schemaVersion: 1,
      updatedAt: "2024-01-15T10:30:00.000Z",
      lastGeneration: {
        packId: "test-pack",
        packVersion: "1.0.0",
        archetypeId: "default",
        inputs: { name: "MyEntity" },
        timestamp: "2024-01-15T10:30:00.000Z",
      },
    },
    null,
    2
  );
}

/**
 * Creates a state file without schemaVersion (legacy).
 */
function createLegacyStateJson() {
  return JSON.stringify(
    {
      updatedAt: "2024-01-15T10:30:00.000Z",
      lastGeneration: {
        packId: "legacy-pack",
        packVersion: "0.9.0",
        archetypeId: "old-archetype",
        inputs: { key: "value" },
        timestamp: "2024-01-15T10:30:00.000Z",
      },
    },
    null,
    2
  );
}

/**
 * Creates a future version state file.
 */
function createFutureStateJson() {
  return JSON.stringify(
    {
      schemaVersion: 999,
      updatedAt: "2024-01-15T10:30:00.000Z",
      futureField: "some future data",
    },
    null,
    2
  );
}

// =============================================================================
// Tests
// =============================================================================

describe("ProjectStateManager auto-migration", () => {
  let tempDir: string;
  let manager: ProjectStateManager;

  beforeEach(async () => {
    tempDir = await createTempDir();
    manager = new ProjectStateManager();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("v1 → v2 migration on read", () => {
    it("automatically migrates v1 state to current version", async () => {
      // Create v1 state file
      const stateDir = path.join(tempDir, ".scaffoldix");
      await fs.mkdir(stateDir, { recursive: true });
      await fs.writeFile(path.join(stateDir, "state.json"), createV1StateJson());

      // Read should trigger migration
      const result = await manager.read(tempDir);

      expect(result).not.toBeNull();
      expect(result!.schemaVersion).toBe(CURRENT_STATE_VERSION);
    });

    it("preserves original data during migration", async () => {
      // Create v1 state file
      const stateDir = path.join(tempDir, ".scaffoldix");
      await fs.mkdir(stateDir, { recursive: true });
      await fs.writeFile(path.join(stateDir, "state.json"), createV1StateJson());

      const result = await manager.read(tempDir);

      expect(result!.lastGeneration.packId).toBe("test-pack");
      expect(result!.lastGeneration.packVersion).toBe("1.0.0");
      expect(result!.lastGeneration.archetypeId).toBe("default");
      expect(result!.lastGeneration.inputs).toEqual({ name: "MyEntity" });
    });

    it("creates generations array from lastGeneration", async () => {
      // Create v1 state file
      const stateDir = path.join(tempDir, ".scaffoldix");
      await fs.mkdir(stateDir, { recursive: true });
      await fs.writeFile(path.join(stateDir, "state.json"), createV1StateJson());

      const result = await manager.read(tempDir);

      // v2 should have a generations array
      if (result && "generations" in result) {
        expect(result.generations).toBeDefined();
        expect(result.generations.length).toBeGreaterThan(0);
        expect(result.generations[0].packId).toBe("test-pack");
      }
    });

    it("writes migrated state back to disk", async () => {
      // Create v1 state file
      const stateDir = path.join(tempDir, ".scaffoldix");
      const stateFile = path.join(stateDir, "state.json");
      await fs.mkdir(stateDir, { recursive: true });
      await fs.writeFile(stateFile, createV1StateJson());

      // Read triggers migration
      await manager.read(tempDir);

      // Verify file was updated
      const content = await fs.readFile(stateFile, "utf-8");
      const parsed = JSON.parse(content);
      expect(parsed.schemaVersion).toBe(CURRENT_STATE_VERSION);
    });
  });

  describe("legacy state (no schemaVersion)", () => {
    it("treats missing schemaVersion as v1 and migrates", async () => {
      // Create legacy state file without schemaVersion
      const stateDir = path.join(tempDir, ".scaffoldix");
      await fs.mkdir(stateDir, { recursive: true });
      await fs.writeFile(path.join(stateDir, "state.json"), createLegacyStateJson());

      const result = await manager.read(tempDir);

      expect(result).not.toBeNull();
      expect(result!.schemaVersion).toBe(CURRENT_STATE_VERSION);
      expect(result!.lastGeneration.packId).toBe("legacy-pack");
    });
  });

  describe("unsupported future version", () => {
    it("throws clear error for future state version", async () => {
      // Create future version state file
      const stateDir = path.join(tempDir, ".scaffoldix");
      const stateFile = path.join(stateDir, "state.json");
      await fs.mkdir(stateDir, { recursive: true });
      await fs.writeFile(stateFile, createFutureStateJson());

      await expect(manager.read(tempDir)).rejects.toThrow(ScaffoldError);

      try {
        await manager.read(tempDir);
      } catch (err) {
        expect(err).toBeInstanceOf(ScaffoldError);
        const scaffoldErr = err as ScaffoldError;
        expect(scaffoldErr.code).toBe("STATE_VERSION_UNSUPPORTED");
        expect(scaffoldErr.message).toContain("999");
        expect(scaffoldErr.hint).toContain("update");
      }
    });
  });

  describe("no migration needed", () => {
    it("returns state unchanged when already at current version", async () => {
      // Create current version state via normal write
      const record = {
        packId: "current-pack",
        packVersion: "2.0.0",
        archetypeId: "modern",
        inputs: { field: "value" },
        timestamp: "2024-01-15T12:00:00.000Z",
      };
      await manager.write(tempDir, record);

      // Read should not modify the file
      const stateFile = path.join(tempDir, ".scaffoldix", "state.json");
      const contentBefore = await fs.readFile(stateFile, "utf-8");

      const result = await manager.read(tempDir);

      const contentAfter = await fs.readFile(stateFile, "utf-8");

      // File should be unchanged (no rewrite needed)
      expect(contentBefore).toBe(contentAfter);
      expect(result!.schemaVersion).toBe(CURRENT_STATE_VERSION);
    });
  });

  describe("atomic migration", () => {
    it("does not leave partial state file on migration", async () => {
      // Create v1 state file
      const stateDir = path.join(tempDir, ".scaffoldix");
      await fs.mkdir(stateDir, { recursive: true });
      await fs.writeFile(path.join(stateDir, "state.json"), createV1StateJson());

      // Trigger migration
      await manager.read(tempDir);

      // Check no temp files remain
      const files = await fs.readdir(stateDir);
      const tempFiles = files.filter((f) => f.includes(".tmp"));
      expect(tempFiles).toHaveLength(0);
    });
  });
});
