/**
 * Tests for CLI Spinner module.
 *
 * Tests spinner behavior, TTY fallback, and integration with CliUx.
 *
 * @module
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CliSpinner, createCliSpinner } from "../src/cli/ux/CliSpinner.js";
import { createCliUx } from "../src/cli/ux/CliUx.js";

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

// =============================================================================
// Tests
// =============================================================================

describe("CliSpinner", () => {
  // ===========================================================================
  // Basic spinner operations (non-TTY mode - testable)
  // ===========================================================================

  describe("non-TTY fallback mode", () => {
    it("outputs start message in non-TTY mode", async () => {
      const ux = createCliUx({ level: "info", colors: false });
      const spinner = createCliSpinner({ ux, isTTY: false });

      const output = await captureStdout(() => {
        spinner.start("Loading manifest");
      });

      expect(output).toContain("Loading manifest");
    });

    it("outputs success message with checkmark", async () => {
      const ux = createCliUx({ level: "info", colors: false });
      const spinner = createCliSpinner({ ux, isTTY: false });

      const output = await captureStdout(() => {
        spinner.start("Installing pack");
        spinner.succeed("Pack installed");
      });

      expect(output).toContain("Pack installed");
      expect(output).toContain("✓");
    });

    it("outputs failure message with X mark", async () => {
      const ux = createCliUx({ level: "info", colors: false });
      const spinner = createCliSpinner({ ux, isTTY: false });

      const stderrChunks: string[] = [];
      const originalStderr = process.stderr.write.bind(process.stderr);
      process.stderr.write = ((chunk: string | Uint8Array) => {
        stderrChunks.push(String(chunk));
        return true;
      }) as typeof process.stderr.write;

      try {
        await captureStdout(() => {
          spinner.start("Installing pack");
          spinner.fail("Installation failed");
        });
      } finally {
        process.stderr.write = originalStderr;
      }

      const stderrOutput = stderrChunks.join("");
      expect(stderrOutput).toContain("Installation failed");
      expect(stderrOutput).toContain("✗");
    });

    it("allows stopping without message", async () => {
      const ux = createCliUx({ level: "info", colors: false });
      const spinner = createCliSpinner({ ux, isTTY: false });

      const output = await captureStdout(() => {
        spinner.start("Processing");
        spinner.stop();
      });

      expect(output).toContain("Processing");
    });

    it("allows updating message", async () => {
      const ux = createCliUx({ level: "info", colors: false });
      const spinner = createCliSpinner({ ux, isTTY: false });

      const output = await captureStdout(() => {
        spinner.start("Step 1");
        spinner.update("Step 2");
        spinner.succeed("Done");
      });

      expect(output).toContain("Step 1");
      expect(output).toContain("Step 2");
      expect(output).toContain("Done");
    });
  });

  // ===========================================================================
  // Silent mode
  // ===========================================================================

  describe("silent mode", () => {
    it("outputs nothing when ux is silent", async () => {
      const ux = createCliUx({ level: "silent", colors: false });
      const spinner = createCliSpinner({ ux, isTTY: false });

      const output = await captureStdout(() => {
        spinner.start("Loading");
        spinner.update("Still loading");
        spinner.succeed("Done");
      });

      expect(output).toBe("");
    });
  });

  // ===========================================================================
  // Async operation wrapper
  // ===========================================================================

  describe("wrap async operation", () => {
    it("wraps async operation with spinner", async () => {
      const ux = createCliUx({ level: "info", colors: false });
      const spinner = createCliSpinner({ ux, isTTY: false });

      let operationRan = false;
      const output = await captureStdout(async () => {
        await spinner.wrap("Processing", async () => {
          operationRan = true;
          return "result";
        });
      });

      expect(operationRan).toBe(true);
      expect(output).toContain("Processing");
      expect(output).toContain("✓");
    });

    it("returns result from wrapped operation", async () => {
      const ux = createCliUx({ level: "info", colors: false });
      const spinner = createCliSpinner({ ux, isTTY: false });

      await captureStdout(async () => {
        const result = await spinner.wrap("Processing", async () => {
          return { value: 42 };
        });

        expect(result).toEqual({ value: 42 });
      });
    });

    it("shows failure on error in wrapped operation", async () => {
      const ux = createCliUx({ level: "info", colors: false });
      const spinner = createCliSpinner({ ux, isTTY: false });

      const stderrChunks: string[] = [];
      const originalStderr = process.stderr.write.bind(process.stderr);
      process.stderr.write = ((chunk: string | Uint8Array) => {
        stderrChunks.push(String(chunk));
        return true;
      }) as typeof process.stderr.write;

      try {
        await captureStdout(async () => {
          try {
            await spinner.wrap("Processing", async () => {
              throw new Error("Something went wrong");
            });
          } catch {
            // Expected
          }
        });
      } finally {
        process.stderr.write = originalStderr;
      }

      const stderrOutput = stderrChunks.join("");
      expect(stderrOutput).toContain("✗");
    });

    it("rethrows error from wrapped operation", async () => {
      const ux = createCliUx({ level: "info", colors: false });
      const spinner = createCliSpinner({ ux, isTTY: false });

      // Suppress output
      const originalStdout = process.stdout.write.bind(process.stdout);
      const originalStderr = process.stderr.write.bind(process.stderr);
      process.stdout.write = () => true;
      process.stderr.write = () => true;

      try {
        await expect(
          spinner.wrap("Processing", async () => {
            throw new Error("Test error");
          })
        ).rejects.toThrow("Test error");
      } finally {
        process.stdout.write = originalStdout;
        process.stderr.write = originalStderr;
      }
    });
  });
});
