/**
 * Unit tests for structured logging system.
 *
 * Tests ContextualLogger, ExecutionContext, StepTimer, and log enrichment.
 *
 * @module
 */

import { describe, it, expect, beforeEach } from "vitest";

import {
  ContextualLogger,
  createLogger,
  type LogEntry,
  type LogSink,
} from "../../src/core/logging/ContextualLogger.js";
import { Step } from "../../src/core/logging/Step.js";
import {
  ExecutionContext,
  createExecutionContext,
} from "../../src/core/logging/ExecutionContext.js";
import { StepTimer } from "../../src/core/logging/StepTimer.js";
import { ScaffoldError } from "../../src/core/errors/errors.js";
import { ErrorCode } from "../../src/core/errors/ErrorCode.js";

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * In-memory log sink for testing.
 */
class InMemoryLogSink implements LogSink {
  readonly entries: LogEntry[] = [];

  write(entry: LogEntry): void {
    this.entries.push(entry);
  }

  clear(): void {
    this.entries.length = 0;
  }
}

// =============================================================================
// ExecutionContext Tests
// =============================================================================

describe("ExecutionContext", () => {
  it("creates context with correlationId", () => {
    const ctx = createExecutionContext();

    expect(ctx.correlationId).toBeDefined();
    expect(typeof ctx.correlationId).toBe("string");
    expect(ctx.correlationId.length).toBeGreaterThan(0);
  });

  it("generates unique correlationIds", () => {
    const ctx1 = createExecutionContext();
    const ctx2 = createExecutionContext();

    expect(ctx1.correlationId).not.toBe(ctx2.correlationId);
  });

  it("accepts custom correlationId", () => {
    const ctx = createExecutionContext({ correlationId: "my-custom-id" });

    expect(ctx.correlationId).toBe("my-custom-id");
  });

  it("accepts initial step", () => {
    const ctx = createExecutionContext({ step: Step.CLI_INIT });

    expect(ctx.step).toBe(Step.CLI_INIT);
  });
});

// =============================================================================
// Step Tests
// =============================================================================

describe("Step", () => {
  it("has all required step names", () => {
    expect(Step.CLI_INIT).toBe("cli.init");
    expect(Step.PACK_LOAD).toBe("pack.load");
    expect(Step.MANIFEST_LOAD).toBe("manifest.load");
    expect(Step.INPUTS_RESOLVE).toBe("inputs.resolve");
    expect(Step.PLAN_BUILD).toBe("plan.build");
    expect(Step.RENDER).toBe("render");
    expect(Step.PATCH_APPLY).toBe("patch.apply");
    expect(Step.HOOKS_RUN).toBe("hooks.run");
    expect(Step.CHECKS_RUN).toBe("checks.run");
    expect(Step.STATE_WRITE).toBe("state.write");
    expect(Step.DONE).toBe("done");
  });
});

// =============================================================================
// ContextualLogger Tests
// =============================================================================

describe("ContextualLogger", () => {
  let sink: InMemoryLogSink;
  let logger: ContextualLogger;

  beforeEach(() => {
    sink = new InMemoryLogSink();
    logger = createLogger({ sink, minLevel: "debug" });
  });

  describe("basic logging", () => {
    it("logs with level and message", () => {
      logger.info("Test message");

      expect(sink.entries).toHaveLength(1);
      expect(sink.entries[0].level).toBe("info");
      expect(sink.entries[0].msg).toBe("Test message");
    });

    it("logs with all levels", () => {
      logger.debug("Debug message");
      logger.info("Info message");
      logger.warn("Warn message");
      logger.error("Error message");

      expect(sink.entries).toHaveLength(4);
      expect(sink.entries.map((e) => e.level)).toEqual(["debug", "info", "warn", "error"]);
    });

    it("includes timestamp as ISO string", () => {
      const before = new Date().toISOString();
      logger.info("Test");
      const after = new Date().toISOString();

      expect(sink.entries[0].ts).toBeDefined();
      expect(sink.entries[0].ts >= before).toBe(true);
      expect(sink.entries[0].ts <= after).toBe(true);
    });
  });

  describe("correlationId enrichment", () => {
    it("includes correlationId in all entries", () => {
      const loggerWithCorrelation = logger.withContext({
        correlationId: "test-correlation-123",
      });

      loggerWithCorrelation.debug("Debug");
      loggerWithCorrelation.info("Info");
      loggerWithCorrelation.warn("Warn");
      loggerWithCorrelation.error("Error");

      for (const entry of sink.entries) {
        expect(entry.correlationId).toBe("test-correlation-123");
      }
    });

    it("child logger inherits correlationId", () => {
      const parent = logger.withContext({ correlationId: "parent-id" });
      const child = parent.withContext({ step: Step.RENDER });

      child.info("Child log");

      expect(sink.entries[0].correlationId).toBe("parent-id");
      expect(sink.entries[0].step).toBe("render");
    });
  });

  describe("step context", () => {
    it("child logger adds step to entries", () => {
      const stepLogger = logger.withContext({ step: Step.MANIFEST_LOAD });

      stepLogger.info("Loading manifest");

      expect(sink.entries[0].step).toBe("manifest.load");
    });

    it("step can be changed with new child logger", () => {
      const manifestLogger = logger.withContext({ step: Step.MANIFEST_LOAD });
      manifestLogger.info("Loading manifest");

      const renderLogger = logger.withContext({ step: Step.RENDER });
      renderLogger.info("Rendering templates");

      expect(sink.entries[0].step).toBe("manifest.load");
      expect(sink.entries[1].step).toBe("render");
    });
  });

  describe("additional context", () => {
    it("includes extra fields in log entry", () => {
      logger.info("Processing file", { file: "index.ts", size: 1024 });

      expect(sink.entries[0].file).toBe("index.ts");
      expect(sink.entries[0].size).toBe(1024);
    });

    it("merges context from parent and call site", () => {
      const packLogger = logger.withContext({ packId: "my-pack" });
      packLogger.info("Loading", { archetype: "react-app" });

      expect(sink.entries[0].packId).toBe("my-pack");
      expect(sink.entries[0].archetype).toBe("react-app");
    });
  });

  describe("level filtering", () => {
    it("default mode hides debug logs", () => {
      const infoLogger = createLogger({ sink, minLevel: "info" });

      infoLogger.debug("Should be hidden");
      infoLogger.info("Should be visible");

      expect(sink.entries).toHaveLength(1);
      expect(sink.entries[0].msg).toBe("Should be visible");
    });

    it("debug mode includes debug logs", () => {
      const debugLogger = createLogger({ sink, minLevel: "debug" });

      debugLogger.debug("Debug visible");
      debugLogger.info("Info visible");

      expect(sink.entries).toHaveLength(2);
      expect(sink.entries[0].msg).toBe("Debug visible");
    });

    it("error level only shows errors", () => {
      const errorLogger = createLogger({ sink, minLevel: "error" });

      errorLogger.debug("Hidden");
      errorLogger.info("Hidden");
      errorLogger.warn("Hidden");
      errorLogger.error("Visible");

      expect(sink.entries).toHaveLength(1);
      expect(sink.entries[0].level).toBe("error");
    });
  });

  describe("error logging", () => {
    it("includes errorCode when logging ScaffoldError", () => {
      const error = new ScaffoldError("Pack not found", ErrorCode.PACK_NOT_FOUND);

      logger.error("Operation failed", { error });

      expect(sink.entries[0].errorCode).toBe("PACK_NOT_FOUND");
    });

    it("includes error message", () => {
      const error = new ScaffoldError("Manifest invalid", ErrorCode.MANIFEST_INVALID);

      logger.error("Validation failed", { error });

      expect(sink.entries[0].errorMessage).toBe("Manifest invalid");
    });

    it("does not include stack by default", () => {
      const error = new ScaffoldError("Test error", ErrorCode.INTERNAL_ERROR);
      error.stack = "Error: Test\n    at file.ts:1:1";

      const infoLogger = createLogger({ sink, minLevel: "info", debug: false });
      infoLogger.error("Failed", { error });

      expect(sink.entries[0].stack).toBeUndefined();
    });

    it("includes stack in debug mode", () => {
      const error = new ScaffoldError("Test error", ErrorCode.INTERNAL_ERROR);
      error.stack = "Error: Test\n    at file.ts:1:1";

      const debugLogger = createLogger({ sink, minLevel: "debug", debug: true });
      debugLogger.error("Failed", { error });

      expect(sink.entries[0].stack).toContain("at file.ts:1:1");
    });

    it("includes cause in debug mode", () => {
      const cause = new Error("Root cause");
      const error = new ScaffoldError(
        "Wrapped error",
        ErrorCode.INTERNAL_ERROR,
        undefined,
        undefined,
        undefined,
        cause,
      );

      const debugLogger = createLogger({ sink, minLevel: "debug", debug: true });
      debugLogger.error("Failed", { error });

      expect(sink.entries[0].cause).toBe("Root cause");
    });
  });
});

// =============================================================================
// StepTimer Tests
// =============================================================================

describe("StepTimer", () => {
  let sink: InMemoryLogSink;
  let logger: ContextualLogger;

  beforeEach(() => {
    sink = new InMemoryLogSink();
    logger = createLogger({ sink, minLevel: "debug" });
  });

  it("emits step.start event", () => {
    const timer = new StepTimer(logger);

    timer.start(Step.MANIFEST_LOAD);

    const startEntry = sink.entries.find((e) => e.event === "step.start");
    expect(startEntry).toBeDefined();
    expect(startEntry?.step).toBe("manifest.load");
  });

  it("emits step.end event with durationMs", async () => {
    const timer = new StepTimer(logger);

    timer.start(Step.RENDER);
    await new Promise((r) => setTimeout(r, 10)); // Small delay
    timer.end(Step.RENDER);

    const endEntry = sink.entries.find((e) => e.event === "step.end");
    expect(endEntry).toBeDefined();
    expect(endEntry?.step).toBe("render");
    expect(endEntry?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("tracks multiple steps independently", () => {
    const timer = new StepTimer(logger);

    timer.start(Step.MANIFEST_LOAD);
    timer.end(Step.MANIFEST_LOAD);
    timer.start(Step.RENDER);
    timer.end(Step.RENDER);

    const startEvents = sink.entries.filter((e) => e.event === "step.start");
    const endEvents = sink.entries.filter((e) => e.event === "step.end");

    expect(startEvents).toHaveLength(2);
    expect(endEvents).toHaveLength(2);
  });

  it("provides run helper for automatic start/end", async () => {
    const timer = new StepTimer(logger);

    const result = await timer.run(Step.PATCH_APPLY, async () => {
      await new Promise((r) => setTimeout(r, 5));
      return "patch-result";
    });

    expect(result).toBe("patch-result");

    const startEntry = sink.entries.find(
      (e) => e.event === "step.start" && e.step === "patch.apply",
    );
    const endEntry = sink.entries.find((e) => e.event === "step.end" && e.step === "patch.apply");

    expect(startEntry).toBeDefined();
    expect(endEntry).toBeDefined();
    expect(endEntry?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("run helper propagates errors and still logs end", async () => {
    const timer = new StepTimer(logger);

    await expect(
      timer.run(Step.HOOKS_RUN, async () => {
        throw new Error("Hook failed");
      }),
    ).rejects.toThrow("Hook failed");

    const endEntry = sink.entries.find((e) => e.event === "step.end" && e.step === "hooks.run");
    expect(endEntry).toBeDefined();
    expect(endEntry?.error).toBe(true);
  });

  it("includes context in step events", () => {
    const timer = new StepTimer(logger);

    timer.start(Step.RENDER, { templateCount: 5 });
    timer.end(Step.RENDER, { filesWritten: 5 });

    const startEntry = sink.entries.find((e) => e.event === "step.start");
    const endEntry = sink.entries.find((e) => e.event === "step.end");

    expect(startEntry?.templateCount).toBe(5);
    expect(endEntry?.filesWritten).toBe(5);
  });
});

// =============================================================================
// JSON Output Format Tests
// =============================================================================

describe("JSON output format", () => {
  it("produces valid JSON entries", () => {
    const sink = new InMemoryLogSink();
    const logger = createLogger({ sink, minLevel: "info" });

    logger
      .withContext({ correlationId: "abc-123", step: Step.RENDER })
      .info("Rendering", { target: "./app" });

    const entry = sink.entries[0];

    // Verify all required fields
    expect(entry.ts).toBeDefined();
    expect(entry.level).toBe("info");
    expect(entry.correlationId).toBe("abc-123");
    expect(entry.step).toBe("render");
    expect(entry.msg).toBe("Rendering");
    expect(entry.target).toBe("./app");

    // Verify it can be serialized to JSON
    const json = JSON.stringify(entry);
    const parsed = JSON.parse(json);
    expect(parsed.level).toBe("info");
  });
});
