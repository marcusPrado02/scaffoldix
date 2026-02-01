/**
 * Regression tests for store and registry failures.
 *
 * These tests verify that corrupted registry files, missing store directories,
 * and related failures produce clear, actionable errors.
 *
 * @module
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import {
  RegistryService,
  REGISTRY_SCHEMA_VERSION,
} from "../../../src/core/registry/RegistryService.js";
import { ScaffoldError } from "../../../src/core/errors/errors.js";

// =============================================================================
// Test Helpers
// =============================================================================

async function createTempDir(prefix: string): Promise<string> {
  const baseDir = path.join(os.tmpdir(), "scaffoldix-regression");
  await fs.mkdir(baseDir, { recursive: true });
  return await fs.mkdtemp(path.join(baseDir, `${prefix}-`));
}

async function cleanupDir(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
}

// =============================================================================
// Tests
// =============================================================================

describe("Store/Registry Regression Tests", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir("store");
  });

  afterEach(async () => {
    await cleanupDir(tempDir);
  });

  // ===========================================================================
  // Corrupted Registry
  // ===========================================================================

  describe("corrupted registry.json", () => {
    it("produces actionable error for invalid JSON", async () => {
      const registryPath = path.join(tempDir, "registry.json");
      await fs.writeFile(registryPath, "{ invalid json content }");

      const service = new RegistryService(registryPath);

      try {
        await service.load();
        expect.fail("Should have thrown an error");
      } catch (err) {
        expect(err).toBeInstanceOf(ScaffoldError);
        const scaffoldErr = err as ScaffoldError;

        // Should indicate JSON parse error
        expect(scaffoldErr.code).toBe("REGISTRY_INVALID_JSON");
        expect(scaffoldErr.message).toMatch(/invalid.*json|parse|json.*error/i);

        // Should be operational
        expect(scaffoldErr.isOperational).toBe(true);

        // Should have hint with guidance
        expect(scaffoldErr.hint).toBeDefined();
      }
    });

    it("produces actionable error for missing schemaVersion", async () => {
      const registryPath = path.join(tempDir, "registry.json");
      await fs.writeFile(registryPath, JSON.stringify({ packs: {} }));

      const service = new RegistryService(registryPath);

      try {
        await service.load();
        expect.fail("Should have thrown an error");
      } catch (err) {
        expect(err).toBeInstanceOf(ScaffoldError);
        const scaffoldErr = err as ScaffoldError;

        expect(scaffoldErr.code).toBe("REGISTRY_INVALID_SCHEMA");
        expect(scaffoldErr.isOperational).toBe(true);
      }
    });

    it("produces actionable error for invalid pack structure", async () => {
      const registryPath = path.join(tempDir, "registry.json");
      const invalid = {
        schemaVersion: REGISTRY_SCHEMA_VERSION,
        packs: {
          "bad-pack": {
            id: "bad-pack",
            // Missing required fields: version, origin, hash, installedAt
          },
        },
      };
      await fs.writeFile(registryPath, JSON.stringify(invalid));

      const service = new RegistryService(registryPath);

      try {
        await service.load();
        expect.fail("Should have thrown an error");
      } catch (err) {
        expect(err).toBeInstanceOf(ScaffoldError);
        const scaffoldErr = err as ScaffoldError;

        expect(scaffoldErr.code).toBe("REGISTRY_INVALID_SCHEMA");
        expect(scaffoldErr.isOperational).toBe(true);
      }
    });
  });

  // ===========================================================================
  // Missing Registry
  // ===========================================================================

  describe("missing registry", () => {
    it("returns empty registry when file does not exist", async () => {
      const registryPath = path.join(tempDir, "nonexistent", "registry.json");
      const service = new RegistryService(registryPath);

      // Should not throw - returns empty registry
      const registry = await service.load();
      expect(registry.packs).toEqual({});
      expect(registry.schemaVersion).toBe(REGISTRY_SCHEMA_VERSION);
    });
  });

  // ===========================================================================
  // Invalid Hash Format
  // ===========================================================================

  describe("invalid hash format", () => {
    it("produces actionable error for invalid hash", async () => {
      const registryPath = path.join(tempDir, "registry.json");
      const invalid = {
        schemaVersion: REGISTRY_SCHEMA_VERSION,
        packs: {
          "test-pack": {
            id: "test-pack",
            version: "1.0.0",
            origin: { type: "local", localPath: "/test" },
            hash: "invalid-short-hash", // Should be 64 chars
            installedAt: "2024-01-01T00:00:00.000Z",
          },
        },
      };
      await fs.writeFile(registryPath, JSON.stringify(invalid));

      const service = new RegistryService(registryPath);

      try {
        await service.load();
        expect.fail("Should have thrown an error");
      } catch (err) {
        expect(err).toBeInstanceOf(ScaffoldError);
        const scaffoldErr = err as ScaffoldError;

        expect(scaffoldErr.code).toBe("REGISTRY_INVALID_SCHEMA");
        expect(scaffoldErr.isOperational).toBe(true);
      }
    });
  });

  // ===========================================================================
  // Error Message Quality
  // ===========================================================================

  describe("error message quality", () => {
    it("errors include registry path in hint or details", async () => {
      const registryPath = path.join(tempDir, "registry.json");
      await fs.writeFile(registryPath, "{ broken }");

      const service = new RegistryService(registryPath);

      try {
        await service.load();
        expect.fail("Should have thrown an error");
      } catch (err) {
        const scaffoldErr = err as ScaffoldError;

        // Path should be included somewhere for debugging
        const hasPath =
          scaffoldErr.hint?.includes(registryPath) ||
          scaffoldErr.message.includes(registryPath) ||
          (scaffoldErr.details?.path as string)?.includes(registryPath) ||
          (scaffoldErr.details?.registryPath as string)?.includes(registryPath);

        expect(hasPath).toBe(true);
      }
    });

    it("errors do not expose internal stack traces in message", async () => {
      const registryPath = path.join(tempDir, "registry.json");
      await fs.writeFile(registryPath, "{ broken }");

      const service = new RegistryService(registryPath);

      try {
        await service.load();
        expect.fail("Should have thrown an error");
      } catch (err) {
        const scaffoldErr = err as ScaffoldError;

        // Message should not contain stack trace patterns
        expect(scaffoldErr.message).not.toMatch(/at\s+\w+\./);
        expect(scaffoldErr.message).not.toMatch(/node_modules/);
      }
    });
  });
});
