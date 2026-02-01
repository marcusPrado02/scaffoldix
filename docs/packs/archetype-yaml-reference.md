# archetype.yaml Reference

This document provides a complete field-by-field reference for the Scaffoldix manifest format.

---

## File Location

The manifest MUST be at the pack root with one of these names (in order of preference):

1. `archetype.yaml` (preferred)
2. `pack.yaml` (fallback)

---

## Top-Level Structure

```yaml
pack:
  name: string # Required
  version: string # Required

scaffoldix: # Optional
  compatibility:
    minVersion: string
    maxVersion: string
    incompatible: [string]

archetypes: # Required, non-empty array
  - id: string
    templateRoot: string
    # ... additional fields
```

---

## `pack` Section

Pack identity and metadata.

| Field     | Type   | Required | Description                                    |
| --------- | ------ | -------- | ---------------------------------------------- |
| `name`    | string | Yes      | Pack identifier (e.g., `my-pack`, `@org/pack`) |
| `version` | string | Yes      | Semantic version (e.g., `1.0.0`)               |

**Validation:**

- `name` MUST be non-empty after trimming
- `version` MUST be non-empty after trimming

**Example:**

```yaml
pack:
  name: java-microservices
  version: "2.1.0"
```

---

## `scaffoldix` Section

Optional Scaffoldix-specific configuration.

### `scaffoldix.compatibility`

Version constraints for engine compatibility.

| Field          | Type     | Required | Default | Description                      |
| -------------- | -------- | -------- | ------- | -------------------------------- |
| `minVersion`   | string   | No       | -       | Minimum supported engine version |
| `maxVersion`   | string   | No       | -       | Maximum supported engine version |
| `incompatible` | string[] | No       | `[]`    | Explicit incompatible versions   |

**Example:**

```yaml
scaffoldix:
  compatibility:
    minVersion: "0.3.0"
    maxVersion: "1.0.0"
    incompatible:
      - "0.4.0" # Known bug affecting this pack
```

---

## `archetypes` Section

Array of archetype definitions. MUST contain at least one archetype.

### Archetype Fields

| Field          | Type       | Required | Default | Description                               |
| -------------- | ---------- | -------- | ------- | ----------------------------------------- |
| `id`           | string     | Yes      | -       | Unique identifier within pack             |
| `templateRoot` | string     | Yes      | -       | Path to templates (relative to pack root) |
| `inputs`       | InputDef[] | No       | `[]`    | Input definitions                         |
| `patches`      | Patch[]    | No       | `[]`    | Patch operations                          |
| `postGenerate` | string[]   | No       | `[]`    | Post-generation commands                  |
| `checks`       | string[]   | No       | `[]`    | Quality check commands                    |

**Validation:**

- `id` MUST be non-empty after trimming
- `templateRoot` MUST be non-empty after trimming
- `templateRoot` MUST be relative path within pack

**Example:**

```yaml
archetypes:
  - id: rest-service
    templateRoot: templates/rest-service
    inputs:
      - name: serviceName
        type: string
        required: true
    postGenerate:
      - npm install
    checks:
      - npm run build
      - npm test
```

---

## Input Definitions

Define user inputs collected during generation.

| Field      | Type     | Required | Default  | Description                                   |
| ---------- | -------- | -------- | -------- | --------------------------------------------- |
| `name`     | string   | Yes      | -        | Variable name (used in templates)             |
| `type`     | string   | No       | `string` | One of: `string`, `number`, `boolean`, `enum` |
| `required` | boolean  | No       | `false`  | Whether input must be provided                |
| `default`  | any      | No       | -        | Default value if not provided                 |
| `prompt`   | string   | No       | -        | Prompt text for interactive mode              |
| `options`  | string[] | No       | -        | Valid options (required for `enum` type)      |

### Type: `string`

```yaml
inputs:
  - name: projectName
    type: string
    required: true
    prompt: "What is your project name?"
```

### Type: `number`

```yaml
inputs:
  - name: port
    type: number
    default: 3000
    prompt: "Which port?"
```

### Type: `boolean`

```yaml
inputs:
  - name: useTypeScript
    type: boolean
    default: true
    prompt: "Use TypeScript?"
```

### Type: `enum`

```yaml
inputs:
  - name: database
    type: enum
    options:
      - postgres
      - mysql
      - sqlite
    default: postgres
    prompt: "Which database?"
```

**Validation:**

- `name` MUST be non-empty after trimming
- `type` MUST be one of the allowed values
- `enum` type MUST include `options` array

---

## Patch Operations

Patches modify existing files after template rendering.

### Common Fields

All patch types share these fields:

| Field            | Type    | Required | Default | Description                                 |
| ---------------- | ------- | -------- | ------- | ------------------------------------------- |
| `kind`           | string  | Yes      | -       | Patch type discriminator                    |
| `file`           | string  | Yes      | -       | Target file path (relative to project root) |
| `idempotencyKey` | string  | Yes      | -       | Unique key for idempotency                  |
| `description`    | string  | No       | -       | Human-readable description                  |
| `strict`         | boolean | No       | `true`  | Fail if markers not found                   |
| `when`           | string  | No       | -       | Reserved for conditional execution          |

### Content Source

Exactly one of these MUST be provided:

| Field             | Type   | Description                   |
| ----------------- | ------ | ----------------------------- |
| `contentTemplate` | string | Inline Handlebars template    |
| `path`            | string | Path to template file in pack |

### `marker_insert`

Inserts content immediately after `markerStart`, before existing content.

| Field         | Type              | Required |
| ------------- | ----------------- | -------- |
| `kind`        | `"marker_insert"` | Yes      |
| `markerStart` | string            | Yes      |
| `markerEnd`   | string            | Yes      |

**Example:**

```yaml
patches:
  - kind: marker_insert
    file: src/config.ts
    idempotencyKey: add-auth-import
    markerStart: "// <scaffoldix:imports>"
    markerEnd: "// </scaffoldix:imports>"
    contentTemplate: |
      import { AuthModule } from './auth';
```

### `marker_replace`

Replaces all content between `markerStart` and `markerEnd`.

| Field         | Type               | Required |
| ------------- | ------------------ | -------- |
| `kind`        | `"marker_replace"` | Yes      |
| `markerStart` | string             | Yes      |
| `markerEnd`   | string             | Yes      |

**Example:**

```yaml
patches:
  - kind: marker_replace
    file: src/version.ts
    idempotencyKey: update-version
    markerStart: "// <scaffoldix:version>"
    markerEnd: "// </scaffoldix:version>"
    contentTemplate: |
      export const VERSION = "{{version}}";
```

### `append_if_missing`

Appends content to end of file if not already present. Does NOT use markers.

| Field  | Type                  | Required |
| ------ | --------------------- | -------- |
| `kind` | `"append_if_missing"` | Yes      |

**Validation:**

- `markerStart` MUST NOT be provided
- `markerEnd` MUST NOT be provided

**Example:**

```yaml
patches:
  - kind: append_if_missing
    file: .gitignore
    idempotencyKey: ignore-env
    contentTemplate: |

      # Environment files
      .env
      .env.local
```

---

## Post-Generate Hooks

Array of shell commands executed after template rendering.

```yaml
postGenerate:
  - npm install
  - npm run format
  - npm run build
```

**Execution:**

- Commands run sequentially
- Working directory is the target project root
- Failure stops subsequent hooks
- All hooks complete before checks run

---

## Quality Checks

Array of shell commands that MUST pass for generation to succeed.

```yaml
checks:
  - npm run build
  - npm test
  - npm run lint
```

**Execution:**

- Commands run sequentially after all hooks
- Working directory is the target project root
- Any failure marks generation as failed
- All checks run even if earlier ones fail (to report all issues)

---

## Complete Example

```yaml
pack:
  name: typescript-api
  version: "1.2.0"

scaffoldix:
  compatibility:
    minVersion: "0.3.0"

archetypes:
  - id: rest-service
    templateRoot: templates/rest-service
    inputs:
      - name: serviceName
        type: string
        required: true
        prompt: "Service name?"

      - name: port
        type: number
        default: 3000
        prompt: "Port number?"

      - name: database
        type: enum
        options: [postgres, mysql, sqlite]
        default: postgres
        prompt: "Database?"

      - name: includeAuth
        type: boolean
        default: false
        prompt: "Include authentication?"

    patches:
      - kind: marker_insert
        file: src/index.ts
        idempotencyKey: register-service-route
        markerStart: "// <scaffoldix:routes>"
        markerEnd: "// </scaffoldix:routes>"
        contentTemplate: |
          app.use('/{{serviceName}}', {{serviceName}}Router);

    postGenerate:
      - npm install
      - npm run format

    checks:
      - npm run build
      - npm test

  - id: entity
    templateRoot: templates/entity
    inputs:
      - name: entityName
        type: string
        required: true
        prompt: "Entity name (PascalCase)?"

    checks:
      - npm run build
```

---

## Validation Errors

Common validation errors and their causes:

| Error Code              | Cause                                       |
| ----------------------- | ------------------------------------------- |
| `MANIFEST_YAML_ERROR`   | Invalid YAML syntax                         |
| `MANIFEST_SCHEMA_ERROR` | Missing required field or invalid value     |
| `MANIFEST_NOT_FOUND`    | No archetype.yaml or pack.yaml in directory |

Error messages include hints with specific field paths and expected values.
