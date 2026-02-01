# Continuous Integration

Scaffoldix uses GitHub Actions for automated CI on every push and pull request.

## What CI Runs

The CI pipeline runs the following steps in order:

1. **Install** - `pnpm install --frozen-lockfile`
2. **Build** - `pnpm run build` (TypeScript compilation via tsup)
3. **Lint** - `pnpm run lint` (Prettier format check + TypeScript type check)
4. **Test** - `pnpm run test` (Vitest test suite)

Any failure in these steps will fail the CI check and block merging.

## Running Locally

Before pushing, run the same checks locally:

```bash
# Install dependencies
pnpm install

# Build the project
pnpm run build

# Check formatting and types
pnpm run lint

# Run tests
pnpm run test
```

### Quick Check

Run all checks in sequence:

```bash
pnpm run build && pnpm run lint && pnpm run test
```

### Fix Formatting

If the lint check fails due to formatting issues:

```bash
pnpm run format
```

## CI Configuration

The workflow is defined in `.github/workflows/ci.yml` and runs on:

- Push to `main` or `master` branch
- Pull requests targeting `main` or `master` branch

## Branch Protection

To enforce CI checks before merging:

1. Go to repository Settings > Branches
2. Add a branch protection rule for `main`
3. Enable "Require status checks to pass before merging"
4. Select the "Build, Lint & Test" check
