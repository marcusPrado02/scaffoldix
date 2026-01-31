import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Test file patterns
    include: ["test/**/*.test.ts"],

    // Coverage configuration with thresholds to prevent regression
    coverage: {
      // Use v8 provider (default in vitest 4.x)
      provider: "v8",

      // Source files to measure
      include: ["src/**/*.ts"],

      // Exclude test utilities and type-only files
      exclude: [
        "src/**/*.d.ts",
        "src/**/index.ts", // Re-export barrels
      ],

      // Enforce minimum coverage thresholds
      // Current levels (prevent regression) - aspirational target is 90%
      thresholds: {
        branches: 65,
        functions: 85,
        lines: 80,
        statements: 80,
      },

      // Generate reports for CI and local review
      reporter: ["text", "html", "json"],
    },

    // Use temp directories for test isolation
    pool: "forks",

    // Timeout for async operations
    testTimeout: 30000,
  },
});
