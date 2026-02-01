/**
 * Unit tests for the standardized error system.
 *
 * Tests ErrorCode enum, ScaffoldError, and ErrorPresenter.
 *
 * @module
 */

import { describe, it, expect } from "vitest";

import { ErrorCode, getExitCode, getErrorCategory } from "../../src/core/errors/ErrorCode.js";
import { ScaffoldError } from "../../src/core/errors/errors.js";
import { ErrorPresenter, formatError } from "../../src/cli/errors/ErrorPresenter.js";

// =============================================================================
// ErrorCode Tests
// =============================================================================

describe("ErrorCode", () => {
  describe("code existence", () => {
    it("has pack-related codes", () => {
      expect(ErrorCode.PACK_NOT_FOUND).toBe("PACK_NOT_FOUND");
      expect(ErrorCode.PACK_INVALID).toBe("PACK_INVALID");
      expect(ErrorCode.PACK_ALREADY_INSTALLED).toBe("PACK_ALREADY_INSTALLED");
    });

    it("has manifest-related codes", () => {
      expect(ErrorCode.MANIFEST_NOT_FOUND).toBe("MANIFEST_NOT_FOUND");
      expect(ErrorCode.MANIFEST_INVALID).toBe("MANIFEST_INVALID");
      expect(ErrorCode.MANIFEST_PARSE_FAILED).toBe("MANIFEST_PARSE_FAILED");
    });

    it("has archetype-related codes", () => {
      expect(ErrorCode.ARCHETYPE_NOT_FOUND).toBe("ARCHETYPE_NOT_FOUND");
    });

    it("has input-related codes", () => {
      expect(ErrorCode.INPUT_VALIDATION_FAILED).toBe("INPUT_VALIDATION_FAILED");
      expect(ErrorCode.INPUT_REQUIRED).toBe("INPUT_REQUIRED");
    });

    it("has render-related codes", () => {
      expect(ErrorCode.TEMPLATE_RENDER_FAILED).toBe("TEMPLATE_RENDER_FAILED");
      expect(ErrorCode.TEMPLATE_NOT_FOUND).toBe("TEMPLATE_NOT_FOUND");
    });

    it("has conflict-related codes", () => {
      expect(ErrorCode.OUTPUT_CONFLICT).toBe("OUTPUT_CONFLICT");
    });

    it("has patch-related codes", () => {
      expect(ErrorCode.PATCH_MARKER_NOT_FOUND).toBe("PATCH_MARKER_NOT_FOUND");
      expect(ErrorCode.PATCH_APPLY_FAILED).toBe("PATCH_APPLY_FAILED");
      expect(ErrorCode.PATCH_FILE_NOT_FOUND).toBe("PATCH_FILE_NOT_FOUND");
    });

    it("has hook-related codes", () => {
      expect(ErrorCode.HOOK_FAILED).toBe("HOOK_FAILED");
      expect(ErrorCode.CHECK_FAILED).toBe("CHECK_FAILED");
    });

    it("has state-related codes", () => {
      expect(ErrorCode.STATE_READ_FAILED).toBe("STATE_READ_FAILED");
      expect(ErrorCode.STATE_WRITE_FAILED).toBe("STATE_WRITE_FAILED");
      expect(ErrorCode.STATE_MIGRATION_FAILED).toBe("STATE_MIGRATION_FAILED");
    });

    it("has fs-related codes", () => {
      expect(ErrorCode.FS_PERMISSION_DENIED).toBe("FS_PERMISSION_DENIED");
      expect(ErrorCode.FS_NOT_FOUND).toBe("FS_NOT_FOUND");
    });

    it("has internal error code", () => {
      expect(ErrorCode.INTERNAL_ERROR).toBe("INTERNAL_ERROR");
    });
  });

  describe("exit codes", () => {
    it("returns pack exit codes in 10-19 range", () => {
      expect(getExitCode(ErrorCode.PACK_NOT_FOUND)).toBeGreaterThanOrEqual(10);
      expect(getExitCode(ErrorCode.PACK_NOT_FOUND)).toBeLessThan(20);
    });

    it("returns manifest exit codes in 20-29 range", () => {
      expect(getExitCode(ErrorCode.MANIFEST_NOT_FOUND)).toBeGreaterThanOrEqual(20);
      expect(getExitCode(ErrorCode.MANIFEST_NOT_FOUND)).toBeLessThan(30);
    });

    it("returns generation exit codes in 30-39 range", () => {
      expect(getExitCode(ErrorCode.OUTPUT_CONFLICT)).toBeGreaterThanOrEqual(30);
      expect(getExitCode(ErrorCode.OUTPUT_CONFLICT)).toBeLessThan(40);
    });

    it("returns patch exit codes in 40-49 range", () => {
      expect(getExitCode(ErrorCode.PATCH_APPLY_FAILED)).toBeGreaterThanOrEqual(40);
      expect(getExitCode(ErrorCode.PATCH_APPLY_FAILED)).toBeLessThan(50);
    });

    it("returns hook exit codes in 50-59 range", () => {
      expect(getExitCode(ErrorCode.HOOK_FAILED)).toBeGreaterThanOrEqual(50);
      expect(getExitCode(ErrorCode.HOOK_FAILED)).toBeLessThan(60);
    });

    it("returns state exit codes in 60-69 range", () => {
      expect(getExitCode(ErrorCode.STATE_READ_FAILED)).toBeGreaterThanOrEqual(60);
      expect(getExitCode(ErrorCode.STATE_READ_FAILED)).toBeLessThan(70);
    });

    it("returns internal error as exit code 1", () => {
      expect(getExitCode(ErrorCode.INTERNAL_ERROR)).toBe(1);
    });
  });

  describe("error categories", () => {
    it("categorizes pack errors", () => {
      expect(getErrorCategory(ErrorCode.PACK_NOT_FOUND)).toBe("pack");
    });

    it("categorizes manifest errors", () => {
      expect(getErrorCategory(ErrorCode.MANIFEST_INVALID)).toBe("manifest");
    });

    it("categorizes generation errors", () => {
      expect(getErrorCategory(ErrorCode.OUTPUT_CONFLICT)).toBe("generation");
    });

    it("categorizes patch errors", () => {
      expect(getErrorCategory(ErrorCode.PATCH_MARKER_NOT_FOUND)).toBe("patch");
    });

    it("categorizes hook errors", () => {
      expect(getErrorCategory(ErrorCode.HOOK_FAILED)).toBe("hook");
    });

    it("categorizes internal errors", () => {
      expect(getErrorCategory(ErrorCode.INTERNAL_ERROR)).toBe("internal");
    });
  });
});

// =============================================================================
// ScaffoldError Tests
// =============================================================================

describe("ScaffoldError", () => {
  it("carries code, message, and hint", () => {
    const error = new ScaffoldError(
      "Pack not found",
      ErrorCode.PACK_NOT_FOUND,
      { packName: "my-pack" },
      undefined,
      "Install the pack first using: scaffoldix pack add <source>",
    );

    expect(error.code).toBe(ErrorCode.PACK_NOT_FOUND);
    expect(error.message).toBe("Pack not found");
    expect(error.hint).toBe("Install the pack first using: scaffoldix pack add <source>");
    expect(error.details).toEqual({ packName: "my-pack" });
  });

  it("carries cause for debugging", () => {
    const originalError = new Error("ENOENT: no such file");
    const error = new ScaffoldError(
      "Failed to read file",
      ErrorCode.FS_NOT_FOUND,
      undefined,
      undefined,
      undefined,
      originalError,
    );

    expect(error.cause).toBe(originalError);
  });

  it("extends Error properly", () => {
    const error = new ScaffoldError("Test error", ErrorCode.INTERNAL_ERROR);

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ScaffoldError);
    expect(error.name).toBe("ScaffoldError");
  });

  it("has timestamp", () => {
    const before = new Date();
    const error = new ScaffoldError("Test", ErrorCode.INTERNAL_ERROR);
    const after = new Date();

    expect(error.timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(error.timestamp.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it("distinguishes operational vs programming errors", () => {
    const operationalError = new ScaffoldError(
      "Pack not found",
      ErrorCode.PACK_NOT_FOUND,
      undefined,
      undefined,
      undefined,
      undefined,
      true,
    );

    const programmingError = new ScaffoldError(
      "Invalid argument",
      ErrorCode.INTERNAL_ERROR,
      undefined,
      undefined,
      undefined,
      undefined,
      false,
    );

    expect(operationalError.isOperational).toBe(true);
    expect(programmingError.isOperational).toBe(false);
  });
});

// =============================================================================
// ErrorPresenter Tests
// =============================================================================

describe("ErrorPresenter", () => {
  describe("formatError", () => {
    it("formats error with code and message", () => {
      const error = new ScaffoldError("Pack 'my-pack' not found", ErrorCode.PACK_NOT_FOUND);

      const output = formatError(error);

      expect(output).toContain("Error [PACK_NOT_FOUND]");
      expect(output).toContain("Pack 'my-pack' not found");
    });

    it("includes hints when present", () => {
      const error = new ScaffoldError(
        "Generation would overwrite files",
        ErrorCode.OUTPUT_CONFLICT,
        undefined,
        undefined,
        "Use --force to overwrite existing files",
      );

      const output = formatError(error);

      expect(output).toContain("Hint:");
      expect(output).toContain("--force");
    });

    it("includes details list when present", () => {
      const error = new ScaffoldError(
        "Generation would overwrite files",
        ErrorCode.OUTPUT_CONFLICT,
        {
          conflictingFiles: ["src/index.ts", "package.json"],
        },
      );

      const output = formatError(error);

      expect(output).toContain("src/index.ts");
      expect(output).toContain("package.json");
    });

    it("does not include stack trace by default", () => {
      const error = new ScaffoldError("Test error", ErrorCode.INTERNAL_ERROR);
      error.stack = "Error: Test error\n    at test.ts:1:1";

      const output = formatError(error);

      expect(output).not.toContain("at test.ts");
    });

    it("includes stack trace in debug mode", () => {
      const error = new ScaffoldError("Test error", ErrorCode.INTERNAL_ERROR);
      error.stack = "Error: Test error\n    at test.ts:1:1";

      const output = formatError(error, { debug: true });

      expect(output).toContain("at test.ts");
    });

    it("includes cause in debug mode", () => {
      const cause = new Error("Original error");
      const error = new ScaffoldError(
        "Wrapped error",
        ErrorCode.INTERNAL_ERROR,
        undefined,
        undefined,
        undefined,
        cause,
      );

      const output = formatError(error, { debug: true });

      expect(output).toContain("Caused by:");
      expect(output).toContain("Original error");
    });
  });

  describe("unknown error handling", () => {
    it("wraps unknown Error as INTERNAL_ERROR", () => {
      const unknownError = new Error("Something went wrong");

      const output = formatError(unknownError);

      expect(output).toContain("Error [INTERNAL_ERROR]");
      expect(output).toContain("Something went wrong");
    });

    it("wraps non-Error as INTERNAL_ERROR", () => {
      const output = formatError("string error");

      expect(output).toContain("Error [INTERNAL_ERROR]");
      expect(output).toContain("string error");
    });

    it("does not leak stack for unknown errors by default", () => {
      const unknownError = new Error("Something went wrong");
      unknownError.stack = "Error: Something went wrong\n    at file.ts:1:1";

      const output = formatError(unknownError);

      expect(output).not.toContain("at file.ts");
    });
  });

  describe("ErrorPresenter class", () => {
    it("uses custom output function", () => {
      const lines: string[] = [];
      const presenter = new ErrorPresenter({
        output: (line) => lines.push(line),
      });

      const error = new ScaffoldError("Test error", ErrorCode.PACK_NOT_FOUND);
      presenter.present(error);

      expect(lines.length).toBeGreaterThan(0);
      expect(lines.some((l) => l.includes("PACK_NOT_FOUND"))).toBe(true);
    });

    it("respects debug option", () => {
      const lines: string[] = [];
      const presenter = new ErrorPresenter({
        output: (line) => lines.push(line),
        debug: true,
      });

      const cause = new Error("Root cause");
      const error = new ScaffoldError(
        "Test error",
        ErrorCode.INTERNAL_ERROR,
        undefined,
        undefined,
        undefined,
        cause,
      );
      presenter.present(error);

      expect(lines.some((l) => l.includes("Root cause"))).toBe(true);
    });
  });
});

// =============================================================================
// Integration Tests
// =============================================================================

describe("Error System Integration", () => {
  it("conflict error has OUTPUT_CONFLICT code", () => {
    // Simulating what GenerateConflictError should produce
    const error = new ScaffoldError(
      "Generation would overwrite 2 existing file(s)",
      ErrorCode.OUTPUT_CONFLICT,
      {
        count: 2,
        conflictingFiles: ["src/index.ts", "package.json"],
      },
      undefined,
      "Use --force to overwrite, or choose a different target",
    );

    const output = formatError(error);

    expect(output).toContain("[OUTPUT_CONFLICT]");
    expect(output).toContain("src/index.ts");
    expect(output).toContain("package.json");
    expect(output).toContain("--force");
  });

  it("manifest validation error maps to MANIFEST_INVALID", () => {
    const error = new ScaffoldError(
      "Manifest validation failed",
      ErrorCode.MANIFEST_INVALID,
      {
        errors: ["name is required", "version must be semver"],
      },
      undefined,
      "Check your archetype.yaml for syntax errors",
    );

    const output = formatError(error);

    expect(output).toContain("[MANIFEST_INVALID]");
    expect(output).toContain("name is required");
  });

  it("check failure has CHECK_FAILED code with command info", () => {
    const error = new ScaffoldError(
      "Check command failed",
      ErrorCode.CHECK_FAILED,
      {
        command: "npm run lint",
        exitCode: 1,
      },
      undefined,
      "Fix the linting errors and rerun generation",
    );

    const output = formatError(error);

    expect(output).toContain("[CHECK_FAILED]");
    expect(output).toContain("npm run lint");
    expect(output).toContain("Exit Code: 1");
  });
});
