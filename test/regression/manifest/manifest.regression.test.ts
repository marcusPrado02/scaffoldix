/**
 * Regression tests for manifest validation failures.
 *
 * These tests verify that invalid manifests produce clear, actionable errors
 * and don't cause unhandled exceptions or crashes.
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { ManifestLoader } from "../../../src/core/manifest/ManifestLoader.js";
import { ScaffoldError } from "../../../src/core/errors/errors.js";

// =============================================================================
// Constants
// =============================================================================

const FIXTURES_DIR = path.join(__dirname, "fixtures");

// =============================================================================
// Tests
// =============================================================================

describe("Manifest Regression Tests", () => {
  const loader = new ManifestLoader();

  // ===========================================================================
  // Invalid YAML Syntax
  // ===========================================================================

  describe("invalid YAML syntax", () => {
    it("produces actionable error for malformed YAML", async () => {
      const fixtureDir = path.join(FIXTURES_DIR, "invalid-yaml");

      try {
        await loader.loadFromDir(fixtureDir);
        expect.fail("Should have thrown an error");
      } catch (err) {
        expect(err).toBeInstanceOf(ScaffoldError);
        const scaffoldErr = err as ScaffoldError;

        // Error should indicate YAML parsing issue
        expect(scaffoldErr.code).toBe("MANIFEST_YAML_ERROR");

        // Message should be user-friendly
        expect(scaffoldErr.message).toMatch(/parse|yaml|syntax/i);

        // Should have a hint for the user
        expect(scaffoldErr.hint).toBeDefined();

        // Should be marked as operational (user-facing error)
        expect(scaffoldErr.isOperational).toBe(true);
      }
    });
  });

  // ===========================================================================
  // Missing Required Fields
  // ===========================================================================

  describe("missing required fields", () => {
    it("produces actionable error when pack.name is missing", async () => {
      const fixtureDir = path.join(FIXTURES_DIR, "missing-pack-name");

      try {
        await loader.loadFromDir(fixtureDir);
        expect.fail("Should have thrown an error");
      } catch (err) {
        expect(err).toBeInstanceOf(ScaffoldError);
        const scaffoldErr = err as ScaffoldError;

        // Error should indicate schema validation issue
        expect(scaffoldErr.code).toBe("MANIFEST_SCHEMA_ERROR");

        // Hint should mention what's missing
        expect(scaffoldErr.hint).toBeDefined();
        expect(scaffoldErr.hint).toMatch(/name|required/i);

        // Should be operational
        expect(scaffoldErr.isOperational).toBe(true);
      }
    });

    it("produces actionable error when archetypes array is missing", async () => {
      const fixtureDir = path.join(FIXTURES_DIR, "missing-archetypes");

      try {
        await loader.loadFromDir(fixtureDir);
        expect.fail("Should have thrown an error");
      } catch (err) {
        expect(err).toBeInstanceOf(ScaffoldError);
        const scaffoldErr = err as ScaffoldError;

        expect(scaffoldErr.code).toBe("MANIFEST_SCHEMA_ERROR");
        // Hint should contain the field name
        expect(scaffoldErr.hint).toBeDefined();
        expect(scaffoldErr.hint).toMatch(/archetypes|required/i);
        expect(scaffoldErr.isOperational).toBe(true);
      }
    });
  });

  // ===========================================================================
  // Empty/Invalid Values
  // ===========================================================================

  describe("empty or invalid values", () => {
    it("produces actionable error for empty archetype id", async () => {
      const fixtureDir = path.join(FIXTURES_DIR, "empty-archetype-id");

      try {
        await loader.loadFromDir(fixtureDir);
        expect.fail("Should have thrown an error");
      } catch (err) {
        expect(err).toBeInstanceOf(ScaffoldError);
        const scaffoldErr = err as ScaffoldError;

        expect(scaffoldErr.code).toBe("MANIFEST_SCHEMA_ERROR");
        // Hint should mention the archetype id issue
        expect(scaffoldErr.hint).toBeDefined();
        expect(scaffoldErr.hint).toMatch(/id|empty|least.*character/i);
        expect(scaffoldErr.isOperational).toBe(true);
      }
    });
  });

  // ===========================================================================
  // Error Message Quality
  // ===========================================================================

  describe("error message quality", () => {
    it("errors include path to problematic file", async () => {
      const fixtureDir = path.join(FIXTURES_DIR, "invalid-yaml");

      try {
        await loader.loadFromDir(fixtureDir);
        expect.fail("Should have thrown an error");
      } catch (err) {
        const scaffoldErr = err as ScaffoldError;

        // Path should be in details or hint
        const hasPath =
          scaffoldErr.hint?.includes(fixtureDir) ||
          (scaffoldErr.details?.path as string)?.includes(fixtureDir) ||
          (scaffoldErr.details?.file as string)?.includes(fixtureDir);

        expect(hasPath).toBe(true);
      }
    });

    it("errors do not expose raw stack traces in message", async () => {
      const fixtureDir = path.join(FIXTURES_DIR, "missing-pack-name");

      try {
        await loader.loadFromDir(fixtureDir);
        expect.fail("Should have thrown an error");
      } catch (err) {
        const scaffoldErr = err as ScaffoldError;

        // Message should not contain "at Object." or similar stack trace patterns
        expect(scaffoldErr.message).not.toMatch(/at\s+\w+\./);
        expect(scaffoldErr.message).not.toMatch(/node_modules/);
      }
    });
  });
});
