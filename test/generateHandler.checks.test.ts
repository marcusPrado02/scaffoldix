/**
 * Integration tests for generate handler with quality checks.
 *
 * Tests the full flow: pack add -> generate -> checks execution.
 *
 * @module
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

import { handlePackAdd } from "../src/cli/handlers/packAddHandler.js";
import {
  handleGenerate,
  formatGenerateOutput,
  formatCheckReport,
} from "../src/cli/handlers/generateHandler.js";
import type { StoreServiceConfig, StoreLogger } from "../src/core/store/StoreService.js";

// =============================================================================
// Test Helpers
// =============================================================================

function createTestLogger(): StoreLogger {
  return {
    debug: () => {},
    info: () => {},
    warn: () => {},
  };
}

async function createTestWorkspace(): Promise<{
  workspaceDir: string;
  storeDir: string;
  packsDir: string;
  registryFile: string;
  targetDir: string;
  storeConfig: StoreServiceConfig;
  logger: StoreLogger;
}> {
  const workspaceDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "scaffoldix-check-test-")
  );

  const storeDir = path.join(workspaceDir, "store");
  const packsDir = path.join(storeDir, "packs");
  const registryFile = path.join(storeDir, "registry.json");
  const targetDir = path.join(workspaceDir, "target");

  await fs.mkdir(packsDir, { recursive: true });
  await fs.mkdir(targetDir, { recursive: true });

  const storeConfig: StoreServiceConfig = {
    storeDir,
    packsDir,
    registryFile,
  };

  const logger = createTestLogger();

  return { workspaceDir, storeDir, packsDir, registryFile, targetDir, storeConfig, logger };
}

async function cleanupWorkspace(workspaceDir: string): Promise<void> {
  try {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

function getCheckPackPath(): string {
  return path.join(__dirname, "fixtures", "check-pack");
}

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

describe("Generate with Quality Checks", () => {
  let workspace: Awaited<ReturnType<typeof createTestWorkspace>>;

  beforeEach(async () => {
    workspace = await createTestWorkspace();
  });

  afterEach(async () => {
    if (workspace) {
      await cleanupWorkspace(workspace.workspaceDir);
    }
  });

  // ===========================================================================
  // Multiple Checks Success
  // ===========================================================================

  describe("multiple checks success", () => {
    it("executes all checks successfully in order", async () => {
      const { storeDir, packsDir, registryFile, targetDir, storeConfig, logger } = workspace;
      const checkPackPath = getCheckPackPath();

      // Install the pack
      await handlePackAdd(
        { packPath: checkPackPath, cwd: process.cwd() },
        { storeConfig, logger }
      );

      // Generate with checks
      const result = await handleGenerate(
        {
          ref: "check-pack:with-multiple-checks",
          targetDir,
          dryRun: false,
          data: { projectName: "TestProject" },
        },
        { registryFile, packsDir, storeDir }
      );

      // Assert: generation succeeded
      expect(result.packId).toBe("check-pack");
      expect(result.archetypeId).toBe("with-multiple-checks");
      expect(result.dryRun).toBe(false);

      // Assert: check report is present
      expect(result.checkReport).toBeDefined();
      expect(result.checkReport!.total).toBe(3);
      expect(result.checkReport!.passed).toBe(3);
      expect(result.checkReport!.failed).toBe(0);
      expect(result.checkReport!.success).toBe(true);

      // Assert: template was rendered
      const readmePath = path.join(targetDir, "README.md");
      expect(await pathExists(readmePath)).toBe(true);
      const readmeContent = await fs.readFile(readmePath, "utf-8");
      expect(readmeContent).toContain("TestProject");

      // Assert: state.json was written (success)
      const stateFile = path.join(targetDir, ".scaffoldix", "state.json");
      expect(await pathExists(stateFile)).toBe(true);
    });

    it("executes single check successfully", async () => {
      const { storeDir, packsDir, registryFile, targetDir, storeConfig, logger } = workspace;
      const checkPackPath = getCheckPackPath();

      await handlePackAdd(
        { packPath: checkPackPath, cwd: process.cwd() },
        { storeConfig, logger }
      );

      const result = await handleGenerate(
        {
          ref: "check-pack:default",
          targetDir,
          dryRun: false,
          data: { projectName: "TestProject" },
        },
        { registryFile, packsDir, storeDir }
      );

      expect(result.checkReport).toBeDefined();
      expect(result.checkReport!.total).toBe(1);
      expect(result.checkReport!.passed).toBe(1);
      expect(result.checkReport!.success).toBe(true);
    });

    it("includes check duration in report", async () => {
      const { storeDir, packsDir, registryFile, targetDir, storeConfig, logger } = workspace;
      const checkPackPath = getCheckPackPath();

      await handlePackAdd(
        { packPath: checkPackPath, cwd: process.cwd() },
        { storeConfig, logger }
      );

      const result = await handleGenerate(
        {
          ref: "check-pack:default",
          targetDir,
          dryRun: false,
          data: { projectName: "TestProject" },
        },
        { registryFile, packsDir, storeDir }
      );

      expect(result.checkReport!.totalDurationMs).toBeGreaterThanOrEqual(0);
    });
  });

  // ===========================================================================
  // Failure Blocks Subsequent Checks
  // ===========================================================================

  describe("failure blocks subsequent checks", () => {
    it("aborts generation when check fails", async () => {
      const { storeDir, packsDir, registryFile, targetDir, storeConfig, logger } = workspace;
      const checkPackPath = getCheckPackPath();

      await handlePackAdd(
        { packPath: checkPackPath, cwd: process.cwd() },
        { storeConfig, logger }
      );

      await expect(
        handleGenerate(
          {
            ref: "check-pack:with-failing-check",
            targetDir,
            dryRun: false,
            data: { projectName: "TestProject" },
          },
          { registryFile, packsDir, storeDir }
        )
      ).rejects.toThrow(/check/i);
    });

    it("does not write state.json when checks fail", async () => {
      const { storeDir, packsDir, registryFile, targetDir, storeConfig, logger } = workspace;
      const checkPackPath = getCheckPackPath();

      await handlePackAdd(
        { packPath: checkPackPath, cwd: process.cwd() },
        { storeConfig, logger }
      );

      try {
        await handleGenerate(
          {
            ref: "check-pack:with-failing-check",
            targetDir,
            dryRun: false,
            data: { projectName: "TestProject" },
          },
          { registryFile, packsDir, storeDir }
        );
      } catch {
        // Expected to throw
      }

      // Assert: state.json was NOT written
      const stateFile = path.join(targetDir, ".scaffoldix", "state.json");
      expect(await pathExists(stateFile)).toBe(false);
    });

    it("error includes command string and exit code", async () => {
      const { storeDir, packsDir, registryFile, targetDir, storeConfig, logger } = workspace;
      const checkPackPath = getCheckPackPath();

      await handlePackAdd(
        { packPath: checkPackPath, cwd: process.cwd() },
        { storeConfig, logger }
      );

      try {
        await handleGenerate(
          {
            ref: "check-pack:with-failing-check",
            targetDir,
            dryRun: false,
            data: { projectName: "TestProject" },
          },
          { registryFile, packsDir, storeDir }
        );
        expect.fail("Should have thrown");
      } catch (error) {
        const err = error as { code?: string; hint?: string; details?: Record<string, unknown> };
        expect(err.code).toBe("CHECK_FAILED");
        expect(err.hint).toContain("exit code 1");
        expect(err.hint).toContain("node -e");
      }
    });

    it("captured output includes stderr content", async () => {
      const { storeDir, packsDir, registryFile, targetDir, storeConfig, logger } = workspace;
      const checkPackPath = getCheckPackPath();

      await handlePackAdd(
        { packPath: checkPackPath, cwd: process.cwd() },
        { storeConfig, logger }
      );

      try {
        await handleGenerate(
          {
            ref: "check-pack:with-failing-check",
            targetDir,
            dryRun: false,
            data: { projectName: "TestProject" },
          },
          { registryFile, packsDir, storeDir }
        );
        expect.fail("Should have thrown");
      } catch (error) {
        const err = error as { details?: { capturedOutput?: string } };
        // Error details should contain the captured stderr
        expect(err.details?.capturedOutput).toContain("Check failed - test error");
      }
    });
  });

  // ===========================================================================
  // Checks Run After postGenerate
  // ===========================================================================

  describe("checks run after postGenerate", () => {
    it("checks can verify files created by postGenerate hooks", async () => {
      const { storeDir, packsDir, registryFile, targetDir, storeConfig, logger } = workspace;
      const checkPackPath = getCheckPackPath();

      await handlePackAdd(
        { packPath: checkPackPath, cwd: process.cwd() },
        { storeConfig, logger }
      );

      // This archetype has postGenerate that creates a file, then checks that verify it exists
      const result = await handleGenerate(
        {
          ref: "check-pack:with-hooks-and-checks",
          targetDir,
          dryRun: false,
          data: { projectName: "TestProject" },
        },
        { registryFile, packsDir, storeDir }
      );

      // Assert: both hooks and checks ran successfully
      expect(result.hookReport).toBeDefined();
      expect(result.hookReport!.succeeded).toBe(1);
      expect(result.checkReport).toBeDefined();
      expect(result.checkReport!.passed).toBe(1);

      // Assert: hook created the file
      const hookFile = path.join(targetDir, "hook_ran.txt");
      expect(await pathExists(hookFile)).toBe(true);
    });
  });

  // ===========================================================================
  // Dry-Run Behavior
  // ===========================================================================

  describe("dry-run behavior", () => {
    it("does not execute checks in dry-run mode", async () => {
      const { storeDir, packsDir, registryFile, targetDir, storeConfig, logger } = workspace;
      const checkPackPath = getCheckPackPath();

      await handlePackAdd(
        { packPath: checkPackPath, cwd: process.cwd() },
        { storeConfig, logger }
      );

      // Generate in dry-run mode
      const result = await handleGenerate(
        {
          ref: "check-pack:with-multiple-checks",
          targetDir,
          dryRun: true,
          data: { projectName: "TestProject" },
        },
        { registryFile, packsDir, storeDir }
      );

      // Assert: no check report (checks not executed)
      expect(result.checkReport).toBeUndefined();
      expect(result.checksSkippedForDryRun).toBe(true);
    });

    it("indicates checks were skipped in formatted output", async () => {
      const { storeDir, packsDir, registryFile, targetDir, storeConfig, logger } = workspace;
      const checkPackPath = getCheckPackPath();

      await handlePackAdd(
        { packPath: checkPackPath, cwd: process.cwd() },
        { storeConfig, logger }
      );

      const result = await handleGenerate(
        {
          ref: "check-pack:with-multiple-checks",
          targetDir,
          dryRun: true,
          data: { projectName: "TestProject" },
        },
        { registryFile, packsDir, storeDir }
      );

      const output = formatGenerateOutput(result);
      const outputText = output.join("\n");

      expect(outputText).toContain("Dry run: checks were not executed.");
    });
  });

  // ===========================================================================
  // Archetype Without Checks
  // ===========================================================================

  describe("archetype without checks", () => {
    it("succeeds when archetype has no checks", async () => {
      const { storeDir, packsDir, registryFile, targetDir, storeConfig, logger } = workspace;
      const checkPackPath = getCheckPackPath();

      await handlePackAdd(
        { packPath: checkPackPath, cwd: process.cwd() },
        { storeConfig, logger }
      );

      const result = await handleGenerate(
        {
          ref: "check-pack:no-checks",
          targetDir,
          dryRun: false,
          data: { projectName: "TestProject" },
        },
        { registryFile, packsDir, storeDir }
      );

      // Assert: no check report when no checks
      expect(result.checkReport).toBeUndefined();
      expect(result.checksSkippedForDryRun).toBe(false);

      // Assert: template was rendered
      const readmePath = path.join(targetDir, "README.md");
      expect(await pathExists(readmePath)).toBe(true);
    });

    it("includes check report in formatted output when checks exist", async () => {
      const { storeDir, packsDir, registryFile, targetDir, storeConfig, logger } = workspace;
      const checkPackPath = getCheckPackPath();

      await handlePackAdd(
        { packPath: checkPackPath, cwd: process.cwd() },
        { storeConfig, logger }
      );

      const result = await handleGenerate(
        {
          ref: "check-pack:default",
          targetDir,
          dryRun: false,
          data: { projectName: "TestProject" },
        },
        { registryFile, packsDir, storeDir }
      );

      const output = formatGenerateOutput(result);
      const outputText = output.join("\n");

      expect(outputText).toContain("Checks:");
      expect(outputText).toContain("total=1");
      expect(outputText).toContain("passed=1");
    });
  });

  // ===========================================================================
  // formatCheckReport
  // ===========================================================================

  describe("formatCheckReport", () => {
    it("formats check report summary correctly", () => {
      const report = {
        total: 3,
        passed: 2,
        failed: 1,
        totalDurationMs: 1234,
        success: false,
      };

      const output = formatCheckReport(report);

      expect(output).toContain("total=3");
      expect(output).toContain("passed=2");
      expect(output).toContain("failed=1");
      expect(output).toContain("duration=1.23s");
    });

    it("formats duration in milliseconds for fast checks", () => {
      const report = {
        total: 1,
        passed: 1,
        failed: 0,
        totalDurationMs: 42,
        success: true,
      };

      const output = formatCheckReport(report);
      expect(output).toContain("duration=42ms");
    });
  });
});
