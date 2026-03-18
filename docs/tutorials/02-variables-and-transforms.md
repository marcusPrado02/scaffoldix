# Tutorial 2: Template Variables & Transforms

Scaffoldix collects **inputs** from the user (or from defaults in `--yes` mode)
and makes them available to Handlebars templates.  *Transforms* automatically
derive additional variables — such as `camelCase` or `kebab-case` variants —
from a single user input.

---

## Declaring inputs

In `archetype.yaml`:

```yaml
inputs:
  - name: entityName
    prompt: "Entity name (PascalCase, e.g. Product):"
    type: string
    required: true
    default: "Entity"

  - name: withTests
    prompt: "Generate test file?"
    type: boolean
    default: true
```

### Input types

| Type | Values | Notes |
|------|--------|-------|
| `string` | Any text | Default type |
| `boolean` | `true` / `false` | Rendered as checkbox in interactive mode |
| `number` | Numeric | Validated as a number |
| `select` | One of `options` | Rendered as a list picker |

```yaml
inputs:
  - name: framework
    type: select
    prompt: "Framework:"
    options: [react, vue, svelte]
```

---

## Using inputs in templates

Variables are available directly in Handlebars templates:

```handlebars
// {{entityName}}.ts
export class {{entityName}} {
  {{#if withTests}}
  // Tests generated alongside this file.
  {{/if}}
}
```

---

## Transforms

A single input can generate multiple derived variables.  Declare them in the
`transforms` list:

```yaml
inputs:
  - name: entityName
    prompt: "Entity name (PascalCase):"
    type: string
    required: true
    transforms:
      - PascalCase      # entityNamePascalCase  → "ProductOrder"
      - camelCase       # entityNameCamelCase   → "productOrder"
      - kebab-case      # entityNameKebabCase   → "product-order"
      - snake_case      # entityNameSnakeCase   → "product_order"
      - UPPER_SNAKE     # entityNameUpperSnake  → "PRODUCT_ORDER"
      - lower           # entityNameLower       → "productorder"
      - upper           # entityNameUpper       → "PRODUCTORDER"
```

### Available transforms

| Transform name | Example output (input: `"ProductOrder"`) |
|---------------|------------------------------------------|
| `PascalCase`  | `ProductOrder` |
| `camelCase`   | `productOrder` |
| `kebab-case`  | `product-order` |
| `snake_case`  | `product_order` |
| `UPPER_SNAKE` | `PRODUCT_ORDER` |
| `lower`       | `productorder` |
| `upper`       | `PRODUCTORDER` |
| `title`       | `Product Order` |
| `dot.case`    | `product.order` |
| `path/case`   | `product/order` |

### Using transform variables in templates

Each transform creates a variable named `<inputName><TransformName>` (PascalCase suffix):

```handlebars
// Generated file: {{entityNameKebabCase}}.service.ts
export class {{entityNamePascalCase}}Service {
  readonly tableName = "{{entityNameSnakeCase}}s";
  readonly routePath = "/api/{{entityNameKebabCase}}s";
}
```

---

## Rename rules (filename placeholders)

To rename *files and directories*, use rename rules when calling `generate`:

```bash
scaffoldix generate my-pack:service --target ./src
```

Or define rename rules in your archetype (programmatic API):

```typescript
await handleGenerate({
  ref: "my-pack:service",
  targetDir: "./src",
  dryRun: false,
  data: { entityName: "Product" },
  renameRules: {
    replacements: {
      "__EntityName__": "Product",
      "__entityName__": "product",
    },
  },
});
```

Pack authors name template files with `__Placeholder__` and users supply
values via `renameRules`.

---

## Conditional inputs with `when`

Show or skip inputs based on previous answers:

```yaml
inputs:
  - name: useDatabase
    prompt: "Include database integration?"
    type: boolean
    default: false

  - name: databaseName
    prompt: "Database name:"
    type: string
    when: "useDatabase == true"
```

---

## What's next?

- [Tutorial 3: Patching Existing Files](./03-patching-existing-files.md)
- [Tutorial 4: Lifecycle Hooks & Quality Checks](./04-hooks-and-checks.md)
