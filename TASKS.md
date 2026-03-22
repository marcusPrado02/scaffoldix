# Scaffoldix — 50 Improvement Tasks

## CLI & UX

- [x] **1.** Add shell completion scripts for bash, zsh, and fish (`scaffoldix completion`)
- [x] **2.** Add `--version` flag that reads from `package.json` dynamically at build time
- [x] **3.** Implement `scaffoldix init` command to scaffold a new pack interactively from scratch
- [x] **4.** Add `scaffoldix update <packId>` command to update an installed pack to a newer version
- [x] **5.** Add color-coded diff output in dry-run mode showing exactly what would be created/modified
- [x] **6.** Implement `scaffoldix history` command to display the full generation history for the current project
- [x] **7.** Add `scaffoldix rollback` command to revert the last generation using stored history
- [x] **8.** Add `--output-format json` flag globally so every command can produce machine-readable output
- [x] **9.** Improve `doctor` command to check for required runtimes (node, pnpm, git) with version constraints
- [x] **10.** Add progress bars for multi-file renders so users get feedback on large packs

---

## Pack System & Manifest

- [x] **11.** Support remote pack installation from a GitHub URL (`scaffoldix pack add github:org/repo`)
- [x] **12.** Support pack installation from npm (`scaffoldix pack add npm:@scope/pack-name`)
- [x] **13.** Add pack versioning with semver range resolution when multiple versions are installed
- [x] **14.** Implement a pack registry/catalog (`scaffoldix pack search <keyword>`) backed by a public index
- [x] **15.** Add `scaffoldix pack validate <path>` command to lint and validate a pack before publishing
- [x] **16.** Support pack inheritance — an archetype can `extend` another archetype, overriding only specific fields
- [x] **17.** Add `scaffoldix pack publish` command to publish a pack to the public registry
- [x] **18.** Support conditional template blocks in `archetype.yaml` based on input values (e.g., `if: inputs.database == 'postgres'`)
- [x] **19.** Add `deprecated` field to archetype manifest so packs can warn users of deprecation
- [x] **20.** Implement pack signing and integrity verification (SHA-256 + optional GPG signature)

---

## Template Engine

- [x] **21.** Add support for custom Handlebars helpers defined inside the pack (e.g., `helpers/` directory)
- [x] **22.** Support `partials/` directory in packs for shared Handlebars partial templates
- [x] **23.** Add a `filters` section in `archetype.yaml` to transform input values (e.g., `camelCase`, `kebab-case`, `PascalCase`)
- [x] **24.** Support binary file copying in packs (images, fonts, etc.) without template processing
- [x] **25.** Add template linting to `pack validate` — detect undefined variables or broken Handlebars syntax
- [x] **26.** Support `.scaffoldixignore` file inside a pack to exclude specific files from rendering
- [x] **27.** Add post-render filename sanitization rules (strip special chars, enforce naming conventions)
- [x] **28.** Support multi-root templates — an archetype can write to multiple target directories simultaneously

---

## Patching Engine

- [x] **29.** Add `regex_replace` patch strategy for pattern-based file modifications
- [x] **30.** Add `json_merge` patch strategy to deeply merge JSON content into existing JSON files
- [x] **31.** Add `yaml_merge` patch strategy for idempotent YAML patching
- [x] **32.** Implement patch preview in dry-run mode showing a unified diff per patched file
- [x] **33.** Add `--skip-patches` flag to `generate` to apply only templates without patches
- [x] **34.** Support ordering guarantees for patches within a single archetype (explicit `order` field)
- [x] **35.** Add patch conflict detection when two archetypes attempt to patch the same marker in the same file

---

## Quality Gates & Hooks

- [x] **36.** Add parallel check execution with a `parallel: true` option in `archetype.yaml` checks section
- [x] **37.** Add timeout support for checks and hooks (`timeout: 60s`) to prevent hanging builds
- [x] **38.** Implement `pre-generate` hooks that run before any files are written (e.g., environment validation)
- [x] **39.** Add `--skip-checks` flag to `generate` for faster iteration during development
- [x] **40.** Support check retries with exponential backoff (`retries: 3`) for flaky network-dependent checks

---

## Testing & Quality

- [x] **41.** Add end-to-end integration tests that run `scaffoldix generate` against the reference pack in a temp directory
- [x] **42.** Add contract tests to verify all public `core/` modules fulfill their documented interfaces
- [x] **43.** Set up mutation testing (e.g., Stryker) to assess the quality of the existing test suite
- [x] **44.** Add snapshot tests for the CLI output of `pack list`, `pack info`, and `archetypes` commands
- [x] **45.** Add performance benchmarks for rendering large packs (100+ template files) to catch regressions

---

## Developer Experience & Documentation

- [x] **46.** Write a `CONTRIBUTING.md` with setup instructions, branching strategy, and PR checklist
- [x] **47.** Add JSDoc comments to all public `core/` module APIs to enable IDE IntelliSense for pack authors
- [x] **48.** Create an official `pack-starter` template repository that authors can clone to bootstrap a new pack
- [x] **49.** Add a `docs/tutorials/` section with step-by-step guides (e.g., "Build your first pack in 10 minutes")
- [x] **50.** Set up an automated changelog generator (e.g., `changesets` or `conventional-changelog`) tied to the CI pipeline
