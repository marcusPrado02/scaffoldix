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

| Field        | Type   | Required | Description                                     |
| ------------ | ------ | -------- | ----------------------------------------------- |
| `name`       | string | Yes      | Pack identifier (e.g., `my-pack`, `@org/pack`)  |
| `version`    | string | Yes      | Semantic version (e.g., `1.0.0`)                |
| `deprecated` | string | No       | Deprecation message shown as a warning to users |

**Validation:**

- `name` MUST be non-empty after trimming
- `version` MUST be non-empty after trimming

**Example:**

```yaml
pack:
  name: java-microservices
  version: "2.1.0"
  deprecated: "Use java-microservices-v2 instead. This pack is no longer maintained."
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

| Field                | Type        | Required | Default | Description                                     |
| -------------------- | ----------- | -------- | ------- | ----------------------------------------------- |
| `id`                 | string      | Yes      | -       | Unique identifier within pack                   |
| `templateRoot`       | string      | Yes      | -       | Path to templates (relative to pack root)       |
| `extend`             | string      | No       | -       | ID of another archetype to inherit from         |
| `inputs`             | InputDef[]  | No       | `[]`    | Input definitions                               |
| `filters`            | FilterDef[] | No       | `[]`    | Input value transforms applied before rendering |
| `patches`            | Patch[]     | No       | `[]`    | Patch operations                                |
| `hooks`              | HooksDef    | No       | -       | Lifecycle hooks (preGenerate / postGenerate)    |
| `checks`             | CheckDef[]  | No       | `[]`    | Quality gate commands                           |
| `extraTemplateRoots` | string[]    | No       | `[]`    | Additional template directories to render       |

**Validation:**

- `id` MUST be non-empty after trimming
- `templateRoot` MUST be non-empty after trimming
- `templateRoot` MUST be relative path within pack
- `extend` MUST reference an archetype ID that exists in the same pack

**Example:**

```yaml
archetypes:
  - id: rest-service
    templateRoot: templates/rest-service
    inputs:
      - id: serviceName
        prompt: "Service name?"
        required: true
    hooks:
      preGenerate:
        - run: node -e "process.exit(0)"
      postGenerate:
        - run: npm install
          timeout: 120s
    checks:
      - run: npm run build
        parallel: true
        timeout: 60s
        retries: 2
```

---

### Pack Inheritance (`extend`)

An archetype can extend another archetype in the same pack. The child overrides fields from the parent; arrays are merged.

```yaml
archetypes:
  - id: base
    templateRoot: templates/base
    inputs:
      - id: name
        prompt: "Name?"

  - id: advanced
    extend: base # inherits inputs, patches, hooks from base
    templateRoot: templates/advanced # overrides templateRoot
    inputs:
      - id: extra
        prompt: "Extra option?" # added on top of inherited inputs
```

---

### Multi-Root Templates (`extraTemplateRoots`)

An archetype can render templates from multiple directories simultaneously.

```yaml
archetypes:
  - id: fullstack
    templateRoot: templates/backend
    extraTemplateRoots:
      - templates/frontend
      - templates/infra
```

---

## Input Definitions

Define user inputs collected during generation.

| Field      | Type     | Required | Default  | Description                                                                  |
| ---------- | -------- | -------- | -------- | ---------------------------------------------------------------------------- |
| `id`       | string   | Yes      | -        | Variable name (used in templates)                                            |
| `type`     | string   | No       | `string` | One of: `string`, `number`, `boolean`, `enum`                                |
| `required` | boolean  | No       | `false`  | Whether input must be provided                                               |
| `default`  | any      | No       | -        | Default value if not provided                                                |
| `prompt`   | string   | No       | -        | Prompt text for interactive mode                                             |
| `options`  | string[] | No       | -        | Valid options (required for `enum` type)                                     |
| `when`     | string   | No       | -        | Expression to conditionally show this input (e.g., `inputs.useAuth == true`) |

### Type: `string`

```yaml
inputs:
  - id: projectName
    type: string
    required: true
    prompt: "What is your project name?"
```

### Type: `number`

```yaml
inputs:
  - id: port
    type: number
    default: 3000
    prompt: "Which port?"
```

### Type: `boolean`

```yaml
inputs:
  - id: useTypeScript
    type: boolean
    default: true
    prompt: "Use TypeScript?"
```

### Type: `enum`

```yaml
inputs:
  - id: database
    type: enum
    options:
      - postgres
      - mysql
      - sqlite
    default: postgres
    prompt: "Which database?"
```

### Conditional inputs (`when`)

Use `when` to show an input only if a previous input matches a condition:

```yaml
inputs:
  - id: useAuth
    type: boolean
    default: false
    prompt: "Include authentication?"

  - id: authProvider
    type: enum
    options: [jwt, session, oauth]
    when: "inputs.useAuth == true"
    prompt: "Auth provider?"
```

**Validation:**

- `id` MUST be non-empty after trimming
- `type` MUST be one of the allowed values
- `enum` type MUST include `options` array

---

## Filters

Filters transform input values before they are available in templates. They are applied after all inputs are collected.

| Field       | Type   | Required | Description                              |
| ----------- | ------ | -------- | ---------------------------------------- |
| `id`        | string | Yes      | Input variable to transform              |
| `as`        | string | Yes      | New variable name to expose in templates |
| `transform` | string | Yes      | Transform to apply                       |

**Available transforms:**

| Transform    | Example input | Output       |
| ------------ | ------------- | ------------ |
| `camelCase`  | `my-service`  | `myService`  |
| `PascalCase` | `my-service`  | `MyService`  |
| `kebab-case` | `MyService`   | `my-service` |
| `snake_case` | `MyService`   | `my_service` |
| `UPPER_CASE` | `myService`   | `MY_SERVICE` |
| `lowercase`  | `MyService`   | `myservice`  |
| `uppercase`  | `myService`   | `MYSERVICE`  |

```yaml
inputs:
  - id: name
    prompt: "Component name (e.g. MyButton)?"

filters:
  - id: name
    as: nameKebab
    transform: kebab-case

  - id: name
    as: nameCamel
    transform: camelCase
```

In templates, both `{{name}}`, `{{nameKebab}}`, and `{{nameCamel}}` are available.

---

## Patch Operations

Patches modify existing files after template rendering.

### Common Fields

All patch types share these fields:

| Field            | Type    | Required | Default | Description                                         |
| ---------------- | ------- | -------- | ------- | --------------------------------------------------- |
| `kind`           | string  | Yes      | -       | Patch type discriminator                            |
| `file`           | string  | Yes      | -       | Target file path (relative to project root)         |
| `idempotencyKey` | string  | Yes      | -       | Unique key for idempotency                          |
| `order`          | number  | No       | `0`     | Execution order (lower runs first, ties are stable) |
| `description`    | string  | No       | -       | Human-readable description                          |
| `strict`         | boolean | No       | `true`  | Fail if markers not found                           |

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

### `regex_replace`

Replaces occurrences of a regular expression pattern.

| Field     | Type              | Required |
| --------- | ----------------- | -------- | ----------------------------- |
| `kind`    | `"regex_replace"` | Yes      |
| `pattern` | string            | Yes      | Regular expression to match   |
| `flags`   | string            | No       | Regex flags (e.g., `g`, `gi`) |

**Example:**

```yaml
patches:
  - kind: regex_replace
    file: src/version.ts
    idempotencyKey: bump-version
    pattern: 'VERSION = "[^"]*"'
    flags: g
    contentTemplate: 'VERSION = "{{version}}"'
```

### `json_merge`

Deep-merges a JSON object into an existing JSON file.

| Field  | Type           | Required |
| ------ | -------------- | -------- |
| `kind` | `"json_merge"` | Yes      |

**Example:**

```yaml
patches:
  - kind: json_merge
    file: package.json
    idempotencyKey: add-lint-script
    contentTemplate: |
      {
        "scripts": {
          "lint": "eslint src"
        }
      }
```

### `yaml_merge`

Deep-merges a YAML document into an existing YAML file.

| Field  | Type           | Required |
| ------ | -------------- | -------- |
| `kind` | `"yaml_merge"` | Yes      |

**Example:**

```yaml
patches:
  - kind: yaml_merge
    file: docker-compose.yml
    idempotencyKey: add-redis-service
    contentTemplate: |
      services:
        redis:
          image: redis:7-alpine
          ports:
            - "6379:6379"
```

---

## Lifecycle Hooks

Hooks run shell commands at specific points in the generation lifecycle.

```yaml
hooks:
  preGenerate:
    - run: node -e "require('fs').existsSync('.env') || process.exit(1)"
      timeout: 10s
  postGenerate:
    - run: npm install
      timeout: 120s
    - run: npm run format
```

### Hook Fields

| Field     | Type   | Required | Default | Description                      |
| --------- | ------ | -------- | ------- | -------------------------------- |
| `run`     | string | Yes      | -       | Shell command to execute         |
| `timeout` | string | No       | `30s`   | Max duration (e.g., `10s`, `2m`) |

**Execution:**

- `preGenerate` hooks run before any files are written (use for environment validation)
- `postGenerate` hooks run after all files are written
- Working directory is the target project root
- Failure stops subsequent hooks

---

## Quality Checks

Checks are mandatory quality gates. Generation fails if any check returns non-zero.

```yaml
checks:
  - run: npm run build
    parallel: true
  - run: npm test
    timeout: 5m
    retries: 2
```

### Check Fields

| Field      | Type    | Required | Default | Description                                     |
| ---------- | ------- | -------- | ------- | ----------------------------------------------- |
| `run`      | string  | Yes      | -       | Shell command to execute                        |
| `parallel` | boolean | No       | `false` | Run concurrently with other parallel checks     |
| `timeout`  | string  | No       | `30s`   | Max duration (e.g., `60s`, `5m`)                |
| `retries`  | number  | No       | `0`     | Retry count with exponential backoff on failure |

**Execution:**

- All sequential checks run in order
- Parallel checks (`parallel: true`) run concurrently as a group
- Working directory is the target project root
- All checks run even if some fail (to report all issues at once)
- Use `--skip-checks` to bypass checks during development

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
      - id: serviceName
        type: string
        required: true
        prompt: "Service name?"

      - id: port
        type: number
        default: 3000
        prompt: "Port number?"

      - id: database
        type: enum
        options: [postgres, mysql, sqlite]
        default: postgres
        prompt: "Database?"

      - id: includeAuth
        type: boolean
        default: false
        prompt: "Include authentication?"

      - id: authProvider
        type: enum
        options: [jwt, session, oauth]
        default: jwt
        when: "inputs.includeAuth == true"
        prompt: "Auth provider?"

    filters:
      - id: serviceName
        as: serviceNameCamel
        transform: camelCase
      - id: serviceName
        as: serviceNameKebab
        transform: kebab-case

    patches:
      - kind: marker_insert
        file: src/index.ts
        idempotencyKey: register-service-route
        order: 10
        markerStart: "// <scaffoldix:routes>"
        markerEnd: "// </scaffoldix:routes>"
        contentTemplate: |
          app.use('/{{serviceNameKebab}}', {{serviceNameCamel}}Router);

      - kind: json_merge
        file: package.json
        idempotencyKey: add-service-script
        order: 20
        contentTemplate: |
          { "scripts": { "start:{{serviceNameKebab}}": "node dist/{{serviceNameKebab}}.js" } }

    hooks:
      preGenerate:
        - run: node -e "require('fs').existsSync('src') || process.exit(1)"
          timeout: 5s
      postGenerate:
        - run: npm install
          timeout: 120s
        - run: npm run format

    checks:
      - run: npm run build
        parallel: true
        timeout: 60s
      - run: npm test
        timeout: 5m
        retries: 2

  - id: entity
    extend: rest-service # inherits inputs/patches as base
    templateRoot: templates/entity
    inputs:
      - id: entityName
        type: string
        required: true
        prompt: "Entity name (PascalCase)?"

    checks:
      - run: npm run build
        parallel: true
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
