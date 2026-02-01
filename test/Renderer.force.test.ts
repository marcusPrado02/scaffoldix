/**
 * Tests for Renderer force mode functionality.
 *
 * Tests the --force flag behavior:
 * - Without force: blocks overwrites with actionable error
 * - With force: allows overwrites and logs them
 * - Dry-run compatibility
 *
 * @module
 */

import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { renderArchetype } from "../src/core/render/Renderer.js";

// =============================================================================
// Test Helpers
// =============================================================================

const FIXTURES_DIR = path.join(__dirname, "fixtures", "render-test-pack", "templates");

async function createTestDir(prefix: string): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), `scaffoldix-force-${prefix}-`));
}

async function cleanupTestDir(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

async function readFile(filePath: string): Promise<string> {
  return await fs.readFile(filePath, "utf-8");
}

// =============================================================================
// Tests
// =============================================================================

describe("Renderer force mode", () => {
  const testDirs: string[] = [];

  afterEach(async () => {
    for (const dir of testDirs) {
      await cleanupTestDir(dir);
    }
    testDirs.length = 0;
  });

  function trackDir(dir: string): string {
    testDirs.push(dir);
    return dir;
  }

  // ===========================================================================
  // Without force (default) - block overwrites
  // ===========================================================================

  describe("without force (default)", () => {
    it("throws error when target file already exists", async () => {
      const targetDir = trackDir(await createTestDir("no-force"));

      // Pre-create a file that will conflict
      const readmePath = path.join(targetDir, "README.md");
      await fs.mkdir(targetDir, { recursive: true });
      await fs.writeFile(readmePath, "Existing content");

      await expect(
        renderArchetype({
          templateDir: FIXTURES_DIR,
          targetDir,
          data: { projectName: "Test", author: "Author" },
          dryRun: false,
          force: false,
        }),
      ).rejects.toMatchObject({
        code: "RENDER_FILE_EXISTS",
      });
    });

    it("error message includes the conflicting file path", async () => {
      const targetDir = trackDir(await createTestDir("no-force-msg"));

      // Pre-create a file that will conflict
      const readmePath = path.join(targetDir, "README.md");
      await fs.mkdir(targetDir, { recursive: true });
      await fs.writeFile(readmePath, "Existing content");

      try {
        await renderArchetype({
          templateDir: FIXTURES_DIR,
          targetDir,
          data: { projectName: "Test", author: "Author" },
          dryRun: false,
          force: false,
        });
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.message).toContain("README.md");
      }
    });

    it("error suggests using --force", async () => {
      const targetDir = trackDir(await createTestDir("no-force-hint"));

      // Pre-create a file that will conflict
      const readmePath = path.join(targetDir, "README.md");
      await fs.mkdir(targetDir, { recursive: true });
      await fs.writeFile(readmePath, "Existing content");

      try {
        await renderArchetype({
          templateDir: FIXTURES_DIR,
          targetDir,
          data: { projectName: "Test", author: "Author" },
          dryRun: false,
          force: false,
        });
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.hint).toContain("--force");
      }
    });

    it("does not modify the existing file when error is thrown", async () => {
      const targetDir = trackDir(await createTestDir("no-force-preserve"));

      // Pre-create a file that will conflict
      const readmePath = path.join(targetDir, "README.md");
      await fs.mkdir(targetDir, { recursive: true });
      await fs.writeFile(readmePath, "Original content - do not modify");

      try {
        await renderArchetype({
          templateDir: FIXTURES_DIR,
          targetDir,
          data: { projectName: "Test", author: "Author" },
          dryRun: false,
          force: false,
        });
      } catch {
        // Expected to throw
      }

      // Verify file was not modified
      const content = await readFile(readmePath);
      expect(content).toBe("Original content - do not modify");
    });

    it("succeeds when no files conflict", async () => {
      const targetDir = trackDir(await createTestDir("no-force-no-conflict"));

      // Empty target directory - no conflicts
      const result = await renderArchetype({
        templateDir: FIXTURES_DIR,
        targetDir,
        data: { projectName: "Test", author: "Author" },
        dryRun: false,
        force: false,
      });

      expect(result.filesWritten.length).toBeGreaterThan(0);
    });

    it("force defaults to false when not specified", async () => {
      const targetDir = trackDir(await createTestDir("no-force-default"));

      // Pre-create a conflicting file
      const readmePath = path.join(targetDir, "README.md");
      await fs.mkdir(targetDir, { recursive: true });
      await fs.writeFile(readmePath, "Existing content");

      // Call without specifying force - should default to false
      await expect(
        renderArchetype({
          templateDir: FIXTURES_DIR,
          targetDir,
          data: { projectName: "Test", author: "Author" },
          dryRun: false,
          // force not specified
        }),
      ).rejects.toMatchObject({
        code: "RENDER_FILE_EXISTS",
      });
    });
  });

  // ===========================================================================
  // With force - allow overwrites
  // ===========================================================================

  describe("with force", () => {
    it("overwrites existing files when force is true", async () => {
      const targetDir = trackDir(await createTestDir("force-overwrite"));

      // Pre-create a file that will be overwritten
      const readmePath = path.join(targetDir, "README.md");
      await fs.mkdir(targetDir, { recursive: true });
      await fs.writeFile(readmePath, "Old content");

      const result = await renderArchetype({
        templateDir: FIXTURES_DIR,
        targetDir,
        data: { projectName: "NewProject", author: "Author" },
        dryRun: false,
        force: true,
      });

      // Verify file was overwritten
      const content = await readFile(readmePath);
      expect(content).toContain("# NewProject");
      expect(result.filesWritten.length).toBeGreaterThan(0);
    });

    it("reports which files were overwritten in result", async () => {
      const targetDir = trackDir(await createTestDir("force-report"));

      // Pre-create a file that will be overwritten
      const readmePath = path.join(targetDir, "README.md");
      await fs.mkdir(targetDir, { recursive: true });
      await fs.writeFile(readmePath, "Old content");

      const result = await renderArchetype({
        templateDir: FIXTURES_DIR,
        targetDir,
        data: { projectName: "Test", author: "Author" },
        dryRun: false,
        force: true,
      });

      // Check that overwritten files are tracked
      expect(result.filesOverwritten).toBeDefined();
      expect(result.filesOverwritten.length).toBeGreaterThan(0);
      expect(result.filesOverwritten.some((f) => f.destRelativePath === "README.md")).toBe(true);
    });

    it("does not report files as overwritten when they did not exist", async () => {
      const targetDir = trackDir(await createTestDir("force-new-files"));

      // Empty target - nothing to overwrite
      const result = await renderArchetype({
        templateDir: FIXTURES_DIR,
        targetDir,
        data: { projectName: "Test", author: "Author" },
        dryRun: false,
        force: true,
      });

      // No files should be reported as overwritten
      expect(result.filesOverwritten).toEqual([]);
    });
  });

  // ===========================================================================
  // Dry-run compatibility
  // ===========================================================================

  describe("dry-run with force", () => {
    it("reports files that would be overwritten without modifying disk", async () => {
      const targetDir = trackDir(await createTestDir("dryrun-force"));

      // Pre-create a file that would be overwritten
      const readmePath = path.join(targetDir, "README.md");
      await fs.mkdir(targetDir, { recursive: true });
      await fs.writeFile(readmePath, "Original content");

      const result = await renderArchetype({
        templateDir: FIXTURES_DIR,
        targetDir,
        data: { projectName: "Test", author: "Author" },
        dryRun: true,
        force: true,
      });

      // File should not be modified
      const content = await readFile(readmePath);
      expect(content).toBe("Original content");

      // But result should indicate what would be overwritten
      expect(result.filesWouldOverwrite).toBeDefined();
      expect(result.filesWouldOverwrite.length).toBeGreaterThan(0);
      expect(result.filesWouldOverwrite.some((f) => f.destRelativePath === "README.md")).toBe(true);
    });

    it("dry-run without force still throws on conflict", async () => {
      const targetDir = trackDir(await createTestDir("dryrun-no-force"));

      // Pre-create a conflicting file
      const readmePath = path.join(targetDir, "README.md");
      await fs.mkdir(targetDir, { recursive: true });
      await fs.writeFile(readmePath, "Existing content");

      await expect(
        renderArchetype({
          templateDir: FIXTURES_DIR,
          targetDir,
          data: { projectName: "Test", author: "Author" },
          dryRun: true,
          force: false,
        }),
      ).rejects.toMatchObject({
        code: "RENDER_FILE_EXISTS",
      });
    });

    it("dry-run without force does not modify existing files", async () => {
      const targetDir = trackDir(await createTestDir("dryrun-preserve"));

      // Pre-create a conflicting file
      const readmePath = path.join(targetDir, "README.md");
      await fs.mkdir(targetDir, { recursive: true });
      await fs.writeFile(readmePath, "Do not modify");

      try {
        await renderArchetype({
          templateDir: FIXTURES_DIR,
          targetDir,
          data: { projectName: "Test", author: "Author" },
          dryRun: true,
          force: false,
        });
      } catch {
        // Expected
      }

      // File should remain unchanged
      const content = await readFile(readmePath);
      expect(content).toBe("Do not modify");
    });
  });
});
