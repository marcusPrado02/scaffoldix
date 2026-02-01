/**
 * Unit tests for HookRunner.
 *
 * Tests the shell command execution engine for postGenerate hooks.
 *
 * @module
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

import { HookRunner, type HookLogger } from "../../src/core/hooks/HookRunner.js";
import { ScaffoldError } from "../../src/core/errors/errors.js";

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Creates a silent logger that collects messages.
 */
function createTestLogger(): HookLogger & {
  infoMessages: string[];
  errorMessages: string[];
  stdoutLines: string[];
  stderrLines: string[];
} {
  const infoMessages: string[] = [];
  const errorMessages: string[] = [];
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];

  return {
    info: (message: string) => infoMessages.push(message),
    error: (message: string) => errorMessages.push(message),
    stdout: (line: string) => stdoutLines.push(line),
    stderr: (line: string) => stderrLines.push(line),
    infoMessages,
    errorMessages,
    stdoutLines,
    stderrLines,
  };
}

/**
 * Creates a temporary directory for testing.
 */
async function createTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "scaffoldix-hook-test-"));
}

/**
 * Cleans up a temporary directory.
 */
async function cleanupTempDir(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

// =============================================================================
// Tests
// =============================================================================

describe("HookRunner", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  // ===========================================================================
  // Empty Commands
  // ===========================================================================

  describe("empty commands", () => {
    it("handles empty commands array", async () => {
      const runner = new HookRunner();
      const logger = createTestLogger();

      const summary = await runner.runPostGenerate({
        commands: [],
        cwd: tempDir,
        logger,
      });

      expect(summary.total).toBe(0);
      expect(summary.succeeded).toBe(0);
      expect(summary.failed).toBe(0);
      expect(summary.success).toBe(true);
      expect(summary.results).toEqual([]);
    });

    it("handles undefined-like commands", async () => {
      const runner = new HookRunner();
      const logger = createTestLogger();

      // Cast to simulate runtime condition
      const summary = await runner.runPostGenerate({
        commands: undefined as unknown as string[],
        cwd: tempDir,
        logger,
      });

      expect(summary.total).toBe(0);
      expect(summary.success).toBe(true);
    });
  });

  // ===========================================================================
  // Successful Execution
  // ===========================================================================

  describe("successful execution", () => {
    it("executes a single command successfully", async () => {
      const runner = new HookRunner();
      const logger = createTestLogger();

      const summary = await runner.runPostGenerate({
        commands: ["echo hello"],
        cwd: tempDir,
        logger,
      });

      expect(summary.total).toBe(1);
      expect(summary.succeeded).toBe(1);
      expect(summary.failed).toBe(0);
      expect(summary.success).toBe(true);
      expect(summary.results[0].success).toBe(true);
      expect(summary.results[0].exitCode).toBe(0);
    });

    it("executes multiple commands sequentially", async () => {
      const runner = new HookRunner();
      const logger = createTestLogger();

      const summary = await runner.runPostGenerate({
        commands: ["echo first", "echo second", "echo third"],
        cwd: tempDir,
        logger,
      });

      expect(summary.total).toBe(3);
      expect(summary.succeeded).toBe(3);
      expect(summary.failed).toBe(0);
      expect(summary.success).toBe(true);
      expect(summary.results.length).toBe(3);
    });

    it("runs commands in the specified cwd", async () => {
      const runner = new HookRunner();
      const logger = createTestLogger();

      // Create a file and verify we can find it
      await fs.writeFile(path.join(tempDir, "marker.txt"), "exists");

      const summary = await runner.runPostGenerate({
        commands: ["ls marker.txt"],
        cwd: tempDir,
        logger,
      });

      expect(summary.success).toBe(true);
    });

    it("tracks duration for each command", async () => {
      const runner = new HookRunner();
      const logger = createTestLogger();

      const summary = await runner.runPostGenerate({
        commands: ["echo fast"],
        cwd: tempDir,
        logger,
      });

      expect(summary.results[0].durationMs).toBeGreaterThanOrEqual(0);
      expect(summary.totalDurationMs).toBeGreaterThanOrEqual(0);
    });

    it("supports shell features like pipes", async () => {
      const runner = new HookRunner();
      const logger = createTestLogger();

      const summary = await runner.runPostGenerate({
        commands: ["echo 'hello world' | grep hello"],
        cwd: tempDir,
        logger,
      });

      expect(summary.success).toBe(true);
    });

    it("supports commands with redirects", async () => {
      const runner = new HookRunner();
      const logger = createTestLogger();
      const outputFile = path.join(tempDir, "output.txt");

      const summary = await runner.runPostGenerate({
        commands: [`echo 'test content' > ${outputFile}`],
        cwd: tempDir,
        logger,
      });

      expect(summary.success).toBe(true);
      const content = await fs.readFile(outputFile, "utf-8");
      expect(content.trim()).toBe("test content");
    });
  });

  // ===========================================================================
  // Command Failure
  // ===========================================================================

  describe("command failure", () => {
    it("throws ScaffoldError on command failure", async () => {
      const runner = new HookRunner();
      const logger = createTestLogger();

      await expect(
        runner.runPostGenerate({
          commands: ["exit 1"],
          cwd: tempDir,
          logger,
        }),
      ).rejects.toThrow(ScaffoldError);
    });

    it("includes actionable error message", async () => {
      const runner = new HookRunner();
      const logger = createTestLogger();

      try {
        await runner.runPostGenerate({
          commands: ["exit 42"],
          cwd: tempDir,
          logger,
        });
        expect.fail("Should have thrown");
      } catch (error) {
        const scaffoldError = error as ScaffoldError;
        expect(scaffoldError.code).toBe("HOOK_EXECUTION_FAILED");
        expect(scaffoldError.hint).toContain("exit 42");
        expect(scaffoldError.hint).toContain("exit code 42");
        expect(scaffoldError.hint).toContain(tempDir);
      }
    });

    it("aborts on first failure", async () => {
      const runner = new HookRunner();
      const logger = createTestLogger();

      try {
        await runner.runPostGenerate({
          commands: ["echo first", "exit 1", "echo third"],
          cwd: tempDir,
          logger,
        });
        expect.fail("Should have thrown");
      } catch (error) {
        // Third command should never execute
        expect(logger.infoMessages.some((m) => m.includes("third"))).toBe(false);
      }
    });

    it("captures stderr in error details", async () => {
      const runner = new HookRunner();
      const logger = createTestLogger();

      try {
        await runner.runPostGenerate({
          commands: ["echo 'error message' >&2 && exit 1"],
          cwd: tempDir,
          logger,
        });
        expect.fail("Should have thrown");
      } catch (error) {
        const scaffoldError = error as ScaffoldError;
        expect(scaffoldError.details?.error).toContain("error message");
      }
    });

    it("handles command not found", async () => {
      const runner = new HookRunner();
      const logger = createTestLogger();

      await expect(
        runner.runPostGenerate({
          commands: ["nonexistent_command_xyz123"],
          cwd: tempDir,
          logger,
        }),
      ).rejects.toThrow(ScaffoldError);
    });
  });

  // ===========================================================================
  // Logging
  // ===========================================================================

  describe("logging", () => {
    it("logs command start and completion", async () => {
      const runner = new HookRunner();
      const logger = createTestLogger();

      await runner.runPostGenerate({
        commands: ["echo test"],
        cwd: tempDir,
        logger,
      });

      expect(logger.infoMessages.some((m) => m.includes("Running"))).toBe(true);
      expect(logger.infoMessages.some((m) => m.includes("completed"))).toBe(true);
    });

    it("logs hook count correctly", async () => {
      const runner = new HookRunner();
      const logger = createTestLogger();

      await runner.runPostGenerate({
        commands: ["echo one", "echo two"],
        cwd: tempDir,
        logger,
      });

      expect(logger.infoMessages.some((m) => m.includes("(1/2)"))).toBe(true);
      expect(logger.infoMessages.some((m) => m.includes("(2/2)"))).toBe(true);
    });

    it("logs stdout via logger.stdout", async () => {
      const runner = new HookRunner();
      const logger = createTestLogger();

      await runner.runPostGenerate({
        commands: ["echo stdout_output"],
        cwd: tempDir,
        logger,
      });

      expect(logger.stdoutLines.some((l) => l.includes("stdout_output"))).toBe(true);
    });

    it("logs stderr via logger.stderr", async () => {
      const runner = new HookRunner();
      const logger = createTestLogger();

      try {
        await runner.runPostGenerate({
          commands: ["echo stderr_output >&2"],
          cwd: tempDir,
          logger,
        });
      } catch {
        // Command may fail or succeed depending on shell
      }

      expect(logger.stderrLines.some((l) => l.includes("stderr_output"))).toBe(true);
    });

    it("falls back to info/error when stdout/stderr are missing", async () => {
      const runner = new HookRunner();
      // Logger without stdout/stderr methods
      const logger: HookLogger = {
        info: vi.fn(),
        error: vi.fn(),
      };

      await runner.runPostGenerate({
        commands: ["echo fallback_test"],
        cwd: tempDir,
        logger,
      });

      // Should have called info() for the output
      expect(logger.info).toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Environment Variables
  // ===========================================================================

  describe("environment variables", () => {
    it("passes custom env variables to commands", async () => {
      const runner = new HookRunner();
      const logger = createTestLogger();
      const outputFile = path.join(tempDir, "env_output.txt");

      await runner.runPostGenerate({
        commands: [`echo $CUSTOM_VAR > ${outputFile}`],
        cwd: tempDir,
        env: { CUSTOM_VAR: "custom_value" },
        logger,
      });

      const content = await fs.readFile(outputFile, "utf-8");
      expect(content.trim()).toBe("custom_value");
    });

    it("preserves existing env variables", async () => {
      const runner = new HookRunner();
      const logger = createTestLogger();
      const outputFile = path.join(tempDir, "path_output.txt");

      await runner.runPostGenerate({
        commands: [`echo $PATH > ${outputFile}`],
        cwd: tempDir,
        logger,
      });

      const content = await fs.readFile(outputFile, "utf-8");
      expect(content.trim().length).toBeGreaterThan(0);
    });
  });

  // ===========================================================================
  // Duration Formatting
  // ===========================================================================

  describe("duration formatting", () => {
    it("logs duration in milliseconds for fast commands", async () => {
      const runner = new HookRunner();
      const logger = createTestLogger();

      await runner.runPostGenerate({
        commands: ["echo fast"],
        cwd: tempDir,
        logger,
      });

      // Check that duration was logged
      const completionMessage = logger.infoMessages.find((m) => m.includes("completed"));
      expect(completionMessage).toBeDefined();
      expect(completionMessage).toMatch(/(\d+ms|\d+\.\d+s)/);
    });
  });
});
