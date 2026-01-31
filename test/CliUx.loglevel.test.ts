/**
 * Tests for CLI log level parsing.
 *
 * Tests that --verbose and --debug flags correctly set log levels.
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import { parseLogLevel, type LogLevel } from "../src/cli/ux/CliUx.js";

describe("parseLogLevel", () => {
  it("returns info by default", () => {
    const level = parseLogLevel({ verbose: false, debug: false, silent: false });
    expect(level).toBe("info");
  });

  it("returns silent when silent is true", () => {
    const level = parseLogLevel({ verbose: false, debug: false, silent: true });
    expect(level).toBe("silent");
  });

  it("returns verbose when verbose is true", () => {
    const level = parseLogLevel({ verbose: true, debug: false, silent: false });
    expect(level).toBe("verbose");
  });

  it("returns debug when debug is true", () => {
    const level = parseLogLevel({ verbose: false, debug: true, silent: false });
    expect(level).toBe("debug");
  });

  it("debug takes precedence over verbose", () => {
    const level = parseLogLevel({ verbose: true, debug: true, silent: false });
    expect(level).toBe("debug");
  });

  it("silent takes precedence over verbose", () => {
    const level = parseLogLevel({ verbose: true, debug: false, silent: true });
    expect(level).toBe("silent");
  });

  it("debug takes precedence over silent", () => {
    const level = parseLogLevel({ verbose: false, debug: true, silent: true });
    expect(level).toBe("debug");
  });
});
