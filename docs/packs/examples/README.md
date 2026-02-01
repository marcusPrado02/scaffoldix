# Example Packs

This directory contains example packs demonstrating Scaffoldix pack authoring patterns.

## Examples

| Example                         | Description                                         |
| ------------------------------- | --------------------------------------------------- |
| [minimal-pack](./minimal-pack/) | Simplest possible pack with basic inputs and checks |
| [patched-pack](./patched-pack/) | Demonstrates patches, hooks, and quality checks     |

## Using Examples

These examples are documentation, not installable packs. To use them:

1. Copy the example directory to a new location
2. Modify the `pack.name` in `archetype.yaml`
3. Install locally: `scaffoldix pack add /path/to/copy`
4. Generate: `scaffoldix generate pack-name archetype-id`

## Example Structure

Each example includes:

- `archetype.yaml` — Complete manifest with comments
- `templates/` — Template files demonstrating patterns
- Optional: `patches/` — Patch template files

Examples are intentionally minimal to focus on specific patterns.
