# Scaffoldix Packs

This directory contains the official documentation for creating and maintaining Scaffoldix packs.

---

## What is a Pack?

A **Pack** is an external bundle containing templates, configuration, and optional patches that Scaffoldix uses to generate project structures. Packs are the intelligence layer—they contain all language-specific and framework-specific knowledge.

The Scaffoldix engine is generic and language-agnostic. It knows nothing about Java, Python, React, or any specific technology. All domain knowledge lives in packs.

---

## What is an Archetype?

An **Archetype** is a generator unit within a pack. A single pack may contain multiple archetypes, each producing different outputs.

Example: A "java-microservices" pack might contain archetypes for:

- `service` — Generate a new microservice
- `entity` — Generate a JPA entity with repository
- `controller` — Generate a REST controller

---

## Pack vs Engine Responsibilities

| Responsibility          | Belongs In          |
| ----------------------- | ------------------- |
| Template files          | Pack                |
| Language-specific logic | Pack                |
| Framework conventions   | Pack                |
| Build commands          | Pack (hooks/checks) |
| Input prompts           | Pack (manifest)     |
| Patch operations        | Pack (manifest)     |
| Template rendering      | Engine              |
| File system operations  | Engine              |
| State tracking          | Engine              |
| Idempotency enforcement | Engine              |

**Rule:** If you find yourself wanting to change engine behavior for a specific language or framework, that logic belongs in a pack instead.

---

## Documentation

| Document                                                  | Purpose                                   |
| --------------------------------------------------------- | ----------------------------------------- |
| [Pack Authoring Guide](./pack-authoring-guide.md)         | Complete guide from zero to working pack  |
| [archetype.yaml Reference](./archetype-yaml-reference.md) | Field-by-field manifest specification     |
| [Examples](./examples/)                                   | Realistic example packs to copy and adapt |

---

## Quick Start

1. Bootstrap from the starter: `cp -r starters/pack-starter my-pack`
2. Edit `my-pack/archetype.yaml` with your pack metadata and archetypes
3. Add templates to `my-pack/templates/<archetype-id>/`
4. Validate before installing: `scaffoldix pack validate ./my-pack`
5. Install locally: `scaffoldix pack add ./my-pack`
6. Generate: `scaffoldix generate my-pack:<archetype-id> --target ./output`

See the [Pack Authoring Guide](./pack-authoring-guide.md) for detailed instructions.

## Pack Distribution

| Method           | Command                                    | Notes                          |
| ---------------- | ------------------------------------------ | ------------------------------ |
| Local path       | `scaffoldix pack add ./my-pack`            | Development and testing        |
| GitHub           | `scaffoldix pack add github:org/repo`      | Public repos                   |
| npm              | `scaffoldix pack add npm:@scope/pack-name` | Published packages             |
| Verify integrity | `scaffoldix pack verify my-pack`           | SHA-256 check                  |
| Publish to npm   | `scaffoldix pack publish`                  | Adds `scaffoldix-pack` keyword |
