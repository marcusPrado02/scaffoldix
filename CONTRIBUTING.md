# Contributing to Scaffoldix

Thank you for your interest in contributing to Scaffoldix!

## Quick start

```bash
# Clone and install dependencies
git clone https://github.com/marcusPrado02/scaffoldix.git
cd scaffoldix
pnpm install

# Build
pnpm build

# Run tests
pnpm test

# Watch mode
pnpm test:watch
```

## Project structure

```
src/
  cli/
    commands/      # Commander.js command builders (parse flags, call handlers)
    handlers/      # Business logic; each handler has typed Input/Deps/Result
    printers/      # CLI output formatters (dry-run preview, etc.)
    prompts/       # Interactive prompt adapters (@clack/prompts)
    ux/            # CliUx abstraction (coloured output, spinners)
  core/
    checks/        # CheckRunner — quality gate execution
    compatibility/ # CLI vs pack semver compatibility checking
    conflicts/     # ConflictDetector — pre-write collision detection
    errors/        # ScaffoldError hierarchy and user message formatting
    generate/      # InputResolver — collecting template variables
    hooks/         # HookRunner — postGenerate / preGenerate lifecycle
    inputs/        # Transformers (camelCase, PascalCase, ...), WhenEvaluator
    manifest/      # ManifestLoader — YAML parsing and Zod validation
    observability/ # EngineTrace — per-phase timing
    patch/         # PatchEngine, PatchResolver, PatchConflictDetector
    preview/       # PreviewPlanner — CREATE/MODIFY/NOOP analysis for dry-run
    render/        # Renderer, HelpersLoader, PartialsLoader (Handlebars)
    registry/      # RegistryService — pack index (registry.json)
    staging/       # StagingManager — atomic commit of generated output
    state/         # ProjectStateManager — .scaffoldix/state.json history
    store/         # StoreService, GitPackFetcher, NpmPackFetcher, PackIntegrity
    utils/         # parseDuration and other small utilities
test/
  bench/           # Vitest benchmarks (pnpm bench)
  contract/        # Stable contract tests for public APIs
  fixtures/        # Local test packs used by integration tests
  integration.*    # End-to-end integration tests
  regression/      # Regression guard tests
  unit/            # Unit tests, including snapshot tests
```

## Architecture principles

**Handler/command separation** — Commander.js commands (`src/cli/commands/`) only
parse CLI flags and call the corresponding handler.  Handlers (`src/cli/handlers/`)
contain all business logic and accept typed `Input` and `Dependencies` objects.
This makes handlers directly testable without spawning a process.

**Dependency injection** — handlers receive `Dependencies` objects instead of
importing singletons.  Tests pass fake/stub implementations.

**Staging directory** — `generate` renders templates into a temp staging dir
before committing atomically to the real target.  If any step fails the target
is never modified.

**Idempotent patches** — every patch carries an `idempotencyKey` that is
stamped into the file (`SCAFFOLDIX_PATCH:<key>`).  Re-running the same archetype
skips already-applied patches rather than duplicating content.

## Development workflow

### Branching

Work on feature branches.  Branch names should follow:
`feat/<topic>`, `fix/<topic>`, `test/<topic>`, `docs/<topic>`, `refactor/<topic>`.

### Commits

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(generate): add --skip-patches flag
fix(renderer): handle binary files with NUL byte
test(e2e): add golden path for preGenerate hooks
docs(contributing): add architecture overview
```

### Before pushing

```bash
pnpm typecheck   # TypeScript type check
pnpm build       # Full build (catches tsup errors)
pnpm test        # All tests (unit + integration + contract + snapshot)
```

### Adding a new command

1. Create `src/cli/commands/<name>.ts` with a `build<Name>Command()` function.
2. Create `src/cli/handlers/<name>Handler.ts` with typed `Input`, `Dependencies`,
   and `Result` interfaces and the `handle<Name>()` function.
3. Register the command in `src/cli/main.ts`.
4. Add unit tests in `test/` and integration coverage in `test/integration.e2e.test.ts`.

### Adding a new patch operation

1. Add a Zod schema constant (e.g. `MyOpSchema`) in `ManifestLoader.ts`.
2. Add it to `RawPatchSchema` (the discriminated union).
3. Add the interface and `apply<MyOp>()` method in `PatchEngine.ts`.
4. Add a case to the `switch` in `PatchEngine.applyAll()`.
5. Write tests in `test/PatchEngine.test.ts`.

## Testing

| Command | Description |
|---------|-------------|
| `pnpm test` | Run all tests once |
| `pnpm test:watch` | Watch mode |
| `pnpm test:coverage` | Coverage report (HTML + text) |
| `pnpm bench` | Performance benchmarks |
| `pnpm mutation` | Stryker mutation testing |

Coverage thresholds (enforced in CI):
- Branches: 65 %
- Functions: 85 %
- Lines: 80 %
- Statements: 80 %

## Writing tests

- **Unit tests** go in `test/unit/` or `test/<module>.test.ts`.
- **Integration tests** go in `test/integration.*.test.ts`.
- **Contract tests** go in `test/contract/` — pin stable API shape.
- **Snapshot tests** in `test/unit/` using `toMatchSnapshot()`.
- All tests use real filesystem operations in temp directories (`os.tmpdir()`).
  Never mock `fs` — this has caused prod/mock divergence in the past.

## Reporting issues

Please open an issue at <https://github.com/marcusPrado02/scaffoldix/issues>
with:
- Scaffoldix version (`scaffoldix --version`)
- OS and Node.js version
- The command you ran
- The error message and full stack trace (if any)
