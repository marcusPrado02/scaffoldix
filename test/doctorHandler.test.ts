import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import {
  handleDoctor,
  formatDoctorReport,
  type DoctorDependencies,
  type DoctorCheckResult,
  type DoctorResult,
  MIN_NODE_VERSION,
} from "../src/cli/handlers/doctorHandler.js";
import {
  REGISTRY_SCHEMA_VERSION,
  type Registry,
} from "../src/core/registry/RegistryService.js";

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Creates a unique temp directory.
 */
async function createTestDir(prefix: string): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), `scaffoldix-${prefix}-`));
}

/**
 * Cleans up a test directory.
 */
async function cleanupTestDir(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Creates a valid registry.
 */
function createValidRegistry(packCount: number = 0): Registry {
  const packs: Registry["packs"] = {};

  for (let i = 0; i < packCount; i++) {
    const id = `pack-${i}`;
    packs[id] = {
      id,
      version: "1.0.0",
      origin: { type: "local", localPath: `/path/${id}` },
      hash: "a".repeat(64),
      installedAt: "2024-01-15T10:30:00.000Z",
    };
  }

  return {
    schemaVersion: REGISTRY_SCHEMA_VERSION,
    packs,
  };
}

/**
 * Creates test dependencies with isolated store.
 */
async function createTestDependencies(options: {
  nodeVersion?: string;
  pnpmResult?: { success: boolean; version?: string; error?: string };
  fsWritable?: boolean;
} = {}): Promise<{
  storeDir: string;
  deps: DoctorDependencies;
}> {
  const storeDir = await createTestDir("doctor-test");
  const packsDir = path.join(storeDir, "packs");
  const registryFile = path.join(storeDir, "registry.json");

  // Create directories
  await fs.mkdir(packsDir, { recursive: true });

  const deps: DoctorDependencies = {
    storePaths: {
      storeDir,
      packsDir,
      registryFile,
    },
    getNodeVersion: () => options.nodeVersion ?? "20.11.0",
    checkPnpm: async () => {
      if (options.pnpmResult) {
        if (options.pnpmResult.success) {
          return { available: true, version: options.pnpmResult.version ?? "9.1.0" };
        } else {
          return { available: false, error: options.pnpmResult.error ?? "not found" };
        }
      }
      return { available: true, version: "9.1.0" };
    },
    testWriteAccess: options.fsWritable === false
      ? async () => {
          throw new Error("EACCES: permission denied");
        }
      : async (dir: string) => {
          // Default: actually test write
          const testFile = path.join(dir, `.doctor-test-${Date.now()}`);
          await fs.writeFile(testFile, "test");
          await fs.unlink(testFile);
        },
  };

  return { storeDir, deps };
}

// =============================================================================
// Tests
// =============================================================================

describe("doctorHandler", () => {
  const testDirs: string[] = [];

  afterEach(async () => {
    for (const dir of testDirs) {
      await cleanupTestDir(dir);
    }
    testDirs.length = 0;
  });

  function trackDir(dir: string): string {
    testDirs.push(dir);
    return dir;
  }

  // ===========================================================================
  // Core behavior: runs without crashing
  // ===========================================================================

  describe("core behavior", () => {
    it("runs and returns results without throwing", async () => {
      const { storeDir, deps } = await createTestDependencies();
      trackDir(storeDir);

      const result = await handleDoctor(deps);

      expect(result).toBeDefined();
      expect(result.checks).toBeInstanceOf(Array);
      expect(result.checks.length).toBeGreaterThan(0);
    });

    it("returns all checks even when some fail", async () => {
      const { storeDir, deps } = await createTestDependencies({
        pnpmResult: { success: false, error: "not found" },
      });
      trackDir(storeDir);

      const result = await handleDoctor(deps);

      // Should have all 4 checks
      expect(result.checks.length).toBe(4);

      // Find each check by name
      const nodeCheck = result.checks.find((c) => c.name === "Node.js");
      const pnpmCheck = result.checks.find((c) => c.name === "pnpm");
      const storeCheck = result.checks.find((c) => c.name === "Store writable");
      const registryCheck = result.checks.find((c) => c.name === "Registry");

      expect(nodeCheck).toBeDefined();
      expect(pnpmCheck).toBeDefined();
      expect(storeCheck).toBeDefined();
      expect(registryCheck).toBeDefined();
    });

    it("hasErrors is true when any check has ERROR status", async () => {
      const { storeDir, deps } = await createTestDependencies({
        pnpmResult: { success: false },
      });
      trackDir(storeDir);

      const result = await handleDoctor(deps);

      expect(result.hasErrors).toBe(true);
    });

    it("hasErrors is false when all checks are OK or WARN", async () => {
      const { storeDir, deps } = await createTestDependencies();
      trackDir(storeDir);

      // Write valid registry
      await fs.writeFile(
        deps.storePaths.registryFile,
        JSON.stringify(createValidRegistry(2), null, 2)
      );

      const result = await handleDoctor(deps);

      expect(result.hasErrors).toBe(false);
    });
  });

  // ===========================================================================
  // Node.js version check
  // ===========================================================================

  describe("Node.js version check", () => {
    it("returns OK when Node.js version meets minimum", async () => {
      const { storeDir, deps } = await createTestDependencies({
        nodeVersion: "20.11.0",
      });
      trackDir(storeDir);

      const result = await handleDoctor(deps);
      const nodeCheck = result.checks.find((c) => c.name === "Node.js");

      expect(nodeCheck?.status).toBe("OK");
      expect(nodeCheck?.details).toContain("20.11.0");
    });

    it("returns ERROR when Node.js version is below minimum", async () => {
      const { storeDir, deps } = await createTestDependencies({
        nodeVersion: "16.0.0",
      });
      trackDir(storeDir);

      const result = await handleDoctor(deps);
      const nodeCheck = result.checks.find((c) => c.name === "Node.js");

      expect(nodeCheck?.status).toBe("ERROR");
      expect(nodeCheck?.details).toContain("16.0.0");
      expect(nodeCheck?.fix).toContain("Upgrade");
      expect(nodeCheck?.fix).toContain(String(MIN_NODE_VERSION));
    });

    it("includes current version in details", async () => {
      const { storeDir, deps } = await createTestDependencies({
        nodeVersion: "22.1.0",
      });
      trackDir(storeDir);

      const result = await handleDoctor(deps);
      const nodeCheck = result.checks.find((c) => c.name === "Node.js");

      expect(nodeCheck?.details).toContain("22.1.0");
    });
  });

  // ===========================================================================
  // pnpm availability check
  // ===========================================================================

  describe("pnpm availability check", () => {
    it("returns OK when pnpm is available", async () => {
      const { storeDir, deps } = await createTestDependencies({
        pnpmResult: { success: true, version: "9.1.0" },
      });
      trackDir(storeDir);

      const result = await handleDoctor(deps);
      const pnpmCheck = result.checks.find((c) => c.name === "pnpm");

      expect(pnpmCheck?.status).toBe("OK");
      expect(pnpmCheck?.details).toContain("9.1.0");
    });

    it("returns ERROR when pnpm is not found", async () => {
      const { storeDir, deps } = await createTestDependencies({
        pnpmResult: { success: false, error: "not found" },
      });
      trackDir(storeDir);

      const result = await handleDoctor(deps);
      const pnpmCheck = result.checks.find((c) => c.name === "pnpm");

      expect(pnpmCheck?.status).toBe("ERROR");
      expect(pnpmCheck?.fix).toContain("pnpm");
      expect(pnpmCheck?.fix).toMatch(/corepack|npm/i);
    });

    it("includes version in details when available", async () => {
      const { storeDir, deps } = await createTestDependencies({
        pnpmResult: { success: true, version: "8.15.4" },
      });
      trackDir(storeDir);

      const result = await handleDoctor(deps);
      const pnpmCheck = result.checks.find((c) => c.name === "pnpm");

      expect(pnpmCheck?.details).toContain("8.15.4");
    });
  });

  // ===========================================================================
  // Store write permissions check
  // ===========================================================================

  describe("Store write permissions check", () => {
    it("returns OK when store is writable", async () => {
      const { storeDir, deps } = await createTestDependencies({
        fsWritable: true,
      });
      trackDir(storeDir);

      const result = await handleDoctor(deps);
      const storeCheck = result.checks.find((c) => c.name === "Store writable");

      expect(storeCheck?.status).toBe("OK");
      expect(storeCheck?.details).toContain(storeDir);
    });

    it("returns ERROR when store is not writable", async () => {
      const { storeDir, deps } = await createTestDependencies({
        fsWritable: false,
      });
      trackDir(storeDir);

      const result = await handleDoctor(deps);
      const storeCheck = result.checks.find((c) => c.name === "Store writable");

      expect(storeCheck?.status).toBe("ERROR");
      expect(storeCheck?.fix).toContain("permission");
    });

    it("includes store path in details", async () => {
      const { storeDir, deps } = await createTestDependencies();
      trackDir(storeDir);

      const result = await handleDoctor(deps);
      const storeCheck = result.checks.find((c) => c.name === "Store writable");

      expect(storeCheck?.details).toContain(storeDir);
    });
  });

  // ===========================================================================
  // Registry integrity check
  // ===========================================================================

  describe("Registry integrity check", () => {
    it("returns OK when registry is valid", async () => {
      const { storeDir, deps } = await createTestDependencies();
      trackDir(storeDir);

      // Write valid registry
      await fs.writeFile(
        deps.storePaths.registryFile,
        JSON.stringify(createValidRegistry(3), null, 2)
      );

      const result = await handleDoctor(deps);
      const registryCheck = result.checks.find((c) => c.name === "Registry");

      expect(registryCheck?.status).toBe("OK");
      expect(registryCheck?.details).toContain("3");
    });

    it("returns OK when registry file is missing (new install)", async () => {
      const { storeDir, deps } = await createTestDependencies();
      trackDir(storeDir);

      // Don't create registry file

      const result = await handleDoctor(deps);
      const registryCheck = result.checks.find((c) => c.name === "Registry");

      expect(registryCheck?.status).toBe("OK");
      expect(registryCheck?.details).toContain("0");
    });

    it("returns ERROR when registry has invalid JSON", async () => {
      const { storeDir, deps } = await createTestDependencies();
      trackDir(storeDir);

      // Write invalid JSON
      await fs.writeFile(deps.storePaths.registryFile, "{ invalid json }");

      const result = await handleDoctor(deps);
      const registryCheck = result.checks.find((c) => c.name === "Registry");

      expect(registryCheck?.status).toBe("ERROR");
      expect(registryCheck?.fix).toContain("registry");
    });

    it("returns ERROR when registry has invalid schema", async () => {
      const { storeDir, deps } = await createTestDependencies();
      trackDir(storeDir);

      // Write valid JSON but invalid schema
      await fs.writeFile(
        deps.storePaths.registryFile,
        JSON.stringify({ schemaVersion: "wrong", packs: {} })
      );

      const result = await handleDoctor(deps);
      const registryCheck = result.checks.find((c) => c.name === "Registry");

      expect(registryCheck?.status).toBe("ERROR");
    });

    it("includes registry file path in error fix message", async () => {
      const { storeDir, deps } = await createTestDependencies();
      trackDir(storeDir);

      // Write invalid registry
      await fs.writeFile(deps.storePaths.registryFile, "not valid");

      const result = await handleDoctor(deps);
      const registryCheck = result.checks.find((c) => c.name === "Registry");

      expect(registryCheck?.fix).toContain(deps.storePaths.registryFile);
    });

    it("includes pack count when registry is valid", async () => {
      const { storeDir, deps } = await createTestDependencies();
      trackDir(storeDir);

      await fs.writeFile(
        deps.storePaths.registryFile,
        JSON.stringify(createValidRegistry(5), null, 2)
      );

      const result = await handleDoctor(deps);
      const registryCheck = result.checks.find((c) => c.name === "Registry");

      expect(registryCheck?.details).toMatch(/5\s*pack/i);
    });
  });

  // ===========================================================================
  // formatDoctorReport()
  // ===========================================================================

  describe("formatDoctorReport()", () => {
    it("formats all-OK report correctly", () => {
      const result: DoctorResult = {
        checks: [
          { name: "Node.js", status: "OK", details: "v20.11.0" },
          { name: "pnpm", status: "OK", details: "9.1.0" },
          { name: "Store writable", status: "OK", details: "/path/to/store" },
          { name: "Registry", status: "OK", details: "valid (3 packs)" },
        ],
        hasErrors: false,
      };

      const lines = formatDoctorReport(result);

      expect(lines.some((l) => l.includes("Scaffoldix Doctor"))).toBe(true);
      expect(lines.filter((l) => l.includes("[OK]")).length).toBe(4);
    });

    it("formats ERROR checks with fix suggestions", () => {
      const result: DoctorResult = {
        checks: [
          { name: "Node.js", status: "OK", details: "v20.11.0" },
          {
            name: "pnpm",
            status: "ERROR",
            details: "not found",
            fix: "Install pnpm (corepack enable pnpm)",
          },
        ],
        hasErrors: true,
      };

      const lines = formatDoctorReport(result);

      expect(lines.some((l) => l.includes("[ERROR]"))).toBe(true);
      expect(lines.some((l) => l.includes("Fix:"))).toBe(true);
      expect(lines.some((l) => l.includes("corepack"))).toBe(true);
    });

    it("formats WARN checks correctly", () => {
      const result: DoctorResult = {
        checks: [
          {
            name: "Some Check",
            status: "WARN",
            details: "something minor",
            fix: "Optional suggestion",
          },
        ],
        hasErrors: false,
      };

      const lines = formatDoctorReport(result);

      expect(lines.some((l) => l.includes("[WARN]"))).toBe(true);
    });

    it("includes divider line after header", () => {
      const result: DoctorResult = {
        checks: [{ name: "Test", status: "OK", details: "good" }],
        hasErrors: false,
      };

      const lines = formatDoctorReport(result);

      expect(lines.some((l) => l.match(/^-+$/))).toBe(true);
    });

    it("indents fix suggestions", () => {
      const result: DoctorResult = {
        checks: [
          {
            name: "Test",
            status: "ERROR",
            details: "bad",
            fix: "Do something",
          },
        ],
        hasErrors: true,
      };

      const lines = formatDoctorReport(result);
      const fixLine = lines.find((l) => l.includes("Fix:"));

      expect(fixLine).toBeDefined();
      expect(fixLine?.startsWith(" ")).toBe(true); // Indented
    });
  });

  // ===========================================================================
  // Integration-style tests
  // ===========================================================================

  describe("integration", () => {
    it("full healthy system check", async () => {
      const { storeDir, deps } = await createTestDependencies({
        nodeVersion: "20.11.0",
        pnpmResult: { success: true, version: "9.1.0" },
        fsWritable: true,
      });
      trackDir(storeDir);

      // Create valid registry with packs
      await fs.writeFile(
        deps.storePaths.registryFile,
        JSON.stringify(createValidRegistry(2), null, 2)
      );

      const result = await handleDoctor(deps);

      expect(result.hasErrors).toBe(false);
      expect(result.checks.every((c) => c.status === "OK")).toBe(true);

      // Verify formatting works
      const lines = formatDoctorReport(result);
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.filter((l) => l.includes("[OK]")).length).toBe(4);
    });

    it("system with multiple issues", async () => {
      const { storeDir, deps } = await createTestDependencies({
        nodeVersion: "16.0.0", // Too old
        pnpmResult: { success: false }, // Not found
        fsWritable: true,
      });
      trackDir(storeDir);

      // Invalid registry
      await fs.writeFile(deps.storePaths.registryFile, "broken");

      const result = await handleDoctor(deps);

      expect(result.hasErrors).toBe(true);

      const errorChecks = result.checks.filter((c) => c.status === "ERROR");
      expect(errorChecks.length).toBe(3); // Node, pnpm, registry

      // All should have fix suggestions
      expect(errorChecks.every((c) => c.fix)).toBe(true);
    });
  });
});
