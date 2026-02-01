/**
 * Unit tests for CheckRunner.
 *
 * Tests the quality gate execution engine for checks commands.
 *
 * @module
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

import { CheckRunner, type CheckLogger } from "../../src/core/checks/CheckRunner.js";
import { ScaffoldError } from "../../src/core/errors/errors.js";

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Creates a test logger that collects messages.
 */
function createTestLogger(): CheckLogger & {
  infoMessages: string[];
  errorMessages: string[];
  stdoutLines: string[];
  stderrLines: string[];
  outputBlocks: string[];
} {
  const infoMessages: string[] = [];
  const errorMessages: string[] = [];
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];
  const outputBlocks: string[] = [];

  return {
    info: (message: string) => infoMessages.push(message),
    error: (message: string) => errorMessages.push(message),
    stdout: (line: string) => stdoutLines.push(line),
    stderr: (line: string) => stderrLines.push(line),
    outputBlock: (output: string) => outputBlocks.push(output),
    infoMessages,
    errorMessages,
    stdoutLines,
    stderrLines,
    outputBlocks,
  };
}

/**
 * Creates a temporary directory for testing.
 */
async function createTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "scaffoldix-check-test-"));
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

/**
 * Checks if a file exists.
 */
async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

// =============================================================================
// Tests
// =============================================================================

describe("CheckRunner", () => {
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
      const runner = new CheckRunner();
      const logger = createTestLogger();

      const summary = await runner.runChecks({
        commands: [],
        cwd: tempDir,
        logger,
      });

      expect(summary.total).toBe(0);
      expect(summary.passed).toBe(0);
      expect(summary.failed).toBe(0);
      expect(summary.success).toBe(true);
      expect(summary.results).toEqual([]);
      expect(logger.infoMessages.some((m) => m.includes("No checks configured"))).toBe(true);
    });

    it("handles undefined commands", async () => {
      const runner = new CheckRunner();
      const logger = createTestLogger();

      const summary = await runner.runChecks({
        commands: undefined as unknown as string[],
        cwd: tempDir,
        logger,
      });

      expect(summary.total).toBe(0);
      expect(summary.success).toBe(true);
    });
  });

  // ===========================================================================
  // Multiple Checks Success
  // ===========================================================================

  describe("multiple checks success", () => {
    it("executes all checks successfully in order", async () => {
      const runner = new CheckRunner();
      const logger = createTestLogger();

      const summary = await runner.runChecks({
        commands: [
          'node -e "process.exit(0)"',
          'node -e "console.log(\\"check2\\"); process.exit(0)"',
          'node -e "process.exit(0)"',
        ],
        cwd: tempDir,
        logger,
      });

      expect(summary.total).toBe(3);
      expect(summary.passed).toBe(3);
      expect(summary.failed).toBe(0);
      expect(summary.success).toBe(true);
      expect(summary.results.length).toBe(3);

      // All results should indicate success
      for (const result of summary.results) {
        expect(result.success).toBe(true);
        expect(result.exitCode).toBe(0);
      }
    });

    it("tracks duration for each check", async () => {
      const runner = new CheckRunner();
      const logger = createTestLogger();

      const summary = await runner.runChecks({
        commands: ['node -e "process.exit(0)"'],
        cwd: tempDir,
        logger,
      });

      expect(summary.results[0].durationMs).toBeGreaterThanOrEqual(0);
      expect(summary.totalDurationMs).toBeGreaterThanOrEqual(0);
    });

    it("logs command start and completion", async () => {
      const runner = new CheckRunner();
      const logger = createTestLogger();

      await runner.runChecks({
        commands: ['node -e "process.exit(0)"'],
        cwd: tempDir,
        logger,
      });

      expect(logger.infoMessages.some((m) => m.includes("Running check"))).toBe(true);
      expect(
        logger.infoMessages.some((m) => m.includes("passed") || m.includes("Check passed")),
      ).toBe(true);
    });

    it("shows check count correctly", async () => {
      const runner = new CheckRunner();
      const logger = createTestLogger();

      await runner.runChecks({
        commands: ['node -e "process.exit(0)"', 'node -e "process.exit(0)"'],
        cwd: tempDir,
        logger,
      });

      expect(logger.infoMessages.some((m) => m.includes("(1/2)"))).toBe(true);
      expect(logger.infoMessages.some((m) => m.includes("(2/2)"))).toBe(true);
    });

    it("runs checks in specified cwd", async () => {
      const runner = new CheckRunner();
      const logger = createTestLogger();
      const markerFile = path.join(tempDir, "marker.txt");

      // Create marker file, then check it exists from within cwd
      await fs.writeFile(markerFile, "exists");

      const summary = await runner.runChecks({
        commands: ['node -e "require(\\"fs\\").accessSync(\\"marker.txt\\")"'],
        cwd: tempDir,
        logger,
      });

      expect(summary.success).toBe(true);
    });
  });

  // ===========================================================================
  // Failure Blocks Subsequent Checks
  // ===========================================================================

  describe("failure blocks subsequent checks", () => {
    it("throws ScaffoldError on check failure", async () => {
      const runner = new CheckRunner();
      const logger = createTestLogger();

      await expect(
        runner.runChecks({
          commands: ['node -e "process.exit(1)"'],
          cwd: tempDir,
          logger,
        }),
      ).rejects.toThrow(ScaffoldError);
    });

    it("aborts on first failure and does not execute subsequent checks", async () => {
      const runner = new CheckRunner();
      const logger = createTestLogger();
      const shouldNotExist = path.join(tempDir, "should_not_exist.txt");

      try {
        await runner.runChecks({
          commands: [
            'node -e "process.exit(0)"',
            'node -e "console.error(\\"boom\\"); process.exit(2)"',
            `node -e "require('fs').writeFileSync('should_not_exist.txt', 'x')"`,
          ],
          cwd: tempDir,
          logger,
        });
        expect.fail("Should have thrown");
      } catch (error) {
        // Third check should never execute
        expect(await pathExists(shouldNotExist)).toBe(false);
      }
    });

    it("error includes command string and exit code", async () => {
      const runner = new CheckRunner();
      const logger = createTestLogger();

      try {
        await runner.runChecks({
          commands: ['node -e "process.exit(42)"'],
          cwd: tempDir,
          logger,
        });
        expect.fail("Should have thrown");
      } catch (error) {
        const scaffoldError = error as ScaffoldError;
        expect(scaffoldError.code).toBe("CHECK_FAILED");
        expect(scaffoldError.hint).toContain("exit code 42");
        expect(scaffoldError.hint).toContain("node -e");
        expect(scaffoldError.hint).toContain(tempDir);
      }
    });

    it("captured output includes stderr content", async () => {
      const runner = new CheckRunner();
      const logger = createTestLogger();

      try {
        await runner.runChecks({
          commands: ['node -e "console.error(\\"boom\\"); process.exit(2)"'],
          cwd: tempDir,
          logger,
        });
        expect.fail("Should have thrown");
      } catch (error) {
        const scaffoldError = error as ScaffoldError;
        // Error details should contain the captured output
        expect(scaffoldError.details?.capturedOutput).toContain("boom");
      }
    });

    it("captured output includes stdout content", async () => {
      const runner = new CheckRunner();
      const logger = createTestLogger();

      try {
        await runner.runChecks({
          commands: ['node -e "console.log(\\"stdout-message\\"); process.exit(1)"'],
          cwd: tempDir,
          logger,
        });
        expect.fail("Should have thrown");
      } catch (error) {
        const scaffoldError = error as ScaffoldError;
        expect(scaffoldError.details?.capturedOutput).toContain("stdout-message");
      }
    });

    it("logs failure with full output block", async () => {
      const runner = new CheckRunner();
      const logger = createTestLogger();

      try {
        await runner.runChecks({
          commands: [
            'node -e "console.log(\\"line1\\"); console.error(\\"line2\\"); process.exit(1)"',
          ],
          cwd: tempDir,
          logger,
        });
      } catch {
        // Expected
      }

      // Logger should have received the output block
      expect(logger.outputBlocks.length).toBeGreaterThan(0);
      const outputBlock = logger.outputBlocks.join("\n");
      expect(outputBlock).toContain("line1");
      expect(outputBlock).toContain("line2");
    });

    it("logs check failure message", async () => {
      const runner = new CheckRunner();
      const logger = createTestLogger();

      try {
        await runner.runChecks({
          commands: ['node -e "process.exit(1)"'],
          cwd: tempDir,
          logger,
        });
      } catch {
        // Expected
      }

      expect(logger.errorMessages.some((m) => m.includes("FAILED"))).toBe(true);
    });
  });

  // ===========================================================================
  // Shell Features
  // ===========================================================================

  describe("shell features", () => {
    it("supports shell pipes", async () => {
      const runner = new CheckRunner();
      const logger = createTestLogger();

      const summary = await runner.runChecks({
        commands: ["echo 'hello' | grep hello"],
        cwd: tempDir,
        logger,
      });

      expect(summary.success).toBe(true);
    });

    it("supports environment variables", async () => {
      const runner = new CheckRunner();
      const logger = createTestLogger();
      const outputFile = path.join(tempDir, "env_output.txt");

      const summary = await runner.runChecks({
        commands: [`echo $HOME > "${outputFile}"`],
        cwd: tempDir,
        logger,
      });

      expect(summary.success).toBe(true);
      const content = await fs.readFile(outputFile, "utf-8");
      expect(content.trim().length).toBeGreaterThan(0);
    });
  });

  // ===========================================================================
  // Logger Fallback
  // ===========================================================================

  describe("logger fallback", () => {
    it("works with minimal logger (info/error only)", async () => {
      const runner = new CheckRunner();
      const logger: CheckLogger = {
        info: vi.fn(),
        error: vi.fn(),
      };

      const summary = await runner.runChecks({
        commands: ['node -e "console.log(\\"test\\"); process.exit(0)"'],
        cwd: tempDir,
        logger,
      });

      expect(summary.success).toBe(true);
      expect(logger.info).toHaveBeenCalled();
    });

    it("calls outputBlock on failure when available", async () => {
      const runner = new CheckRunner();
      const outputBlock = vi.fn();
      const logger: CheckLogger = {
        info: vi.fn(),
        error: vi.fn(),
        outputBlock,
      };

      try {
        await runner.runChecks({
          commands: ['node -e "console.log(\\"captured\\"); process.exit(1)"'],
          cwd: tempDir,
          logger,
        });
      } catch {
        // Expected
      }

      expect(outputBlock).toHaveBeenCalled();
      expect(outputBlock.mock.calls[0][0]).toContain("captured");
    });
  });
});
