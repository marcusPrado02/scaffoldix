# Scaffoldix — Complete User Guide

> A professional code scaffolding CLI built on deterministic packs, designed for DevX and Platform Engineering.

---

## Table of Contents

1. [What is Scaffoldix?](#what-is-scaffoldix)
2. [Installation](#installation)
3. [Core Concepts](#core-concepts)
4. [Daily Workflow Guide](#daily-workflow-guide)
5. [Command Reference](#command-reference)
6. [Global Flags](#global-flags)
7. [Template Variables & Transforms](#template-variables--transforms)
8. [Patching Existing Files](#patching-existing-files)
9. [Hooks & Quality Gates](#hooks--quality-gates)
10. [Creating Your Own Pack](#creating-your-own-pack)
11. [Advanced Usage](#advanced-usage)
12. [Troubleshooting](#troubleshooting)

---

## What is Scaffoldix?

Scaffoldix is a CLI that automates repetitive code generation tasks using **packs**. A pack is a reusable collection of templates and rules that know how to scaffold code for a specific purpose — like generating a REST service, a React component, a database entity, or an entire project from scratch.

**What makes Scaffoldix different from `create-*` tools:**

- **Packs are versioned and installable** from local paths, GitHub repos, or npm packages
- **Generates into existing projects** — not just brand-new ones
- **Patches existing files** intelligently (imports, exports, config files) using idempotent operations
- **Runs quality gates** (build, test, lint) after generation and rolls back on failure
- **Records every generation** with a full audit trail and one-command rollback
- **Dry-run mode** previews exactly what will change before touching a single file

---

## Installation

```bash
# Install globally via npm
npm install -g scaffoldix

# Or via pnpm
pnpm add -g scaffoldix

# Verify installation
scaffoldix --version
scaffoldix doctor
```

### Shell Completion (optional but recommended)

```bash
# Bash
scaffoldix completion bash >> ~/.bashrc && source ~/.bashrc

# Zsh
scaffoldix completion zsh >> ~/.zshrc && source ~/.zshrc

# Fish
scaffoldix completion fish > ~/.config/fish/completions/scaffoldix.fish
```

---

## Core Concepts

### Pack

A **pack** is a directory containing an `archetype.yaml` manifest and a `templates/` folder. It defines one or more archetypes, each with their own templates, inputs, patches, hooks, and checks.

```
my-pack/
├── archetype.yaml       # Pack manifest
└── templates/
    └── service/
        └── __entityName__.service.ts  # Template file
```

### Archetype

An **archetype** is a specific scaffolding recipe inside a pack. A pack for a Java backend might have archetypes like `rest-service`, `repository`, `dto`, etc. You generate from a specific archetype using `packId:archetypeId` notation.

### Template

Templates are files processed by the [Handlebars](https://handlebarsjs.com/) engine. Variables are injected as `{{variableName}}`. Filename placeholders use `__variableName__` syntax.

### Patch

A **patch** modifies an existing file in your project (e.g., adds an import to `index.ts`, merges keys into `package.json`). Patches are idempotent — running generation twice won't duplicate changes.

### Pack Registry

When you install a pack, Scaffoldix records it in `~/.scaffoldix/registry.json`. All installed packs are available across all your projects on that machine.

### Project State

Each project that uses Scaffoldix has a `.scaffoldix/state.json` file tracking every generation run — what was created, what was patched, what checks ran.

---

## Daily Workflow Guide

This section covers the most common day-to-day patterns.

### Day 1: Install a Pack and Generate Your First File

```bash
# 1. Install a pack from a local directory
scaffoldix pack add ./my-company-pack

# 2. See what archetypes the pack offers
scaffoldix pack info my-company-pack

# 3. Preview what generation would produce (safe — writes nothing)
scaffoldix generate my-company-pack:service --dry-run

# 4. Generate for real
scaffoldix generate my-company-pack:service
```

You will be prompted for any inputs the archetype requires (e.g., service name, target module, etc.).

### Adding a Pack from GitHub

```bash
# Public repo (uses default branch)
scaffoldix pack add github:my-org/scaffoldix-packs

# Specific tag or branch
scaffoldix pack add github:my-org/scaffoldix-packs --ref v2.0.0
scaffoldix pack add github:my-org/scaffoldix-packs --ref main
```

### Adding a Pack from npm

```bash
# Latest version
scaffoldix pack add npm:@my-company/scaffoldix-pack

# Specific version
scaffoldix pack add npm:@my-company/scaffoldix-pack --ref 1.4.0
```

### Generating in Non-Interactive Mode

When running in CI or scripts, pass all inputs as flags to skip prompts:

```bash
scaffoldix generate my-pack:service \
  --yes \
  --target ./src/services \
  -- serviceName=OrderService module=orders useAuth=true
```

> Inputs are passed after `--` as `key=value` pairs.

### Checking What Changed Before Committing

Always use `--dry-run` before a real generation to review:

```bash
scaffoldix generate my-pack:entity --dry-run
```

Output example:
```
  CREATE  src/entities/Order.entity.ts
  CREATE  src/entities/Order.dto.ts
  MODIFY  src/entities/index.ts       (patch: export-entity-order)
  NOOP    src/app.module.ts           (patch already applied)
```

### Undoing a Generation

```bash
# Preview what rollback would delete
scaffoldix rollback --dry-run

# Actually roll back
scaffoldix rollback

# Confirm without prompt
scaffoldix rollback --yes
```

> Rollback removes files that were **created** by the last generation. Patched files must be reverted manually (e.g., `git checkout`).

### Updating a Pack

```bash
# Update to latest
scaffoldix pack update my-company-pack

# Update to specific version
scaffoldix pack update my-company-pack --ref v2.1.0
```

### Viewing Generation History

```bash
# Human-readable
scaffoldix history

# With more entries
scaffoldix history --limit 50

# Machine-readable JSON (for scripts or editors)
scaffoldix history --json
```

### Running Doctor

If something seems off, run the diagnostics:

```bash
scaffoldix doctor
```

This checks: Node.js version, Git availability, Scaffoldix config directory, registry health, and more.

---

## Command Reference

### `scaffoldix generate <packId:archetypeId>`

Generate code from an installed archetype.

```bash
scaffoldix generate my-pack:service
scaffoldix generate my-pack:service --target ./src/modules/auth
scaffoldix generate my-pack:service --dry-run
scaffoldix generate my-pack:service --force       # overwrite existing files
scaffoldix generate my-pack:service --skip-checks # skip quality gates
scaffoldix generate my-pack:service --skip-patches # templates only
scaffoldix generate my-pack:service --yes          # no prompts, use defaults
```

| Flag | Default | Description |
|------|---------|-------------|
| `--target <dir>` | `.` | Output directory for generated files |
| `--dry-run` | false | Preview without writing |
| `--force` | false | Overwrite existing files |
| `--yes` | false | Use defaults, no prompts |
| `--skip-patches` | false | Skip all patch operations |
| `--skip-checks` | false | Skip quality gate commands |

### `scaffoldix pack add <source>`

Install a pack from a local path, GitHub URL, or npm package.

```bash
scaffoldix pack add ./path/to/pack          # local
scaffoldix pack add github:org/repo         # GitHub (default branch)
scaffoldix pack add github:org/repo --ref v1.0.0  # specific tag
scaffoldix pack add npm:@org/pack-name      # npm latest
scaffoldix pack add npm:@org/pack-name --ref 2.0.0  # npm version
```

### `scaffoldix pack list`

List all installed packs.

```bash
scaffoldix pack list
scaffoldix pack list --json
```

### `scaffoldix pack info <packId>`

Show details about an installed pack, including all archetypes and their inputs.

```bash
scaffoldix pack info my-pack
scaffoldix pack info my-pack --json
```

### `scaffoldix pack remove <packId>`

Uninstall a pack. Does not affect files already generated.

```bash
scaffoldix pack remove my-pack
```

### `scaffoldix pack update <packId>`

Pull the latest version (or a specified ref) of a pack.

```bash
scaffoldix pack update my-pack
scaffoldix pack update my-pack --ref v2.0.0
```

### `scaffoldix pack validate <path>`

Lint a pack before publishing or using it. Checks YAML syntax, schema compliance, template correctness.

```bash
scaffoldix pack validate ./my-pack
scaffoldix pack validate ./my-pack --strict   # extra checks
```

### `scaffoldix pack verify <packId>`

Verify installed pack integrity using SHA-256 file hashing.

```bash
scaffoldix pack verify my-pack
```

### `scaffoldix pack search <keyword>`

Search the public pack registry.

```bash
scaffoldix pack search react
scaffoldix pack search java spring --json
```

### `scaffoldix pack publish`

Publish your pack to npm. Runs validation first.

```bash
scaffoldix pack publish              # from current directory
scaffoldix pack publish ./my-pack   # from specific path
scaffoldix pack publish --dry-run   # see what would be published
```

### `scaffoldix archetypes`

List all archetypes across all installed packs.

```bash
scaffoldix archetypes
scaffoldix archetypes list --json
```

### `scaffoldix history`

Show the generation history for the current project.

```bash
scaffoldix history
scaffoldix history --limit 20
scaffoldix history --json
```

### `scaffoldix rollback`

Undo the most recent generation (removes created files).

```bash
scaffoldix rollback
scaffoldix rollback --dry-run   # preview what would be removed
scaffoldix rollback --yes       # skip confirmation prompt
```

### `scaffoldix init [directory]`

Bootstrap a new pack interactively.

```bash
scaffoldix init              # in current directory
scaffoldix init ./my-pack    # in new directory
```

### `scaffoldix doctor`

Run system health checks and diagnostics.

```bash
scaffoldix doctor
```

### `scaffoldix completion <shell>`

Print shell completion script.

```bash
scaffoldix completion bash
scaffoldix completion zsh
scaffoldix completion fish
```

---

## Global Flags

These flags work with every command:

| Flag | Description |
|------|-------------|
| `--verbose` | Show additional output and timing info |
| `--debug` | Show all output including internal traces |
| `--silent` | Suppress everything except errors |
| `--json` | Output machine-readable JSON |
| `--help` | Show help for a command |
| `--version` | Print version number |

---

## Template Variables & Transforms

### Basic Variable Interpolation

In template files (`.ts`, `.yaml`, `.json`, etc.):

```handlebars
export class {{serviceName}}Service {
  constructor(private readonly {{repositoryName}}Repository: {{repositoryName}}Repository) {}
}
```

### Filename Templating

Use `__variableName__` in filenames:

```
templates/
└── __entityName__.entity.ts    →  order.entity.ts  (when entityName=order)
└── __entityName__.dto.ts       →  order.dto.ts
└── __EntityName__Controller.ts →  OrderController.ts
```

### Built-in Transforms

Every input variable can be automatically transformed. Given `entityName = "order item"`:

| Transform | Result | Usage in template |
|-----------|--------|-------------------|
| `camelCase` | `orderItem` | `{{entityName_camelCase}}` |
| `PascalCase` | `OrderItem` | `{{entityName_PascalCase}}` |
| `kebab-case` | `order-item` | `{{entityName_kebabCase}}` |
| `snake_case` | `order_item` | `{{entityName_snakeCase}}` |
| `UPPER_SNAKE` | `ORDER_ITEM` | `{{entityName_UPPER_SNAKE}}` |
| `lower` | `order item` | `{{entityName_lower}}` |
| `upper` | `ORDER ITEM` | `{{entityName_upper}}` |
| `title` | `Order Item` | `{{entityName_title}}` |
| `dot.case` | `order.item` | `{{entityName_dotCase}}` |
| `path/case` | `order/item` | `{{entityName_pathCase}}` |

Transforms are declared per-input in the manifest:

```yaml
inputs:
  - name: entityName
    type: string
    required: true
    transforms:
      - PascalCase
      - camelCase
      - kebab-case
      - snake_case
```

### Handlebars Conditionals

```handlebars
{{#if useAuth}}
import { AuthGuard } from '@nestjs/passport';
{{/if}}

{{#unless isPublic}}
@UseGuards(AuthGuard)
{{/unless}}
```

### Handlebars Loops

```handlebars
{{#each dependencies}}
import { {{this}} } from './{{this}}';
{{/each}}
```

---

## Patching Existing Files

Patches modify files that already exist in your project. They are **idempotent** — running the same generation twice will not duplicate content.

### Marker Insert

Inserts content right after a start marker (content before `markerEnd` is preserved):

```yaml
patches:
  - kind: marker_insert
    file: src/app.module.ts
    idempotencyKey: "register-{{moduleName}}-module"
    markerStart: "// <scaffoldix:imports>"
    markerEnd: "// </scaffoldix:imports>"
    contentTemplate: |
      import { {{ModuleName}}Module } from './{{moduleName}}/{{moduleName}}.module';
```

### Marker Replace

Replaces all content between markers:

```yaml
patches:
  - kind: marker_replace
    file: src/routes/index.ts
    idempotencyKey: "routes-block"
    markerStart: "// <scaffoldix:routes>"
    markerEnd: "// </scaffoldix:routes>"
    contentTemplate: |
      router.use('/{{routePath}}', {{ControllerName}}Router);
```

### Append If Missing

Appends content to the end of a file, but only if not already present:

```yaml
patches:
  - kind: append_if_missing
    file: .env.example
    idempotencyKey: "env-{{serviceName}}"
    contentTemplate: |
      {{SERVICE_NAME_UPPER}}_PORT=3000
      {{SERVICE_NAME_UPPER}}_URL=http://localhost:3000
```

### Regex Replace

Replaces content matching a regular expression:

```yaml
patches:
  - kind: regex_replace
    file: package.json
    idempotencyKey: "add-script-{{scriptName}}"
    pattern: '"scripts":\s*\{'
    replacement: '"scripts": { "{{scriptName}}": "node {{scriptFile}}",'
    flags: "m"
```

### JSON Merge

Deep-merges a JSON object into an existing JSON file:

```yaml
patches:
  - kind: json_merge
    file: package.json
    idempotencyKey: "add-{{packageName}}-dep"
    content: |
      {
        "dependencies": {
          "{{packageName}}": "^{{packageVersion}}"
        }
      }
```

### YAML Merge

Deep-merges a YAML object into an existing YAML file:

```yaml
patches:
  - kind: yaml_merge
    file: docker-compose.yml
    idempotencyKey: "add-{{serviceName}}-service"
    content: |
      services:
        {{serviceName}}:
          image: {{imageName}}
          ports:
            - "{{port}}:{{port}}"
```

---

## Hooks & Quality Gates

### Pre-generation Hooks

Commands that run **before** templates are rendered. Use to validate prerequisites:

```yaml
preGenerate:
  - command: "node --version"
    description: "Check Node.js is available"
  - command: "test -f package.json"
    description: "Ensure we are inside a Node project"
```

### Post-generation Hooks

Commands that run **after** files are written. Use to install dependencies, format code, etc.:

```yaml
postGenerate:
  - command: "npm install"
    description: "Install new dependencies"
  - command: "npx prettier --write src/{{moduleName}}/**"
    description: "Format generated files"
```

### Quality Gate Checks

Commands that must pass for the generation to be committed. If any check fails, all generated files are rolled back:

```yaml
checks:
  - command: "tsc --noEmit"
    description: "TypeScript type check"
  - command: "npm test -- --passWithNoTests"
    description: "Run tests"

parallelChecks: true    # run all checks concurrently
checksTimeout: "120s"   # max time per check
checksRetries: 2        # retry up to 2 times on failure
hooksTimeout: "60s"     # max time per hook
```

---

## Creating Your Own Pack

### Step 1: Bootstrap with `init`

```bash
scaffoldix init ./my-pack
cd my-pack
```

This creates the basic pack structure:

```
my-pack/
├── archetype.yaml
└── templates/
    └── default/
        └── example.ts
```

### Step 2: Define the Manifest

Edit `archetype.yaml`:

```yaml
pack:
  name: my-company-pack
  version: "1.0.0"
  description: "Standard scaffolding for My Company services"

archetypes:
  - id: rest-service
    templateRoot: templates/rest-service
    inputs:
      - name: serviceName
        type: string
        required: true
        prompt: "Service name (e.g. OrderService)?"
        transforms:
          - PascalCase
          - camelCase
          - kebab-case

      - name: useAuth
        type: boolean
        default: false
        prompt: "Add authentication guard?"

    postGenerate:
      - command: "npm install"
        description: "Install dependencies"

    checks:
      - command: "tsc --noEmit"
        description: "Type check"

    patches:
      - kind: append_if_missing
        file: src/index.ts
        idempotencyKey: "export-{{serviceName_camelCase}}"
        contentTemplate: |
          export * from './{{serviceName_camelCase}}/{{serviceName_camelCase}}.service';
```

### Step 3: Add Templates

Create `templates/rest-service/__serviceName_camelCase__.service.ts`:

```handlebars
import { Injectable } from '@nestjs/common';
{{#if useAuth}}
import { AuthGuard } from '@nestjs/passport';
{{/if}}

@Injectable()
export class {{serviceName_PascalCase}}Service {
  // Generated by Scaffoldix — {{pack.name}} v{{pack.version}}
}
```

### Step 4: Validate and Test

```bash
# Validate the manifest
scaffoldix pack validate ./my-pack

# Install locally for testing
scaffoldix pack add ./my-pack

# Run a dry-run
scaffoldix generate my-company-pack:rest-service --dry-run

# Generate for real
scaffoldix generate my-company-pack:rest-service
```

### Step 5: Publish to npm

```bash
# Preview what would be published
scaffoldix pack publish --dry-run

# Publish
scaffoldix pack publish
```

---

## Advanced Usage

### Non-Interactive Generation (CI/CD)

```bash
# Pass inputs as key=value after --
scaffoldix generate my-pack:service --yes -- \
  serviceName="AuthService" \
  useAuth=true \
  module="auth"
```

### JSON Output for Scripting

```bash
# Get list of installed packs as JSON
scaffoldix pack list --json | jq '.[].id'

# Get archetypes of a pack as JSON
scaffoldix pack info my-pack --json | jq '.archetypes[].id'

# Check generation history
scaffoldix history --json | jq '.[0].inputs'
```

### Multiple Target Directories

```bash
# Generate the same archetype in multiple places
scaffoldix generate my-pack:component --target src/components/Button
scaffoldix generate my-pack:component --target src/components/Input
```

### Checking Compatibility

```bash
# Check if pack is compatible with current Scaffoldix version
scaffoldix pack verify my-pack
scaffoldix doctor
```

### Using Staging for Safety

Scaffoldix always renders to a temporary staging directory first, then atomically commits files. This means:
- If a check fails, **no files are written** to your project
- The target directory is never left in a partial state
- Safe to interrupt mid-generation

### The `.scaffoldixignore` File

Inside a pack's template directory, create `.scaffoldixignore` to exclude files from being rendered:

```gitignore
# Don't render these files (they are helpers/meta)
_helpers/
*.partial.hbs
README.md
```

### Binary Files

Scaffoldix automatically detects binary files (images, fonts, JARs) and copies them as-is without Handlebars processing. To force a text file to be copied without rendering, create a `.binary` marker:

```bash
touch templates/assets/config.json.binary
```

---

## Troubleshooting

### `Pack not found` after adding

```bash
# Make sure the pack was added successfully
scaffoldix pack list

# Re-add if needed
scaffoldix pack add ./my-pack

# Check registry integrity
scaffoldix doctor
```

### `Template directory does not exist`

The `templateRoot` in `archetype.yaml` must point to an existing directory relative to the pack root:

```yaml
archetypes:
  - id: service
    templateRoot: templates/service   # Must exist in pack directory
```

### `Cannot overwrite existing file`

```bash
# Use --force to allow overwriting
scaffoldix generate my-pack:service --force

# Or --dry-run first to see which files conflict
scaffoldix generate my-pack:service --dry-run
```

### Checks failing after generation

```bash
# Skip checks during development
scaffoldix generate my-pack:service --skip-checks

# Check what the failing command outputs
scaffoldix generate my-pack:service --verbose
```

### `Path traversal detected`

A rename rule in the pack contains `..` that would write outside the target directory. This is a security check — contact the pack author.

### Patch not applying

```bash
# Run with --verbose to see patch details
scaffoldix generate my-pack:service --verbose

# Check that marker comments exist in the target file
grep "scaffoldix:imports" src/app.module.ts
```

### Resetting project state

```bash
# View current state
cat .scaffoldix/state.json

# Roll back last generation
scaffoldix rollback

# To fully reset (removes all history — use with caution)
rm -rf .scaffoldix/
```

### Getting Debug Output

```bash
scaffoldix generate my-pack:service --debug 2>&1 | tee scaffoldix-debug.log
```

---

## Quick Reference Card

```bash
# Install & setup
npm i -g scaffoldix
scaffoldix doctor
scaffoldix completion zsh >> ~/.zshrc

# Pack management
scaffoldix pack add ./my-pack
scaffoldix pack add github:org/repo --ref v1.0.0
scaffoldix pack add npm:@company/pack
scaffoldix pack list
scaffoldix pack info my-pack
scaffoldix pack update my-pack
scaffoldix pack remove my-pack
scaffoldix pack validate ./my-pack

# Generate
scaffoldix generate my-pack:archetype
scaffoldix generate my-pack:archetype --dry-run
scaffoldix generate my-pack:archetype --target ./src/modules
scaffoldix generate my-pack:archetype --force
scaffoldix generate my-pack:archetype --skip-checks
scaffoldix generate my-pack:archetype --yes -- key=value

# Inspect & undo
scaffoldix archetypes
scaffoldix history
scaffoldix rollback --dry-run
scaffoldix rollback --yes

# Authoring
scaffoldix init ./new-pack
scaffoldix pack validate ./new-pack
scaffoldix pack publish --dry-run
```
