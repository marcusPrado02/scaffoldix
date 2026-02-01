/**
 * Conflict Detector for Scaffoldix Generation.
 *
 * Detects file conflicts between a render plan and existing files on disk.
 * This module enables fail-fast behavior when generation would overwrite
 * existing files, unless explicitly allowed with --force.
 *
 * ## Usage
 *
 * ```typescript
 * const detector = new ConflictDetector();
 * const report = await detector.detectConflicts({
 *   plannedFiles: ["src/index.ts", "package.json"],
 *   targetDir: "/path/to/project",
 * });
 *
 * if (report.hasConflicts && !force) {
 *   throw new GenerateConflictError(report);
 * }
 * ```
 *
 * @module
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { ScaffoldError } from "../errors/errors.js";

// =============================================================================
// Types
// =============================================================================

/**
 * A single file conflict.
 */
export interface FileConflict {
  /** Relative path from target directory */
  readonly relativePath: string;

  /** Absolute path on disk */
  readonly absolutePath: string;
}

/**
 * Report of detected conflicts.
 */
export interface ConflictReport {
  /** Whether any conflicts were detected */
  readonly hasConflicts: boolean;

  /** Number of conflicting files */
  readonly count: number;

  /** List of conflicting files */
  readonly conflicts: FileConflict[];

  /** Target directory that was scanned */
  readonly targetDir: string;
}

/**
 * Parameters for conflict detection.
 */
export interface DetectConflictsParams {
  /** Relative paths of files that would be written */
  readonly plannedFiles: string[];

  /** Absolute path to the target directory */
  readonly targetDir: string;

  /** Optional logger for progress reporting */
  readonly logger?: ConflictLogger;
}

/**
 * Logger interface for conflict detection.
 */
export interface ConflictLogger {
  /** Log debug messages */
  debug?(message: string): void;
  /** Log info messages */
  info?(message: string): void;
}

// =============================================================================
// ConflictDetector Class
// =============================================================================

/**
 * Detects file conflicts for generation operations.
 *
 * This class checks whether files in a render plan already exist in the
 * target directory. It provides a comprehensive report of all conflicts
 * to enable actionable error messages.
 */
export class ConflictDetector {
  private readonly logger?: ConflictLogger;

  constructor(logger?: ConflictLogger) {
    this.logger = logger;
  }

  /**
   * Detects conflicts between planned files and existing files on disk.
   *
   * @param params - Detection parameters
   * @returns Conflict report with all detected conflicts
   */
  async detectConflicts(params: DetectConflictsParams): Promise<ConflictReport> {
    const { plannedFiles, targetDir, logger } = params;
    const effectiveLogger = logger ?? this.logger;

    effectiveLogger?.debug?.(`Scanning for conflicts in: ${targetDir}`);
    effectiveLogger?.debug?.(`Checking ${plannedFiles.length} planned files`);

    const conflicts: FileConflict[] = [];

    for (const relativePath of plannedFiles) {
      const absolutePath = path.join(targetDir, relativePath);

      try {
        await fs.access(absolutePath);
        // File exists - this is a conflict
        conflicts.push({ relativePath, absolutePath });
        effectiveLogger?.debug?.(`Conflict: ${relativePath}`);
      } catch {
        // File does not exist - no conflict
      }
    }

    const report: ConflictReport = {
      hasConflicts: conflicts.length > 0,
      count: conflicts.length,
      conflicts,
      targetDir,
    };

    if (report.hasConflicts) {
      effectiveLogger?.info?.(`Found ${report.count} conflicting file(s)`);
    } else {
      effectiveLogger?.debug?.(`No conflicts detected`);
    }

    return report;
  }
}

// =============================================================================
// Error Class
// =============================================================================

/**
 * Error thrown when file conflicts are detected during generation.
 *
 * This error provides actionable information about all conflicting files
 * and guidance on how to resolve the situation.
 */
export class GenerateConflictError extends ScaffoldError {
  /** The conflict report with all detected conflicts */
  readonly conflictReport: ConflictReport;

  constructor(report: ConflictReport) {
    const fileList = report.conflicts
      .slice(0, 10) // Show max 10 files in message
      .map((c) => `  - ${c.relativePath}`)
      .join("\n");

    const moreCount = report.count - 10;
    const moreMessage = moreCount > 0 ? `\n  ... and ${moreCount} more` : "";

    const message = `Generation would overwrite ${report.count} existing file(s)`;

    const hint =
      `Conflicting files:\n${fileList}${moreMessage}\n\n` +
      `To resolve this:\n` +
      `  - Choose a different target directory, OR\n` +
      `  - Delete or rename the conflicting files, OR\n` +
      `  - Use --force to overwrite existing files`;

    super(
      message,
      "GENERATE_CONFLICT",
      {
        count: report.count,
        targetDir: report.targetDir,
        conflictingFiles: report.conflicts.map((c) => c.relativePath),
      },
      undefined,
      hint,
      undefined,
      true // isOperational
    );

    this.conflictReport = report;
  }
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Formats a conflict report for logging.
 *
 * @param report - The conflict report to format
 * @param verbose - If true, show all files; otherwise limit to 10
 * @returns Formatted string lines
 */
export function formatConflictReport(report: ConflictReport, verbose = false): string[] {
  const lines: string[] = [];

  if (!report.hasConflicts) {
    lines.push("No file conflicts detected.");
    return lines;
  }

  lines.push(`Detected ${report.count} file conflict(s):`);

  const filesToShow = verbose ? report.conflicts : report.conflicts.slice(0, 10);
  for (const conflict of filesToShow) {
    lines.push(`  - ${conflict.relativePath}`);
  }

  if (!verbose && report.count > 10) {
    lines.push(`  ... and ${report.count - 10} more`);
  }

  return lines;
}
