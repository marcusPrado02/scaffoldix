# Scaffoldix Tutorials

Step-by-step guides for getting started with Scaffoldix.

## Tutorials

1. [Your First Pack](./01-your-first-pack.md)
   Create a minimal pack, install it locally, and generate your first file.

2. [Template Variables & Transforms](./02-variables-and-transforms.md)
   Declare inputs, use Handlebars variables, apply case transforms, and write
   conditional templates.

3. [Patching Existing Files](./03-patching-existing-files.md)
   Use marker_insert, marker_replace, append_if_missing, regex_replace,
   json_merge, and yaml_merge to modify files that already exist.

4. [Lifecycle Hooks & Quality Checks](./04-hooks-and-checks.md)
   Run shell commands before generation (preGenerate), after generation
   (postGenerate), and as mandatory quality gates (checks).

## Quick reference

```bash
# Install a pack from local path
scaffoldix pack add ./my-pack

# Install a pack from GitHub
scaffoldix pack add github:owner/repo

# Install a pack from npm
scaffoldix pack add npm:my-pack-name

# Generate from a pack archetype
scaffoldix generate my-pack:archetype-id --target ./output

# Preview without writing
scaffoldix generate my-pack:archetype-id --dry-run

# Skip prompts (use defaults)
scaffoldix generate my-pack:archetype-id --yes

# Force overwrite existing files
scaffoldix generate my-pack:archetype-id --force

# Skip patches
scaffoldix generate my-pack:archetype-id --skip-patches

# Skip quality checks
scaffoldix generate my-pack:archetype-id --skip-checks
```
