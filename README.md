# Scaffoldix

A professional code scaffolding CLI built on deterministic packs, designed for DevX and Platform Engineering.

## Features

- **Pack system** — install packs from local paths, GitHub URLs, or npm
- **Template engine** — Handlebars templates with custom helpers, partials, filters, and binary file support
- **Patching engine** — idempotent file patching with `marker_insert`, `marker_replace`, `append_if_missing`, `regex_replace`, `json_merge`, and `yaml_merge` strategies
- **Quality gates** — pre/post-generate hooks and checks with parallel execution, timeouts, and retries
- **Dry-run mode** — color-coded diff preview before writing any files
- **Audit trail** — generation history, rollback support, and structured tracing
- **Pack authoring** — versioning, semver range resolution, inheritance, signing, and publishing

## Installation

```bash
npm install -g scaffoldix
```

## Quick start

```bash
# Add a pack
scaffoldix pack add ./my-pack

# List installed packs
scaffoldix pack list

# List available archetypes
scaffoldix archetypes

# Generate from an archetype
scaffoldix generate my-pack:component --target ./src/components

# Dry-run (preview only)
scaffoldix generate my-pack:component --target ./src --dry-run
```

## Commands

| Command                     | Description                                                       |
| --------------------------- | ----------------------------------------------------------------- |
| `generate <pack:archetype>` | Generate files from an archetype                                  |
| `pack add <source>`         | Install a pack (local path, `github:org/repo`, `npm:@scope/name`) |
| `pack list`                 | List installed packs                                              |
| `pack info <packId>`        | Show pack details and archetypes                                  |
| `pack remove <packId>`      | Uninstall a pack                                                  |
| `pack update <packId>`      | Update a pack to a newer version                                  |
| `pack validate <path>`      | Validate a pack before publishing                                 |
| `pack publish`              | Publish a pack to npm                                             |
| `pack search <keyword>`     | Search the public pack registry                                   |
| `pack verify <packId>`      | Verify pack integrity (SHA-256)                                   |
| `archetypes`                | List all archetypes across installed packs                        |
| `history`                   | Show generation history for the current project                   |
| `rollback`                  | Revert the last generation                                        |
| `doctor`                    | Check runtime dependencies (node, pnpm, git)                      |
| `init`                      | Scaffold a new pack interactively                                 |
| `completion`                | Print shell completion script (bash / zsh / fish)                 |

## Global flags

| Flag             | Description                           |
| ---------------- | ------------------------------------- |
| `--json`         | Machine-readable JSON output          |
| `--dry-run`      | Preview changes without writing files |
| `--skip-patches` | Apply templates only, skip patches    |
| `--skip-checks`  | Skip quality gate checks              |
| `--force`        | Overwrite existing files              |
| `--trace`        | Print per-phase timing                |

## Pack authoring

A pack is a directory containing a `pack.yaml` manifest and an `archetypes/` or `templates/` tree.

```yaml
# pack.yaml
pack:
  name: my-pack
  version: 1.0.0

archetypes:
  - id: component
    templateRoot: templates/component
    inputs:
      - id: name
        prompt: "Component name"
    patches:
      - file: src/index.ts
        strategy: append_if_missing
        content: "export { {{name}} } from './{{name}}';"
    hooks:
      postGenerate:
        - run: pnpm lint --fix
    checks:
      - run: pnpm type-check
        parallel: true
        timeout: 60s
```

See [docs/packs/pack-authoring-guide.md](docs/packs/pack-authoring-guide.md) for the full reference.

## Tutorials

Step-by-step guides are in [`docs/tutorials/`](docs/tutorials/):

1. [Build your first pack](docs/tutorials/01-your-first-pack.md)
2. [Variables and transforms](docs/tutorials/02-variables-and-transforms.md)
3. [Patching existing files](docs/tutorials/03-patching-existing-files.md)
4. [Hooks and checks](docs/tutorials/04-hooks-and-checks.md)

## Development

```bash
# Install dependencies
pnpm install

# Build
pnpm build

# Run tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Run mutation tests
pnpm stryker run

# Run CLI locally
node dist/cli.js --help
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full development workflow, project structure, and PR checklist.

## Stack

- Node.js + TypeScript
- pnpm
- commander / @clack/prompts
- tsup / vitest / Stryker
