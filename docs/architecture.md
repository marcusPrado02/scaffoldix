# Scaffoldix — Architecture Decisions & Rationale

This document explains how and why the Scaffoldix system is structured. It is written for senior engineers and future maintainers who need to understand not just what exists, but why it exists and what alternatives were rejected.

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLI Layer                                │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐            │
│  │ Commands│  │ Handlers│  │   UX    │  │ Prompts │            │
│  └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘            │
└───────┼────────────┼────────────┼────────────┼──────────────────┘
        │            │            │            │
        ▼            ▼            ▼            ▼
┌─────────────────────────────────────────────────────────────────┐
│                        Core Engine                               │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐        │
│  │ Manifest │  │ Renderer │  │  Patch   │  │  Hooks   │        │
│  │  Loader  │  │          │  │  Engine  │  │  Runner  │        │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘        │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐        │
│  │  Store   │  │ Registry │  │ Staging  │  │  State   │        │
│  │ Service  │  │ Service  │  │ Manager  │  │ Manager  │        │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘        │
└─────────────────────────────────────────────────────────────────┘
        │            │            │            │
        ▼            ▼            ▼            ▼
┌─────────────────────────────────────────────────────────────────┐
│                     External Systems                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐        │
│  │   Git    │  │   File   │  │  Shell   │  │  Packs   │        │
│  │ (simple- │  │  System  │  │  (execa) │  │(external)│        │
│  │   git)   │  │          │  │          │  │          │        │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘        │
└─────────────────────────────────────────────────────────────────┘
```

---

## Layer Responsibilities

### CLI Layer (`src/cli/`)

**Responsibility:** User interaction, command parsing, output formatting.

| Component | Purpose |
|-----------|---------|
| `commands/` | Command definitions (Commander.js) |
| `handlers/` | Business logic orchestration |
| `ux/` | Output formatting (CliUx, CliJson, CliSpinner) |

**Rules:**
- Commands MUST NOT contain business logic
- Handlers orchestrate core services
- All user output goes through CliUx

**Why handlers exist:** Commands define CLI surface; handlers contain testable orchestration logic. This separation enables testing without CLI parsing overhead.

### Core Engine (`src/core/`)

**Responsibility:** All domain logic, completely independent of CLI.

| Module | Purpose |
|--------|---------|
| `manifest/` | Pack manifest loading and validation |
| `render/` | Template rendering with Handlebars |
| `patch/` | Idempotent file patching |
| `hooks/` | Post-generate command execution |
| `checks/` | Quality gate verification |
| `store/` | Pack installation and storage |
| `registry/` | Installed pack tracking |
| `staging/` | Transactional generation with rollback |
| `state/` | Per-project generation history |
| `compatibility/` | Pack/engine version compatibility |
| `observability/` | Generation tracing and metrics |
| `errors/` | Structured error types |

**Rules:**
- Core MUST NOT import from CLI
- Core MUST NOT use console directly
- Core MUST NOT contain language-specific logic

---

## Design Principles Applied

### Clean Architecture

**Dependency Rule:** Dependencies point inward. Core has no knowledge of CLI.

```
CLI → Core → External Systems
```

- `src/core/` defines interfaces (e.g., `PromptAdapter`, `StoreLogger`)
- `src/cli/` provides implementations
- Core services accept adapters via dependency injection

**Boundary enforcement:**
- No imports from `src/cli/` in `src/core/`
- Logger interfaces defined in core, implemented in CLI

### Domain-Driven Design (DDD)

**Bounded Contexts:**

| Context | Ownership | Key Entities |
|---------|-----------|--------------|
| Pack Management | StoreService | Pack, Archetype, Manifest |
| Generation | Renderer, StagingManager | FileEntry, RenderResult |
| Patching | PatchEngine | PatchOperation, PatchResult |
| State Tracking | ProjectStateManager | GenerationRecord |

**Ubiquitous Language:**
- "Pack" not "template" or "scaffold"
- "Archetype" not "generator" or "preset"
- "Generation" not "scaffold" or "create"

### GRASP Principles

| Principle | Application |
|-----------|-------------|
| **Information Expert** | ManifestLoader validates manifests (it has the schema knowledge) |
| **Creator** | StagingManager creates FileEntry objects (it manages file lifecycle) |
| **Controller** | Handlers coordinate across services without owning domain logic |
| **Low Coupling** | Services communicate through interfaces, not concrete types |
| **High Cohesion** | Each module has a single, focused responsibility |

### SOLID Principles

| Principle | Application |
|-----------|-------------|
| **SRP** | PatchEngine only patches; HookRunner only runs hooks |
| **OCP** | New patch types can be added without modifying existing code |
| **LSP** | All pack origins (local, git, npm) implement the same interface |
| **ISP** | Small interfaces (PromptAdapter, StoreLogger) instead of large ones |
| **DIP** | Core depends on abstractions; CLI provides implementations |

---

## Key Architectural Decisions

### Decision 1: External Packs (Not Built-in Templates)

**Choice:** All templates live in external packs, never in the engine.

**Alternatives considered:**
- Built-in starter templates (rejected: couples engine to specific tech)
- Plugin system with code execution (rejected: security concerns)

**Trade-off:** Users must install packs before use, but engine remains generic.

### Decision 2: Staging + Atomic Commit

**Choice:** Generate to staging directory, then atomically move to target.

**Alternatives considered:**
- Direct write to target (rejected: partial failures corrupt projects)
- Git-based staging (rejected: adds Git dependency to all projects)

**Trade-off:** Extra disk I/O, but crash safety guaranteed.

### Decision 3: Per-Project State (Not Global)

**Choice:** State stored in `<project>/.scaffoldix/state.json`.

**Alternatives considered:**
- Global database (rejected: projects not portable)
- Git-based tracking (rejected: not all projects use Git)

**Trade-off:** State not shared across machines, but projects are self-contained.

### Decision 4: Handlebars (Not More Powerful Templates)

**Choice:** Handlebars for all templating.

**Alternatives considered:**
- EJS (rejected: allows arbitrary JS, breaks determinism)
- Liquid (rejected: less ecosystem support)
- Custom DSL (rejected: learning curve)

**Trade-off:** Limited logic in templates, but determinism guaranteed.

### Decision 5: Schema Migrations (Not Breaking Changes)

**Choice:** State and registry schemas are versioned with automatic migration.

**Alternatives considered:**
- Breaking changes in minor versions (rejected: poor UX)
- No schema versioning (rejected: can't evolve format)

**Trade-off:** Migration code maintenance, but backward compatibility.

---

## Module Deep Dives

### ManifestLoader

**Responsibility:** Load, validate, and normalize pack manifests.

**Key behaviors:**
- Supports both `archetype.yaml` and `pack.yaml`
- Validates against Zod schemas
- Returns typed `PackManifest` objects
- Provides actionable error messages

**Schema hierarchy:**
```
ManifestSchema
├── PackInfoSchema (name, version, description)
├── ArchetypeSchema[] (id, templateRoot, inputs, patches)
└── CompatibilitySchema (minEngineVersion)
```

### Renderer

**Responsibility:** Transform templates into output files.

**Key behaviors:**
- Handlebars compilation with strict mode
- Rename rules (e.g., `__name__` → actual name)
- Binary file detection (skip templating)
- Dry-run support (no filesystem writes)

**Why Handlebars strict mode:** Catches typos in variable names rather than silently outputting empty strings.

### PatchEngine

**Responsibility:** Apply idempotent modifications to generated files.

**Patch types:**
| Type | Purpose |
|------|---------|
| `marker_insert` | Insert content between markers |
| `marker_replace` | Replace content between markers |
| `append_if_missing` | Add content if not present |

**Idempotency mechanism:**
- Each patch has an `idempotencyKey`
- Applied patches are stamped: `// SCAFFOLDIX_PATCH:<key>`
- Re-application checks for existing stamps

### StagingManager

**Responsibility:** Transactional generation with two-phase commit.

**Flow:**
1. Create staging directory
2. Render all templates to staging
3. Run patches on staged files
4. Run checks on staged files
5. If all pass: atomic move to target
6. If any fail: rollback (delete staging)

**Rollback capability:** Previous target backed up before commit, restored on failure.

### ProjectStateManager

**Responsibility:** Track generation history per project.

**Schema evolution:**
- v1: Single `lastGeneration` record
- v2: Array of `generations` with history

**Migration:** Automatic on load; always writes current version.

---

## Evolution & Versioning

### How the System Evolves

| Change Type | Approach |
|-------------|----------|
| New patch type | Add to PatchEngine, update schemas |
| New manifest field | Add with default, maintain compatibility |
| New state field | Add migration, bump schema version |
| New CLI command | Add command + handler + tests |

### What Requires Migrations

| Artifact | Migration Trigger |
|----------|-------------------|
| `state.json` | Adding required fields, restructuring |
| `registry.json` | Changing pack metadata structure |
| Pack manifests | Engine can read old versions indefinitely |

### Version Compatibility Matrix

```
Pack Manifest v1.0 ──► Engine 0.1+
Pack Manifest v1.1 ──► Engine 0.2+ (new fields optional)
State v1 ──────────► Engine 0.1+ (migrates to v2 on write)
State v2 ──────────► Engine 0.3+
```

---

## Testing Architecture

### Test Categories

| Category | Location | Purpose |
|----------|----------|---------|
| Unit | `test/unit/` | Isolated module testing |
| Integration | `test/` | Handler-level flows |
| Regression | `test/regression/` | Known failure scenarios |

### Test Principles

1. **Real code over mocks:** Use actual services when possible
2. **Fixture-based:** Test data in version control
3. **Temp directories:** No pollution of real filesystem
4. **No network:** All tests run offline

### Coverage Requirements

Enforced thresholds (prevent regression):
- Statements: 80%
- Branches: 65%
- Functions: 85%
- Lines: 80%

---

## Future Considerations

### Planned Extensions

| Feature | Architectural Impact |
|---------|---------------------|
| Pack versioning | Multi-version storage in store |
| Remote pack registry | New fetch adapter, caching layer |
| Interactive patches | New patch type with user input |

### Intentionally Deferred

| Feature | Reason |
|---------|--------|
| Watch mode | Complexity vs. value for scaffolding |
| GUI | CLI-first philosophy |
| Plugin system | Security concerns with code execution |
