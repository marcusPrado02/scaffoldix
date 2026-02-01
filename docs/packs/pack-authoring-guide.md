# Pack Authoring Guide

This guide explains how to create a Scaffoldix pack from scratch. It covers structure, manifests, templates, patches, hooks, and quality gates.

---

## Pack Structure

A pack is a directory containing a manifest and templates. The recommended structure:

```
my-pack/
├── archetype.yaml          # Pack manifest (required)
├── templates/              # Template files organized by archetype
│   └── my-archetype/
│       ├── src/
│       │   └── main.ts.hbs
│       └── package.json.hbs
├── patches/                # Patch template files (optional)
│   └── my-archetype/
│       └── add-dependency.hbs
└── docs/                   # Pack documentation (optional)
    └── README.md
```

### Naming Conventions

| Element | Convention | Example |
|---------|------------|---------|
| Pack name | lowercase, hyphens | `java-microservices`, `react-starter` |
| Archetype ID | lowercase, hyphens | `service`, `base-entity`, `rest-controller` |
| Template files | `.hbs` extension | `Main.java.hbs`, `package.json.hbs` |
| Patch files | `.hbs` extension | `add-import.hbs` |

### Versioning

Pack versions MUST follow semantic versioning (semver):

```yaml
pack:
  name: my-pack
  version: "1.0.0"  # Major.Minor.Patch
```

- **Major:** Breaking changes to templates or inputs
- **Minor:** New archetypes or backward-compatible features
- **Patch:** Bug fixes, documentation updates

---

## Manifest Authoring

The manifest file (`archetype.yaml`) defines pack identity and archetypes.

### Required Structure

```yaml
pack:
  name: my-pack
  version: "1.0.0"

archetypes:
  - id: my-archetype
    templateRoot: templates/my-archetype
```

### Archetype Fields

| Field | Required | Description |
|-------|----------|-------------|
| `id` | Yes | Unique identifier within pack |
| `templateRoot` | Yes | Path to templates (relative to pack root) |
| `inputs` | No | Input definitions for user prompts |
| `patches` | No | Patch operations to apply |
| `postGenerate` | No | Commands to run after generation |
| `checks` | Recommended | Quality gate commands |

### Input Definitions

Inputs collect values from users during generation:

```yaml
archetypes:
  - id: service
    templateRoot: templates/service
    inputs:
      - name: projectName
        type: string
        required: true
        prompt: "What is your project name?"

      - name: port
        type: number
        default: 3000
        prompt: "Which port should the server use?"

      - name: useTypeScript
        type: boolean
        default: true
        prompt: "Use TypeScript?"

      - name: database
        type: enum
        options: ["postgres", "mysql", "sqlite"]
        default: postgres
        prompt: "Which database?"
```

**Input Rules:**

- Input `name` MUST be valid identifier (letters, numbers, underscores)
- `type` MUST be one of: `string`, `number`, `boolean`, `enum`
- `enum` type MUST include `options` array
- Required inputs without defaults MUST prompt user (unless `--yes` mode)

---

## Templates

Templates are Handlebars files that produce output files.

### Template Engine

Scaffoldix uses Handlebars for templating. Templates have access to all input values.

```handlebars
// src/{{projectName}}/index.ts
export const PORT = {{port}};

{{#if useTypeScript}}
// TypeScript enabled
{{/if}}
```

### Variable Naming

Use consistent variable names across templates:

| Purpose | Variable | Example Value |
|---------|----------|---------------|
| Project name | `projectName` | `my-app` |
| Entity name | `entityName` | `User` |
| Package/module | `packageName` | `com.example.app` |
| Boolean flags | `useX`, `enableX` | `useTypeScript` |

### Filename Templating

Template filenames can include variables using double underscores:

```
templates/
  __projectName__/
    __entityName__.java.hbs
```

With inputs `projectName: "myapp"` and `entityName: "User"`, produces:
```
myapp/
  User.java
```

### Conditionals

Use Handlebars conditionals for optional content:

```handlebars
{{#if useDocker}}
# Docker configuration
COPY . /app
{{/if}}

{{#unless skipTests}}
test:
  npm test
{{/unless}}
```

### Template Rules

- Templates MUST NOT contain pack-specific logic that assumes engine behavior
- Templates SHOULD produce deterministic output given the same inputs
- Templates MUST use `.hbs` extension
- Binary files (images, fonts) are copied without template processing

---

## Patches

Patches modify existing files in the target project. They are useful for incremental additions to configuration files, imports, or registrations.

### Patch Types

| Type | Purpose |
|------|---------|
| `marker_insert` | Insert content between markers |
| `marker_replace` | Replace content between markers |
| `append_if_missing` | Append to end of file if not present |

### Marker-Based Patching

Marker-based patches find start/end markers in the target file and insert or replace content between them.

**Template file with markers:**

```typescript
// src/config.ts
export const plugins = [
  // <scaffoldix:plugins>
  // </scaffoldix:plugins>
];
```

**Patch definition in manifest:**

```yaml
patches:
  - kind: marker_insert
    file: src/config.ts
    idempotencyKey: add-auth-plugin
    markerStart: "// <scaffoldix:plugins>"
    markerEnd: "// </scaffoldix:plugins>"
    contentTemplate: |
      new AuthPlugin({ provider: "{{authProvider}}" }),
```

### Marker Conventions

Use consistent marker formats. Recommended conventions:

**Single-line comments (JavaScript, TypeScript, Java, Go):**
```
// <scaffoldix:SECTION_NAME>
// </scaffoldix:SECTION_NAME>
```

**Block comments (CSS, SQL):**
```
/* <scaffoldix:SECTION_NAME> */
/* </scaffoldix:SECTION_NAME> */
```

**XML/HTML:**
```
<!-- scaffoldix:SECTION_NAME -->
<!-- /scaffoldix:SECTION_NAME -->
```

**YAML/Python:**
```
# <scaffoldix:SECTION_NAME>
# </scaffoldix:SECTION_NAME>
```

### Idempotency

Every patch MUST have a unique `idempotencyKey`. The engine stamps applied patches and skips re-application.

```yaml
patches:
  - kind: marker_insert
    file: src/index.ts
    idempotencyKey: import-auth-module  # Unique key
    markerStart: "// <scaffoldix:imports>"
    markerEnd: "// </scaffoldix:imports>"
    contentTemplate: |
      import { AuthModule } from './auth';
```

**Idempotency Rules:**

- `idempotencyKey` MUST be unique within the archetype
- `idempotencyKey` SHOULD be descriptive (e.g., `add-user-entity-import`)
- Running generation twice MUST NOT duplicate patch content

### Append If Missing

For simple appends without markers:

```yaml
patches:
  - kind: append_if_missing
    file: .gitignore
    idempotencyKey: ignore-env-files
    contentTemplate: |

      # Environment files
      .env
      .env.local
```

### External Patch Content

For complex patches, use external template files:

```yaml
patches:
  - kind: marker_insert
    file: src/config.ts
    idempotencyKey: add-database-config
    markerStart: "// <scaffoldix:database>"
    markerEnd: "// </scaffoldix:database>"
    path: patches/database-config.hbs  # External file
```

---

## Hooks and Checks

### postGenerate Hooks

Commands that run after template rendering (formatting, installation):

```yaml
archetypes:
  - id: service
    templateRoot: templates/service
    postGenerate:
      - npm install
      - npm run format
```

**Hook Guidelines:**

- Hooks run sequentially in the target directory
- Hooks SHOULD be used for formatting and setup tasks
- Hooks SHOULD NOT modify core generated files (use patches instead)
- Hooks MUST handle cross-platform concerns (see below)

### Quality Checks

Checks are mandatory quality gates. If any check fails, generation is not considered successful.

```yaml
archetypes:
  - id: service
    templateRoot: templates/service
    checks:
      - npm run build
      - npm test
      - npm run lint
```

**Check Rules:**

- Every archetype SHOULD have at least one check
- Checks run after all hooks complete
- Check failure blocks generation success
- Checks MUST be deterministic (same input → same result)

### Cross-Platform Commands

Avoid platform-specific commands when possible:

| Instead of | Use |
|------------|-----|
| `rm -rf node_modules` | `npx rimraf node_modules` |
| `mkdir -p src/foo` | `npx mkdirp src/foo` |
| `cp file1 file2` | `npx copyfiles file1 file2` |

If platform-specific commands are required, document clearly:

```yaml
# WARNING: Unix-only command
postGenerate:
  - chmod +x scripts/deploy.sh
```

---

## Best Practices

### Deterministic Outputs

- Templates MUST produce identical output given identical inputs
- Avoid time-based or random values in templates
- Use explicit defaults rather than derived values

### Stable Defaults

- Provide sensible defaults for optional inputs
- Defaults SHOULD produce working, buildable output
- Document what defaults assume

### Strong Input Validation

- Use appropriate types (`number` for ports, `enum` for choices)
- Mark truly required inputs as `required: true`
- Provide clear prompt text

### Intentional Markers

- Place markers in templates where patches will insert content
- Use descriptive marker names (`scaffoldix:imports`, `scaffoldix:routes`)
- Document marker locations for pack users

### Minimal Patch Surface

- Prefer complete templates over many patches
- Use patches for truly dynamic content (registrations, imports)
- Each patch SHOULD have a single, clear purpose

### Quality Gates

- Every archetype SHOULD have at least one check
- Checks SHOULD verify the generated code compiles/builds
- Checks SHOULD run fast enough for interactive use

---

## Anti-Patterns

### MUST NOT: Engine-Specific Logic

Packs MUST NOT assume or request changes to engine behavior:

```yaml
# WRONG - Packs cannot control engine behavior
archetypes:
  - id: service
    engineOptions:
      skipIdempotency: true  # NOT ALLOWED
```

### MUST NOT: Destructive Patches

Patches MUST NOT replace entire files:

```yaml
# WRONG - This destroys existing content
patches:
  - kind: marker_replace
    file: src/index.ts
    markerStart: "// FILE_START"
    markerEnd: "// FILE_END"
    contentTemplate: |
      // Completely new file content...
```

### MUST NOT: Non-Idempotent Operations

Every patch MUST be safely re-runnable:

```yaml
# WRONG - Missing idempotencyKey
patches:
  - kind: marker_insert
    file: src/config.ts
    markerStart: "// imports"
    markerEnd: "// /imports"
    contentTemplate: |
      import { foo } from './foo';
```

### MUST NOT: Missing Checks

Archetypes SHOULD NOT ship without quality checks:

```yaml
# WRONG - No verification that output works
archetypes:
  - id: service
    templateRoot: templates/service
    # No checks defined!
```

### MUST NOT: Overly Dynamic Templates

Templates SHOULD NOT obscure output predictability:

```handlebars
{{! WRONG - Complex logic obscures output }}
{{#each (computeDependencies projectType framework database)}}
  {{this.name}}: {{this.version}}
{{/each}}
```

### MUST NOT: Undocumented Platform Dependencies

```yaml
# WRONG - Assumes Unix without documentation
postGenerate:
  - ./setup.sh
  - chmod +x bin/*
```

If platform-specific, document clearly in pack README.

---

## Testing Your Pack

Before publishing:

1. **Install locally:** `scaffoldix pack add /path/to/pack`
2. **Generate to temp directory:** `scaffoldix generate pack-name archetype-id --target /tmp/test`
3. **Verify checks pass:** All quality checks should succeed
4. **Test idempotency:** Run generation twice, verify no duplicates
5. **Test with different inputs:** Vary inputs to cover conditional paths
