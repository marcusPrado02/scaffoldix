/**
 * Tests for PackResolver.
 *
 * PackResolver handles version selection for pack lookups:
 * - No version specified: returns latest installed version
 * - Version specified: returns matching version or error with available list
 * - Works with both single-version and multi-version pack entries
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { PackResolver } from "../src/core/store/PackResolver.js";
import { RegistryService } from "../src/core/registry/RegistryService.js";

// =============================================================================
// Test Setup
// =============================================================================

describe("PackResolver", () => {
  let tempDir: string;
  let registryFile: string;
  let registry: RegistryService;
  let resolver: PackResolver;

  beforeEach(async () => {
    // Create isolated temp directory
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pack-resolver-test-"));
    registryFile = path.join(tempDir, "registry.json");
    registry = new RegistryService(registryFile);
    resolver = new PackResolver(registryFile);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  // ===========================================================================
  // Basic Resolution (Single Version)
  // ===========================================================================

  describe("single version packs", () => {
    it("resolves pack when no version specified (returns current)", async () => {
      // Setup: Single version pack
      await registry.registerPack({
        id: "my-pack",
        version: "1.0.0",
        origin: { type: "local", localPath: "/some/path" },
        hash: "a".repeat(64),
      });

      const result = await resolver.resolve("my-pack");

      expect(result.packId).toBe("my-pack");
      expect(result.version).toBe("1.0.0");
      expect(result.hash).toBe("a".repeat(64));
    });

    it("resolves pack with explicit version matching current", async () => {
      await registry.registerPack({
        id: "my-pack",
        version: "1.0.0",
        origin: { type: "local", localPath: "/some/path" },
        hash: "a".repeat(64),
      });

      const result = await resolver.resolve("my-pack", "1.0.0");

      expect(result.packId).toBe("my-pack");
      expect(result.version).toBe("1.0.0");
    });

    it("throws PACK_NOT_FOUND when pack does not exist", async () => {
      await expect(resolver.resolve("nonexistent")).rejects.toMatchObject({
        code: "PACK_NOT_FOUND",
        message: expect.stringContaining("not found"),
      });
    });

    it("throws VERSION_NOT_FOUND when version does not match", async () => {
      await registry.registerPack({
        id: "my-pack",
        version: "1.0.0",
        origin: { type: "local", localPath: "/some/path" },
        hash: "a".repeat(64),
      });

      await expect(resolver.resolve("my-pack", "2.0.0")).rejects.toMatchObject({
        code: "VERSION_NOT_FOUND",
        message: expect.stringContaining("2.0.0"),
        hint: expect.stringContaining("1.0.0"), // Should list available versions
      });
    });
  });

  // ===========================================================================
  // Multi-Version Resolution
  // ===========================================================================

  describe("multi-version packs (installs array)", () => {
    it("resolves latest version when no version specified", async () => {
      // Setup: Pack with multiple installed versions
      await registry.registerPackWithInstalls("multi-pack", [
        {
          version: "1.0.0",
          origin: { type: "local", localPath: "/v1" },
          hash: "a".repeat(64),
          installedAt: "2024-01-01T00:00:00.000Z",
        },
        {
          version: "2.0.0",
          origin: { type: "local", localPath: "/v2" },
          hash: "b".repeat(64),
          installedAt: "2024-01-02T00:00:00.000Z",
        },
        {
          version: "1.5.0",
          origin: { type: "local", localPath: "/v1.5" },
          hash: "c".repeat(64),
          installedAt: "2024-01-03T00:00:00.000Z", // Installed later but lower semver
        },
      ]);

      // Should return highest semver, not most recently installed
      const result = await resolver.resolve("multi-pack");

      expect(result.version).toBe("2.0.0");
      expect(result.hash).toBe("b".repeat(64));
    });

    it("resolves specific version from installs array", async () => {
      await registry.registerPackWithInstalls("multi-pack", [
        {
          version: "1.0.0",
          origin: { type: "local", localPath: "/v1" },
          hash: "a".repeat(64),
          installedAt: "2024-01-01T00:00:00.000Z",
        },
        {
          version: "2.0.0",
          origin: { type: "local", localPath: "/v2" },
          hash: "b".repeat(64),
          installedAt: "2024-01-02T00:00:00.000Z",
        },
      ]);

      const result = await resolver.resolve("multi-pack", "1.0.0");

      expect(result.version).toBe("1.0.0");
      expect(result.hash).toBe("a".repeat(64));
    });

    it("throws VERSION_NOT_FOUND with list of available versions", async () => {
      await registry.registerPackWithInstalls("multi-pack", [
        {
          version: "1.0.0",
          origin: { type: "local", localPath: "/v1" },
          hash: "a".repeat(64),
          installedAt: "2024-01-01T00:00:00.000Z",
        },
        {
          version: "2.0.0",
          origin: { type: "local", localPath: "/v2" },
          hash: "b".repeat(64),
          installedAt: "2024-01-02T00:00:00.000Z",
        },
      ]);

      await expect(resolver.resolve("multi-pack", "3.0.0")).rejects.toMatchObject({
        code: "VERSION_NOT_FOUND",
        message: expect.stringContaining("3.0.0"),
        hint: expect.stringMatching(/1\.0\.0.*2\.0\.0|2\.0\.0.*1\.0\.0/), // Lists both
      });
    });
  });

  // ===========================================================================
  // Listing Available Versions
  // ===========================================================================

  describe("listVersions", () => {
    it("returns empty array for nonexistent pack", async () => {
      const versions = await resolver.listVersions("nonexistent");
      expect(versions).toEqual([]);
    });

    it("returns single version for simple pack entry", async () => {
      await registry.registerPack({
        id: "my-pack",
        version: "1.0.0",
        origin: { type: "local", localPath: "/some/path" },
        hash: "a".repeat(64),
      });

      const versions = await resolver.listVersions("my-pack");
      expect(versions).toEqual(["1.0.0"]);
    });

    it("returns all versions sorted by semver (descending)", async () => {
      await registry.registerPackWithInstalls("multi-pack", [
        {
          version: "1.0.0",
          origin: { type: "local", localPath: "/v1" },
          hash: "a".repeat(64),
          installedAt: "2024-01-01T00:00:00.000Z",
        },
        {
          version: "2.0.0",
          origin: { type: "local", localPath: "/v2" },
          hash: "b".repeat(64),
          installedAt: "2024-01-02T00:00:00.000Z",
        },
        {
          version: "1.5.0",
          origin: { type: "local", localPath: "/v1.5" },
          hash: "c".repeat(64),
          installedAt: "2024-01-03T00:00:00.000Z",
        },
      ]);

      const versions = await resolver.listVersions("multi-pack");
      expect(versions).toEqual(["2.0.0", "1.5.0", "1.0.0"]);
    });
  });

  // ===========================================================================
  // Edge Cases
  // ===========================================================================

  describe("edge cases", () => {
    it("handles prerelease versions correctly", async () => {
      await registry.registerPackWithInstalls("prerelease-pack", [
        {
          version: "1.0.0",
          origin: { type: "local", localPath: "/v1" },
          hash: "a".repeat(64),
          installedAt: "2024-01-01T00:00:00.000Z",
        },
        {
          version: "2.0.0-beta.1",
          origin: { type: "local", localPath: "/v2-beta" },
          hash: "b".repeat(64),
          installedAt: "2024-01-02T00:00:00.000Z",
        },
      ]);

      // Stable 1.0.0 should be "latest" since prereleases are lower
      const result = await resolver.resolve("prerelease-pack");
      expect(result.version).toBe("1.0.0");

      // But can explicitly request prerelease
      const beta = await resolver.resolve("prerelease-pack", "2.0.0-beta.1");
      expect(beta.version).toBe("2.0.0-beta.1");
    });

    it("backward compatible with legacy single-entry packs", async () => {
      // Simulate a pack registered before multi-version support
      await registry.registerPack({
        id: "legacy-pack",
        version: "1.0.0",
        origin: { type: "local", localPath: "/legacy" },
        hash: "a".repeat(64),
      });

      // Should still work
      const result = await resolver.resolve("legacy-pack");
      expect(result.version).toBe("1.0.0");
    });
  });
});
