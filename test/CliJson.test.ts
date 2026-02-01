/**
 * Tests for CLI JSON output module.
 *
 * Tests JSON formatting, error serialization, and stdout-only output.
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import {
  formatJsonOutput,
  formatJsonError,
  type JsonOutputOptions,
} from "../src/cli/ux/CliJson.js";

// =============================================================================
// Tests
// =============================================================================

describe("CliJson", () => {
  // ===========================================================================
  // formatJsonOutput
  // ===========================================================================

  describe("formatJsonOutput", () => {
    it("formats simple object as JSON string", () => {
      const data = { packs: [] };
      const output = formatJsonOutput(data);

      expect(output).toBe('{\n  "packs": []\n}');
    });

    it("formats complex nested object", () => {
      const data = {
        packs: [
          {
            packId: "foo",
            version: "1.0.0",
            origin: { type: "local", path: "/path/to/foo" },
          },
        ],
      };

      const output = formatJsonOutput(data);
      const parsed = JSON.parse(output);

      expect(parsed.packs).toHaveLength(1);
      expect(parsed.packs[0].packId).toBe("foo");
      expect(parsed.packs[0].origin.type).toBe("local");
    });

    it("includes newline at end when requested", () => {
      const data = { test: true };
      const output = formatJsonOutput(data, { trailingNewline: true });

      expect(output.endsWith("\n")).toBe(true);
    });

    it("does not include newline at end by default", () => {
      const data = { test: true };
      const output = formatJsonOutput(data);

      expect(output.endsWith("\n")).toBe(false);
    });

    it("handles arrays at top level", () => {
      const data = ["a", "b", "c"];
      const output = formatJsonOutput(data);
      const parsed = JSON.parse(output);

      expect(parsed).toEqual(["a", "b", "c"]);
    });

    it("handles null values", () => {
      const data = { value: null };
      const output = formatJsonOutput(data);
      const parsed = JSON.parse(output);

      expect(parsed.value).toBeNull();
    });
  });

  // ===========================================================================
  // formatJsonError
  // ===========================================================================

  describe("formatJsonError", () => {
    it("formats error with message only", () => {
      const output = formatJsonError({
        message: "Something went wrong",
      });

      const parsed = JSON.parse(output);
      expect(parsed.error.message).toBe("Something went wrong");
    });

    it("includes code when provided", () => {
      const output = formatJsonError({
        message: "Pack not found",
        code: "PACK_NOT_FOUND",
      });

      const parsed = JSON.parse(output);
      expect(parsed.error.code).toBe("PACK_NOT_FOUND");
      expect(parsed.error.message).toBe("Pack not found");
    });

    it("includes context when provided", () => {
      const output = formatJsonError({
        message: "Pack not found",
        code: "PACK_NOT_FOUND",
        context: { packId: "foo", command: "pack info" },
      });

      const parsed = JSON.parse(output);
      expect(parsed.error.packId).toBe("foo");
      expect(parsed.error.command).toBe("pack info");
    });

    it("does not include stack trace by default", () => {
      const output = formatJsonError({
        message: "Error",
        stack: "Error\n  at foo\n  at bar",
      });

      const parsed = JSON.parse(output);
      expect(parsed.error.stack).toBeUndefined();
    });

    it("includes stack trace when debug is true", () => {
      const output = formatJsonError({
        message: "Error",
        stack: "Error\n  at foo\n  at bar",
        debug: true,
      });

      const parsed = JSON.parse(output);
      expect(parsed.error.stack).toBe("Error\n  at foo\n  at bar");
    });

    it("includes newline at end when requested", () => {
      const output = formatJsonError({ message: "Error" }, { trailingNewline: true });

      expect(output.endsWith("\n")).toBe(true);
    });
  });

  // ===========================================================================
  // Pack list JSON format
  // ===========================================================================

  describe("pack list JSON format", () => {
    it("matches expected schema for pack list", () => {
      const data = {
        packs: [
          {
            packId: "foo",
            version: "1.0.0",
            origin: {
              type: "local",
              path: "/abs/path",
            },
          },
          {
            packId: "bar",
            version: "2.1.3",
            origin: {
              type: "git",
              url: "https://github.com/org/repo",
              commit: "abc123",
            },
          },
        ],
      };

      const output = formatJsonOutput(data);
      const parsed = JSON.parse(output);

      expect(parsed.packs).toHaveLength(2);
      expect(parsed.packs[0].origin.type).toBe("local");
      expect(parsed.packs[1].origin.type).toBe("git");
      expect(parsed.packs[1].origin.commit).toBe("abc123");
    });
  });

  // ===========================================================================
  // Pack info JSON format
  // ===========================================================================

  describe("pack info JSON format", () => {
    it("matches expected schema for pack info", () => {
      const data = {
        packId: "my-pack",
        version: "1.0.0",
        origin: {
          type: "local",
          path: "/path/to/pack",
        },
        storePath: "/store/my-pack/abc123",
        installedAt: "2024-01-15T10:30:00.000Z",
        archetypes: [
          { id: "a1", templateRoot: "templates/a1" },
          { id: "a2", templateRoot: "templates/a2" },
        ],
      };

      const output = formatJsonOutput(data);
      const parsed = JSON.parse(output);

      expect(parsed.packId).toBe("my-pack");
      expect(parsed.archetypes).toHaveLength(2);
      expect(parsed.archetypes[0].id).toBe("a1");
    });
  });

  // ===========================================================================
  // Archetypes list JSON format
  // ===========================================================================

  describe("archetypes list JSON format", () => {
    it("matches expected schema for archetypes list", () => {
      const data = {
        archetypes: [
          { packId: "foo", id: "a1" },
          { packId: "foo", id: "a2" },
          { packId: "bar", id: "b1" },
        ],
      };

      const output = formatJsonOutput(data);
      const parsed = JSON.parse(output);

      expect(parsed.archetypes).toHaveLength(3);
      expect(parsed.archetypes[0].packId).toBe("foo");
      expect(parsed.archetypes[0].id).toBe("a1");
    });
  });
});
