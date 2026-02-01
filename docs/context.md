# Scaffoldix — Project Context & Non-Negotiable Rules

This document defines the fixed rules, invariants, and constraints of the Scaffoldix project. It serves as the engineering constitution that all contributors MUST follow.

---

## Mission & Positioning

**Scaffoldix is a generic, language-agnostic scaffolding engine.**

It generates project structures from external template packs, tracks generation history, and supports idempotent updates.

### What Scaffoldix IS

- A CLI tool that renders templates from external packs
- A stateful engine that tracks what was generated and when
- A generic system with zero built-in language or framework knowledge
- A deterministic, auditable generation pipeline

### What Scaffoldix is NOT

- A framework or SDK
- A language-specific tool (no Node, Python, Go bias in the engine)
- An AI-powered generator (no LLMs in the core engine)
- A package manager (packs are sources, not dependencies)

---

## Non-Negotiable Principles

### 1. Engine/Pack Separation

The core engine MUST NOT contain:
- Language-specific logic (e.g., "if JavaScript, do X")
- Framework-specific templates or defaults
- Opinionated project structures

All language/framework knowledge lives in **packs**, never in the engine.

**Rationale:** This separation enables infinite extensibility. The engine is a generic machine; packs are the intelligence.

### 2. Determinism

Given the same pack, archetype, and inputs, generation MUST produce identical output.

- No randomness in file generation
- No time-based decisions (except timestamps in metadata)
- No network calls during rendering
- Handlebars helpers MUST be pure functions

**Rationale:** Reproducibility enables debugging, testing, and trust.

### 3. Idempotency

Applying the same generation twice MUST NOT corrupt or duplicate content.

- Patch operations use idempotency keys
- Re-running generation with identical inputs is safe
- State tracking prevents duplicate patches

**Rationale:** Users must be able to safely re-run commands without fear.

### 4. Auditability

Every generation MUST be traceable.

- `state.json` records all generations with timestamps
- Registry tracks pack origins, versions, and hashes
- Generation reports include file manifests and operation traces

**Rationale:** Users must understand what changed, when, and why.

### 5. Safety

Operations MUST be atomic and recoverable.

- Staging directories for generation (never write directly to target)
- Atomic writes for registry and state files
- Rollback capability on failure

**Rationale:** Partial failures must not corrupt user projects.

### 6. Explicit Over Implicit

- No magic defaults
- No auto-detection of project type
- No silent failures
- All behavior must be declared in manifests

**Rationale:** Predictability requires explicitness.

---

## Explicit Constraints

### Engine Constraints

| Constraint | Rationale |
|------------|-----------|
| No AI in core engine | Determinism requires no probabilistic behavior |
| No network during render | Offline-first, reproducible builds |
| No language detection | Packs declare their domain, not the engine |
| No shell execution during render | Security and determinism (hooks are post-render) |
| No interactive prompts during render | Inputs are resolved before render starts |

### Pack Constraints

| Constraint | Rationale |
|------------|-----------|
| Packs MUST have a manifest | Validation requires schema |
| Packs MUST NOT modify engine behavior | Packs are data, not code |
| Pack templates MUST be Handlebars | Single templating standard |
| Patches MUST have idempotency keys | Duplicate protection |

### State Constraints

| Constraint | Rationale |
|------------|-----------|
| State is per-project, not global | Projects are independent |
| State writes MUST be atomic | Crash safety |
| State schema MUST be versioned | Forward compatibility |
| State MUST NOT be required for generation | New projects have no state |

---

## Sources of Truth

| Artifact | Location | Purpose |
|----------|----------|---------|
| **Pack Manifest** | `archetype.yaml` in pack root | Defines pack structure, archetypes, inputs, patches |
| **Registry** | `~/.scaffoldix/registry.json` | Tracks installed packs, origins, versions, hashes |
| **Project State** | `<project>/.scaffoldix/state.json` | Records generation history for the project |
| **Documentation** | `/docs/*.md` | Architectural decisions and rules |

### Truth Hierarchy

1. **Code** — The implementation is the ultimate truth
2. **Tests** — Verified behavior expectations
3. **Documentation** — Architectural intent and contracts
4. **Comments** — Local context (least authoritative)

If documentation conflicts with code, the code wins but documentation MUST be updated.

---

## Rules Contributors MUST Never Break

### Critical Rules (Breaking = Rejected PR)

1. **MUST NOT add language-specific logic to `src/core/`**
   - All language knowledge belongs in packs

2. **MUST NOT make generation non-deterministic**
   - No `Math.random()`, no `Date.now()` in rendering logic

3. **MUST NOT break state schema compatibility**
   - Old state files must remain readable
   - Use migrations for schema changes

4. **MUST NOT remove or rename public error codes**
   - Error codes are part of the API contract

5. **MUST NOT add network calls to render pipeline**
   - Pack fetching is separate from rendering

6. **MUST NOT bypass idempotency checks**
   - Patches must always check for previous application

### Important Rules (Breaking = Required Discussion)

1. **SHOULD NOT add new dependencies without justification**
   - Prefer standard library when possible

2. **SHOULD NOT add CLI flags without handler support**
   - Flags must be wired end-to-end

3. **SHOULD NOT modify test fixtures without test updates**
   - Fixtures and tests are coupled

4. **SHOULD NOT add console output outside CliUx**
   - All user-facing output goes through the UX layer

---

## Error Handling Contract

All errors shown to users MUST:

1. Have a machine-readable `code` (e.g., `MANIFEST_SCHEMA_ERROR`)
2. Have a human-readable `message`
3. Include a `hint` with actionable guidance
4. Be marked `isOperational: true` for user-facing errors
5. NOT expose internal stack traces in normal mode

```typescript
// Correct
throw new ScaffoldError(
  "Manifest validation failed",
  "MANIFEST_SCHEMA_ERROR",
  { path: filePath },
  undefined,
  "Check that all required fields are present in archetype.yaml"
);

// Incorrect
throw new Error("Validation failed");
```

---

## Terminology

| Term | Definition |
|------|------------|
| **Engine** | The core CLI runtime (`src/core/`) |
| **Pack** | A bundle containing manifest, archetypes, and templates |
| **Store** | Internal directory where installed packs reside (`~/.scaffoldix/store/`) |
| **Registry** | JSON file tracking installed packs (`~/.scaffoldix/registry.json`) |
| **Archetype** | A generator unit inside a pack |
| **Patch** | Safe snippet to modify generated files |
| **Hook** | Post-generate command (build/test/other) |
| **Check** | A quality gate command (blocks on failure) |
| **State** | Per-project file tracking generation history |

---

## Technology Stack

| Area | Technology | Rationale |
|------|------------|-----------|
| Runtime | Node.js (ES2022+) | Cross-platform, async-first |
| Language | TypeScript (strict mode) | Type safety, maintainability |
| CLI Framework | Commander | Industry standard, minimal |
| Prompts | @clack/prompts | Modern, accessible UX |
| Template Engine | Handlebars | Logic-less, deterministic |
| Validation | Zod | Runtime type safety |
| Git Operations | simple-git | Mature, well-tested |
| Shell Execution | execa | Cross-platform, secure |
| Testing | Vitest | Fast, modern, ESM-native |

---

## Versioning Contract

### Semantic Versioning

Scaffoldix follows SemVer with these definitions:

| Change Type | Version Bump |
|-------------|--------------|
| Breaking CLI change | Major |
| Breaking state schema (without migration) | Major |
| New command or flag | Minor |
| New error code | Minor |
| Bug fix | Patch |
| Documentation only | None |

### State Schema Versioning

- Schema version lives in `state.json` as `schemaVersion`
- Migrations run automatically when reading old versions
- Engine always writes the current schema version
- Breaking changes require a major engine version bump

---

## Testing Contract

1. All public functions MUST have tests
2. All error paths MUST be tested
3. Regression tests MUST exist for known bugs
4. Coverage MUST NOT decrease (enforced by CI thresholds)

Test locations:
- `test/unit/` — Unit tests for isolated modules
- `test/` — Integration tests for handlers
- `test/regression/` — Regression tests for specific failure scenarios
