/**
 * Tests for pack update handler.
 *
 * Uses local git repositories to test the update workflow
 * without network dependencies.
 *
 * @module
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import simpleGit, { type SimpleGit } from "simple-git";
import {
  handlePackUpdate,
  type PackUpdateInput,
  type PackUpdateResult,
  type PackUpdateDependencies,
} from "../src/cli/handlers/packUpdateHandler.js";
import { handlePackAdd } from "../src/cli/handlers/packAddHandler.js";
import { RegistryService } from "../src/core/registry/RegistryService.js";
import type { StoreServiceConfig, StoreLogger } from "../src/core/store/StoreService.js";

// =============================================================================
// Test Helpers
// =============================================================================

interface TestGitRepo {
  repoPath: string;
  git: SimpleGit;
  commitHash: string;
}

interface TestWorkspace {
  baseDir: string;
  storeDir: string;
  packsDir: string;
  registryFile: string;
  storeConfig: StoreServiceConfig;
  logger: StoreLogger;
}

/**
 * Creates a no-op logger for testing.
 */
function createTestLogger(): StoreLogger {
  return {
    info: () => {},
    debug: () => {},
    warn: () => {},
  };
}

/**
 * Creates a local git repository with a valid pack manifest.
 */
async function createTestGitRepo(
  baseDir: string,
  packName: string,
  version: string,
): Promise<TestGitRepo> {
  const repoPath = path.join(baseDir, `${packName}-repo`);
  await fs.mkdir(repoPath, { recursive: true });

  const git = simpleGit(repoPath);
  await git.init();
  await git.addConfig("user.email", "test@example.com");
  await git.addConfig("user.name", "Test User");

  // Create a valid pack manifest
  const manifest = `pack:
  name: "${packName}"
  version: "${version}"

archetypes:
  - id: default
    templateRoot: templates
`;
  await fs.writeFile(path.join(repoPath, "archetype.yaml"), manifest);

  // Create template directory and file
  const templateDir = path.join(repoPath, "templates");
  await fs.mkdir(templateDir, { recursive: true });
  await fs.writeFile(path.join(templateDir, "hello.txt"), "Hello from {{name}}!");

  // Commit everything
  await git.add(".");
  await git.commit("Initial commit");

  // Get the commit hash
  const log = await git.log({ maxCount: 1 });
  const commitHash = log.latest?.hash ?? "";

  return { repoPath, git, commitHash };
}

/**
 * Creates a test workspace with store directories.
 */
async function createTestWorkspace(): Promise<TestWorkspace> {
  const baseDir = path.join(os.tmpdir(), "scaffoldix-packupdate-test");
  await fs.mkdir(baseDir, { recursive: true });
  const testDir = await fs.mkdtemp(path.join(baseDir, "test-"));

  const storeDir = path.join(testDir, "store");
  const packsDir = path.join(storeDir, "packs");
  const registryFile = path.join(storeDir, "registry.json");

  await fs.mkdir(storeDir, { recursive: true });
  await fs.mkdir(packsDir, { recursive: true });

  const storeConfig: StoreServiceConfig = {
    storeDir,
    packsDir,
    registryFile,
  };

  const logger = createTestLogger();

  return {
    baseDir: testDir,
    storeDir,
    packsDir,
    registryFile,
    storeConfig,
    logger,
  };
}

async function cleanupWorkspace(workspace: TestWorkspace): Promise<void> {
  await fs.rm(workspace.baseDir, { recursive: true, force: true });
}

// =============================================================================
// Tests
// =============================================================================

describe("pack update <packId>", () => {
  let workspace: TestWorkspace;

  beforeEach(async () => {
    workspace = await createTestWorkspace();
  });

  afterEach(async () => {
    await cleanupWorkspace(workspace);
  });

  // ===========================================================================
  // Error Cases
  // ===========================================================================

  describe("error handling", () => {
    it("throws PACK_NOT_FOUND when pack does not exist", async () => {
      const deps: PackUpdateDependencies = {
        storeConfig: workspace.storeConfig,
        logger: workspace.logger,
      };

      await expect(handlePackUpdate({ packId: "nonexistent-pack" }, deps)).rejects.toThrow(
        /not found/i,
      );

      try {
        await handlePackUpdate({ packId: "nonexistent-pack" }, deps);
      } catch (err) {
        expect((err as Error).message).toContain("nonexistent-pack");
      }
    });

    it("throws actionable error when pack is not git-based", async () => {
      // Install a local pack (not git-based)
      const localPackDir = path.join(workspace.baseDir, "local-pack");
      await fs.mkdir(localPackDir, { recursive: true });
      await fs.writeFile(
        path.join(localPackDir, "archetype.yaml"),
        `pack:
  name: "local-pack"
  version: "1.0.0"

archetypes:
  - id: default
    templateRoot: templates
`,
      );
      const templateDir = path.join(localPackDir, "templates");
      await fs.mkdir(templateDir, { recursive: true });
      await fs.writeFile(path.join(templateDir, "test.txt"), "test");

      // Add the local pack
      await handlePackAdd(
        { packPath: localPackDir, cwd: workspace.baseDir },
        { storeConfig: workspace.storeConfig, logger: workspace.logger },
      );

      // Try to update it
      const deps: PackUpdateDependencies = {
        storeConfig: workspace.storeConfig,
        logger: workspace.logger,
      };

      await expect(handlePackUpdate({ packId: "local-pack" }, deps)).rejects.toThrow(
        /not Git-based/i,
      );

      try {
        await handlePackUpdate({ packId: "local-pack" }, deps);
      } catch (err) {
        const message = (err as Error).message;
        expect(message).toContain("local-pack");
        expect(message.toLowerCase()).toContain("git");
      }
    });
  });

  // ===========================================================================
  // Successful Update
  // ===========================================================================

  describe("successful update", () => {
    it("updates pack when new commit is available", async () => {
      // Create initial git repo and install
      const {
        repoPath,
        git,
        commitHash: commit1,
      } = await createTestGitRepo(workspace.baseDir, "update-test-pack", "1.0.0");

      // Install the pack via git
      await handlePackAdd(
        { packPath: repoPath, cwd: workspace.baseDir, isGitUrl: true },
        { storeConfig: workspace.storeConfig, logger: workspace.logger },
      );

      // Verify initial installation
      const registry = new RegistryService(workspace.registryFile);
      const initialEntry = await registry.getPack("update-test-pack");
      expect(initialEntry).not.toBeNull();
      expect(initialEntry!.origin.type).toBe("git");
      if (initialEntry!.origin.type === "git") {
        expect(initialEntry!.origin.commit).toBe(commit1);
      }

      // Make a new commit in the repo
      await fs.writeFile(
        path.join(repoPath, "templates", "hello.txt"),
        "Hello updated from {{name}}!",
      );
      await git.add(".");
      await git.commit("Update template content");
      const log = await git.log({ maxCount: 1 });
      const commit2 = log.latest?.hash ?? "";

      expect(commit2).not.toBe(commit1);

      // Update the pack
      const deps: PackUpdateDependencies = {
        storeConfig: workspace.storeConfig,
        logger: workspace.logger,
      };

      const result = await handlePackUpdate({ packId: "update-test-pack" }, deps);

      // Verify update result
      expect(result.packId).toBe("update-test-pack");
      expect(result.status).toBe("updated");
      expect(result.previousCommit).toBe(commit1);
      expect(result.newCommit).toBe(commit2);

      // Verify registry was updated
      const updatedEntry = await registry.getPack("update-test-pack");
      expect(updatedEntry!.origin.type).toBe("git");
      if (updatedEntry!.origin.type === "git") {
        expect(updatedEntry!.origin.commit).toBe(commit2);
      }
    });

    it("updates pack version when manifest version changes", async () => {
      // Create initial git repo and install
      const {
        repoPath,
        git,
        commitHash: commit1,
      } = await createTestGitRepo(workspace.baseDir, "version-update-pack", "1.0.0");

      // Install the pack via git
      await handlePackAdd(
        { packPath: repoPath, cwd: workspace.baseDir, isGitUrl: true },
        { storeConfig: workspace.storeConfig, logger: workspace.logger },
      );

      // Verify initial version
      const registry = new RegistryService(workspace.registryFile);
      const initialEntry = await registry.getPack("version-update-pack");
      expect(initialEntry!.version).toBe("1.0.0");

      // Update the manifest version
      await fs.writeFile(
        path.join(repoPath, "archetype.yaml"),
        `pack:
  name: "version-update-pack"
  version: "2.0.0"

archetypes:
  - id: default
    templateRoot: templates
`,
      );
      await git.add(".");
      await git.commit("Bump version to 2.0.0");
      const log = await git.log({ maxCount: 1 });
      const commit2 = log.latest?.hash ?? "";

      // Update the pack
      const deps: PackUpdateDependencies = {
        storeConfig: workspace.storeConfig,
        logger: workspace.logger,
      };

      const result = await handlePackUpdate({ packId: "version-update-pack" }, deps);

      expect(result.status).toBe("updated");
      expect(result.previousVersion).toBe("1.0.0");
      expect(result.newVersion).toBe("2.0.0");

      // Verify registry has new version
      const updatedEntry = await registry.getPack("version-update-pack");
      expect(updatedEntry!.version).toBe("2.0.0");
    });

    it("returns already_up_to_date when no changes", async () => {
      // Create initial git repo and install
      const { repoPath, commitHash } = await createTestGitRepo(
        workspace.baseDir,
        "no-change-pack",
        "1.0.0",
      );

      // Install the pack via git
      await handlePackAdd(
        { packPath: repoPath, cwd: workspace.baseDir, isGitUrl: true },
        { storeConfig: workspace.storeConfig, logger: workspace.logger },
      );

      // Update without any changes
      const deps: PackUpdateDependencies = {
        storeConfig: workspace.storeConfig,
        logger: workspace.logger,
      };

      const result = await handlePackUpdate({ packId: "no-change-pack" }, deps);

      expect(result.status).toBe("already_up_to_date");
      expect(result.newCommit).toBe(commitHash);
      expect(result.previousCommit).toBe(commitHash);
    });

    it("uses --ref flag to update to specific branch", async () => {
      // Create initial git repo and install
      const {
        repoPath,
        git,
        commitHash: commit1,
      } = await createTestGitRepo(workspace.baseDir, "ref-update-pack", "1.0.0");

      // Get the default branch name
      const branchInfo = await git.branch();
      const defaultBranch = branchInfo.current;

      // Install the pack via git (from default branch)
      await handlePackAdd(
        { packPath: repoPath, cwd: workspace.baseDir, isGitUrl: true },
        { storeConfig: workspace.storeConfig, logger: workspace.logger },
      );

      // Create a feature branch with different content
      await git.checkoutLocalBranch("feature/v2");
      await fs.writeFile(
        path.join(repoPath, "archetype.yaml"),
        `pack:
  name: "ref-update-pack"
  version: "2.0.0"

archetypes:
  - id: default
    templateRoot: templates
`,
      );
      await git.add(".");
      await git.commit("Version 2 on feature branch");
      const log = await git.log({ maxCount: 1 });
      const featureCommit = log.latest?.hash ?? "";

      // Switch back to default branch
      await git.checkout(defaultBranch);

      // Update to the feature branch
      const deps: PackUpdateDependencies = {
        storeConfig: workspace.storeConfig,
        logger: workspace.logger,
      };

      const result = await handlePackUpdate({ packId: "ref-update-pack", ref: "feature/v2" }, deps);

      expect(result.status).toBe("updated");
      expect(result.newCommit).toBe(featureCommit);
      expect(result.newVersion).toBe("2.0.0");
    });
  });

  // ===========================================================================
  // History Tracking
  // ===========================================================================

  describe("history tracking", () => {
    it("preserves previous version in history after update", async () => {
      // Create initial git repo and install
      const {
        repoPath,
        git,
        commitHash: commit1,
      } = await createTestGitRepo(workspace.baseDir, "history-pack", "1.0.0");

      // Install the pack via git
      await handlePackAdd(
        { packPath: repoPath, cwd: workspace.baseDir, isGitUrl: true },
        { storeConfig: workspace.storeConfig, logger: workspace.logger },
      );

      // Make a new commit
      await fs.writeFile(
        path.join(repoPath, "archetype.yaml"),
        `pack:
  name: "history-pack"
  version: "2.0.0"

archetypes:
  - id: default
    templateRoot: templates
`,
      );
      await git.add(".");
      await git.commit("Bump to v2");

      // Update the pack
      const deps: PackUpdateDependencies = {
        storeConfig: workspace.storeConfig,
        logger: workspace.logger,
      };

      await handlePackUpdate({ packId: "history-pack" }, deps);

      // Verify history is preserved
      const registry = new RegistryService(workspace.registryFile);
      const history = await registry.getPackHistory("history-pack");

      expect(history).not.toBeNull();
      expect(history!.length).toBeGreaterThanOrEqual(1);

      // The history should contain the previous version
      const previousRecord = history![0];
      expect(previousRecord.version).toBe("1.0.0");
      if (previousRecord.origin.type === "git") {
        expect(previousRecord.origin.commit).toBe(commit1);
      }
    });

    it("maintains history order (oldest first) after multiple updates", async () => {
      // Create initial git repo and install
      const {
        repoPath,
        git,
        commitHash: commit1,
      } = await createTestGitRepo(workspace.baseDir, "multi-history-pack", "1.0.0");

      // Install the pack via git
      await handlePackAdd(
        { packPath: repoPath, cwd: workspace.baseDir, isGitUrl: true },
        { storeConfig: workspace.storeConfig, logger: workspace.logger },
      );

      const deps: PackUpdateDependencies = {
        storeConfig: workspace.storeConfig,
        logger: workspace.logger,
      };

      // Update to v2
      await fs.writeFile(
        path.join(repoPath, "archetype.yaml"),
        `pack:
  name: "multi-history-pack"
  version: "2.0.0"

archetypes:
  - id: default
    templateRoot: templates
`,
      );
      await git.add(".");
      await git.commit("Bump to v2");
      const log2 = await git.log({ maxCount: 1 });
      const commit2 = log2.latest?.hash ?? "";

      await handlePackUpdate({ packId: "multi-history-pack" }, deps);

      // Update to v3
      await fs.writeFile(
        path.join(repoPath, "archetype.yaml"),
        `pack:
  name: "multi-history-pack"
  version: "3.0.0"

archetypes:
  - id: default
    templateRoot: templates
`,
      );
      await git.add(".");
      await git.commit("Bump to v3");

      await handlePackUpdate({ packId: "multi-history-pack" }, deps);

      // Verify history order
      const registry = new RegistryService(workspace.registryFile);
      const history = await registry.getPackHistory("multi-history-pack");

      expect(history!.length).toBe(2);
      expect(history![0].version).toBe("1.0.0"); // Oldest first
      expect(history![1].version).toBe("2.0.0");

      // Current should be v3
      const current = await registry.getPack("multi-history-pack");
      expect(current!.version).toBe("3.0.0");
    });
  });

  // ===========================================================================
  // Cleanup
  // ===========================================================================

  describe("cleanup", () => {
    it("cleans up temp directory after successful update", async () => {
      // Create initial git repo and install
      const { repoPath, git } = await createTestGitRepo(workspace.baseDir, "cleanup-pack", "1.0.0");

      // Install the pack via git
      await handlePackAdd(
        { packPath: repoPath, cwd: workspace.baseDir, isGitUrl: true },
        { storeConfig: workspace.storeConfig, logger: workspace.logger },
      );

      // Make a new commit
      await fs.writeFile(path.join(repoPath, "templates", "new.txt"), "new content");
      await git.add(".");
      await git.commit("Add new file");

      // Update the pack
      const deps: PackUpdateDependencies = {
        storeConfig: workspace.storeConfig,
        logger: workspace.logger,
      };

      await handlePackUpdate({ packId: "cleanup-pack" }, deps);

      // Verify no temp directories left
      const tmpDir = path.join(workspace.storeDir, ".tmp", "git-clones");
      const tmpExists = await fs
        .access(tmpDir)
        .then(() => true)
        .catch(() => false);

      if (tmpExists) {
        const entries = await fs.readdir(tmpDir);
        expect(entries).toHaveLength(0);
      }
    });

    it("cleans up temp directory on failure", async () => {
      // Create a git repo with a valid manifest initially
      const { repoPath, git } = await createTestGitRepo(
        workspace.baseDir,
        "fail-cleanup-pack",
        "1.0.0",
      );

      // Install the pack via git
      await handlePackAdd(
        { packPath: repoPath, cwd: workspace.baseDir, isGitUrl: true },
        { storeConfig: workspace.storeConfig, logger: workspace.logger },
      );

      // Make the manifest invalid in the next commit
      await fs.writeFile(path.join(repoPath, "archetype.yaml"), "invalid: yaml: content:");
      await git.add(".");
      await git.commit("Break manifest");

      // Try to update (should fail due to invalid manifest)
      const deps: PackUpdateDependencies = {
        storeConfig: workspace.storeConfig,
        logger: workspace.logger,
      };

      try {
        await handlePackUpdate({ packId: "fail-cleanup-pack" }, deps);
      } catch {
        // Expected to fail
      }

      // Verify temp directories are cleaned up
      const tmpDir = path.join(workspace.storeDir, ".tmp", "git-clones");
      const tmpExists = await fs
        .access(tmpDir)
        .then(() => true)
        .catch(() => false);

      if (tmpExists) {
        const entries = await fs.readdir(tmpDir);
        expect(entries).toHaveLength(0);
      }
    });
  });
});
