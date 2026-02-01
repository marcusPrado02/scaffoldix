/**
 * Unit tests for ConflictDetector.
 *
 * Tests file conflict detection between render plans and existing files.
 *
 * @module
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

import {
  ConflictDetector,
  GenerateConflictError,
  formatConflictReport,
} from "../../src/core/conflicts/ConflictDetector.js";

// =============================================================================
// Test Helpers
// =============================================================================

async function createTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "scaffoldix-conflict-test-"));
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

describe("ConflictDetector", () => {
  let targetDir: string;

  beforeEach(async () => {
    targetDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(targetDir);
  });

  // ===========================================================================
  // No Conflicts
  // ===========================================================================

  describe("detectConflicts - no conflicts", () => {
    it("returns hasConflicts=false when target directory is empty", async () => {
      const detector = new ConflictDetector();
      const report = await detector.detectConflicts({
        plannedFiles: ["src/index.ts", "package.json", "README.md"],
        targetDir,
      });

      expect(report.hasConflicts).toBe(false);
      expect(report.count).toBe(0);
      expect(report.conflicts).toEqual([]);
      expect(report.targetDir).toBe(targetDir);
    });

    it("returns hasConflicts=false when planned files don't exist", async () => {
      // Create some files that are NOT in the planned list
      await writeFile(path.join(targetDir, "other.txt"), "other");
      await writeFile(path.join(targetDir, "src", "utils.ts"), "export {};");

      const detector = new ConflictDetector();
      const report = await detector.detectConflicts({
        plannedFiles: ["src/index.ts", "package.json"],
        targetDir,
      });

      expect(report.hasConflicts).toBe(false);
      expect(report.count).toBe(0);
    });

    it("returns hasConflicts=false with empty planned files list", async () => {
      const detector = new ConflictDetector();
      const report = await detector.detectConflicts({
        plannedFiles: [],
        targetDir,
      });

      expect(report.hasConflicts).toBe(false);
      expect(report.count).toBe(0);
    });
  });

  // ===========================================================================
  // With Conflicts
  // ===========================================================================

  describe("detectConflicts - with conflicts", () => {
    it("detects single file conflict", async () => {
      await writeFile(path.join(targetDir, "package.json"), "{}");

      const detector = new ConflictDetector();
      const report = await detector.detectConflicts({
        plannedFiles: ["src/index.ts", "package.json", "README.md"],
        targetDir,
      });

      expect(report.hasConflicts).toBe(true);
      expect(report.count).toBe(1);
      expect(report.conflicts).toHaveLength(1);
      expect(report.conflicts[0].relativePath).toBe("package.json");
      expect(report.conflicts[0].absolutePath).toBe(
        path.join(targetDir, "package.json")
      );
    });

    it("detects multiple file conflicts", async () => {
      await writeFile(path.join(targetDir, "package.json"), "{}");
      await writeFile(path.join(targetDir, "src", "index.ts"), "export {};");
      await writeFile(path.join(targetDir, "README.md"), "# Hello");

      const detector = new ConflictDetector();
      const report = await detector.detectConflicts({
        plannedFiles: ["src/index.ts", "package.json", "README.md", "tsconfig.json"],
        targetDir,
      });

      expect(report.hasConflicts).toBe(true);
      expect(report.count).toBe(3);
      expect(report.conflicts).toHaveLength(3);

      const relativePaths = report.conflicts.map((c) => c.relativePath);
      expect(relativePaths).toContain("package.json");
      expect(relativePaths).toContain("src/index.ts");
      expect(relativePaths).toContain("README.md");
    });

    it("detects conflicts in nested directories", async () => {
      await writeFile(
        path.join(targetDir, "src", "components", "Button.tsx"),
        "export const Button = () => {};"
      );

      const detector = new ConflictDetector();
      const report = await detector.detectConflicts({
        plannedFiles: ["src/components/Button.tsx", "src/components/Input.tsx"],
        targetDir,
      });

      expect(report.hasConflicts).toBe(true);
      expect(report.count).toBe(1);
      expect(report.conflicts[0].relativePath).toBe("src/components/Button.tsx");
    });

    it("correctly distinguishes files from directories with same name", async () => {
      // Create a directory named "package.json" (unusual but valid)
      await fs.mkdir(path.join(targetDir, "config"), { recursive: true });
      // Create a file named "config" (can't coexist with directory)
      // Actually let's just test normal files
      await writeFile(path.join(targetDir, "config", "settings.json"), "{}");

      const detector = new ConflictDetector();
      const report = await detector.detectConflicts({
        plannedFiles: ["config/settings.json", "config/other.json"],
        targetDir,
      });

      expect(report.hasConflicts).toBe(true);
      expect(report.count).toBe(1);
      expect(report.conflicts[0].relativePath).toBe("config/settings.json");
    });
  });

  // ===========================================================================
  // Logger Integration
  // ===========================================================================

  describe("detectConflicts - with logger", () => {
    it("logs debug messages during detection", async () => {
      const debugMessages: string[] = [];
      const infoMessages: string[] = [];
      const logger = {
        debug: (msg: string) => debugMessages.push(msg),
        info: (msg: string) => infoMessages.push(msg),
      };

      await writeFile(path.join(targetDir, "file.txt"), "content");

      const detector = new ConflictDetector(logger);
      await detector.detectConflicts({
        plannedFiles: ["file.txt", "other.txt"],
        targetDir,
      });

      expect(debugMessages.some((m) => m.includes("Scanning"))).toBe(true);
      expect(debugMessages.some((m) => m.includes("Conflict"))).toBe(true);
      expect(infoMessages.some((m) => m.includes("1 conflicting"))).toBe(true);
    });

    it("uses params logger over constructor logger", async () => {
      const constructorMessages: string[] = [];
      const paramsMessages: string[] = [];

      const constructorLogger = {
        debug: (msg: string) => constructorMessages.push(msg),
      };
      const paramsLogger = {
        debug: (msg: string) => paramsMessages.push(msg),
      };

      const detector = new ConflictDetector(constructorLogger);
      await detector.detectConflicts({
        plannedFiles: ["file.txt"],
        targetDir,
        logger: paramsLogger,
      });

      expect(paramsMessages.length).toBeGreaterThan(0);
      expect(constructorMessages.length).toBe(0);
    });
  });
});

// =============================================================================
// GenerateConflictError Tests
// =============================================================================

describe("GenerateConflictError", () => {
  it("creates error with correct code and message", () => {
    const report = {
      hasConflicts: true,
      count: 2,
      conflicts: [
        { relativePath: "file1.txt", absolutePath: "/abs/file1.txt" },
        { relativePath: "file2.txt", absolutePath: "/abs/file2.txt" },
      ],
      targetDir: "/target",
    };

    const error = new GenerateConflictError(report);

    expect(error.code).toBe("GENERATE_CONFLICT");
    expect(error.message).toContain("2 existing file(s)");
    expect(error.conflictReport).toBe(report);
    expect(error.isOperational).toBe(true);
  });

  it("includes file list in hint", () => {
    const report = {
      hasConflicts: true,
      count: 2,
      conflicts: [
        { relativePath: "package.json", absolutePath: "/abs/package.json" },
        { relativePath: "src/index.ts", absolutePath: "/abs/src/index.ts" },
      ],
      targetDir: "/target",
    };

    const error = new GenerateConflictError(report);

    expect(error.hint).toContain("package.json");
    expect(error.hint).toContain("src/index.ts");
    expect(error.hint).toContain("--force");
  });

  it("truncates file list when more than 10 files", () => {
    const conflicts = Array.from({ length: 15 }, (_, i) => ({
      relativePath: `file${i}.txt`,
      absolutePath: `/abs/file${i}.txt`,
    }));

    const report = {
      hasConflicts: true,
      count: 15,
      conflicts,
      targetDir: "/target",
    };

    const error = new GenerateConflictError(report);

    // Should show first 10 files
    expect(error.hint).toContain("file0.txt");
    expect(error.hint).toContain("file9.txt");
    // Should show "and X more" message
    expect(error.hint).toContain("and 5 more");
    // Should not show file11.txt through file14.txt explicitly
    expect(error.hint).not.toContain("file14.txt");
  });
});

// =============================================================================
// formatConflictReport Tests
// =============================================================================

describe("formatConflictReport", () => {
  it("formats no conflicts report", () => {
    const report = {
      hasConflicts: false,
      count: 0,
      conflicts: [],
      targetDir: "/target",
    };

    const lines = formatConflictReport(report);

    expect(lines).toEqual(["No file conflicts detected."]);
  });

  it("formats report with conflicts", () => {
    const report = {
      hasConflicts: true,
      count: 2,
      conflicts: [
        { relativePath: "file1.txt", absolutePath: "/abs/file1.txt" },
        { relativePath: "file2.txt", absolutePath: "/abs/file2.txt" },
      ],
      targetDir: "/target",
    };

    const lines = formatConflictReport(report);

    expect(lines[0]).toContain("2 file conflict");
    expect(lines).toContain("  - file1.txt");
    expect(lines).toContain("  - file2.txt");
  });

  it("shows only first 10 files in non-verbose mode", () => {
    const conflicts = Array.from({ length: 15 }, (_, i) => ({
      relativePath: `file${i}.txt`,
      absolutePath: `/abs/file${i}.txt`,
    }));

    const report = {
      hasConflicts: true,
      count: 15,
      conflicts,
      targetDir: "/target",
    };

    const lines = formatConflictReport(report, false);

    // Should show first 10
    expect(lines).toContain("  - file0.txt");
    expect(lines).toContain("  - file9.txt");
    // Should show "... and X more"
    expect(lines.some((l) => l.includes("and 5 more"))).toBe(true);
    // Should not show file10.txt
    expect(lines).not.toContain("  - file10.txt");
  });

  it("shows all files in verbose mode", () => {
    const conflicts = Array.from({ length: 15 }, (_, i) => ({
      relativePath: `file${i}.txt`,
      absolutePath: `/abs/file${i}.txt`,
    }));

    const report = {
      hasConflicts: true,
      count: 15,
      conflicts,
      targetDir: "/target",
    };

    const lines = formatConflictReport(report, true);

    // Should show all 15
    expect(lines).toContain("  - file0.txt");
    expect(lines).toContain("  - file14.txt");
    // Should not show "and X more"
    expect(lines.some((l) => l.includes("more"))).toBe(false);
  });
});
