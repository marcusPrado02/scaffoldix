# Tutorial 4: Lifecycle Hooks & Quality Checks

Scaffoldix provides three lifecycle phases where you can run shell commands:

| Phase | When | Stops on failure? |
|-------|------|-------------------|
| `preGenerate` | Before any templates are written | Yes — target untouched |
| `postGenerate` | After templates and patches are written | Yes |
| `checks` | After `postGenerate`, as mandatory gates | Yes |

---

## `preGenerate` — prerequisite validation

Use `preGenerate` to check that required tools or environment variables are
present *before* writing any files.  If any command exits non-zero, generation
aborts and the target directory is not modified.

```yaml
archetypes:
  - id: spring-service
    templateRoot: templates/spring-service
    preGenerate:
      - which mvn        # Fail if Maven is not installed
      - which java       # Fail if Java is not installed
      - node --version   # Show Node version for debugging
```

---

## `postGenerate` — run after generation

Use `postGenerate` for commands that should run after files are written:

```yaml
postGenerate:
  - npm install
  - npm run build
```

Commands run sequentially by default.  If any command fails, the error is
reported and generation is considered unsuccessful (but files have already
been written to the target directory).

---

## `checks` — mandatory quality gates

`checks` are like `postGenerate`, but they represent *must-pass* gates.  If any
check fails, the generation status is `failed` and the exit code is non-zero.

```yaml
checks:
  - npm run build
  - npm test
  - npm run lint
```

### Parallel checks

Run checks concurrently to save time when they are independent:

```yaml
parallelChecks: true
checks:
  - npm run build      # runs in parallel
  - npm run lint       # runs in parallel
  - npm test           # runs in parallel
```

When `parallelChecks: true`, all checks run even if some fail, and all
failures are reported together.

### Timeouts

```yaml
checksTimeout: "2m"     # kill each check after 2 minutes
hooksTimeout: "60s"     # kill each hook after 60 seconds
```

Accepted formats: `"30s"`, `"2m"`, `"1h"`, `"500ms"`, or a bare number
(e.g. `"90"` = 90 seconds).

### Retries with exponential backoff

Retry flaky checks automatically:

```yaml
checksRetries: 3   # retry up to 3 times (delays: 2s, 4s, 8s)
```

---

## Skipping phases on the command line

| Flag | Effect |
|------|--------|
| `--skip-patches` | Skip all patch operations |
| `--skip-checks` | Skip all quality check commands |
| `--dry-run` | Preview only; no writes, no hooks, no checks |

---

## Example: full archetype with all lifecycle phases

```yaml
archetypes:
  - id: full-stack-service
    templateRoot: templates/full-stack-service
    inputs:
      - name: serviceName
        prompt: "Service name:"
        type: string
        required: true

    preGenerate:
      - which docker
      - which kubectl

    patches:
      - kind: marker_insert
        file: k8s/services.yaml
        idempotencyKey: register-{{serviceName}}
        markerStart: "# SCAFFOLDIX:START:services"
        markerEnd: "# SCAFFOLDIX:END:services"
        contentTemplate: "  - name: {{serviceName}}"
        order: 10

    postGenerate:
      - npm install

    parallelChecks: true
    checksTimeout: "3m"
    checksRetries: 1
    checks:
      - npm run build
      - npm test
      - npm run lint
```

---

## What's next?

Explore the [Scaffoldix CLI reference](../reference/cli.md) for a complete list
of flags, or browse [the pack-starter template](../../starters/pack-starter/)
to start building your own pack.
