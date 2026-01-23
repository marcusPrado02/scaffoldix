# Scaffoldix

Scaffoldix é uma CLI profissional de scaffolding de código baseada em packs determinísticos,
voltada para DevX e Platform Engineering.

## Status
🚧 Em desenvolvimento (v0.1)

## Objetivo
- Engine genérico (sem lógica por linguagem)
- Packs externos com manifest
- Geração auditável e idempotente
- Quality gates obrigatórios

## Stack
- Node.js + TypeScript
- pnpm
- commander / @clack/prompts
- tsup / vitest

## Desenvolvimento
```bash
pnpm install
pnpm build
node dist/cli.js --help
