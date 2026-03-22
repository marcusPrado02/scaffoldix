/**
 * Performance benchmarks for core modules.
 *
 * Run with: pnpm bench
 *
 * Measures throughput of the most frequently executed operations:
 * - parseDurationMs: called once per hook/check invocation
 * - detectPatchConflicts: called per archetype before applying patches
 * - Handlebars template rendering (via renderTemplate helper)
 * - applyRenameRules path transformation
 *
 * Benchmarks serve as a regression guard — a significant slowdown in
 * any baseline operation should be investigated before merging.
 *
 * @module
 */

import { bench, describe } from "vitest";
import { parseDurationMs } from "../../src/core/utils/parseDuration.js";
import {
  detectPatchConflicts,
  type AnalyzablePatch,
} from "../../src/core/patch/PatchConflictDetector.js";
import Handlebars from "handlebars";

// =============================================================================
// parseDurationMs benchmarks
// =============================================================================

describe("parseDurationMs", () => {
  bench("parse '30s'", () => {
    parseDurationMs("30s");
  });

  bench("parse '2m'", () => {
    parseDurationMs("2m");
  });

  bench("parse '500ms'", () => {
    parseDurationMs("500ms");
  });

  bench("parse bare number '90'", () => {
    parseDurationMs("90");
  });

  bench("reject invalid 'abc'", () => {
    parseDurationMs("abc");
  });

  bench("handle undefined", () => {
    parseDurationMs(undefined);
  });
});

// =============================================================================
// detectPatchConflicts benchmarks
// =============================================================================

function makePatchList(n: number): AnalyzablePatch[] {
  return Array.from({ length: n }, (_, i) => ({
    kind: i % 2 === 0 ? "marker_insert" : "append_if_missing",
    file: `src/file${i}.ts`,
    idempotencyKey: `key-${i}`,
    markerStart: i % 2 === 0 ? `//MARK-${i}` : undefined,
  }));
}

describe("detectPatchConflicts", () => {
  const patches5 = makePatchList(5);
  const patches20 = makePatchList(20);
  const patches100 = makePatchList(100);

  bench("5 patches (no conflicts)", () => {
    detectPatchConflicts(patches5);
  });

  bench("20 patches (no conflicts)", () => {
    detectPatchConflicts(patches20);
  });

  bench("100 patches (no conflicts)", () => {
    detectPatchConflicts(patches100);
  });

  // Conflict scenario: duplicate key at position n-1
  const patchesWithDup = [
    ...makePatchList(20),
    { kind: "append_if_missing", file: "x.ts", idempotencyKey: "key-0" },
  ];

  bench("21 patches (1 duplicate key conflict)", () => {
    detectPatchConflicts(patchesWithDup);
  });
});

// =============================================================================
// Handlebars template rendering benchmarks
// =============================================================================

describe("Handlebars rendering", () => {
  const simpleTemplate = Handlebars.compile("Hello {{name}}!");
  const complexTemplate = Handlebars.compile(
    `
class {{className}} {
  {{#each fields}}
  private {{type}} {{name}};
  {{/each}}

  public {{className}}({{#each fields}}{{type}} {{name}}{{#unless @last}}, {{/unless}}{{/each}}) {
    {{#each fields}}
    this.{{name}} = {{name}};
    {{/each}}
  }
}
  `.trim(),
  );

  const simpleData = { name: "World" };
  const complexData = {
    className: "CustomerEntity",
    fields: [
      { type: "String", name: "id" },
      { type: "String", name: "name" },
      { type: "LocalDate", name: "createdAt" },
      { type: "boolean", name: "active" },
    ],
  };

  bench("simple interpolation (1 variable)", () => {
    simpleTemplate(simpleData);
  });

  bench("compile + render simple template", () => {
    const t = Handlebars.compile("Hello {{name}}!");
    t(simpleData);
  });

  bench("complex template (class with 4 fields)", () => {
    complexTemplate(complexData);
  });

  bench("compile + render complex template", () => {
    const t = Handlebars.compile(
      `
class {{className}} {
  {{#each fields}}private {{type}} {{name}};
  {{/each}}
}`.trim(),
    );
    t(complexData);
  });
});

// =============================================================================
// String rename rule application benchmarks
// =============================================================================

describe("rename rule string replacement", () => {
  // Simulates what applyRenameRules does internally
  function applyReplacements(path: string, keys: string[], replacements: Record<string, string>) {
    let result = path;
    for (const key of keys) {
      result = result.split(key).join(replacements[key]);
    }
    return result;
  }

  const pathWithPlaceholders = "__PackageName__/__ClassName__/__ClassName__Service.ts";

  const smallReplacements = { __ClassName__: "Customer", __PackageName__: "com/example" };
  const smallKeys = Object.keys(smallReplacements).sort((a, b) => b.length - a.length);

  const largeReplacements = Object.fromEntries(
    Array.from({ length: 10 }, (_, i) => [`__Placeholder${i}__`, `value${i}`]),
  );
  const largeKeys = Object.keys(largeReplacements).sort((a, b) => b.length - a.length);
  const pathWithManyPlaceholders =
    Array.from({ length: 5 }, (_, i) => `__Placeholder${i}__`).join("/") + "/file.ts";

  bench("2 replacements on realistic path", () => {
    applyReplacements(pathWithPlaceholders, smallKeys, smallReplacements);
  });

  bench("10 replacements on path with 5 placeholders", () => {
    applyReplacements(pathWithManyPlaceholders, largeKeys, largeReplacements);
  });

  bench("no-op (path has no placeholders)", () => {
    applyReplacements("src/components/Button.tsx", smallKeys, smallReplacements);
  });
});
