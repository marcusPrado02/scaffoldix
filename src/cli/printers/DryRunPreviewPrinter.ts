/**
 * Dry-Run Preview Printer for Scaffoldix CLI.
 *
 * Formats and prints a preview report showing what would happen
 * during generation without actually writing files.
 *
 * ## Output Format
 *
 * ```
 * Dry-run preview (no files written)
 * Target: ./my-app
 *
 * CREATE (3)
 *   + src/index.ts
 *   + package.json
 *   + tsconfig.json
 *
 * MODIFY (1)
 *   ~ README.md
 *
 * Hint: rerun without --dry-run to apply. Use --force to allow overwriting existing files.
 * ```
 *
 * @module
 */

import type { PreviewReport, PreviewFile } from "../../core/preview/PreviewPlanner.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Options for preview printing.
 */
export interface PrintPreviewOptions {
  /** Whether to show NOOP files (default: false) */
  readonly showNoop?: boolean;

  /** Whether to use colors (default: true) */
  readonly useColors?: boolean;

  /** Custom output function (default: console.log) */
  readonly output?: (line: string) => void;
}

// =============================================================================
// Symbols
// =============================================================================

const SYMBOLS = {
  create: "+",
  modify: "~",
  noop: "=",
} as const;

// =============================================================================
// DryRunPreviewPrinter Class
// =============================================================================

/**
 * Formats and prints dry-run preview reports.
 */
export class DryRunPreviewPrinter {
  private readonly output: (line: string) => void;
  private readonly showNoop: boolean;

  constructor(options: PrintPreviewOptions = {}) {
    this.output = options.output ?? console.log.bind(console);
    this.showNoop = options.showNoop ?? false;
  }

  /**
   * Prints a preview report to the configured output.
   *
   * @param report - The preview report to print
   */
  print(report: PreviewReport): void {
    this.printHeader(report);
    this.printSummary(report);
    this.printFileGroups(report);
    this.printHint(report);
  }

  /**
   * Formats a preview report as an array of lines.
   *
   * @param report - The preview report to format
   * @returns Array of formatted lines
   */
  format(report: PreviewReport): string[] {
    const lines: string[] = [];

    // Header
    lines.push("Dry-run preview (no files written)");
    lines.push(`Target: ${report.targetDir}`);
    lines.push("");

    // Summary
    const parts: string[] = [];
    if (report.summary.create > 0) {
      parts.push(`${report.summary.create} to create`);
    }
    if (report.summary.modify > 0) {
      parts.push(`${report.summary.modify} to modify`);
    }
    if (this.showNoop && report.summary.noop > 0) {
      parts.push(`${report.summary.noop} unchanged`);
    }

    if (parts.length === 0) {
      lines.push("No changes would be made.");
      return lines;
    }

    lines.push(`Summary: ${parts.join(", ")}`);
    lines.push("");

    // CREATE section
    if (report.creates.length > 0) {
      lines.push(`CREATE (${report.creates.length})`);
      for (const file of report.creates) {
        lines.push(`  ${SYMBOLS.create} ${file.relativePath}`);
      }
      lines.push("");
    }

    // MODIFY section
    if (report.modifies.length > 0) {
      lines.push(`MODIFY (${report.modifies.length})`);
      for (const file of report.modifies) {
        lines.push(`  ${SYMBOLS.modify} ${file.relativePath}`);
      }
      lines.push("");
    }

    // NOOP section (if showNoop is enabled)
    if (this.showNoop && report.noops.length > 0) {
      lines.push(`UNCHANGED (${report.noops.length})`);
      for (const file of report.noops) {
        lines.push(`  ${SYMBOLS.noop} ${file.relativePath}`);
      }
      lines.push("");
    }

    // Hint
    if (report.hasModifications) {
      lines.push("Hint: Rerun without --dry-run to apply. Use --force to allow overwriting existing files.");
    } else if (report.summary.create > 0) {
      lines.push("Hint: Rerun without --dry-run to apply changes.");
    }

    return lines;
  }

  private printHeader(report: PreviewReport): void {
    this.output("Dry-run preview (no files written)");
    this.output(`Target: ${report.targetDir}`);
    this.output("");
  }

  private printSummary(report: PreviewReport): void {
    const parts: string[] = [];
    if (report.summary.create > 0) {
      parts.push(`${report.summary.create} to create`);
    }
    if (report.summary.modify > 0) {
      parts.push(`${report.summary.modify} to modify`);
    }
    if (this.showNoop && report.summary.noop > 0) {
      parts.push(`${report.summary.noop} unchanged`);
    }

    if (parts.length === 0) {
      this.output("No changes would be made.");
      return;
    }

    this.output(`Summary: ${parts.join(", ")}`);
    this.output("");
  }

  private printFileGroups(report: PreviewReport): void {
    // CREATE section
    if (report.creates.length > 0) {
      this.output(`CREATE (${report.creates.length})`);
      for (const file of report.creates) {
        this.output(`  ${SYMBOLS.create} ${file.relativePath}`);
      }
      this.output("");
    }

    // MODIFY section
    if (report.modifies.length > 0) {
      this.output(`MODIFY (${report.modifies.length})`);
      for (const file of report.modifies) {
        this.output(`  ${SYMBOLS.modify} ${file.relativePath}`);
      }
      this.output("");
    }

    // NOOP section (if showNoop is enabled)
    if (this.showNoop && report.noops.length > 0) {
      this.output(`UNCHANGED (${report.noops.length})`);
      for (const file of report.noops) {
        this.output(`  ${SYMBOLS.noop} ${file.relativePath}`);
      }
      this.output("");
    }
  }

  private printHint(report: PreviewReport): void {
    if (report.hasModifications) {
      this.output("Hint: Rerun without --dry-run to apply. Use --force to allow overwriting existing files.");
    } else if (report.summary.create > 0) {
      this.output("Hint: Rerun without --dry-run to apply changes.");
    }
  }
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Formats a preview report for CLI output.
 *
 * @param report - The preview report to format
 * @param options - Formatting options
 * @returns Array of formatted lines
 */
export function formatDryRunPreview(
  report: PreviewReport,
  options: PrintPreviewOptions = {}
): string[] {
  const printer = new DryRunPreviewPrinter(options);
  return printer.format(report);
}

/**
 * Prints a preview report to console.
 *
 * @param report - The preview report to print
 * @param options - Printing options
 */
export function printDryRunPreview(
  report: PreviewReport,
  options: PrintPreviewOptions = {}
): void {
  const printer = new DryRunPreviewPrinter(options);
  printer.print(report);
}
