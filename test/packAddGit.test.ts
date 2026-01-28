/**
 * Integration tests for pack add with git URLs.
 *
 * Tests the full flow of adding a pack from a git repository,
 * using local git repositories to avoid network dependencies.
 *
 * @module
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import simpleGit, { type SimpleGit } from "simple-git";
import {
  handlePackAdd,
  type PackAddResult,
  type PackAddDependencies,
} from "../src/cli/handlers/packAddHandler.js";
import { RegistryService, type RegistryPackEntry } from "../src/core/registry/RegistryService.js";
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
 * Creates a local git repository with a valid pack manifest.
 */
async function createTestGitRepo(
  baseDir: string,
  packName: string,
  version: string
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
 * Creates a test workspace with store directories.
 */
async function createTestWorkspace(): Promise<TestWorkspace> {
  const baseDir = path.join(os.tmpdir(), "scaffoldix-packaddgit-test");
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

describe("pack add <git-url>", () => {
  let workspace: TestWorkspace;

  beforeEach(async () => {
    workspace = await createTestWorkspace();
  });

  afterEach(async () => {
    await cleanupWorkspace(workspace);
  });

  // ===========================================================================
  // Successful Install from Git
  // ===========================================================================

  describe("successful git install", () => {
    it("installs pack from local git repository path", async () => {
      const { repoPath, commitHash } = await createTestGitRepo(
        workspace.baseDir,
        "git-pack",
        "1.0.0"
      );

      const result = await handlePackAdd(
        {
          packPath: repoPath,
          cwd: workspace.baseDir,
          isGitUrl: true,
        },
        {
          storeConfig: workspace.storeConfig,
          logger: workspace.logger,
        }
      );

      expect(result.packId).toBe("git-pack");
      expect(result.version).toBe("1.0.0");
      expect(result.status).toBe("installed");

      // Verify registry entry has git origin
      const registry = new RegistryService(workspace.registryFile);
      const packEntry = await registry.getPack("git-pack");

      expect(packEntry).not.toBeNull();
      expect(packEntry!.origin.type).toBe("git");

      if (packEntry!.origin.type === "git") {
        expect(packEntry!.origin.gitUrl).toBe(repoPath);
        expect(packEntry!.origin.commit).toBe(commitHash);
      }
    });

    it("installs pack with specific ref", async () => {
      const { repoPath, git } = await createTestGitRepo(
        workspace.baseDir,
        "ref-pack",
        "1.0.0"
      );

      // Get the current/default branch name (could be main or master)
      const branchInfo = await git.branch();
      const defaultBranch = branchInfo.current;

      // Create a v2 branch
      await git.checkoutLocalBranch("v2");
      await fs.writeFile(
        path.join(repoPath, "archetype.yaml"),
        `pack:
  name: "ref-pack"
  version: "2.0.0"

archetypes:
  - id: default
    templateRoot: templates
`
      );
      await git.add(".");
      await git.commit("Version 2");
      const log = await git.log({ maxCount: 1 });
      const v2Commit = log.latest?.hash ?? "";

      // Switch back to default branch
      await git.checkout(defaultBranch);

      // Install from v2 branch
      const result = await handlePackAdd(
        {
          packPath: repoPath,
          cwd: workspace.baseDir,
          isGitUrl: true,
          ref: "v2",
        },
        {
          storeConfig: workspace.storeConfig,
          logger: workspace.logger,
        }
      );

      expect(result.version).toBe("2.0.0");

      // Verify registry has v2 commit
      const registry = new RegistryService(workspace.registryFile);
      const packEntry = await registry.getPack("ref-pack");

      expect(packEntry!.origin.type).toBe("git");
      if (packEntry!.origin.type === "git") {
        expect(packEntry!.origin.commit).toBe(v2Commit);
        expect(packEntry!.origin.ref).toBe("v2");
      }
    });

    it("stores pack in correct store location", async () => {
      const { repoPath } = await createTestGitRepo(
        workspace.baseDir,
        "store-pack",
        "1.0.0"
      );

      const result = await handlePackAdd(
        {
          packPath: repoPath,
          cwd: workspace.baseDir,
          isGitUrl: true,
        },
        {
          storeConfig: workspace.storeConfig,
          logger: workspace.logger,
        }
      );

      // Verify pack is installed in store
      expect(result.destDir).toContain(workspace.packsDir);
      expect(result.destDir).toContain("store-pack");

      // Verify manifest exists in store
      const manifestPath = path.join(result.destDir, "archetype.yaml");
      const stat = await fs.stat(manifestPath);
      expect(stat.isFile()).toBe(true);
    });
  });

  // ===========================================================================
  // Idempotency
  // ===========================================================================

  describe("idempotency", () => {
    it("returns already_installed on second identical install", async () => {
      const { repoPath } = await createTestGitRepo(
        workspace.baseDir,
        "idempotent-pack",
        "1.0.0"
      );

      const deps: PackAddDependencies = {
        storeConfig: workspace.storeConfig,
        logger: workspace.logger,
      };

      const input = {
        packPath: repoPath,
        cwd: workspace.baseDir,
        isGitUrl: true,
      };

      // First install
      const result1 = await handlePackAdd(input, deps);
      expect(result1.status).toBe("installed");

      // Second install
      const result2 = await handlePackAdd(input, deps);
      expect(result2.status).toBe("already_installed");
      expect(result2.destDir).toBe(result1.destDir);
    });

    it("does not create duplicate registry entries", async () => {
      const { repoPath } = await createTestGitRepo(
        workspace.baseDir,
        "nodup-pack",
        "1.0.0"
      );

      const deps: PackAddDependencies = {
        storeConfig: workspace.storeConfig,
        logger: workspace.logger,
      };

      const input = {
        packPath: repoPath,
        cwd: workspace.baseDir,
        isGitUrl: true,
      };

      // Install twice
      await handlePackAdd(input, deps);
      await handlePackAdd(input, deps);

      // Verify only one registry entry
      const registryContent = await fs.readFile(workspace.registryFile, "utf-8");
      const registry = JSON.parse(registryContent);
      const packIds = Object.keys(registry.packs);

      expect(packIds.filter((id) => id === "nodup-pack")).toHaveLength(1);
    });
  });

  // ===========================================================================
  // Error Handling
  // ===========================================================================

  describe("error handling", () => {
    it("throws actionable error for invalid git URL", async () => {
      const deps: PackAddDependencies = {
        storeConfig: workspace.storeConfig,
        logger: workspace.logger,
      };

      await expect(
        handlePackAdd(
          {
            packPath: "/nonexistent/repo/path",
            cwd: workspace.baseDir,
            isGitUrl: true,
          },
          deps
        )
      ).rejects.toThrow();

      try {
        await handlePackAdd(
          {
            packPath: "/nonexistent/repo/path",
            cwd: workspace.baseDir,
            isGitUrl: true,
          },
          deps
        );
      } catch (err) {
        expect((err as Error).message).toContain("clone");
      }
    });

    it("throws actionable error for missing manifest in repo", async () => {
      // Create a git repo without a manifest
      const repoPath = path.join(workspace.baseDir, "no-manifest-repo");
      await fs.mkdir(repoPath, { recursive: true });

      const git = simpleGit(repoPath);
      await git.init();
      await git.addConfig("user.email", "test@example.com");
      await git.addConfig("user.name", "Test User");

      await fs.writeFile(path.join(repoPath, "README.md"), "# No manifest here");
      await git.add(".");
      await git.commit("Initial commit");

      const deps: PackAddDependencies = {
        storeConfig: workspace.storeConfig,
        logger: workspace.logger,
      };

      await expect(
        handlePackAdd(
          {
            packPath: repoPath,
            cwd: workspace.baseDir,
            isGitUrl: true,
          },
          deps
        )
      ).rejects.toThrow();

      try {
        await handlePackAdd(
          {
            packPath: repoPath,
            cwd: workspace.baseDir,
            isGitUrl: true,
          },
          deps
        );
      } catch (err) {
        expect((err as Error).message.toLowerCase()).toContain("manifest");
      }
    });

    it("cleans up temp directory on failure", async () => {
      // Create a git repo without a manifest
      const repoPath = path.join(workspace.baseDir, "cleanup-fail-repo");
      await fs.mkdir(repoPath, { recursive: true });

      const git = simpleGit(repoPath);
      await git.init();
      await git.addConfig("user.email", "test@example.com");
      await git.addConfig("user.name", "Test User");

      await fs.writeFile(path.join(repoPath, "README.md"), "# No manifest");
      await git.add(".");
      await git.commit("Initial commit");

      const deps: PackAddDependencies = {
        storeConfig: workspace.storeConfig,
        logger: workspace.logger,
      };

      try {
        await handlePackAdd(
          {
            packPath: repoPath,
            cwd: workspace.baseDir,
            isGitUrl: true,
          },
          deps
        );
      } catch {
        // Expected to fail
      }

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
  });
});
