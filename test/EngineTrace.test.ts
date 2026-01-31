/**
 * Tests for EngineTrace observability module.
 *
 * Tests the trace collection and formatting for engine phases.
 *
 * @module
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { EngineTrace, type TraceEntry } from "../src/core/observability/EngineTrace.js";

// =============================================================================
// Tests
// =============================================================================

describe("EngineTrace", () => {
  let trace: EngineTrace;

  beforeEach(() => {
    trace = new EngineTrace();
  });

  // ===========================================================================
  // Basic Operations
  // ===========================================================================

  describe("start and end", () => {
    it("records a trace entry with start and end", () => {
      trace.start("load manifest");
      trace.end("load manifest");

      const entries = trace.toArray();

      expect(entries).toHaveLength(1);
      expect(entries[0].name).toBe("load manifest");
      expect(entries[0].start).toBeInstanceOf(Date);
      expect(entries[0].end).toBeInstanceOf(Date);
      expect(entries[0].durationMs).toBeGreaterThanOrEqual(0);
    });

    it("records multiple phases in order", () => {
      trace.start("phase 1");
      trace.end("phase 1");
      trace.start("phase 2");
      trace.end("phase 2");
      trace.start("phase 3");
      trace.end("phase 3");

      const entries = trace.toArray();

      expect(entries).toHaveLength(3);
      expect(entries[0].name).toBe("phase 1");
      expect(entries[1].name).toBe("phase 2");
      expect(entries[2].name).toBe("phase 3");
    });

    it("includes context in trace entry", () => {
      trace.start("render templates", { packId: "my-pack", archetypeId: "default" });
      trace.end("render templates");

      const entries = trace.toArray();

      expect(entries[0].context).toEqual({ packId: "my-pack", archetypeId: "default" });
    });

    it("handles entry without end (in-progress)", () => {
      trace.start("running phase");

      const entries = trace.toArray();

      expect(entries).toHaveLength(1);
      expect(entries[0].name).toBe("running phase");
      expect(entries[0].end).toBeUndefined();
      expect(entries[0].durationMs).toBeUndefined();
    });

    it("calculates duration correctly", async () => {
      trace.start("slow phase");
      await new Promise((r) => setTimeout(r, 50));
      trace.end("slow phase");

      const entries = trace.toArray();

      expect(entries[0].durationMs).toBeGreaterThanOrEqual(45);
      expect(entries[0].durationMs).toBeLessThan(200);
    });
  });

  // ===========================================================================
  // Error Handling
  // ===========================================================================

  describe("error handling", () => {
    it("allows ending a phase that was not started (no-op)", () => {
      // Should not throw
      trace.end("nonexistent");

      const entries = trace.toArray();
      expect(entries).toHaveLength(0);
    });

    it("ignores duplicate end calls", () => {
      trace.start("phase");
      trace.end("phase");
      trace.end("phase"); // duplicate

      const entries = trace.toArray();

      expect(entries).toHaveLength(1);
    });
  });

  // ===========================================================================
  // Total Duration
  // ===========================================================================

  describe("totalDurationMs", () => {
    it("returns 0 for empty trace", () => {
      expect(trace.totalDurationMs()).toBe(0);
    });

    it("returns sum of all phase durations", async () => {
      trace.start("phase 1");
      await new Promise((r) => setTimeout(r, 20));
      trace.end("phase 1");

      trace.start("phase 2");
      await new Promise((r) => setTimeout(r, 20));
      trace.end("phase 2");

      const total = trace.totalDurationMs();

      expect(total).toBeGreaterThanOrEqual(35);
    });

    it("excludes incomplete phases from total", () => {
      trace.start("complete");
      trace.end("complete");
      trace.start("incomplete");

      const entries = trace.toArray();
      const completedDuration = entries[0].durationMs ?? 0;

      expect(trace.totalDurationMs()).toBe(completedDuration);
    });
  });

  // ===========================================================================
  // JSON Output
  // ===========================================================================

  describe("toJSON", () => {
    it("returns trace array with ISO timestamps", () => {
      trace.start("load manifest");
      trace.end("load manifest");

      const json = trace.toJSON();

      expect(json.trace).toHaveLength(1);
      expect(typeof json.trace[0].start).toBe("string");
      expect(typeof json.trace[0].end).toBe("string");
      expect(json.trace[0].start).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("includes totalDurationMs", () => {
      trace.start("phase");
      trace.end("phase");

      const json = trace.toJSON();

      expect(typeof json.totalDurationMs).toBe("number");
    });

    it("includes context in JSON entries", () => {
      trace.start("render", { fileCount: 10 });
      trace.end("render");

      const json = trace.toJSON();

      expect(json.trace[0].context).toEqual({ fileCount: 10 });
    });

    it("handles incomplete phases in JSON", () => {
      trace.start("incomplete");

      const json = trace.toJSON();

      expect(json.trace[0].end).toBeUndefined();
      expect(json.trace[0].durationMs).toBeUndefined();
    });
  });

  // ===========================================================================
  // Human-Readable Output
  // ===========================================================================

  describe("toHumanString", () => {
    it("returns empty string for empty trace", () => {
      expect(trace.toHumanString()).toBe("");
    });

    it("includes phase names", () => {
      trace.start("load manifest");
      trace.end("load manifest");
      trace.start("render templates");
      trace.end("render templates");

      const output = trace.toHumanString();

      expect(output).toContain("load manifest");
      expect(output).toContain("render templates");
    });

    it("includes duration in human format", () => {
      trace.start("phase");
      trace.end("phase");

      const output = trace.toHumanString();

      expect(output).toMatch(/\d+ms/);
    });

    it("includes total duration line", () => {
      trace.start("phase");
      trace.end("phase");

      const output = trace.toHumanString();

      expect(output).toMatch(/completed|total/i);
    });

    it("marks incomplete phases", () => {
      trace.start("incomplete");

      const output = trace.toHumanString();

      expect(output).toMatch(/incomplete|running|in.?progress/i);
    });
  });

  // ===========================================================================
  // Detailed Output (for verbose mode)
  // ===========================================================================

  describe("toDetailedString", () => {
    it("includes timestamps", () => {
      trace.start("phase");
      trace.end("phase");

      const output = trace.toDetailedString();

      expect(output).toMatch(/start:/i);
      expect(output).toMatch(/end:/i);
    });

    it("includes context fields when present", () => {
      trace.start("render", { packId: "test-pack", fileCount: 5 });
      trace.end("render");

      const output = trace.toDetailedString();

      expect(output).toContain("test-pack");
      expect(output).toContain("5");
    });
  });
});
