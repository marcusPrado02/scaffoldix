/**
 * Integration tests for generate handler with postGenerate hooks.
 *
 * Tests the full flow: pack add -> generate -> hooks execution.
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
  formatHookReport,
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
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "scaffoldix-hook-test-"));

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

function getHookPackPath(): string {
  return path.join(__dirname, "fixtures", "hook-pack");
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

describe("Generate with postGenerate Hooks", () => {
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
  // Successful Hook Execution
  // ===========================================================================

  describe("successful hook execution", () => {
    it("executes hooks after template rendering", async () => {
      const { storeDir, packsDir, registryFile, targetDir, storeConfig, logger } = workspace;
      const hookPackPath = getHookPackPath();

      // Install the pack
      await handlePackAdd({ packPath: hookPackPath, cwd: process.cwd() }, { storeConfig, logger });

      // Generate with hooks
      const result = await handleGenerate(
        {
          ref: "hook-pack:with-multiple-hooks",
          targetDir,
          dryRun: false,
          data: { projectName: "TestProject" },
        },
        { registryFile, packsDir, storeDir },
      );

      // Assert: generation succeeded
      expect(result.packId).toBe("hook-pack");
      expect(result.archetypeId).toBe("with-multiple-hooks");
      expect(result.dryRun).toBe(false);

      // Assert: hook report is present
      expect(result.hookReport).toBeDefined();
      expect(result.hookReport!.total).toBe(3);
      expect(result.hookReport!.succeeded).toBe(3);
      expect(result.hookReport!.failed).toBe(0);
      expect(result.hookReport!.success).toBe(true);

      // Assert: hook actually ran (created marker file)
      const markerPath = path.join(targetDir, "hook_marker.txt");
      expect(await pathExists(markerPath)).toBe(true);

      // Assert: template was rendered
      const readmePath = path.join(targetDir, "README.md");
      expect(await pathExists(readmePath)).toBe(true);
      const readmeContent = await fs.readFile(readmePath, "utf-8");
      expect(readmeContent).toContain("TestProject");
    });

    it("executes single hook successfully", async () => {
      const { storeDir, packsDir, registryFile, targetDir, storeConfig, logger } = workspace;
      const hookPackPath = getHookPackPath();

      await handlePackAdd({ packPath: hookPackPath, cwd: process.cwd() }, { storeConfig, logger });

      const result = await handleGenerate(
        {
          ref: "hook-pack:default",
          targetDir,
          dryRun: false,
          data: { projectName: "TestProject" },
        },
        { registryFile, packsDir, storeDir },
      );

      expect(result.hookReport).toBeDefined();
      expect(result.hookReport!.total).toBe(1);
      expect(result.hookReport!.succeeded).toBe(1);
      expect(result.hookReport!.success).toBe(true);
    });

    it("includes hook duration in report", async () => {
      const { storeDir, packsDir, registryFile, targetDir, storeConfig, logger } = workspace;
      const hookPackPath = getHookPackPath();

      await handlePackAdd({ packPath: hookPackPath, cwd: process.cwd() }, { storeConfig, logger });

      const result = await handleGenerate(
        {
          ref: "hook-pack:default",
          targetDir,
          dryRun: false,
          data: { projectName: "TestProject" },
        },
        { registryFile, packsDir, storeDir },
      );

      expect(result.hookReport!.totalDurationMs).toBeGreaterThanOrEqual(0);
    });
  });

  // ===========================================================================
  // Hook Failure
  // ===========================================================================

  describe("hook failure", () => {
    it("aborts generation when hook fails", async () => {
      const { storeDir, packsDir, registryFile, targetDir, storeConfig, logger } = workspace;
      const hookPackPath = getHookPackPath();

      await handlePackAdd({ packPath: hookPackPath, cwd: process.cwd() }, { storeConfig, logger });

      await expect(
        handleGenerate(
          {
            ref: "hook-pack:with-failing-hook",
            targetDir,
            dryRun: false,
            data: { projectName: "TestProject" },
          },
          { registryFile, packsDir, storeDir },
        ),
      ).rejects.toThrow(/hook/i);
    });

    it("does not write state.json when hooks fail", async () => {
      const { storeDir, packsDir, registryFile, targetDir, storeConfig, logger } = workspace;
      const hookPackPath = getHookPackPath();

      await handlePackAdd({ packPath: hookPackPath, cwd: process.cwd() }, { storeConfig, logger });

      try {
        await handleGenerate(
          {
            ref: "hook-pack:with-failing-hook",
            targetDir,
            dryRun: false,
            data: { projectName: "TestProject" },
          },
          { registryFile, packsDir, storeDir },
        );
      } catch {
        // Expected to throw
      }

      // Assert: state.json was NOT written
      const stateFile = path.join(targetDir, ".scaffoldix", "state.json");
      expect(await pathExists(stateFile)).toBe(false);
    });

    it("error includes actionable details", async () => {
      const { storeDir, packsDir, registryFile, targetDir, storeConfig, logger } = workspace;
      const hookPackPath = getHookPackPath();

      await handlePackAdd({ packPath: hookPackPath, cwd: process.cwd() }, { storeConfig, logger });

      try {
        await handleGenerate(
          {
            ref: "hook-pack:with-failing-hook",
            targetDir,
            dryRun: false,
            data: { projectName: "TestProject" },
          },
          { registryFile, packsDir, storeDir },
        );
        expect.fail("Should have thrown");
      } catch (error) {
        const err = error as { code?: string; hint?: string };
        expect(err.code).toBe("HOOK_EXECUTION_FAILED");
        expect(err.hint).toMatch(/hook/i);
        expect(err.hint).toContain("exit 1");
      }
    });
  });

  // ===========================================================================
  // Dry-Run Behavior
  // ===========================================================================

  describe("dry-run behavior", () => {
    it("does not execute hooks in dry-run mode", async () => {
      const { storeDir, packsDir, registryFile, targetDir, storeConfig, logger } = workspace;
      const hookPackPath = getHookPackPath();

      await handlePackAdd({ packPath: hookPackPath, cwd: process.cwd() }, { storeConfig, logger });

      // Generate in dry-run mode
      const result = await handleGenerate(
        {
          ref: "hook-pack:with-multiple-hooks",
          targetDir,
          dryRun: true,
          data: { projectName: "TestProject" },
        },
        { registryFile, packsDir, storeDir },
      );

      // Assert: no hook report (hooks not executed)
      expect(result.hookReport).toBeUndefined();
      expect(result.hooksSkippedForDryRun).toBe(true);

      // Assert: hook marker file was NOT created
      const markerPath = path.join(targetDir, "hook_marker.txt");
      expect(await pathExists(markerPath)).toBe(false);
    });

    it("indicates hooks were skipped in formatted output", async () => {
      const { storeDir, packsDir, registryFile, targetDir, storeConfig, logger } = workspace;
      const hookPackPath = getHookPackPath();

      await handlePackAdd({ packPath: hookPackPath, cwd: process.cwd() }, { storeConfig, logger });

      const result = await handleGenerate(
        {
          ref: "hook-pack:with-multiple-hooks",
          targetDir,
          dryRun: true,
          data: { projectName: "TestProject" },
        },
        { registryFile, packsDir, storeDir },
      );

      const output = formatGenerateOutput(result);
      const outputText = output.join("\n");

      expect(outputText).toContain("Dry run: postGenerate hooks were not executed.");
    });
  });

  // ===========================================================================
  // Archetype Without Hooks
  // ===========================================================================

  describe("archetype without hooks", () => {
    it("succeeds when archetype has no postGenerate hooks", async () => {
      const { storeDir, packsDir, registryFile, targetDir, storeConfig, logger } = workspace;
      const hookPackPath = getHookPackPath();

      await handlePackAdd({ packPath: hookPackPath, cwd: process.cwd() }, { storeConfig, logger });

      const result = await handleGenerate(
        {
          ref: "hook-pack:no-hooks",
          targetDir,
          dryRun: false,
          data: { projectName: "TestProject" },
        },
        { registryFile, packsDir, storeDir },
      );

      // Assert: no hook report when no hooks
      expect(result.hookReport).toBeUndefined();
      expect(result.hooksSkippedForDryRun).toBe(false);

      // Assert: template was rendered
      const readmePath = path.join(targetDir, "README.md");
      expect(await pathExists(readmePath)).toBe(true);
    });

    it("includes hook report in formatted output when hooks exist", async () => {
      const { storeDir, packsDir, registryFile, targetDir, storeConfig, logger } = workspace;
      const hookPackPath = getHookPackPath();

      await handlePackAdd({ packPath: hookPackPath, cwd: process.cwd() }, { storeConfig, logger });

      const result = await handleGenerate(
        {
          ref: "hook-pack:default",
          targetDir,
          dryRun: false,
          data: { projectName: "TestProject" },
        },
        { registryFile, packsDir, storeDir },
      );

      const output = formatGenerateOutput(result);
      const outputText = output.join("\n");

      expect(outputText).toContain("Hooks:");
      expect(outputText).toContain("total=1");
      expect(outputText).toContain("succeeded=1");
    });
  });

  // ===========================================================================
  // formatHookReport
  // ===========================================================================

  describe("formatHookReport", () => {
    it("formats hook report summary correctly", () => {
      const report = {
        total: 3,
        succeeded: 2,
        failed: 1,
        totalDurationMs: 1234,
        success: false,
      };

      const output = formatHookReport(report);

      expect(output).toContain("total=3");
      expect(output).toContain("succeeded=2");
      expect(output).toContain("failed=1");
      expect(output).toContain("duration=1.23s");
    });

    it("formats duration in milliseconds for fast hooks", () => {
      const report = {
        total: 1,
        succeeded: 1,
        failed: 0,
        totalDurationMs: 42,
        success: true,
      };

      const output = formatHookReport(report);
      expect(output).toContain("duration=42ms");
    });
  });
});
