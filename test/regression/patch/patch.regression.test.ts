/**
 * Regression tests for patch engine failures.
 *
 * These tests verify that missing markers, invalid operations, and other
 * patch failures produce clear, actionable errors.
 *
 * @module
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { PatchEngine, type PatchOperation } from "../../../src/core/patch/PatchEngine.js";
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

describe("Patch Regression Tests", () => {
  let tempDir: string;
  let engine: PatchEngine;

  beforeEach(async () => {
    tempDir = await createTempDir("patch");
    engine = new PatchEngine();
  });

  afterEach(async () => {
    await cleanupDir(tempDir);
  });

  // ===========================================================================
  // Missing Markers (Strict Mode)
  // ===========================================================================

  describe("missing markers in strict mode", () => {
    it("produces actionable error when markerStart is not found", async () => {
      // Create a file without the expected markers
      const filePath = path.join(tempDir, "target.ts");
      await fs.writeFile(filePath, "// Some content without markers\nexport default {};\n");

      const operation: PatchOperation = {
        kind: "marker_insert",
        file: "target.ts",
        markerStart: "// START_MARKER",
        markerEnd: "// END_MARKER",
        content: "// Inserted content",
        idempotencyKey: "test-patch-1",
      };

      // Use applyPatch directly which throws on error
      try {
        await engine.applyPatch(operation, { rootDir: tempDir, strict: true });
        expect.fail("Should have thrown an error");
      } catch (err) {
        expect(err).toBeInstanceOf(ScaffoldError);
        const scaffoldErr = err as ScaffoldError;

        expect(scaffoldErr.code).toBe("PATCH_MARKER_NOT_FOUND");
        expect(scaffoldErr.message).toMatch(/markerStart|not found/i);
        expect(scaffoldErr.isOperational).toBe(true);

        // Should include helpful context
        expect(scaffoldErr.hint).toBeDefined();
        expect(scaffoldErr.hint).toMatch(/marker/i);
      }
    });

    it("produces actionable error when markerEnd is not found", async () => {
      // Create a file with only markerStart
      const filePath = path.join(tempDir, "partial.ts");
      await fs.writeFile(filePath, "// Some content\n// START_MARKER\n// More content\n");

      const operation: PatchOperation = {
        kind: "marker_insert",
        file: "partial.ts",
        markerStart: "// START_MARKER",
        markerEnd: "// END_MARKER",
        content: "// Inserted content",
        idempotencyKey: "test-patch-2",
      };

      // Use applyPatch directly which throws on error
      try {
        await engine.applyPatch(operation, { rootDir: tempDir, strict: true });
        expect.fail("Should have thrown an error");
      } catch (err) {
        expect(err).toBeInstanceOf(ScaffoldError);
        const scaffoldErr = err as ScaffoldError;

        expect(scaffoldErr.code).toBe("PATCH_MARKER_NOT_FOUND");
        expect(scaffoldErr.message).toMatch(/markerEnd|not found/i);
        expect(scaffoldErr.isOperational).toBe(true);
      }
    });
  });

  // ===========================================================================
  // Marker Order Issues
  // ===========================================================================

  describe("marker order issues", () => {
    it("produces actionable error when markers are in wrong order", async () => {
      // Create a file with markers in wrong order
      const filePath = path.join(tempDir, "wrongorder.ts");
      await fs.writeFile(
        filePath,
        "// Some content\n// END_MARKER\n// Middle\n// START_MARKER\n// More\n",
      );

      const operation: PatchOperation = {
        kind: "marker_insert",
        file: "wrongorder.ts",
        markerStart: "// START_MARKER",
        markerEnd: "// END_MARKER",
        content: "// Inserted content",
        idempotencyKey: "test-patch-3",
      };

      // Use applyPatch directly which throws on error
      try {
        await engine.applyPatch(operation, { rootDir: tempDir, strict: true });
        expect.fail("Should have thrown an error");
      } catch (err) {
        expect(err).toBeInstanceOf(ScaffoldError);
        const scaffoldErr = err as ScaffoldError;

        expect(scaffoldErr.code).toBe("PATCH_MARKER_ORDER");
        expect(scaffoldErr.message).toMatch(/before|order/i);
        expect(scaffoldErr.isOperational).toBe(true);
      }
    });
  });

  // ===========================================================================
  // Missing Target File
  // ===========================================================================

  describe("missing target file", () => {
    it("produces actionable error when target file does not exist (strict)", async () => {
      const operation: PatchOperation = {
        kind: "marker_insert",
        file: "nonexistent.ts",
        markerStart: "// START",
        markerEnd: "// END",
        content: "// content",
        idempotencyKey: "test-patch-4",
      };

      // Use applyPatch directly which throws on error
      try {
        await engine.applyPatch(operation, { rootDir: tempDir, strict: true });
        expect.fail("Should have thrown an error");
      } catch (err) {
        expect(err).toBeInstanceOf(ScaffoldError);
        const scaffoldErr = err as ScaffoldError;

        expect(scaffoldErr.code).toBe("PATCH_FILE_NOT_FOUND");
        expect(scaffoldErr.message).toMatch(/not found|does not exist/i);
        expect(scaffoldErr.isOperational).toBe(true);

        // Should include helpful hint
        expect(scaffoldErr.hint).toBeDefined();
        expect(scaffoldErr.hint).toMatch(/exist|ensure/i);
      }
    });

    it("skips gracefully when target file does not exist (non-strict)", async () => {
      const operation: PatchOperation = {
        kind: "marker_insert",
        file: "nonexistent.ts",
        markerStart: "// START",
        markerEnd: "// END",
        content: "// content",
        idempotencyKey: "test-patch-5",
      };

      // Should not throw in non-strict mode
      const result = await engine.applyAll([operation], { rootDir: tempDir, strict: false });

      expect(result.skipped).toBe(1);
      expect(result.failed).toBe(0);
      expect(result.results[0].status).toBe("skipped");
      expect(result.results[0].reason).toBe("file_not_found");
    });
  });

  // ===========================================================================
  // Idempotency
  // ===========================================================================

  describe("idempotency", () => {
    it("skips patches that were already applied", async () => {
      // Create a file with already-applied patch stamp
      // The stamp format is: // SCAFFOLDIX_PATCH:<key>
      const filePath = path.join(tempDir, "already-patched.ts");
      await fs.writeFile(
        filePath,
        "// START\n// SCAFFOLDIX_PATCH:existing-patch\n// Existing content\n// END\n",
      );

      const operation: PatchOperation = {
        kind: "marker_insert",
        file: "already-patched.ts",
        markerStart: "// START",
        markerEnd: "// END",
        content: "// New content",
        idempotencyKey: "existing-patch", // Same key as in file
      };

      // Use applyPatch directly which returns result object
      const result = await engine.applyPatch(operation, { rootDir: tempDir, strict: true });

      expect(result.status).toBe("skipped");
      expect(result.reason).toBe("already_applied");
    });
  });

  // ===========================================================================
  // Error Message Quality
  // ===========================================================================

  describe("error message quality", () => {
    it("errors include file path for debugging", async () => {
      const operation: PatchOperation = {
        kind: "marker_insert",
        file: "test-file.ts",
        markerStart: "// START",
        markerEnd: "// END",
        content: "// content",
        idempotencyKey: "test-patch-6",
      };

      // Use applyPatch directly which throws on error
      try {
        await engine.applyPatch(operation, { rootDir: tempDir, strict: true });
        expect.fail("Should have thrown an error");
      } catch (err) {
        const scaffoldErr = err as ScaffoldError;

        // File should be mentioned somewhere
        const hasFile =
          scaffoldErr.message.includes("test-file.ts") ||
          scaffoldErr.hint?.includes("test-file.ts") ||
          (scaffoldErr.details?.file as string) === "test-file.ts";

        expect(hasFile).toBe(true);
      }
    });

    it("errors do not expose internal stack traces", async () => {
      const operation: PatchOperation = {
        kind: "marker_insert",
        file: "nonexistent.ts",
        markerStart: "// START",
        markerEnd: "// END",
        content: "// content",
        idempotencyKey: "test-patch-7",
      };

      // Use applyPatch directly which throws on error
      try {
        await engine.applyPatch(operation, { rootDir: tempDir, strict: true });
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
