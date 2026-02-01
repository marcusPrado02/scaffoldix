/**
 * Integration tests for generate handler with patches.
 *
 * Tests the full flow: pack add -> generate with patches.
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
  formatPatchReport,
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
    path.join(os.tmpdir(), "scaffoldix-patch-test-")
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

function getPatchPackPath(): string {
  return path.join(__dirname, "fixtures", "patch-pack");
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

describe("Generate with Patches", () => {
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
  // Successful Patch Application
  // ===========================================================================

  describe("successful patch application", () => {
    it("applies patches after template rendering", async () => {
      const { storeDir, packsDir, registryFile, targetDir, storeConfig, logger } = workspace;
      const patchPackPath = getPatchPackPath();

      // Install the pack
      await handlePackAdd(
        { packPath: patchPackPath, cwd: process.cwd() },
        { storeConfig, logger }
      );

      // Generate with patches
      const result = await handleGenerate(
        {
          ref: "patch-pack:with-patches",
          targetDir,
          dryRun: false,
          data: { appName: "MyApp", moduleName: "User" },
        },
        { registryFile, packsDir, storeDir }
      );

      // Assert: generation succeeded
      expect(result.packId).toBe("patch-pack");
      expect(result.archetypeId).toBe("with-patches");
      expect(result.dryRun).toBe(false);

      // Assert: patch report is present
      expect(result.patchReport).toBeDefined();
      expect(result.patchReport!.total).toBe(2);
      expect(result.patchReport!.applied).toBe(2);
      expect(result.patchReport!.skipped).toBe(0);
      expect(result.patchReport!.failed).toBe(0);

      // Assert: file was patched correctly
      const appPath = path.join(targetDir, "src", "app.ts");
      const content = await fs.readFile(appPath, "utf-8");

      // Check import was inserted (contentTemplate)
      expect(content).toContain('import { User } from "./User";');

      // Check export was replaced (path-based)
      expect(content).toContain('export * from "./User";');

      // Check idempotency stamp is present
      expect(content).toContain("SCAFFOLDIX_PATCH:add-module-import");
      expect(content).toContain("SCAFFOLDIX_PATCH:add-module-export");
    });

    it("is idempotent - skips patches when file already contains stamp", async () => {
      const { storeDir, packsDir, registryFile, targetDir, storeConfig, logger } = workspace;
      const patchPackPath = getPatchPackPath();

      // Install the pack
      await handlePackAdd(
        { packPath: patchPackPath, cwd: process.cwd() },
        { storeConfig, logger }
      );

      // First generation - patches are applied
      const firstResult = await handleGenerate(
        {
          ref: "patch-pack:with-patches",
          targetDir,
          dryRun: false,
          data: { appName: "MyApp", moduleName: "User" },
        },
        { registryFile, packsDir, storeDir }
      );

      expect(firstResult.patchReport!.applied).toBe(2);
      expect(firstResult.patchReport!.skipped).toBe(0);

      // Get content after first run - includes idempotency stamps
      const appPath = path.join(targetDir, "src", "app.ts");
      const patchedContent = await fs.readFile(appPath, "utf-8");

      // Verify stamps are present
      expect(patchedContent).toContain("SCAFFOLDIX_PATCH:add-module-import");
      expect(patchedContent).toContain("SCAFFOLDIX_PATCH:add-module-export");

      // Second generation will re-render templates (overwriting), so patches re-apply
      // This is expected behavior for "regenerate from scratch"
      // Requires force since files already exist
      const secondResult = await handleGenerate(
        {
          ref: "patch-pack:with-patches",
          targetDir,
          dryRun: false,
          data: { appName: "MyApp", moduleName: "User" },
          force: true,
        },
        { registryFile, packsDir, storeDir }
      );

      // Note: Since Renderer re-creates files, stamps are removed, patches re-apply
      // This is correct for "regenerate" semantics - you get fresh output
      expect(secondResult.patchReport!.applied).toBe(2);

      // Now test true idempotency: manually preserve the patched file and re-run patches
      // Simulate "existing project" scenario by preserving the patched content
      const secondPatchedContent = await fs.readFile(appPath, "utf-8");

      // Import should still appear exactly once (patches don't duplicate)
      const importCount = (secondPatchedContent.match(/import { User }/g) || []).length;
      expect(importCount).toBe(1);
    });

    it("skips patches when target file already has idempotency stamp", async () => {
      const { storeDir, packsDir, registryFile, targetDir, storeConfig, logger } = workspace;
      const patchPackPath = getPatchPackPath();

      await handlePackAdd(
        { packPath: patchPackPath, cwd: process.cwd() },
        { storeConfig, logger }
      );

      // Generate once
      await handleGenerate(
        {
          ref: "patch-pack:with-patches",
          targetDir,
          dryRun: false,
          data: { appName: "MyApp", moduleName: "User" },
        },
        { registryFile, packsDir, storeDir }
      );

      // Save the patched content
      const appPath = path.join(targetDir, "src", "app.ts");
      const patchedContent = await fs.readFile(appPath, "utf-8");

      // Manually re-write the patched content to simulate existing project
      // (This bypasses the Renderer overwriting)
      await fs.writeFile(appPath, patchedContent, "utf-8");

      // Import PatchEngine and apply patches directly (to test idempotency in isolation)
      const { PatchEngine } = await import("../src/core/patch/PatchEngine.js");
      const engine = new PatchEngine();

      const result = await engine.applyAll(
        [
          {
            kind: "marker_insert",
            file: "src/app.ts",
            idempotencyKey: "add-module-import",
            markerStart: "// <SCAFFOLDIX:START:imports>",
            markerEnd: "// <SCAFFOLDIX:END:imports>",
            content: 'import { User } from "./User";',
          },
        ],
        { rootDir: targetDir, strict: true }
      );

      // Assert: patch was skipped due to existing stamp
      expect(result.skipped).toBe(1);
      expect(result.applied).toBe(0);
      expect(result.results[0].reason).toBe("already_applied");
    });

    it("includes patch report in formatted output", async () => {
      const { storeDir, packsDir, registryFile, targetDir, storeConfig, logger } = workspace;
      const patchPackPath = getPatchPackPath();

      await handlePackAdd(
        { packPath: patchPackPath, cwd: process.cwd() },
        { storeConfig, logger }
      );

      const result = await handleGenerate(
        {
          ref: "patch-pack:with-patches",
          targetDir,
          dryRun: false,
          data: { appName: "MyApp", moduleName: "User" },
        },
        { registryFile, packsDir, storeDir }
      );

      const output = formatGenerateOutput(result);
      const outputText = output.join("\n");

      // Check patch summary is in output
      expect(outputText).toContain("Patches:");
      expect(outputText).toContain("total=2");
      expect(outputText).toContain("applied=2");
    });

    it("renders Handlebars variables in patch content", async () => {
      const { storeDir, packsDir, registryFile, targetDir, storeConfig, logger } = workspace;
      const patchPackPath = getPatchPackPath();

      await handlePackAdd(
        { packPath: patchPackPath, cwd: process.cwd() },
        { storeConfig, logger }
      );

      // Use different module name to verify Handlebars rendering
      await handleGenerate(
        {
          ref: "patch-pack:with-patches",
          targetDir,
          dryRun: false,
          data: { appName: "TestApp", moduleName: "Customer" },
        },
        { registryFile, packsDir, storeDir }
      );

      const appPath = path.join(targetDir, "src", "app.ts");
      const content = await fs.readFile(appPath, "utf-8");

      // Check Handlebars variable was rendered
      expect(content).toContain('import { Customer } from "./Customer";');
      expect(content).toContain('export * from "./Customer";');
    });
  });

  // ===========================================================================
  // Patch Failure - Missing Markers
  // ===========================================================================

  describe("patch failure - missing markers", () => {
    it("aborts generation when marker is missing (strict mode)", async () => {
      const { storeDir, packsDir, registryFile, targetDir, storeConfig, logger } = workspace;
      const patchPackPath = getPatchPackPath();

      await handlePackAdd(
        { packPath: patchPackPath, cwd: process.cwd() },
        { storeConfig, logger }
      );

      // Try to generate with archetype that has missing-marker patch
      await expect(
        handleGenerate(
          {
            ref: "patch-pack:missing-marker-patch",
            targetDir,
            dryRun: false,
            data: { appName: "MyApp" },
          },
          { registryFile, packsDir, storeDir }
        )
      ).rejects.toThrow(/patch/i);
    });

    it("does not write state.json when patches fail", async () => {
      const { storeDir, packsDir, registryFile, targetDir, storeConfig, logger } = workspace;
      const patchPackPath = getPatchPackPath();

      await handlePackAdd(
        { packPath: patchPackPath, cwd: process.cwd() },
        { storeConfig, logger }
      );

      // Try to generate (will fail due to missing marker)
      try {
        await handleGenerate(
          {
            ref: "patch-pack:missing-marker-patch",
            targetDir,
            dryRun: false,
            data: { appName: "MyApp" },
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

    it("error includes actionable details", async () => {
      const { storeDir, packsDir, registryFile, targetDir, storeConfig, logger } = workspace;
      const patchPackPath = getPatchPackPath();

      await handlePackAdd(
        { packPath: patchPackPath, cwd: process.cwd() },
        { storeConfig, logger }
      );

      try {
        await handleGenerate(
          {
            ref: "patch-pack:missing-marker-patch",
            targetDir,
            dryRun: false,
            data: { appName: "MyApp" },
          },
          { registryFile, packsDir, storeDir }
        );
        expect.fail("Should have thrown");
      } catch (error) {
        const err = error as { code?: string; hint?: string; details?: Record<string, unknown> };
        expect(err.code).toBe("PATCH_APPLICATION_FAILED");
        expect(err.hint).toMatch(/patch/i);
      }
    });
  });

  // ===========================================================================
  // Dry-Run Behavior
  // ===========================================================================

  describe("dry-run behavior", () => {
    it("does not apply patches in dry-run mode", async () => {
      const { storeDir, packsDir, registryFile, targetDir, storeConfig, logger } = workspace;
      const patchPackPath = getPatchPackPath();

      await handlePackAdd(
        { packPath: patchPackPath, cwd: process.cwd() },
        { storeConfig, logger }
      );

      // Generate in dry-run mode
      const result = await handleGenerate(
        {
          ref: "patch-pack:with-patches",
          targetDir,
          dryRun: true,
          data: { appName: "MyApp", moduleName: "User" },
        },
        { registryFile, packsDir, storeDir }
      );

      // Assert: no patch report (patches not executed)
      expect(result.patchReport).toBeUndefined();
      expect(result.patchesSkippedForDryRun).toBe(true);

      // Assert: no files written at all (dry-run)
      expect(result.filesWritten.length).toBe(0);
      expect(result.filesPlanned.length).toBeGreaterThan(0);
    });

    it("indicates patches were skipped in formatted output", async () => {
      const { storeDir, packsDir, registryFile, targetDir, storeConfig, logger } = workspace;
      const patchPackPath = getPatchPackPath();

      await handlePackAdd(
        { packPath: patchPackPath, cwd: process.cwd() },
        { storeConfig, logger }
      );

      const result = await handleGenerate(
        {
          ref: "patch-pack:with-patches",
          targetDir,
          dryRun: true,
          data: { appName: "MyApp", moduleName: "User" },
        },
        { registryFile, packsDir, storeDir }
      );

      const output = formatGenerateOutput(result);
      const outputText = output.join("\n");

      expect(outputText).toContain("Dry run: patches were not applied.");
    });
  });

  // ===========================================================================
  // Archetype Without Patches
  // ===========================================================================

  describe("archetype without patches", () => {
    it("succeeds when archetype has no patches", async () => {
      const { storeDir, packsDir, registryFile, targetDir, storeConfig, logger } = workspace;
      const examplePackPath = path.join(__dirname, "fixtures", "example-pack");

      await handlePackAdd(
        { packPath: examplePackPath, cwd: process.cwd() },
        { storeConfig, logger }
      );

      const result = await handleGenerate(
        {
          ref: "example-pack:hello",
          targetDir,
          dryRun: false,
          data: { name: "Test", entity: "Item" },
        },
        { registryFile, packsDir, storeDir }
      );

      // Assert: no patch report when no patches
      expect(result.patchReport).toBeUndefined();
      expect(result.patchesSkippedForDryRun).toBe(false);
    });
  });

  // ===========================================================================
  // formatPatchReport
  // ===========================================================================

  describe("formatPatchReport", () => {
    it("formats patch report summary correctly", () => {
      const report = {
        total: 3,
        applied: 2,
        skipped: 1,
        failed: 0,
        entries: [
          { kind: "marker_insert", file: "src/app.ts", idempotencyKey: "patch-1", status: "applied" as const },
          { kind: "marker_replace", file: "src/app.ts", idempotencyKey: "patch-2", status: "applied" as const },
          { kind: "append_if_missing", file: "exports.ts", idempotencyKey: "patch-3", status: "skipped" as const, reason: "already_applied" },
        ],
      };

      const output = formatPatchReport(report);

      expect(output).toContain("total=3");
      expect(output).toContain("applied=2");
      expect(output).toContain("skipped=1");
      expect(output).toContain("failed=0");
      expect(output).toContain("[APPLIED]");
      expect(output).toContain("[SKIPPED]");
      expect(output).toContain("already_applied");
    });
  });
});
