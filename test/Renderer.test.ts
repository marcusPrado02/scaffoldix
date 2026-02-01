import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { renderArchetype } from "../src/core/render/Renderer.js";

// =============================================================================
// Test Helpers
// =============================================================================

const FIXTURES_DIR = path.join(__dirname, "fixtures", "render-test-pack", "templates");

async function createTestDir(prefix: string): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), `scaffoldix-render-${prefix}-`));
}

async function cleanupTestDir(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

async function readFile(filePath: string): Promise<string> {
  return await fs.readFile(filePath, "utf-8");
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function dirExists(dirPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

// =============================================================================
// Tests
// =============================================================================

describe("Renderer", () => {
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
  // Basic Rendering
  // ===========================================================================

  describe("basic rendering", () => {
    it("renders Handlebars variables in file contents", async () => {
      const targetDir = trackDir(await createTestDir("basic"));

      const result = await renderArchetype({
        templateDir: FIXTURES_DIR,
        targetDir,
        data: {
          projectName: "MyAwesomeProject",
          author: "John Doe",
        },
        dryRun: false,
      });

      const readmePath = path.join(targetDir, "README.md");
      const content = await readFile(readmePath);

      expect(content).toContain("# MyAwesomeProject");
      expect(content).toContain("Welcome to MyAwesomeProject!");
      expect(content).toContain("This project was created for John Doe.");
      expect(result.filesWritten.length).toBeGreaterThan(0);
    });

    it("preserves directory structure from template", async () => {
      const targetDir = trackDir(await createTestDir("structure"));

      await renderArchetype({
        templateDir: FIXTURES_DIR,
        targetDir,
        data: {
          projectName: "Test",
          Entity: "User",
          entity: "user",
        },
        renameRules: {
          replacements: {
            __Entity__: "User",
          },
        },
        dryRun: false,
      });

      // Should have created User directory
      expect(await dirExists(path.join(targetDir, "User"))).toBe(true);
    });

    it("renders all template files recursively", async () => {
      const targetDir = trackDir(await createTestDir("recursive"));

      const result = await renderArchetype({
        templateDir: FIXTURES_DIR,
        targetDir,
        data: {
          projectName: "Test",
          Entity: "Customer",
          entity: "customer",
        },
        renameRules: {
          replacements: {
            __Entity__: "Customer",
          },
        },
        dryRun: false,
      });

      // Should have multiple files
      expect(result.filesWritten.length).toBeGreaterThanOrEqual(3);
    });
  });

  // ===========================================================================
  // Filename Renaming Rules
  // ===========================================================================

  describe("filename renaming rules", () => {
    it("renames files according to replacement rules", async () => {
      const targetDir = trackDir(await createTestDir("rename-file"));

      await renderArchetype({
        templateDir: FIXTURES_DIR,
        targetDir,
        data: {
          Entity: "Customer",
          entity: "customer",
        },
        renameRules: {
          replacements: {
            __Entity__: "Customer",
          },
        },
        dryRun: false,
      });

      // __Entity__Service.ts should become CustomerService.ts
      expect(await fileExists(path.join(targetDir, "Customer", "CustomerService.ts"))).toBe(true);
      expect(await fileExists(path.join(targetDir, "Customer", "CustomerRepository.ts"))).toBe(true);
    });

    it("renames directories according to replacement rules", async () => {
      const targetDir = trackDir(await createTestDir("rename-dir"));

      await renderArchetype({
        templateDir: FIXTURES_DIR,
        targetDir,
        data: {
          Entity: "Order",
          entity: "order",
        },
        renameRules: {
          replacements: {
            __Entity__: "Order",
          },
        },
        dryRun: false,
      });

      // __Entity__ directory should become Order
      expect(await dirExists(path.join(targetDir, "Order"))).toBe(true);
      expect(await dirExists(path.join(targetDir, "__Entity__"))).toBe(false);
    });

    it("applies multiple replacement rules", async () => {
      const targetDir = trackDir(await createTestDir("multi-replace"));

      await renderArchetype({
        templateDir: FIXTURES_DIR,
        targetDir,
        data: {
          Entity: "Product",
          entity: "product",
        },
        renameRules: {
          replacements: {
            __Entity__: "Product",
            __entity__: "product",
          },
        },
        dryRun: false,
      });

      expect(await dirExists(path.join(targetDir, "Product"))).toBe(true);
    });

    it("applies replacements in deterministic order (longer keys first)", async () => {
      const targetDir = trackDir(await createTestDir("deterministic"));

      // Create a custom template dir for this test
      const customTemplateDir = await createTestDir("custom-template");
      testDirs.push(customTemplateDir);

      await fs.mkdir(path.join(customTemplateDir, "__EntityName__"), { recursive: true });
      await fs.writeFile(
        path.join(customTemplateDir, "__EntityName__", "__Entity__File.ts"),
        "content"
      );

      await renderArchetype({
        templateDir: customTemplateDir,
        targetDir,
        data: {},
        renameRules: {
          replacements: {
            __Entity__: "Short",
            __EntityName__: "LongerName",
          },
        },
        dryRun: false,
      });

      // __EntityName__ should be replaced as a whole, not __Entity__ within it
      expect(await dirExists(path.join(targetDir, "LongerName"))).toBe(true);
      expect(await fileExists(path.join(targetDir, "LongerName", "ShortFile.ts"))).toBe(true);
    });
  });

  // ===========================================================================
  // Handlebars Features
  // ===========================================================================

  describe("Handlebars features", () => {
    it("supports conditionals with #if", async () => {
      const targetDir = trackDir(await createTestDir("conditionals"));

      await renderArchetype({
        templateDir: FIXTURES_DIR,
        targetDir,
        data: {
          projectName: "Test",
          enableLogging: true,
        },
        dryRun: false,
      });

      const configPath = path.join(targetDir, "config.json");
      const content = await readFile(configPath);

      expect(content).toContain("logging");
    });

    it("renders template variables in nested files", async () => {
      const targetDir = trackDir(await createTestDir("nested-vars"));

      await renderArchetype({
        templateDir: FIXTURES_DIR,
        targetDir,
        data: {
          Entity: "Invoice",
          entity: "invoice",
        },
        renameRules: {
          replacements: {
            __Entity__: "Invoice",
          },
        },
        dryRun: false,
      });

      const servicePath = path.join(targetDir, "Invoice", "InvoiceService.ts");
      const content = await readFile(servicePath);

      expect(content).toContain("Invoice Service");
      expect(content).toContain("class InvoiceService");
      expect(content).toContain("findInvoiceById");
    });
  });

  // ===========================================================================
  // Binary File Handling
  // ===========================================================================

  describe("binary file handling", () => {
    it("copies binary files without templating", async () => {
      const targetDir = trackDir(await createTestDir("binary"));

      const result = await renderArchetype({
        templateDir: FIXTURES_DIR,
        targetDir,
        data: {
          projectName: "Test",
        },
        dryRun: false,
      });

      const logoPath = path.join(targetDir, "logo.png");
      expect(await fileExists(logoPath)).toBe(true);

      // Verify file is copied as-is (starts with PNG header)
      const content = await fs.readFile(logoPath);
      expect(content[0]).toBe(0x89);
      expect(content.toString("utf-8", 1, 4)).toBe("PNG");

      // Should be marked as copied, not rendered
      const logoEntry = result.filesWritten.find((f) => f.destRelativePath === "logo.png");
      expect(logoEntry?.mode).toBe("copied");
    });

    it("detects binary files by NUL byte presence", async () => {
      const targetDir = trackDir(await createTestDir("nul-detection"));

      const result = await renderArchetype({
        templateDir: FIXTURES_DIR,
        targetDir,
        data: {},
        dryRun: false,
      });

      // logo.png should be detected as binary (has NUL bytes)
      const binaryFiles = result.filesWritten.filter((f) => f.mode === "copied");
      expect(binaryFiles.some((f) => f.srcRelativePath === "logo.png")).toBe(true);
    });
  });

  // ===========================================================================
  // Dry Run Mode
  // ===========================================================================

  describe("dry run mode", () => {
    it("returns planned operations without writing files", async () => {
      const targetDir = trackDir(await createTestDir("dry-run"));

      const result = await renderArchetype({
        templateDir: FIXTURES_DIR,
        targetDir,
        data: {
          projectName: "DryRunTest",
          Entity: "User",
          entity: "user",
        },
        renameRules: {
          replacements: {
            __Entity__: "User",
          },
        },
        dryRun: true,
      });

      // Should have planned files
      expect(result.filesPlanned.length).toBeGreaterThan(0);

      // But nothing should be written
      expect(result.filesWritten.length).toBe(0);

      // Target directory should be empty (or not exist)
      const files = await fs.readdir(targetDir).catch(() => []);
      expect(files.length).toBe(0);
    });

    it("plans correct destination paths with rename rules", async () => {
      const targetDir = trackDir(await createTestDir("dry-plan"));

      const result = await renderArchetype({
        templateDir: FIXTURES_DIR,
        targetDir,
        data: {
          Entity: "Order",
        },
        renameRules: {
          replacements: {
            __Entity__: "Order",
          },
        },
        dryRun: true,
      });

      // Should plan OrderService.ts in Order directory
      const servicePlanned = result.filesPlanned.find(
        (f) => f.destRelativePath === path.join("Order", "OrderService.ts")
      );
      expect(servicePlanned).toBeDefined();
      expect(servicePlanned?.srcRelativePath).toBe(
        path.join("__Entity__", "__Entity__Service.ts")
      );
    });

    it("does not create target directory in dry run", async () => {
      const targetDir = path.join(os.tmpdir(), `scaffoldix-dry-nodir-${Date.now()}`);

      await renderArchetype({
        templateDir: FIXTURES_DIR,
        targetDir,
        data: { projectName: "Test" },
        dryRun: true,
      });

      // Target directory should not have been created
      expect(await dirExists(targetDir)).toBe(false);
    });
  });

  // ===========================================================================
  // Result Structure
  // ===========================================================================

  describe("result structure", () => {
    it("returns filesWritten with correct structure for real writes", async () => {
      const targetDir = trackDir(await createTestDir("result-structure"));

      const result = await renderArchetype({
        templateDir: FIXTURES_DIR,
        targetDir,
        data: {
          projectName: "Test",
          Entity: "Item",
          entity: "item",
        },
        renameRules: {
          replacements: {
            __Entity__: "Item",
          },
        },
        dryRun: false,
      });

      expect(result.filesWritten.length).toBeGreaterThan(0);

      const readmeEntry = result.filesWritten.find((f) => f.destRelativePath === "README.md");
      expect(readmeEntry).toBeDefined();
      expect(readmeEntry?.srcRelativePath).toBe("README.md");
      expect(readmeEntry?.destAbsolutePath).toBe(path.join(targetDir, "README.md"));
      expect(readmeEntry?.mode).toBe("rendered");
    });

    it("returns filesPlanned with correct structure for dry run", async () => {
      const targetDir = trackDir(await createTestDir("result-planned"));

      const result = await renderArchetype({
        templateDir: FIXTURES_DIR,
        targetDir,
        data: {
          projectName: "Test",
          Entity: "Task",
        },
        renameRules: {
          replacements: {
            __Entity__: "Task",
          },
        },
        dryRun: true,
      });

      expect(result.filesPlanned.length).toBeGreaterThan(0);
      expect(result.filesWritten.length).toBe(0);

      const readmeEntry = result.filesPlanned.find((f) => f.destRelativePath === "README.md");
      expect(readmeEntry).toBeDefined();
      expect(readmeEntry?.srcRelativePath).toBe("README.md");
      expect(readmeEntry?.mode).toBe("rendered");
    });
  });

  // ===========================================================================
  // Path Safety
  // ===========================================================================

  describe("path safety", () => {
    it("rejects rename rules that would escape target directory", async () => {
      const targetDir = trackDir(await createTestDir("path-traversal"));

      await expect(
        renderArchetype({
          templateDir: FIXTURES_DIR,
          targetDir,
          data: {},
          renameRules: {
            replacements: {
              __Entity__: "../../../escape",
            },
          },
          dryRun: false,
        })
      ).rejects.toThrow();
    });

    it("normalizes paths to prevent traversal attempts", async () => {
      const targetDir = trackDir(await createTestDir("normalize"));

      // This should not escape even with tricky replacement
      await expect(
        renderArchetype({
          templateDir: FIXTURES_DIR,
          targetDir,
          data: {},
          renameRules: {
            replacements: {
              __Entity__: "foo/../bar/../../baz",
            },
          },
          dryRun: false,
        })
      ).rejects.toThrow();
    });
  });

  // ===========================================================================
  // Error Handling
  // ===========================================================================

  describe("error handling", () => {
    it("throws informative error for invalid template directory", async () => {
      const targetDir = trackDir(await createTestDir("invalid-template"));

      await expect(
        renderArchetype({
          templateDir: "/nonexistent/path/to/templates",
          targetDir,
          data: {},
          dryRun: false,
        })
      ).rejects.toThrow();
    });

    it("includes template file path in render errors", async () => {
      const targetDir = trackDir(await createTestDir("error-context"));
      const badTemplateDir = await createTestDir("bad-template");
      testDirs.push(badTemplateDir);

      // Create a template with invalid Handlebars syntax
      await fs.writeFile(
        path.join(badTemplateDir, "bad.txt"),
        "{{#if unclosed"
      );

      try {
        await renderArchetype({
          templateDir: badTemplateDir,
          targetDir,
          data: {},
          dryRun: false,
        });
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.message).toContain("bad.txt");
      }
    });
  });

  // ===========================================================================
  // Edge Cases
  // ===========================================================================

  describe("edge cases", () => {
    it("handles empty data object", async () => {
      const targetDir = trackDir(await createTestDir("empty-data"));
      const simpleTemplateDir = await createTestDir("simple-template");
      testDirs.push(simpleTemplateDir);

      await fs.writeFile(
        path.join(simpleTemplateDir, "static.txt"),
        "No variables here"
      );

      const result = await renderArchetype({
        templateDir: simpleTemplateDir,
        targetDir,
        data: {},
        dryRun: false,
      });

      expect(result.filesWritten.length).toBe(1);
      const content = await readFile(path.join(targetDir, "static.txt"));
      expect(content).toBe("No variables here");
    });

    it("handles undefined rename rules", async () => {
      const targetDir = trackDir(await createTestDir("no-rename"));

      const result = await renderArchetype({
        templateDir: FIXTURES_DIR,
        targetDir,
        data: { projectName: "Test" },
        // No renameRules provided
        dryRun: false,
      });

      // Should still work with original filenames
      expect(result.filesWritten.length).toBeGreaterThan(0);
      expect(await dirExists(path.join(targetDir, "__Entity__"))).toBe(true);
    });

    it("preserves file permissions", async () => {
      const targetDir = trackDir(await createTestDir("permissions"));
      const execTemplateDir = await createTestDir("exec-template");
      testDirs.push(execTemplateDir);

      // Create an executable script
      const scriptPath = path.join(execTemplateDir, "script.sh");
      await fs.writeFile(scriptPath, "#!/bin/bash\necho 'Hello'");
      await fs.chmod(scriptPath, 0o755);

      await renderArchetype({
        templateDir: execTemplateDir,
        targetDir,
        data: {},
        dryRun: false,
      });

      const destScriptPath = path.join(targetDir, "script.sh");
      const stat = await fs.stat(destScriptPath);
      // Check executable bit is preserved (at least user execute)
      expect(stat.mode & 0o100).toBeTruthy();
    });

    it("handles deeply nested directories", async () => {
      const targetDir = trackDir(await createTestDir("deep-nest"));
      const deepTemplateDir = await createTestDir("deep-template");
      testDirs.push(deepTemplateDir);

      const deepPath = path.join(deepTemplateDir, "a", "b", "c", "d");
      await fs.mkdir(deepPath, { recursive: true });
      await fs.writeFile(path.join(deepPath, "deep.txt"), "{{value}}");

      const result = await renderArchetype({
        templateDir: deepTemplateDir,
        targetDir,
        data: { value: "deep value" },
        dryRun: false,
      });

      expect(result.filesWritten.length).toBe(1);
      const content = await readFile(path.join(targetDir, "a", "b", "c", "d", "deep.txt"));
      expect(content).toBe("deep value");
    });
  });
});

// =============================================================================
// computeRenderPlan Tests
// =============================================================================

import { computeRenderPlan } from "../src/core/render/Renderer.js";

describe("computeRenderPlan", () => {
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

  it("returns list of output paths from template directory", async () => {
    const templateDir = trackDir(await createTestDir("plan-basic"));

    // Create template files
    await fs.mkdir(path.join(templateDir, "src"), { recursive: true });
    await fs.writeFile(path.join(templateDir, "package.json"), "{}");
    await fs.writeFile(path.join(templateDir, "src", "index.ts"), "");
    await fs.writeFile(path.join(templateDir, "README.md"), "");

    const plan = await computeRenderPlan({ templateDir });

    expect(plan.outputPaths).toHaveLength(3);
    expect(plan.outputPaths).toContain("package.json");
    expect(plan.outputPaths).toContain("src/index.ts");
    expect(plan.outputPaths).toContain("README.md");
  });

  it("applies rename rules to output paths", async () => {
    const templateDir = trackDir(await createTestDir("plan-rename"));

    await fs.mkdir(path.join(templateDir, "__moduleName__"), { recursive: true });
    await fs.writeFile(path.join(templateDir, "__moduleName__", "__moduleName__.ts"), "");

    const plan = await computeRenderPlan({
      templateDir,
      renameRules: {
        replacements: {
          __moduleName__: "customer",
        },
      },
    });

    expect(plan.outputPaths).toHaveLength(1);
    expect(plan.outputPaths[0]).toBe("customer/customer.ts");
  });

  it("handles multiple rename rules", async () => {
    const templateDir = trackDir(await createTestDir("plan-multi-rename"));

    await fs.mkdir(path.join(templateDir, "src", "__Entity__"), { recursive: true });
    await fs.writeFile(
      path.join(templateDir, "src", "__Entity__", "__entity__Repository.ts"),
      ""
    );

    const plan = await computeRenderPlan({
      templateDir,
      renameRules: {
        replacements: {
          __Entity__: "Customer",
          __entity__: "customer",
        },
      },
    });

    expect(plan.outputPaths).toHaveLength(1);
    expect(plan.outputPaths[0]).toBe("src/Customer/customerRepository.ts");
  });

  it("throws if template directory does not exist", async () => {
    const nonExistentDir = "/nonexistent/template/dir";

    await expect(computeRenderPlan({ templateDir: nonExistentDir })).rejects.toThrow(
      /does not exist/
    );
  });

  it("returns empty list for empty template directory", async () => {
    const templateDir = trackDir(await createTestDir("plan-empty"));
    // Directory exists but is empty

    const plan = await computeRenderPlan({ templateDir });

    expect(plan.outputPaths).toHaveLength(0);
  });

  it("includes dotfiles in output paths", async () => {
    const templateDir = trackDir(await createTestDir("plan-dotfiles"));

    await fs.writeFile(path.join(templateDir, ".gitignore"), "");
    await fs.writeFile(path.join(templateDir, ".env.example"), "");
    await fs.writeFile(path.join(templateDir, "normal.txt"), "");

    const plan = await computeRenderPlan({ templateDir });

    expect(plan.outputPaths).toHaveLength(3);
    expect(plan.outputPaths).toContain(".gitignore");
    expect(plan.outputPaths).toContain(".env.example");
    expect(plan.outputPaths).toContain("normal.txt");
  });

  it("handles deeply nested directories", async () => {
    const templateDir = trackDir(await createTestDir("plan-deep"));

    const deepPath = path.join(templateDir, "a", "b", "c", "d");
    await fs.mkdir(deepPath, { recursive: true });
    await fs.writeFile(path.join(deepPath, "deep.txt"), "");

    const plan = await computeRenderPlan({ templateDir });

    expect(plan.outputPaths).toHaveLength(1);
    expect(plan.outputPaths[0]).toBe("a/b/c/d/deep.txt");
  });
});
