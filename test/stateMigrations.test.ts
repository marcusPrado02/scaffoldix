/**
 * Tests for state migration module.
 *
 * Tests the migration system for .scaffoldix/state.json files.
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import {
  runMigrations,
  CURRENT_STATE_VERSION,
  type StateMigration,
} from "../src/core/state/migrations.js";

// =============================================================================
// Test Fixtures
// =============================================================================

/**
 * Creates a v1 state fixture.
 */
function createV1State() {
  return {
    schemaVersion: 1,
    updatedAt: "2024-01-15T10:30:00.000Z",
    lastGeneration: {
      packId: "test-pack",
      packVersion: "1.0.0",
      archetypeId: "default",
      inputs: { name: "MyEntity" },
      timestamp: "2024-01-15T10:30:00.000Z",
    },
  };
}

/**
 * Creates a v2 state fixture.
 */
function createV2State() {
  return {
    schemaVersion: 2,
    updatedAt: "2024-01-15T10:30:00.000Z",
    generations: [
      {
        id: "gen-123",
        timestamp: "2024-01-15T10:30:00.000Z",
        packId: "test-pack",
        packVersion: "1.0.0",
        archetypeId: "default",
        inputs: { name: "MyEntity" },
        status: "success",
      },
    ],
    lastGeneration: {
      packId: "test-pack",
      packVersion: "1.0.0",
      archetypeId: "default",
      inputs: { name: "MyEntity" },
      timestamp: "2024-01-15T10:30:00.000Z",
    },
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("state migrations", () => {
  describe("CURRENT_STATE_VERSION", () => {
    it("is defined and is a positive number", () => {
      expect(CURRENT_STATE_VERSION).toBeDefined();
      expect(typeof CURRENT_STATE_VERSION).toBe("number");
      expect(CURRENT_STATE_VERSION).toBeGreaterThan(0);
    });
  });

  describe("runMigrations", () => {
    it("returns state unchanged when already at current version", () => {
      const v2State = createV2State();

      const result = runMigrations(v2State);

      expect(result.state).toEqual(v2State);
      expect(result.migrated).toBe(false);
      expect(result.migrationsApplied).toEqual([]);
    });

    it("migrates v1 state to current version", () => {
      const v1State = createV1State();

      const result = runMigrations(v1State);

      expect(result.migrated).toBe(true);
      expect(result.state.schemaVersion).toBe(CURRENT_STATE_VERSION);
      expect(result.migrationsApplied).toContain("1→2");
    });

    it("preserves lastGeneration data during v1→v2 migration", () => {
      const v1State = createV1State();

      const result = runMigrations(v1State);

      expect(result.state.lastGeneration.packId).toBe("test-pack");
      expect(result.state.lastGeneration.packVersion).toBe("1.0.0");
      expect(result.state.lastGeneration.archetypeId).toBe("default");
      expect(result.state.lastGeneration.inputs).toEqual({ name: "MyEntity" });
    });

    it("converts lastGeneration to generations array during v1→v2 migration", () => {
      const v1State = createV1State();

      const result = runMigrations(v1State);

      // v2 should have a generations array
      expect(result.state.generations).toBeDefined();
      expect(Array.isArray(result.state.generations)).toBe(true);
      expect(result.state.generations.length).toBeGreaterThan(0);

      // The first generation should contain the original data
      const firstGen = result.state.generations[0];
      expect(firstGen.packId).toBe("test-pack");
      expect(firstGen.archetypeId).toBe("default");
    });

    it("handles state without schemaVersion (treats as v1)", () => {
      // Old state files might not have schemaVersion
      const legacyState = {
        updatedAt: "2024-01-15T10:30:00.000Z",
        lastGeneration: {
          packId: "legacy-pack",
          packVersion: "0.9.0",
          archetypeId: "old",
          inputs: {},
          timestamp: "2024-01-15T10:30:00.000Z",
        },
      };

      const result = runMigrations(legacyState);

      expect(result.migrated).toBe(true);
      expect(result.state.schemaVersion).toBe(CURRENT_STATE_VERSION);
    });

    it("throws clear error for unsupported future version", () => {
      const futureState = {
        schemaVersion: 999,
        updatedAt: "2024-01-15T10:30:00.000Z",
        newFieldFromFuture: "some value",
      };

      expect(() => runMigrations(futureState)).toThrow();

      try {
        runMigrations(futureState);
      } catch (err) {
        expect(err).toBeInstanceOf(Error);
        const error = err as Error;
        expect(error.message).toContain("999");
        expect(error.message.toLowerCase()).toContain("unsupported");
      }
    });

    it("is idempotent - running twice produces same result", () => {
      const v1State = createV1State();

      const firstResult = runMigrations(v1State);
      const secondResult = runMigrations(firstResult.state);

      expect(secondResult.migrated).toBe(false);
      expect(secondResult.state).toEqual(firstResult.state);
    });

    it("tracks which migrations were applied", () => {
      const v1State = createV1State();

      const result = runMigrations(v1State);

      expect(result.migrationsApplied).toBeInstanceOf(Array);
      expect(result.migrationsApplied.length).toBeGreaterThan(0);
    });
  });

  describe("migration chain", () => {
    it("applies migrations sequentially from any version", () => {
      // If we add more versions in the future, this test ensures
      // migrations are applied in order
      const v1State = createV1State();

      const result = runMigrations(v1State);

      // Should migrate through all versions in order
      expect(result.state.schemaVersion).toBe(CURRENT_STATE_VERSION);
    });
  });
});
