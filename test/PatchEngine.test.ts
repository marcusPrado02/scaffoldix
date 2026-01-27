/**
 * Tests for PatchEngine.
 *
 * The PatchEngine handles marker-based, idempotent file patching.
 * It is isolated from the Renderer - no template rendering concerns.
 *
 * @module
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import {
  PatchEngine,
  type PatchOperation,
  type PatchOptions,
  type MarkerInsertOperation,
  type MarkerReplaceOperation,
  type AppendIfMissingOperation,
} from "../src/core/patch/PatchEngine.js";
import { ScaffoldError } from "../src/core/errors/errors.js";

// =============================================================================
// Test Helpers
// =============================================================================

async function createTempDir(): Promise<string> {
  const baseDir = path.join(os.tmpdir(), "scaffoldix-patch-test");
  await fs.mkdir(baseDir, { recursive: true });
  return await fs.mkdtemp(path.join(baseDir, "test-"));
}

async function writeFile(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf-8");
}

async function readFile(filePath: string): Promise<string> {
  return await fs.readFile(filePath, "utf-8");
}

// =============================================================================
// Tests: marker_insert
// =============================================================================

describe("PatchEngine", () => {
  let tempDir: string;
  let engine: PatchEngine;

  beforeEach(async () => {
    tempDir = await createTempDir();
    engine = new PatchEngine();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("marker_insert", () => {
    it("inserts content between markers", async () => {
      const targetFile = path.join(tempDir, "src/imports.ts");
      await writeFile(
        targetFile,
        `// existing code
// <SCAFFOLDIX:START:imports>
// <SCAFFOLDIX:END:imports>
// more code`
      );

      const op: MarkerInsertOperation = {
        file: "src/imports.ts",
        kind: "marker_insert",
        idempotencyKey: "add-user-import",
        markerStart: "// <SCAFFOLDIX:START:imports>",
        markerEnd: "// <SCAFFOLDIX:END:imports>",
        content: 'import { User } from "./models/User";',
      };

      const result = await engine.applyPatch(op, { rootDir: tempDir });

      expect(result.status).toBe("applied");
      expect(result.file).toBe("src/imports.ts");
      expect(result.kind).toBe("marker_insert");

      const content = await readFile(targetFile);
      expect(content).toContain('import { User } from "./models/User";');
      expect(content).toContain("SCAFFOLDIX_PATCH:add-user-import");
    });

    it("is idempotent - applying twice does not duplicate content", async () => {
      const targetFile = path.join(tempDir, "idempotent.ts");
      await writeFile(
        targetFile,
        `// <SCAFFOLDIX:START:deps>
// <SCAFFOLDIX:END:deps>`
      );

      const op: MarkerInsertOperation = {
        file: "idempotent.ts",
        kind: "marker_insert",
        idempotencyKey: "add-lodash",
        markerStart: "// <SCAFFOLDIX:START:deps>",
        markerEnd: "// <SCAFFOLDIX:END:deps>",
        content: 'import _ from "lodash";',
      };

      // First application
      const result1 = await engine.applyPatch(op, { rootDir: tempDir });
      expect(result1.status).toBe("applied");

      const contentAfterFirst = await readFile(targetFile);
      const importCount1 = (contentAfterFirst.match(/import _ from "lodash"/g) || []).length;
      expect(importCount1).toBe(1);

      // Second application - should be skipped
      const result2 = await engine.applyPatch(op, { rootDir: tempDir });
      expect(result2.status).toBe("skipped");
      expect(result2.reason).toBe("already_applied");

      const contentAfterSecond = await readFile(targetFile);
      const importCount2 = (contentAfterSecond.match(/import _ from "lodash"/g) || []).length;
      expect(importCount2).toBe(1);
    });

    it("throws actionable error when markerStart is missing in strict mode", async () => {
      const targetFile = path.join(tempDir, "no-start.ts");
      await writeFile(targetFile, "// some code\n// <SCAFFOLDIX:END:imports>");

      const op: MarkerInsertOperation = {
        file: "no-start.ts",
        kind: "marker_insert",
        idempotencyKey: "test-key",
        markerStart: "// <SCAFFOLDIX:START:imports>",
        markerEnd: "// <SCAFFOLDIX:END:imports>",
        content: "inserted content",
      };

      await expect(engine.applyPatch(op, { rootDir: tempDir, strict: true })).rejects.toThrow(
        ScaffoldError
      );

      try {
        await engine.applyPatch(op, { rootDir: tempDir, strict: true });
      } catch (err) {
        expect(err).toBeInstanceOf(ScaffoldError);
        const scaffoldErr = err as ScaffoldError;
        expect(scaffoldErr.code).toBe("PATCH_MARKER_NOT_FOUND");
        expect(scaffoldErr.message).toContain("markerStart");
        expect(scaffoldErr.hint).toContain(targetFile);
      }
    });

    it("throws actionable error when markerEnd is missing in strict mode", async () => {
      const targetFile = path.join(tempDir, "no-end.ts");
      await writeFile(targetFile, "// <SCAFFOLDIX:START:imports>\n// some code");

      const op: MarkerInsertOperation = {
        file: "no-end.ts",
        kind: "marker_insert",
        idempotencyKey: "test-key",
        markerStart: "// <SCAFFOLDIX:START:imports>",
        markerEnd: "// <SCAFFOLDIX:END:imports>",
        content: "inserted content",
      };

      await expect(engine.applyPatch(op, { rootDir: tempDir, strict: true })).rejects.toThrow(
        ScaffoldError
      );

      try {
        await engine.applyPatch(op, { rootDir: tempDir, strict: true });
      } catch (err) {
        expect(err).toBeInstanceOf(ScaffoldError);
        const scaffoldErr = err as ScaffoldError;
        expect(scaffoldErr.code).toBe("PATCH_MARKER_NOT_FOUND");
        expect(scaffoldErr.message).toContain("markerEnd");
      }
    });

    it("throws error when target file does not exist in strict mode", async () => {
      const op: MarkerInsertOperation = {
        file: "nonexistent.ts",
        kind: "marker_insert",
        idempotencyKey: "test-key",
        markerStart: "// START",
        markerEnd: "// END",
        content: "content",
      };

      await expect(engine.applyPatch(op, { rootDir: tempDir, strict: true })).rejects.toThrow(
        ScaffoldError
      );

      try {
        await engine.applyPatch(op, { rootDir: tempDir, strict: true });
      } catch (err) {
        expect(err).toBeInstanceOf(ScaffoldError);
        const scaffoldErr = err as ScaffoldError;
        expect(scaffoldErr.code).toBe("PATCH_FILE_NOT_FOUND");
      }
    });
  });

  // ===========================================================================
  // Tests: marker_replace
  // ===========================================================================

  describe("marker_replace", () => {
    it("replaces content between markers", async () => {
      const targetFile = path.join(tempDir, "config.ts");
      await writeFile(
        targetFile,
        `// config
// <SCAFFOLDIX:START:config>
const oldConfig = { debug: false };
// <SCAFFOLDIX:END:config>
// end`
      );

      const op: MarkerReplaceOperation = {
        file: "config.ts",
        kind: "marker_replace",
        idempotencyKey: "update-config",
        markerStart: "// <SCAFFOLDIX:START:config>",
        markerEnd: "// <SCAFFOLDIX:END:config>",
        content: "const config = { debug: true, version: 2 };",
      };

      const result = await engine.applyPatch(op, { rootDir: tempDir });

      expect(result.status).toBe("applied");

      const content = await readFile(targetFile);
      expect(content).not.toContain("oldConfig");
      expect(content).toContain("const config = { debug: true, version: 2 };");
      expect(content).toContain("SCAFFOLDIX_PATCH:update-config");
    });

    it("is idempotent - replacing twice does not change file", async () => {
      const targetFile = path.join(tempDir, "replace-twice.ts");
      await writeFile(
        targetFile,
        `// <SCAFFOLDIX:START:data>
original
// <SCAFFOLDIX:END:data>`
      );

      const op: MarkerReplaceOperation = {
        file: "replace-twice.ts",
        kind: "marker_replace",
        idempotencyKey: "replace-data",
        markerStart: "// <SCAFFOLDIX:START:data>",
        markerEnd: "// <SCAFFOLDIX:END:data>",
        content: "replaced content",
      };

      // First replace
      const result1 = await engine.applyPatch(op, { rootDir: tempDir });
      expect(result1.status).toBe("applied");

      const contentAfterFirst = await readFile(targetFile);

      // Second replace - should be skipped
      const result2 = await engine.applyPatch(op, { rootDir: tempDir });
      expect(result2.status).toBe("skipped");
      expect(result2.reason).toBe("already_applied");

      const contentAfterSecond = await readFile(targetFile);
      expect(contentAfterSecond).toBe(contentAfterFirst);
    });

    it("throws actionable error when markers missing in strict mode", async () => {
      const targetFile = path.join(tempDir, "no-markers.ts");
      await writeFile(targetFile, "// just some code");

      const op: MarkerReplaceOperation = {
        file: "no-markers.ts",
        kind: "marker_replace",
        idempotencyKey: "test-key",
        markerStart: "// <START>",
        markerEnd: "// <END>",
        content: "content",
      };

      await expect(engine.applyPatch(op, { rootDir: tempDir, strict: true })).rejects.toThrow(
        ScaffoldError
      );
    });

    it("preserves content outside markers", async () => {
      const targetFile = path.join(tempDir, "preserve.ts");
      await writeFile(
        targetFile,
        `const before = true;
// <SCAFFOLDIX:START:section>
old content
// <SCAFFOLDIX:END:section>
const after = true;`
      );

      const op: MarkerReplaceOperation = {
        file: "preserve.ts",
        kind: "marker_replace",
        idempotencyKey: "replace-section",
        markerStart: "// <SCAFFOLDIX:START:section>",
        markerEnd: "// <SCAFFOLDIX:END:section>",
        content: "new content",
      };

      await engine.applyPatch(op, { rootDir: tempDir });

      const content = await readFile(targetFile);
      expect(content).toContain("const before = true;");
      expect(content).toContain("const after = true;");
      expect(content).not.toContain("old content");
      expect(content).toContain("new content");
    });
  });

  // ===========================================================================
  // Tests: append_if_missing
  // ===========================================================================

  describe("append_if_missing", () => {
    it("appends content to end of file", async () => {
      const targetFile = path.join(tempDir, "append.ts");
      await writeFile(targetFile, "// existing content\n");

      const op: AppendIfMissingOperation = {
        file: "append.ts",
        kind: "append_if_missing",
        idempotencyKey: "add-export",
        content: 'export * from "./utils";',
      };

      const result = await engine.applyPatch(op, { rootDir: tempDir });

      expect(result.status).toBe("applied");

      const content = await readFile(targetFile);
      expect(content).toContain("// existing content");
      expect(content).toContain('export * from "./utils";');
      expect(content).toContain("SCAFFOLDIX_PATCH:add-export");
    });

    it("is idempotent - appends only once", async () => {
      const targetFile = path.join(tempDir, "append-once.ts");
      await writeFile(targetFile, "// start\n");

      const op: AppendIfMissingOperation = {
        file: "append-once.ts",
        kind: "append_if_missing",
        idempotencyKey: "unique-append",
        content: "appended line",
      };

      // First append
      const result1 = await engine.applyPatch(op, { rootDir: tempDir });
      expect(result1.status).toBe("applied");

      const contentAfterFirst = await readFile(targetFile);
      const lineCount1 = (contentAfterFirst.match(/appended line/g) || []).length;
      expect(lineCount1).toBe(1);

      // Second append - should be skipped
      const result2 = await engine.applyPatch(op, { rootDir: tempDir });
      expect(result2.status).toBe("skipped");
      expect(result2.reason).toBe("already_applied");

      const contentAfterSecond = await readFile(targetFile);
      const lineCount2 = (contentAfterSecond.match(/appended line/g) || []).length;
      expect(lineCount2).toBe(1);
    });

    it("throws error when file does not exist in strict mode", async () => {
      const op: AppendIfMissingOperation = {
        file: "missing.ts",
        kind: "append_if_missing",
        idempotencyKey: "test-key",
        content: "content",
      };

      await expect(engine.applyPatch(op, { rootDir: tempDir, strict: true })).rejects.toThrow(
        ScaffoldError
      );
    });

    it("creates file in non-strict mode when file does not exist", async () => {
      const op: AppendIfMissingOperation = {
        file: "new-file.ts",
        kind: "append_if_missing",
        idempotencyKey: "create-file",
        content: "// new file content",
      };

      const result = await engine.applyPatch(op, { rootDir: tempDir, strict: false });

      expect(result.status).toBe("applied");

      const targetFile = path.join(tempDir, "new-file.ts");
      const content = await readFile(targetFile);
      expect(content).toContain("// new file content");
      expect(content).toContain("SCAFFOLDIX_PATCH:create-file");
    });
  });

  // ===========================================================================
  // Tests: applyAll
  // ===========================================================================

  describe("applyAll", () => {
    it("applies multiple patches and returns summary", async () => {
      const targetFile = path.join(tempDir, "multi.ts");
      await writeFile(
        targetFile,
        `// <SCAFFOLDIX:START:imports>
// <SCAFFOLDIX:END:imports>
// <SCAFFOLDIX:START:config>
old config
// <SCAFFOLDIX:END:config>`
      );

      const ops: PatchOperation[] = [
        {
          file: "multi.ts",
          kind: "marker_insert",
          idempotencyKey: "add-import",
          markerStart: "// <SCAFFOLDIX:START:imports>",
          markerEnd: "// <SCAFFOLDIX:END:imports>",
          content: "import foo from 'foo';",
        },
        {
          file: "multi.ts",
          kind: "marker_replace",
          idempotencyKey: "replace-config",
          markerStart: "// <SCAFFOLDIX:START:config>",
          markerEnd: "// <SCAFFOLDIX:END:config>",
          content: "new config",
        },
      ];

      const summary = await engine.applyAll(ops, { rootDir: tempDir });

      expect(summary.applied).toBe(2);
      expect(summary.skipped).toBe(0);
      expect(summary.failed).toBe(0);
      expect(summary.results.length).toBe(2);
    });

    it("continues on skipped patches", async () => {
      const targetFile = path.join(tempDir, "skip.ts");
      await writeFile(
        targetFile,
        `// SCAFFOLDIX_PATCH:already-applied
// <SCAFFOLDIX:START:section>
// <SCAFFOLDIX:END:section>`
      );

      const ops: PatchOperation[] = [
        {
          file: "skip.ts",
          kind: "marker_insert",
          idempotencyKey: "already-applied",
          markerStart: "// <SCAFFOLDIX:START:section>",
          markerEnd: "// <SCAFFOLDIX:END:section>",
          content: "new content",
        },
        {
          file: "skip.ts",
          kind: "append_if_missing",
          idempotencyKey: "append-content",
          content: "appended",
        },
      ];

      const summary = await engine.applyAll(ops, { rootDir: tempDir });

      expect(summary.skipped).toBe(1);
      expect(summary.applied).toBe(1);
    });
  });

  // ===========================================================================
  // Tests: Newline preservation
  // ===========================================================================

  describe("newline preservation", () => {
    it("preserves LF line endings", async () => {
      const targetFile = path.join(tempDir, "lf.ts");
      await writeFile(targetFile, "line1\nline2\n// <START>\n// <END>\nline3\n");

      const op: MarkerInsertOperation = {
        file: "lf.ts",
        kind: "marker_insert",
        idempotencyKey: "test",
        markerStart: "// <START>",
        markerEnd: "// <END>",
        content: "inserted",
      };

      await engine.applyPatch(op, { rootDir: tempDir });

      const content = await readFile(targetFile);
      expect(content).not.toContain("\r\n");
      expect(content).toContain("\n");
    });

    it("preserves CRLF line endings", async () => {
      const targetFile = path.join(tempDir, "crlf.ts");
      await writeFile(targetFile, "line1\r\nline2\r\n// <START>\r\n// <END>\r\nline3\r\n");

      const op: MarkerInsertOperation = {
        file: "crlf.ts",
        kind: "marker_insert",
        idempotencyKey: "test",
        markerStart: "// <START>",
        markerEnd: "// <END>",
        content: "inserted",
      };

      await engine.applyPatch(op, { rootDir: tempDir });

      const content = await readFile(targetFile);
      // Should still have CRLF endings
      expect(content).toContain("\r\n");
    });
  });

  // ===========================================================================
  // Tests: Atomic writes
  // ===========================================================================

  describe("atomic writes", () => {
    it("no temp files remain after successful patch", async () => {
      const targetFile = path.join(tempDir, "atomic.ts");
      await writeFile(targetFile, "// <START>\n// <END>");

      const op: MarkerInsertOperation = {
        file: "atomic.ts",
        kind: "marker_insert",
        idempotencyKey: "test",
        markerStart: "// <START>",
        markerEnd: "// <END>",
        content: "content",
      };

      await engine.applyPatch(op, { rootDir: tempDir });

      const files = await fs.readdir(tempDir);
      const tempFiles = files.filter((f) => f.includes(".tmp"));
      expect(tempFiles.length).toBe(0);
    });
  });

  // ===========================================================================
  // Tests: Isolation from Renderer
  // ===========================================================================

  describe("isolation", () => {
    it("does not process Handlebars templates in content", async () => {
      const targetFile = path.join(tempDir, "no-hbs.ts");
      await writeFile(targetFile, "// <START>\n// <END>");

      const op: MarkerInsertOperation = {
        file: "no-hbs.ts",
        kind: "marker_insert",
        idempotencyKey: "test",
        markerStart: "// <START>",
        markerEnd: "// <END>",
        content: "const name = '{{name}}'; // This should remain as-is",
      };

      await engine.applyPatch(op, { rootDir: tempDir });

      const content = await readFile(targetFile);
      // The Handlebars syntax should be preserved exactly
      expect(content).toContain("'{{name}}'");
    });
  });

  // ===========================================================================
  // Tests: Return structure
  // ===========================================================================

  describe("result structure", () => {
    it("returns complete result on success", async () => {
      const targetFile = path.join(tempDir, "result.ts");
      await writeFile(targetFile, "// <START>\n// <END>");

      const op: MarkerInsertOperation = {
        file: "result.ts",
        kind: "marker_insert",
        idempotencyKey: "my-key",
        markerStart: "// <START>",
        markerEnd: "// <END>",
        content: "content",
      };

      const result = await engine.applyPatch(op, { rootDir: tempDir });

      expect(result.status).toBe("applied");
      expect(result.file).toBe("result.ts");
      expect(result.kind).toBe("marker_insert");
      expect(result.idempotencyKey).toBe("my-key");
    });

    it("returns complete result on skip", async () => {
      const targetFile = path.join(tempDir, "skip-result.ts");
      await writeFile(targetFile, "// SCAFFOLDIX_PATCH:existing-key\n// <START>\n// <END>");

      const op: MarkerInsertOperation = {
        file: "skip-result.ts",
        kind: "marker_insert",
        idempotencyKey: "existing-key",
        markerStart: "// <START>",
        markerEnd: "// <END>",
        content: "content",
      };

      const result = await engine.applyPatch(op, { rootDir: tempDir });

      expect(result.status).toBe("skipped");
      expect(result.reason).toBe("already_applied");
      expect(result.idempotencyKey).toBe("existing-key");
    });
  });
});
