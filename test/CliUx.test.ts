/**
 * Tests for CLI UX messaging module.
 *
 * Tests consistent messaging, colors, and log levels.
 *
 * @module
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CliUx, type LogLevel, createCliUx } from "../src/cli/ux/CliUx.js";

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Captures stdout output during a function call.
 */
async function captureStdout(fn: () => Promise<void> | void): Promise<string> {
  const chunks: string[] = [];
  const originalWrite = process.stdout.write.bind(process.stdout);

  process.stdout.write = ((chunk: string | Uint8Array) => {
    chunks.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;

  try {
    await fn();
  } finally {
    process.stdout.write = originalWrite;
  }

  return chunks.join("");
}

/**
 * Captures stderr output during a function call.
 */
async function captureStderr(fn: () => Promise<void> | void): Promise<string> {
  const chunks: string[] = [];
  const originalWrite = process.stderr.write.bind(process.stderr);

  process.stderr.write = ((chunk: string | Uint8Array) => {
    chunks.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;

  try {
    await fn();
  } finally {
    process.stderr.write = originalWrite;
  }

  return chunks.join("");
}

// =============================================================================
// Tests
// =============================================================================

describe("CliUx", () => {
  // ===========================================================================
  // Success messages
  // ===========================================================================

  describe("success messages", () => {
    it("formats success message with checkmark", async () => {
      const ux = createCliUx({ level: "info", colors: false });

      const output = await captureStdout(() => {
        ux.success("Operation completed");
      });

      expect(output).toContain("✓");
      expect(output).toContain("Operation completed");
    });

    it("includes details when provided", async () => {
      const ux = createCliUx({ level: "info", colors: false });

      const output = await captureStdout(() => {
        ux.success("Installed pack", { name: "foo", version: "1.0.0" });
      });

      expect(output).toContain("Installed pack");
      expect(output).toContain("foo");
      expect(output).toContain("1.0.0");
    });
  });

  // ===========================================================================
  // Error messages
  // ===========================================================================

  describe("error messages", () => {
    it("formats error message with X mark", async () => {
      const ux = createCliUx({ level: "info", colors: false });

      const output = await captureStderr(() => {
        ux.error("Something went wrong");
      });

      expect(output).toContain("✗");
      expect(output).toContain("Something went wrong");
    });

    it("includes hint when provided", async () => {
      const ux = createCliUx({ level: "info", colors: false });

      const output = await captureStderr(() => {
        ux.error("File not found", { hint: "Check the file path" });
      });

      expect(output).toContain("File not found");
      expect(output).toContain("Hint:");
      expect(output).toContain("Check the file path");
    });

    it("includes code when provided", async () => {
      const ux = createCliUx({ level: "info", colors: false });

      const output = await captureStderr(() => {
        ux.error("Validation failed", { code: "INVALID_INPUT" });
      });

      expect(output).toContain("INVALID_INPUT");
      expect(output).toContain("Validation failed");
    });
  });

  // ===========================================================================
  // Warning messages
  // ===========================================================================

  describe("warning messages", () => {
    it("formats warning message with warning symbol", async () => {
      const ux = createCliUx({ level: "info", colors: false });

      const output = await captureStderr(() => {
        ux.warn("This might cause issues");
      });

      expect(output).toContain("⚠");
      expect(output).toContain("This might cause issues");
    });
  });

  // ===========================================================================
  // Info messages
  // ===========================================================================

  describe("info messages", () => {
    it("formats info message with arrow", async () => {
      const ux = createCliUx({ level: "info", colors: false });

      const output = await captureStdout(() => {
        ux.info("Processing files...");
      });

      expect(output).toContain("→");
      expect(output).toContain("Processing files...");
    });
  });

  // ===========================================================================
  // Log levels
  // ===========================================================================

  describe("log levels", () => {
    it("respects normal level - hides debug and verbose", async () => {
      const ux = createCliUx({ level: "info", colors: false });

      const output = await captureStdout(() => {
        ux.debug("Debug message");
        ux.verbose("Verbose message");
        ux.info("Info message");
      });

      expect(output).not.toContain("Debug message");
      expect(output).not.toContain("Verbose message");
      expect(output).toContain("Info message");
    });

    it("verbose level shows verbose but not debug", async () => {
      const ux = createCliUx({ level: "verbose", colors: false });

      const output = await captureStdout(() => {
        ux.debug("Debug message");
        ux.verbose("Verbose message");
        ux.info("Info message");
      });

      expect(output).not.toContain("Debug message");
      expect(output).toContain("Verbose message");
      expect(output).toContain("Info message");
    });

    it("debug level shows everything", async () => {
      const ux = createCliUx({ level: "debug", colors: false });

      const output = await captureStdout(() => {
        ux.debug("Debug message");
        ux.verbose("Verbose message");
        ux.info("Info message");
      });

      expect(output).toContain("Debug message");
      expect(output).toContain("Verbose message");
      expect(output).toContain("Info message");
    });

    it("silent level shows nothing except errors", async () => {
      const ux = createCliUx({ level: "silent", colors: false });

      const stdoutOutput = await captureStdout(() => {
        ux.info("Info message");
        ux.success("Success message");
      });

      const stderrOutput = await captureStderr(() => {
        ux.error("Error message");
      });

      expect(stdoutOutput).toBe("");
      expect(stderrOutput).toContain("Error message");
    });
  });

  // ===========================================================================
  // Step logging
  // ===========================================================================

  describe("step logging", () => {
    it("formats step with number and description", async () => {
      const ux = createCliUx({ level: "info", colors: false });

      const output = await captureStdout(() => {
        ux.step(1, 3, "Loading manifest");
      });

      expect(output).toContain("[1/3]");
      expect(output).toContain("Loading manifest");
    });
  });

  // ===========================================================================
  // Indented output
  // ===========================================================================

  describe("indented output", () => {
    it("indents detail lines", async () => {
      const ux = createCliUx({ level: "info", colors: false });

      const output = await captureStdout(() => {
        ux.detail("File: src/app.ts");
      });

      expect(output).toMatch(/^\s{2,}File: src\/app\.ts/m);
    });
  });

  // ===========================================================================
  // Newlines and formatting
  // ===========================================================================

  describe("formatting", () => {
    it("newline adds blank line", async () => {
      const ux = createCliUx({ level: "info", colors: false });

      const output = await captureStdout(() => {
        ux.info("First");
        ux.newline();
        ux.info("Second");
      });

      expect(output).toContain("\n\n");
    });
  });

  // ===========================================================================
  // Color detection
  // ===========================================================================

  describe("color support", () => {
    it("can disable colors explicitly", async () => {
      const ux = createCliUx({ level: "info", colors: false });

      const output = await captureStdout(() => {
        ux.success("No colors here");
      });

      // Should not contain ANSI escape codes
      expect(output).not.toMatch(/\x1b\[/);
    });
  });
});
