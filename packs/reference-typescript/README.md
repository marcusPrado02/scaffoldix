# Reference TypeScript Pack

This is the **official reference implementation** for Scaffoldix pack authors.

## Purpose

This pack serves as:
- **Canonical example** of best practices for pack authoring
- **Integration test fixture** for Scaffoldix engine testing
- **Onboarding material** for new pack developers
- **Documentation reference** for the pack authoring guide

## Archetypes

### `base-project`

Generates a minimal but complete TypeScript project from scratch.

**Inputs:**
| Input | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `projectName` | string | Yes | - | Project display name |
| `packageName` | string | Yes | - | npm package name |
| `useStrict` | boolean | No | `true` | Enable strict TypeScript |
| `includeTests` | boolean | No | `true` | Include vitest setup |

**Generated structure:**
```
<target>/
├── package.json
├── tsconfig.json
├── vitest.config.ts (if includeTests)
└── src/
    ├── index.ts
    └── index.test.ts (if includeTests)
```

**Usage:**
```bash
scaffoldix generate reference-typescript base-project --target ./my-project
```

### `module`

Generates a new module inside an existing project created by `base-project`.

**Inputs:**
| Input | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `moduleName` | string | Yes | - | Module name (camelCase) |
| `moduleDescription` | string | No | "A new module" | Brief description |

**What it does:**
1. Creates `src/<moduleName>.ts` with an exported function
2. Patches `src/index.ts` to export the new module

**Usage:**
```bash
scaffoldix generate reference-typescript module --target ./my-project
```

## Demonstrates

This pack demonstrates:
- **Inputs:** String, boolean types with defaults
- **Templates:** Handlebars with variable substitution
- **Filename rules:** Dynamic filenames using `__moduleName__`
- **Conditional rendering:** Content based on boolean inputs
- **Marker-based patching:** Incremental modification of existing files
- **Idempotency:** Safe to run multiple times
- **Quality checks:** TypeScript compilation verification

## For Pack Authors

Use this pack as a blueprint when creating your own packs:
1. Study the `archetype.yaml` structure
2. Follow the template organization pattern
3. Use markers in templates where patching is expected
4. Always include quality checks
5. Keep templates simple and predictable

## Installation

```bash
# From repository root
scaffoldix pack add ./packs/reference-typescript
```

## Testing

This pack is designed for automated testing:
- All inputs have sensible defaults
- Output is deterministic given same inputs
- No interactive-only behavior
- Checks verify correctness programmatically
