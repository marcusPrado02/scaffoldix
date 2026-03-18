#!/usr/bin/env node
/**
 * Automated release script for Scaffoldix.
 *
 * Usage:
 *   node scripts/release.mjs [patch|minor|major]
 *   pnpm release patch
 *   pnpm release minor
 *   pnpm release major
 *
 * Steps performed:
 * 1. Bump version in package.json
 * 2. Regenerate CHANGELOG.md from git history (conventional commits)
 * 3. Stage the changed files
 * 4. Create a git commit: "chore(release): vX.Y.Z"
 * 5. Create a git tag: "vX.Y.Z"
 *
 * After running, push with:
 *   git push origin main --tags
 */

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const VALID_BUMPS = ["patch", "minor", "major"];
const bump = process.argv[2] ?? "patch";

if (!VALID_BUMPS.includes(bump)) {
  console.error(`Invalid bump type: "${bump}". Use one of: patch, minor, major`);
  process.exit(1);
}

const pkgPath = resolve("package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));

// 1. Compute new version
const [major, minor, patch] = pkg.version.split(".").map(Number);
let newVersion;
if (bump === "major") newVersion = `${major + 1}.0.0`;
else if (bump === "minor") newVersion = `${major}.${minor + 1}.0`;
else newVersion = `${major}.${minor}.${patch + 1}`;

console.log(`Bumping ${pkg.version} → ${newVersion} (${bump})`);

// 2. Write new version to package.json
pkg.version = newVersion;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf-8");
console.log("Updated package.json");

// 3. Regenerate CHANGELOG.md
try {
  execSync("pnpm changelog", { stdio: "inherit" });
  console.log("Regenerated CHANGELOG.md");
} catch (err) {
  console.error("Failed to generate changelog:", err.message);
  process.exit(1);
}

// 4. Stage changed files
execSync("git add package.json CHANGELOG.md", { stdio: "inherit" });

// 5. Commit
const commitMsg = `chore(release): v${newVersion}`;
execSync(`git commit -m "${commitMsg}"`, { stdio: "inherit" });
console.log(`Created commit: ${commitMsg}`);

// 6. Tag
const tag = `v${newVersion}`;
execSync(`git tag -a ${tag} -m "Release ${tag}"`, { stdio: "inherit" });
console.log(`Created tag: ${tag}`);

console.log(`
Release v${newVersion} prepared!

To publish:
  git push origin main --tags
  pnpm publish   # optional: publish to npm
`);
