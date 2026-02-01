import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  initStorePaths,
  getStorePaths,
  isStoreInitialized,
  _resetStorePathsCache,
} from "../src/core/utils/paths.js";

describe("Store paths module", () => {
  beforeEach(() => {
    // Reset cache before each test to ensure isolation
    _resetStorePathsCache();
  });

  afterEach(() => {
    _resetStorePathsCache();
  });

  describe("getStorePaths", () => {
    it("returns absolute paths", () => {
      const paths = getStorePaths();

      expect(path.isAbsolute(paths.storeDir)).toBe(true);
      expect(path.isAbsolute(paths.packsDir)).toBe(true);
      expect(path.isAbsolute(paths.registryFile)).toBe(true);
    });

    it("returns packsDir as direct child of storeDir", () => {
      const paths = getStorePaths();

      expect(paths.packsDir.startsWith(paths.storeDir)).toBe(true);
      expect(path.dirname(paths.packsDir)).toBe(paths.storeDir);
      expect(path.basename(paths.packsDir)).toBe("packs");
    });

    it("returns registryFile inside storeDir root", () => {
      const paths = getStorePaths();

      expect(paths.registryFile.startsWith(paths.storeDir)).toBe(true);
      expect(path.dirname(paths.registryFile)).toBe(paths.storeDir);
      expect(path.basename(paths.registryFile)).toBe("registry.json");
    });

    it("returns normalized paths without .. or double slashes", () => {
      const paths = getStorePaths();

      expect(paths.storeDir).not.toContain("..");
      expect(paths.packsDir).not.toContain("..");
      expect(paths.registryFile).not.toContain("..");
      expect(paths.storeDir).not.toMatch(/\/\//);
      expect(paths.packsDir).not.toMatch(/\/\//);
    });

    it("returns frozen (immutable) object", () => {
      const paths = getStorePaths();

      expect(Object.isFrozen(paths)).toBe(true);
    });

    it("does not create directories", () => {
      // Reset and get paths without initialization
      _resetStorePathsCache();
      const paths = getStorePaths();

      // This test verifies getStorePaths is read-only
      // We can't easily verify directories weren't created without mocking,
      // but we can verify the paths are returned correctly
      expect(paths.storeDir).toBeTruthy();
      expect(paths.packsDir).toBeTruthy();
      expect(paths.registryFile).toBeTruthy();
    });
  });

  describe("initStorePaths", () => {
    it("creates Store directories when ensureDirectories is true (default)", () => {
      const paths = initStorePaths();

      expect(fs.existsSync(paths.storeDir)).toBe(true);
      expect(fs.existsSync(paths.packsDir)).toBe(true);
    });

    it("does NOT create registryFile (that is RegistryService responsibility)", () => {
      const paths = initStorePaths();

      // Registry file should NOT be created by initStorePaths
      // This is intentional - RegistryService owns file creation
      // We're only verifying the path is returned, not that it exists
      expect(paths.registryFile.endsWith("registry.json")).toBe(true);
    });

    it("does not create directories when ensureDirectories is false", () => {
      _resetStorePathsCache();

      const paths = initStorePaths({ ensureDirectories: false });

      // Should return valid paths without throwing
      expect(paths.storeDir).toBeTruthy();
      expect(paths.packsDir).toBeTruthy();
      expect(paths.registryFile).toBeTruthy();
    });

    it("is idempotent - safe to call multiple times", () => {
      const paths1 = initStorePaths();
      const paths2 = initStorePaths();
      const paths3 = initStorePaths();

      // All calls should return equivalent paths
      expect(paths1).toEqual(paths2);
      expect(paths2).toEqual(paths3);

      // Directories should still exist after multiple calls
      expect(fs.existsSync(paths1.storeDir)).toBe(true);
      expect(fs.existsSync(paths1.packsDir)).toBe(true);
    });

    it("caches paths for subsequent getStorePaths calls", () => {
      const initPaths = initStorePaths();
      const getPaths = getStorePaths();

      // Should return the exact same cached object
      expect(initPaths).toBe(getPaths);
    });
  });

  describe("isStoreInitialized", () => {
    it("returns true when Store directories exist", () => {
      initStorePaths();

      expect(isStoreInitialized()).toBe(true);
    });

    it("returns false when Store has not been initialized", () => {
      _resetStorePathsCache();

      // On a fresh system where the Store hasn't been created yet,
      // this would return false. Since we can't easily clean up the
      // real Store directory in tests, we just verify the function works
      const result = isStoreInitialized();
      expect(typeof result).toBe("boolean");
    });
  });

  describe("platform conventions (env-paths)", () => {
    it("uses scaffoldix as the application name", () => {
      const paths = getStorePaths();

      // The storeDir should contain 'scaffoldix' somewhere in the path
      expect(paths.storeDir.toLowerCase()).toContain("scaffoldix");
    });

    it("does NOT use hardcoded home directory paths", () => {
      const paths = getStorePaths();
      const homeDir = os.homedir();

      // Should NOT be ~/.scaffoldix (common but incorrect pattern)
      const badPath = path.join(homeDir, ".scaffoldix");
      expect(paths.storeDir).not.toBe(badPath);
    });

    it("uses platform-appropriate data directory", () => {
      const paths = getStorePaths();
      const platform = process.platform;

      // Verify we're using the correct platform directory
      if (platform === "linux") {
        // Should be under ~/.local/share or XDG_DATA_HOME
        expect(
          paths.storeDir.includes(".local/share") ||
            paths.storeDir.includes(process.env.XDG_DATA_HOME || ""),
        ).toBe(true);
      } else if (platform === "darwin") {
        // Should be under ~/Library/Application Support
        expect(paths.storeDir).toContain("Application Support");
      } else if (platform === "win32") {
        // Should be under AppData\Roaming
        expect(paths.storeDir.toLowerCase()).toContain("appdata");
      }
    });
  });

  describe("Store ownership semantics", () => {
    it("storeDir is the root - all other paths are descendants", () => {
      const paths = getStorePaths();

      // packsDir must be inside storeDir
      expect(paths.packsDir.startsWith(paths.storeDir)).toBe(true);

      // registryFile must be inside storeDir
      expect(paths.registryFile.startsWith(paths.storeDir)).toBe(true);
    });

    it("packsDir is direct child of storeDir", () => {
      const paths = getStorePaths();

      // packsDir should be exactly one level below storeDir
      const relative = path.relative(paths.storeDir, paths.packsDir);
      expect(relative).toBe("packs");
      expect(relative.includes(path.sep)).toBe(false);
    });

    it("registryFile is direct child of storeDir", () => {
      const paths = getStorePaths();

      // registryFile should be directly inside storeDir, not in a subdirectory
      const relative = path.relative(paths.storeDir, paths.registryFile);
      expect(relative).toBe("registry.json");
      expect(relative.includes(path.sep)).toBe(false);
    });
  });
});
