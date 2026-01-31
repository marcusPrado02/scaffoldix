/**
 * Tests for pack info --json output.
 *
 * Tests JSON formatting for the pack info command.
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import {
  formatPackInfoJson,
  type PackInfoResult,
} from "../src/cli/handlers/packInfoHandler.js";

describe("pack info --json", () => {
  describe("formatPackInfoJson", () => {
    it("formats pack info with local origin correctly", () => {
      const result: PackInfoResult = {
        packId: "my-pack",
        version: "1.0.0",
        origin: "local:/path/to/pack",
        originRaw: { type: "local", localPath: "/path/to/pack" },
        storePath: "/store/my-pack/abc123",
        installedAt: "2024-01-15T10:30:00.000Z",
        hash: "abc123def456",
        archetypes: ["entity", "controller"],
      };

      const output = formatPackInfoJson(result);
      const parsed = JSON.parse(output);

      expect(parsed.packId).toBe("my-pack");
      expect(parsed.version).toBe("1.0.0");
      expect(parsed.origin.type).toBe("local");
      expect(parsed.origin.path).toBe("/path/to/pack");
      expect(parsed.storePath).toBe("/store/my-pack/abc123");
      expect(parsed.installedAt).toBe("2024-01-15T10:30:00.000Z");
    });

    it("formats pack info with git origin correctly", () => {
      const result: PackInfoResult = {
        packId: "git-pack",
        version: "2.0.0",
        origin: "git:https://github.com/org/repo@abc1234",
        originRaw: {
          type: "git",
          gitUrl: "https://github.com/org/repo",
          commit: "abc1234",
        },
        storePath: "/store/git-pack/def456",
        installedAt: "2024-01-15T10:30:00.000Z",
        hash: "def456ghi789",
        archetypes: ["template"],
      };

      const output = formatPackInfoJson(result);
      const parsed = JSON.parse(output);

      expect(parsed.origin.type).toBe("git");
      expect(parsed.origin.url).toBe("https://github.com/org/repo");
      expect(parsed.origin.commit).toBe("abc1234");
    });

    it("includes archetypes with id and templateRoot", () => {
      const result: PackInfoResult = {
        packId: "my-pack",
        version: "1.0.0",
        origin: "local:/path",
        originRaw: { type: "local", localPath: "/path" },
        storePath: "/store/my-pack/abc123",
        installedAt: "2024-01-15T10:30:00.000Z",
        hash: "abc123",
        archetypes: ["entity", "controller", "service"],
      };

      const output = formatPackInfoJson(result);
      const parsed = JSON.parse(output);

      expect(parsed.archetypes).toHaveLength(3);
      expect(parsed.archetypes[0].id).toBe("entity");
      expect(parsed.archetypes[0].templateRoot).toBeDefined();
    });

    it("produces valid JSON without ANSI codes", () => {
      const result: PackInfoResult = {
        packId: "test",
        version: "1.0.0",
        origin: "local:/test",
        originRaw: { type: "local", localPath: "/test" },
        storePath: "/store/test/abc",
        installedAt: "2024-01-15T10:30:00.000Z",
        hash: "abc123",
        archetypes: [],
      };

      const output = formatPackInfoJson(result);

      // Should not throw
      expect(() => JSON.parse(output)).not.toThrow();

      // Should not contain ANSI escape codes
      expect(output).not.toMatch(/\x1b\[/);
    });

    it("handles empty archetypes array", () => {
      const result: PackInfoResult = {
        packId: "empty-pack",
        version: "1.0.0",
        origin: "local:/path",
        originRaw: { type: "local", localPath: "/path" },
        storePath: "/store/empty-pack/abc",
        installedAt: "2024-01-15T10:30:00.000Z",
        hash: "abc123",
        archetypes: [],
      };

      const output = formatPackInfoJson(result);
      const parsed = JSON.parse(output);

      expect(parsed.archetypes).toEqual([]);
    });
  });
});
