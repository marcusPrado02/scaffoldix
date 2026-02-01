/**
 * Tests for GitPackFetcher.
 *
 * Uses local git repositories created in temp directories to test
 * git clone functionality without network dependencies.
 *
 * @module
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import simpleGit, { type SimpleGit } from "simple-git";
import { GitPackFetcher, type GitFetchResult } from "../src/core/store/GitPackFetcher.js";
import { ScaffoldError } from "../src/core/errors/errors.js";

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
  repoPath: string;
  storeDir: string;
  cleanupPaths: string[];
}

/**
 * Creates a local git repository with a valid pack manifest for testing.
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
 * Creates a test workspace with directories for testing.
 */
async function createTestWorkspace(): Promise<TestWorkspace> {
  const baseDir = path.join(os.tmpdir(), "scaffoldix-git-test");
  await fs.mkdir(baseDir, { recursive: true });
  const testDir = await fs.mkdtemp(path.join(baseDir, "test-"));

  const storeDir = path.join(testDir, "store");
  await fs.mkdir(storeDir, { recursive: true });

  return {
    baseDir: testDir,
    repoPath: path.join(testDir, "repo"),
    storeDir,
    cleanupPaths: [testDir],
  };
}

async function cleanupWorkspace(workspace: TestWorkspace): Promise<void> {
  for (const p of workspace.cleanupPaths) {
    await fs.rm(p, { recursive: true, force: true });
  }
}

// =============================================================================
// Tests
// =============================================================================

describe("GitPackFetcher", () => {
  let workspace: TestWorkspace;
  let fetcher: GitPackFetcher;

  beforeEach(async () => {
    workspace = await createTestWorkspace();
    fetcher = new GitPackFetcher(workspace.storeDir);
  });

  afterEach(async () => {
    await cleanupWorkspace(workspace);
  });

  // ===========================================================================
  // URL Detection
  // ===========================================================================

  describe("isGitUrl()", () => {
    it("detects https:// URLs as git", () => {
      expect(GitPackFetcher.isGitUrl("https://github.com/user/repo.git")).toBe(true);
      expect(GitPackFetcher.isGitUrl("https://github.com/user/repo")).toBe(true);
      expect(GitPackFetcher.isGitUrl("https://gitlab.com/org/pack.git")).toBe(true);
    });

    it("detects http:// URLs as git", () => {
      expect(GitPackFetcher.isGitUrl("http://github.com/user/repo.git")).toBe(true);
    });

    it("detects git@ SSH URLs as git", () => {
      expect(GitPackFetcher.isGitUrl("git@github.com:user/repo.git")).toBe(true);
      expect(GitPackFetcher.isGitUrl("git@gitlab.com:org/pack")).toBe(true);
    });

    it("detects ssh:// URLs as git", () => {
      expect(GitPackFetcher.isGitUrl("ssh://git@github.com/user/repo.git")).toBe(true);
    });

    it("does not detect local paths as git URLs", () => {
      expect(GitPackFetcher.isGitUrl("/path/to/pack")).toBe(false);
      expect(GitPackFetcher.isGitUrl("./relative/path")).toBe(false);
      expect(GitPackFetcher.isGitUrl("../parent/path")).toBe(false);
      expect(GitPackFetcher.isGitUrl("pack-name")).toBe(false);
    });

    it("does not detect Windows paths as git URLs", () => {
      expect(GitPackFetcher.isGitUrl("C:\\Users\\pack")).toBe(false);
      expect(GitPackFetcher.isGitUrl("D:/path/to/pack")).toBe(false);
    });
  });

  // ===========================================================================
  // Successful Clone
  // ===========================================================================

  describe("fetch() - success", () => {
    it("clones a local git repository and returns fetch result", async () => {
      const { repoPath, commitHash } = await createTestGitRepo(
        workspace.baseDir,
        "test-pack",
        "1.0.0",
      );

      const result = await fetcher.fetch(repoPath);

      expect(result.packDir).toBeDefined();
      expect(result.commit).toBe(commitHash);
      expect(result.url).toBe(repoPath);

      // Verify cloned files exist
      const manifestPath = path.join(result.packDir, "archetype.yaml");
      const stat = await fs.stat(manifestPath);
      expect(stat.isFile()).toBe(true);

      // Verify template was cloned
      const templatePath = path.join(result.packDir, "templates", "hello.txt");
      const templateStat = await fs.stat(templatePath);
      expect(templateStat.isFile()).toBe(true);
    });

    it("clones with a specific branch ref", async () => {
      const { repoPath, git } = await createTestGitRepo(workspace.baseDir, "branch-pack", "1.0.0");

      // Get the current/default branch name (could be main or master)
      const branchInfo = await git.branch();
      const defaultBranch = branchInfo.current;

      // Create a feature branch with different content
      await git.checkoutLocalBranch("feature/v2");
      await fs.writeFile(
        path.join(repoPath, "archetype.yaml"),
        `pack:
  name: "branch-pack"
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

      // Clone the feature branch
      const result = await fetcher.fetch(repoPath, { ref: "feature/v2" });

      expect(result.commit).toBe(featureCommit);
      expect(result.ref).toBe("feature/v2");

      // Verify we got v2 content
      const manifestContent = await fs.readFile(
        path.join(result.packDir, "archetype.yaml"),
        "utf-8",
      );
      expect(manifestContent).toContain('version: "2.0.0"');
    });

    it("clones with a specific tag ref", async () => {
      const { repoPath, git, commitHash } = await createTestGitRepo(
        workspace.baseDir,
        "tag-pack",
        "1.0.0",
      );

      // Create a tag
      await git.addTag("v1.0.0");

      // Add another commit (so tag points to previous commit)
      await fs.writeFile(path.join(repoPath, "new-file.txt"), "new content");
      await git.add(".");
      await git.commit("After tag commit");

      // Clone at the tag
      const result = await fetcher.fetch(repoPath, { ref: "v1.0.0" });

      expect(result.commit).toBe(commitHash);
      expect(result.ref).toBe("v1.0.0");

      // Verify we got the tagged version (no new-file.txt)
      const newFileExists = await fs
        .access(path.join(result.packDir, "new-file.txt"))
        .then(() => true)
        .catch(() => false);
      expect(newFileExists).toBe(false);
    });

    it("cleans up temp directory after successful fetch", async () => {
      const { repoPath } = await createTestGitRepo(workspace.baseDir, "cleanup-pack", "1.0.0");

      const result = await fetcher.fetch(repoPath);

      // The packDir should exist (it's the result)
      const packDirExists = await fs
        .access(result.packDir)
        .then(() => true)
        .catch(() => false);
      expect(packDirExists).toBe(true);

      // No other temp directories should exist in staging
      const stagingDir = path.join(workspace.storeDir, ".tmp", "git-clones");
      const stagingExists = await fs
        .access(stagingDir)
        .then(() => true)
        .catch(() => false);

      if (stagingExists) {
        const entries = await fs.readdir(stagingDir);
        // All entries should be the result packDir or empty
        expect(entries.length).toBeLessThanOrEqual(1);
      }
    });
  });

  // ===========================================================================
  // Clone Failures
  // ===========================================================================

  describe("fetch() - failures", () => {
    it("throws actionable error when URL is invalid", async () => {
      const invalidUrl = "https://invalid.example.com/nonexistent/repo.git";

      await expect(fetcher.fetch(invalidUrl)).rejects.toThrow(ScaffoldError);

      try {
        await fetcher.fetch(invalidUrl);
      } catch (err) {
        expect(err).toBeInstanceOf(ScaffoldError);
        const scaffoldErr = err as ScaffoldError;
        expect(scaffoldErr.code).toBe("GIT_CLONE_FAILED");
        expect(scaffoldErr.hint).toContain(invalidUrl);
        expect(scaffoldErr.hint).toContain("Check network");
      }
    });

    it("throws actionable error when ref does not exist", async () => {
      const { repoPath } = await createTestGitRepo(workspace.baseDir, "noref-pack", "1.0.0");

      await expect(fetcher.fetch(repoPath, { ref: "nonexistent-branch" })).rejects.toThrow(
        ScaffoldError,
      );

      try {
        await fetcher.fetch(repoPath, { ref: "nonexistent-branch" });
      } catch (err) {
        expect(err).toBeInstanceOf(ScaffoldError);
        const scaffoldErr = err as ScaffoldError;
        expect(scaffoldErr.code).toBe("GIT_CHECKOUT_FAILED");
        expect(scaffoldErr.hint).toContain("nonexistent-branch");
      }
    });

    it("cleans up temp directory on clone failure", async () => {
      const invalidUrl = "/nonexistent/path/that/does/not/exist";

      try {
        await fetcher.fetch(invalidUrl);
      } catch {
        // Expected to fail
      }

      // Check no temp directories left behind
      const stagingDir = path.join(workspace.storeDir, ".tmp", "git-clones");
      const stagingExists = await fs
        .access(stagingDir)
        .then(() => true)
        .catch(() => false);

      if (stagingExists) {
        const entries = await fs.readdir(stagingDir);
        expect(entries).toHaveLength(0);
      }
    });
  });

  // ===========================================================================
  // cleanup()
  // ===========================================================================

  describe("cleanup()", () => {
    it("removes the cloned pack directory", async () => {
      const { repoPath } = await createTestGitRepo(workspace.baseDir, "cleanup-test", "1.0.0");

      const result = await fetcher.fetch(repoPath);
      expect(
        await fs
          .access(result.packDir)
          .then(() => true)
          .catch(() => false),
      ).toBe(true);

      await fetcher.cleanup(result);

      expect(
        await fs
          .access(result.packDir)
          .then(() => true)
          .catch(() => false),
      ).toBe(false);
    });

    it("does not throw if directory already deleted", async () => {
      const { repoPath } = await createTestGitRepo(workspace.baseDir, "double-cleanup", "1.0.0");

      const result = await fetcher.fetch(repoPath);
      await fetcher.cleanup(result);

      // Second cleanup should not throw
      await expect(fetcher.cleanup(result)).resolves.not.toThrow();
    });
  });
});
