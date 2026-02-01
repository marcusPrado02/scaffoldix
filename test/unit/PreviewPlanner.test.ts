/**
 * Unit tests for PreviewPlanner.
 *
 * Tests the dry-run preview computation logic.
 *
 * @module
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

import { PreviewPlanner } from "../../src/core/preview/PreviewPlanner.js";

// =============================================================================
// Test Helpers
// =============================================================================

async function createTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `scaffoldix-preview-${prefix}-`));
}

async function cleanupTempDir(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

async function writeFile(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf-8");
}

// =============================================================================
// Tests
// =============================================================================

describe("PreviewPlanner", () => {
  let templateDir: string;
  let targetDir: string;

  beforeEach(async () => {
    templateDir = await createTempDir("templates");
    targetDir = await createTempDir("target");
  });

  afterEach(async () => {
    await cleanupTempDir(templateDir);
    await cleanupTempDir(targetDir);
  });

  // ===========================================================================
  // CREATE Detection
  // ===========================================================================

  describe("CREATE detection", () => {
    it("marks all files as CREATE when target is empty", async () => {
      // Setup templates
      await writeFile(path.join(templateDir, "README.md"), "# {{projectName}}");
      await writeFile(path.join(templateDir, "src", "index.ts"), "// Code");
      await writeFile(path.join(templateDir, "package.json"), '{"name": "test"}');

      const planner = new PreviewPlanner();
      const report = await planner.computePreview({
        templateDir,
        targetDir,
        data: { projectName: "TestProject" },
      });

      expect(report.summary.create).toBe(3);
      expect(report.summary.modify).toBe(0);
      expect(report.summary.noop).toBe(0);
      expect(report.creates.length).toBe(3);
      expect(report.modifies.length).toBe(0);
      expect(report.noops.length).toBe(0);
    });

    it("correctly identifies new files when some exist", async () => {
      // Setup templates
      await writeFile(path.join(templateDir, "new.txt"), "New file");
      await writeFile(path.join(templateDir, "existing.txt"), "Same content");

      // Pre-create one file with matching content
      await writeFile(path.join(targetDir, "existing.txt"), "Same content");

      const planner = new PreviewPlanner();
      const report = await planner.computePreview({
        templateDir,
        targetDir,
        data: {},
      });

      expect(report.summary.create).toBe(1);
      expect(report.creates[0].relativePath).toBe("new.txt");
      expect(report.summary.noop).toBe(1);
    });
  });

  // ===========================================================================
  // MODIFY Detection
  // ===========================================================================

  describe("MODIFY detection", () => {
    it("marks file as MODIFY when content differs", async () => {
      await writeFile(path.join(templateDir, "file.txt"), "New content");
      await writeFile(path.join(targetDir, "file.txt"), "Old content");

      const planner = new PreviewPlanner();
      const report = await planner.computePreview({
        templateDir,
        targetDir,
        data: {},
      });

      expect(report.summary.modify).toBe(1);
      expect(report.modifies[0].relativePath).toBe("file.txt");
      expect(report.hasModifications).toBe(true);
    });

    it("detects MODIFY when template rendering changes content", async () => {
      await writeFile(path.join(templateDir, "file.txt"), "# {{name}}");
      await writeFile(path.join(targetDir, "file.txt"), "# OldName");

      const planner = new PreviewPlanner();
      const report = await planner.computePreview({
        templateDir,
        targetDir,
        data: { name: "NewName" },
      });

      expect(report.summary.modify).toBe(1);
      expect(report.hasModifications).toBe(true);
    });

    it("normalizes line endings for comparison", async () => {
      // Template with LF
      await writeFile(path.join(templateDir, "file.txt"), "line1\nline2\n");
      // Target with CRLF (should be treated as same content)
      await writeFile(path.join(targetDir, "file.txt"), "line1\r\nline2\r\n");

      const planner = new PreviewPlanner();
      const report = await planner.computePreview({
        templateDir,
        targetDir,
        data: {},
      });

      expect(report.summary.noop).toBe(1);
      expect(report.summary.modify).toBe(0);
    });
  });

  // ===========================================================================
  // NOOP Detection
  // ===========================================================================

  describe("NOOP detection", () => {
    it("marks file as NOOP when content is identical", async () => {
      await writeFile(path.join(templateDir, "file.txt"), "Same content");
      await writeFile(path.join(targetDir, "file.txt"), "Same content");

      const planner = new PreviewPlanner();
      const report = await planner.computePreview({
        templateDir,
        targetDir,
        data: {},
      });

      expect(report.summary.noop).toBe(1);
      expect(report.noops[0].relativePath).toBe("file.txt");
      expect(report.summary.modify).toBe(0);
    });

    it("marks rendered template as NOOP when output matches", async () => {
      await writeFile(path.join(templateDir, "file.txt"), "Hello, {{name}}!");
      await writeFile(path.join(targetDir, "file.txt"), "Hello, World!");

      const planner = new PreviewPlanner();
      const report = await planner.computePreview({
        templateDir,
        targetDir,
        data: { name: "World" },
      });

      expect(report.summary.noop).toBe(1);
      expect(report.summary.modify).toBe(0);
    });
  });

  // ===========================================================================
  // Rename Rules
  // ===========================================================================

  describe("rename rules", () => {
    it("applies rename rules to output paths", async () => {
      await writeFile(
        path.join(templateDir, "__moduleName__", "__moduleName__.ts"),
        "export class {{moduleName}} {}"
      );

      const planner = new PreviewPlanner();
      const report = await planner.computePreview({
        templateDir,
        targetDir,
        data: { moduleName: "Customer" },
        renameRules: {
          replacements: {
            __moduleName__: "customer",
          },
        },
      });

      expect(report.creates[0].relativePath).toBe("customer/customer.ts");
    });

    it("correctly detects MODIFY with renamed paths", async () => {
      await writeFile(path.join(templateDir, "__name__.txt"), "New content");
      await writeFile(path.join(targetDir, "myfile.txt"), "Old content");

      const planner = new PreviewPlanner();
      const report = await planner.computePreview({
        templateDir,
        targetDir,
        data: {},
        renameRules: {
          replacements: { __name__: "myfile" },
        },
      });

      expect(report.summary.modify).toBe(1);
      expect(report.modifies[0].relativePath).toBe("myfile.txt");
    });
  });

  // ===========================================================================
  // Binary Files
  // ===========================================================================

  describe("binary files", () => {
    it("identifies binary files correctly", async () => {
      // Create a binary file (contains NUL bytes)
      const binaryContent = Buffer.from([0x00, 0x01, 0x02, 0x03]);
      await fs.writeFile(path.join(templateDir, "image.bin"), binaryContent);

      const planner = new PreviewPlanner();
      const report = await planner.computePreview({
        templateDir,
        targetDir,
        data: {},
      });

      expect(report.creates[0].isBinary).toBe(true);
    });

    it("compares binary content for NOOP detection", async () => {
      const binaryContent = Buffer.from([0x00, 0x01, 0x02, 0x03]);
      await fs.writeFile(path.join(templateDir, "data.bin"), binaryContent);
      await fs.writeFile(path.join(targetDir, "data.bin"), binaryContent);

      const planner = new PreviewPlanner();
      const report = await planner.computePreview({
        templateDir,
        targetDir,
        data: {},
      });

      expect(report.summary.noop).toBe(1);
    });

    it("detects MODIFY for changed binary files", async () => {
      await fs.writeFile(
        path.join(templateDir, "data.bin"),
        Buffer.from([0x00, 0x01, 0x02])
      );
      await fs.writeFile(
        path.join(targetDir, "data.bin"),
        Buffer.from([0x00, 0x01, 0x03])
      );

      const planner = new PreviewPlanner();
      const report = await planner.computePreview({
        templateDir,
        targetDir,
        data: {},
      });

      expect(report.summary.modify).toBe(1);
      expect(report.modifies[0].isBinary).toBe(true);
    });
  });

  // ===========================================================================
  // Summary
  // ===========================================================================

  describe("summary", () => {
    it("correctly calculates total", async () => {
      await writeFile(path.join(templateDir, "create.txt"), "new");
      await writeFile(path.join(templateDir, "modify.txt"), "new content");
      await writeFile(path.join(templateDir, "noop.txt"), "same");

      await writeFile(path.join(targetDir, "modify.txt"), "old content");
      await writeFile(path.join(targetDir, "noop.txt"), "same");

      const planner = new PreviewPlanner();
      const report = await planner.computePreview({
        templateDir,
        targetDir,
        data: {},
      });

      expect(report.summary.total).toBe(3);
      expect(report.summary.create).toBe(1);
      expect(report.summary.modify).toBe(1);
      expect(report.summary.noop).toBe(1);
    });

    it("hasModifications is false when no modifies", async () => {
      await writeFile(path.join(templateDir, "new.txt"), "content");
      await writeFile(path.join(templateDir, "same.txt"), "same");
      await writeFile(path.join(targetDir, "same.txt"), "same");

      const planner = new PreviewPlanner();
      const report = await planner.computePreview({
        templateDir,
        targetDir,
        data: {},
      });

      expect(report.hasModifications).toBe(false);
    });
  });

  // ===========================================================================
  // Error Handling
  // ===========================================================================

  describe("error handling", () => {
    it("throws when template directory does not exist", async () => {
      const planner = new PreviewPlanner();

      await expect(
        planner.computePreview({
          templateDir: "/nonexistent/path",
          targetDir,
          data: {},
        })
      ).rejects.toThrow(/does not exist/);
    });
  });
});
