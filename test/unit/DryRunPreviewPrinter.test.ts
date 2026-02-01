/**
 * Unit tests for DryRunPreviewPrinter.
 *
 * Tests the formatting of dry-run preview reports.
 *
 * @module
 */

import { describe, it, expect } from "vitest";

import {
  DryRunPreviewPrinter,
  formatDryRunPreview,
} from "../../src/cli/printers/DryRunPreviewPrinter.js";
import type { PreviewReport } from "../../src/core/preview/PreviewPlanner.js";

// =============================================================================
// Test Helpers
// =============================================================================

function createReport(overrides: Partial<PreviewReport> = {}): PreviewReport {
  return {
    targetDir: "/path/to/project",
    summary: { create: 0, modify: 0, noop: 0, total: 0 },
    creates: [],
    modifies: [],
    noops: [],
    allFiles: [],
    hasModifications: false,
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("DryRunPreviewPrinter", () => {
  // ===========================================================================
  // Format CREATE Files
  // ===========================================================================

  describe("CREATE formatting", () => {
    it("formats CREATE files with + symbol", () => {
      const report = createReport({
        summary: { create: 2, modify: 0, noop: 0, total: 2 },
        creates: [
          {
            relativePath: "src/index.ts",
            absolutePath: "/abs/src/index.ts",
            operation: "create",
            isBinary: false,
            sourceTemplate: "src/index.ts",
          },
          {
            relativePath: "package.json",
            absolutePath: "/abs/package.json",
            operation: "create",
            isBinary: false,
            sourceTemplate: "package.json",
          },
        ],
        allFiles: [],
      });

      const lines = formatDryRunPreview(report);

      expect(lines).toContain("CREATE (2)");
      expect(lines.some((l) => l.includes("+ src/index.ts"))).toBe(true);
      expect(lines.some((l) => l.includes("+ package.json"))).toBe(true);
    });
  });

  // ===========================================================================
  // Format MODIFY Files
  // ===========================================================================

  describe("MODIFY formatting", () => {
    it("formats MODIFY files with ~ symbol", () => {
      const report = createReport({
        summary: { create: 0, modify: 2, noop: 0, total: 2 },
        modifies: [
          {
            relativePath: "README.md",
            absolutePath: "/abs/README.md",
            operation: "modify",
            isBinary: false,
            sourceTemplate: "README.md",
          },
          {
            relativePath: "config.json",
            absolutePath: "/abs/config.json",
            operation: "modify",
            isBinary: false,
            sourceTemplate: "config.json",
          },
        ],
        allFiles: [],
        hasModifications: true,
      });

      const lines = formatDryRunPreview(report);

      expect(lines).toContain("MODIFY (2)");
      expect(lines.some((l) => l.includes("~ README.md"))).toBe(true);
      expect(lines.some((l) => l.includes("~ config.json"))).toBe(true);
    });

    it("shows hint about --force when modifications exist", () => {
      const report = createReport({
        summary: { create: 0, modify: 1, noop: 0, total: 1 },
        modifies: [
          {
            relativePath: "file.txt",
            absolutePath: "/abs/file.txt",
            operation: "modify",
            isBinary: false,
            sourceTemplate: "file.txt",
          },
        ],
        allFiles: [],
        hasModifications: true,
      });

      const lines = formatDryRunPreview(report);

      expect(lines.some((l) => l.includes("--force"))).toBe(true);
    });
  });

  // ===========================================================================
  // Format NOOP Files
  // ===========================================================================

  describe("NOOP formatting", () => {
    it("hides NOOP files by default", () => {
      const report = createReport({
        summary: { create: 1, modify: 0, noop: 2, total: 3 },
        creates: [
          {
            relativePath: "new.txt",
            absolutePath: "/abs/new.txt",
            operation: "create",
            isBinary: false,
            sourceTemplate: "new.txt",
          },
        ],
        noops: [
          {
            relativePath: "unchanged.txt",
            absolutePath: "/abs/unchanged.txt",
            operation: "noop",
            isBinary: false,
            sourceTemplate: "unchanged.txt",
          },
        ],
        allFiles: [],
      });

      const lines = formatDryRunPreview(report);

      expect(lines.some((l) => l.includes("UNCHANGED"))).toBe(false);
      expect(lines.some((l) => l.includes("unchanged.txt"))).toBe(false);
    });

    it("shows NOOP files when showNoop is true", () => {
      const report = createReport({
        summary: { create: 0, modify: 0, noop: 2, total: 2 },
        noops: [
          {
            relativePath: "same1.txt",
            absolutePath: "/abs/same1.txt",
            operation: "noop",
            isBinary: false,
            sourceTemplate: "same1.txt",
          },
          {
            relativePath: "same2.txt",
            absolutePath: "/abs/same2.txt",
            operation: "noop",
            isBinary: false,
            sourceTemplate: "same2.txt",
          },
        ],
        allFiles: [],
      });

      const lines = formatDryRunPreview(report, { showNoop: true });

      expect(lines).toContain("UNCHANGED (2)");
      expect(lines.some((l) => l.includes("= same1.txt"))).toBe(true);
      expect(lines.some((l) => l.includes("= same2.txt"))).toBe(true);
    });
  });

  // ===========================================================================
  // Summary
  // ===========================================================================

  describe("summary", () => {
    it("shows summary line with counts", () => {
      const report = createReport({
        summary: { create: 3, modify: 1, noop: 0, total: 4 },
        creates: [],
        modifies: [],
        allFiles: [],
        hasModifications: true,
      });

      const lines = formatDryRunPreview(report);

      expect(lines.some((l) => l.includes("3 to create"))).toBe(true);
      expect(lines.some((l) => l.includes("1 to modify"))).toBe(true);
    });

    it("shows 'no changes' when nothing to do", () => {
      const report = createReport({
        summary: { create: 0, modify: 0, noop: 0, total: 0 },
      });

      const lines = formatDryRunPreview(report);

      expect(lines.some((l) => l.includes("No changes"))).toBe(true);
    });
  });

  // ===========================================================================
  // Header
  // ===========================================================================

  describe("header", () => {
    it("shows dry-run header", () => {
      const report = createReport({
        targetDir: "/my/project",
        summary: { create: 1, modify: 0, noop: 0, total: 1 },
        creates: [
          {
            relativePath: "file.txt",
            absolutePath: "/my/project/file.txt",
            operation: "create",
            isBinary: false,
            sourceTemplate: "file.txt",
          },
        ],
        allFiles: [],
      });

      const lines = formatDryRunPreview(report);

      expect(lines[0]).toBe("Dry-run preview (no files written)");
      expect(lines[1]).toBe("Target: /my/project");
    });
  });

  // ===========================================================================
  // Hints
  // ===========================================================================

  describe("hints", () => {
    it("shows hint for CREATE only", () => {
      const report = createReport({
        summary: { create: 2, modify: 0, noop: 0, total: 2 },
        creates: [],
        allFiles: [],
        hasModifications: false,
      });

      const lines = formatDryRunPreview(report);

      expect(lines.some((l) => l.includes("Rerun without --dry-run"))).toBe(true);
      expect(lines.some((l) => l.includes("--force"))).toBe(false);
    });

    it("shows hint with --force for MODIFY", () => {
      const report = createReport({
        summary: { create: 1, modify: 1, noop: 0, total: 2 },
        creates: [],
        modifies: [],
        allFiles: [],
        hasModifications: true,
      });

      const lines = formatDryRunPreview(report);

      expect(lines.some((l) => l.includes("--force"))).toBe(true);
    });
  });

  // ===========================================================================
  // Custom Output
  // ===========================================================================

  describe("custom output", () => {
    it("uses custom output function", () => {
      const output: string[] = [];
      const printer = new DryRunPreviewPrinter({
        output: (line) => output.push(line),
      });

      const report = createReport({
        summary: { create: 1, modify: 0, noop: 0, total: 1 },
        creates: [
          {
            relativePath: "file.txt",
            absolutePath: "/abs/file.txt",
            operation: "create",
            isBinary: false,
            sourceTemplate: "file.txt",
          },
        ],
        allFiles: [],
      });

      printer.print(report);

      expect(output.length).toBeGreaterThan(0);
      expect(output.some((l) => l.includes("CREATE"))).toBe(true);
    });
  });
});
