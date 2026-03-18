# Tutorial 1: Your First Pack

In this tutorial you will create a minimal Scaffoldix pack from scratch,
install it locally, and use it to generate a TypeScript service file.

**Prerequisites:** Node.js ≥ 18, Scaffoldix installed globally (`npm i -g scaffoldix`).

---

## 1. Create the pack directory

```bash
mkdir my-first-pack && cd my-first-pack
```

## 2. Write the manifest

Create `archetype.yaml`:

```yaml
pack:
  name: my-first-pack
  version: "0.1.0"
  description: "A simple pack that generates a TypeScript service"

archetypes:
  - id: service
    description: "Generates a minimal TypeScript service class"
    templateRoot: templates/service

    inputs:
      - name: serviceName
        prompt: "Service name (e.g. UserService):"
        type: string
        required: true
```

## 3. Add a template

Create `templates/service/{{serviceName}}.ts`:

```typescript
export class {{serviceName}} {
  greet(name: string): string {
    return `Hello from {{serviceName}}, ${name}!`;
  }
}
```

> **Tip:** Scaffoldix uses [Handlebars](https://handlebarsjs.com/) for template
> rendering.  Any `{{variable}}` in file content *or* filenames is replaced
> with the value collected from the user.

## 4. Install the pack locally

```bash
scaffoldix pack add ./my-first-pack
```

You should see:

```
✓ Installed my-first-pack@0.1.0
```

## 5. Generate from the pack

```bash
mkdir my-project && scaffoldix generate my-first-pack:service --target ./my-project
```

Scaffoldix will prompt you:

```
? Service name (e.g. UserService): GreeterService
```

After answering, the file `my-project/GreeterService.ts` is created with the
class name correctly rendered.

## 6. Preview changes first (dry-run)

Run with `--dry-run` to see what would be generated without writing anything:

```bash
scaffoldix generate my-first-pack:service --target ./my-project --dry-run
```

## 7. Skip prompts in CI

Use `--yes` to accept all defaults without prompting:

```bash
scaffoldix generate my-first-pack:service --target ./my-project --yes
```

Or supply values directly with `--set` (coming soon):

```bash
# Future API
scaffoldix generate my-first-pack:service --target ./my-project --set serviceName=OrderService
```

---

## What's next?

- [Tutorial 2: Template Variables & Transforms](./02-variables-and-transforms.md)
- [Tutorial 3: Patching Existing Files](./03-patching-existing-files.md)
- [Tutorial 4: Lifecycle Hooks & Quality Checks](./04-hooks-and-checks.md)
