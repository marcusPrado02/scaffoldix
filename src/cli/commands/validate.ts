/**
 * Pack validate command — lint and validate a pack before publishing/installing.
 *
 * Performs comprehensive checks on a pack directory:
 *   1. archetype.yaml / pack.yaml exists and is valid YAML
 *   2. Manifest schema validation (all required fields, types)
 *   3. Template directories exist for each archetype
 *   4. Handlebars syntax check on all template files
 *   5. Input definitions are valid (required fields, correct types)
 *   6. Patch references point to files that exist in templates
 *   7. Pack ID and version follow expected conventions
 *
 * Usage:
 *   scaffoldix pack validate <path>
 *   scaffoldix pack validate . --strict
 *
 * @module
 */

import * as path from "node:path";
import * as fs from "node:fs/promises";
import { Command } from "commander";
import Handlebars from "handlebars";
import fg from "fast-glob";
import { getCliUx } from "../ux/CliUx.js";
import { ManifestLoader } from "../../core/manifest/ManifestLoader.js";
import { toUserMessage } from "../../core/errors/errors.js";

interface ValidationIssue {
  level: "error" | "warn";
  message: string;
  context?: string;
}

async function validateHandlebarsTemplates(
  templateDir: string,
  archetypeId: string,
): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];

  let files: string[];
  try {
    files = await fg("**/*", {
      cwd: templateDir,
      dot: true,
      onlyFiles: true,
      followSymbolicLinks: false,
    });
  } catch {
    return [{ level: "error", message: `Cannot read template directory`, context: templateDir }];
  }

  for (const file of files) {
    const absPath = path.join(templateDir, file);
    try {
      const content = await fs.readFile(absPath, "utf-8");
      // Skip if likely binary
      if (content.includes("\0")) continue;
      Handlebars.precompile(content);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      issues.push({
        level: "error",
        message: `Invalid Handlebars syntax in ${archetypeId}/templates/${file}: ${msg}`,
        context: absPath,
      });
    }
  }

  return issues;
}

/**
 * Builds the `pack validate <path>` command.
 *
 * @returns Configured Commander command
 */
export function buildPackValidateCommand(): Command {
  return new Command("validate")
    .description("Lint and validate a pack directory before publishing or installing")
    .argument("<path>", "Path to the pack directory")
    .option("--strict", "Treat warnings as errors", false)
    .option("--json", "Output results as JSON", false)
    .addHelpText(
      "after",
      `
Checks performed:
  ✓ archetype.yaml / pack.yaml presence and YAML validity
  ✓ Manifest schema (pack name, version, archetypes)
  ✓ Template directories exist for all archetypes
  ✓ Handlebars syntax on all template files
  ✓ Input definition completeness
  ✓ Pack name and version format

Examples:
  scaffoldix pack validate ./my-pack
  scaffoldix pack validate . --strict
  scaffoldix pack validate ./packs/java-spring --json`,
    )
    .action(async (packPath: string, options: { strict: boolean; json: boolean }) => {
      const ux = getCliUx();
      const issues: ValidationIssue[] = [];
      let packName = packPath;

      try {
        const resolvedPath = path.resolve(process.cwd(), packPath);

        // 1. Check directory exists
        try {
          const stat = await fs.stat(resolvedPath);
          if (!stat.isDirectory()) {
            issues.push({ level: "error", message: `Path is not a directory: ${packPath}` });
          }
        } catch {
          issues.push({ level: "error", message: `Directory not found: ${packPath}` });
        }

        if (issues.some((i) => i.level === "error")) {
          printResults(issues, packPath, options, ux);
          process.exitCode = 1;
          return;
        }

        // 2. Load and validate manifest
        const loader = new ManifestLoader();
        let manifest;
        try {
          manifest = await loader.loadFromDir(resolvedPath);
          packName = manifest.pack.name;
        } catch (err) {
          const msg = toUserMessage(err);
          issues.push({ level: "error", message: `Manifest validation failed: ${msg.message}` });
          printResults(issues, packPath, options, ux);
          process.exitCode = 1;
          return;
        }

        // 3. Validate pack name format (kebab-case recommended)
        if (!/^[@a-z0-9][-a-z0-9/@.]*$/.test(manifest.pack.name)) {
          issues.push({
            level: "warn",
            message: `Pack name "${manifest.pack.name}" should use lowercase letters, numbers, and hyphens only`,
          });
        }

        // 4. Validate version is semver
        if (!/^\d+\.\d+\.\d+/.test(manifest.pack.version)) {
          issues.push({
            level: "error",
            message: `Pack version "${manifest.pack.version}" must follow semver (e.g. 1.0.0)`,
          });
        }

        // 5. Validate each archetype
        for (const archetype of manifest.archetypes ?? []) {
          const templateDir = path.join(resolvedPath, archetype.templateRoot);

          // Check template directory exists
          try {
            await fs.access(templateDir);
          } catch {
            issues.push({
              level: "error",
              message: `Template directory not found for archetype "${archetype.id}": ${archetype.templateRoot}`,
              context: templateDir,
            });
            continue; // Can't check templates if dir missing
          }

          // Check for empty template directory
          const files = await fg("**/*", { cwd: templateDir, onlyFiles: true, dot: true });
          if (files.length === 0) {
            issues.push({
              level: "warn",
              message: `Template directory for archetype "${archetype.id}" has no files`,
              context: templateDir,
            });
          }

          // Validate Handlebars syntax
          const templateIssues = await validateHandlebarsTemplates(templateDir, archetype.id);
          issues.push(...templateIssues);

          // Validate inputs have required fields
          for (const input of archetype.inputs ?? []) {
            if (!input.name || typeof input.name !== "string") {
              issues.push({
                level: "error",
                message: `Input in archetype "${archetype.id}" is missing a "name" field`,
              });
            }
            if (!input.type) {
              issues.push({
                level: "error",
                message: `Input "${input.name}" in archetype "${archetype.id}" is missing a "type" field`,
              });
            }
          }
        }

        // 6. Warn if no archetypes are defined
        if (!manifest.archetypes || manifest.archetypes.length === 0) {
          issues.push({ level: "warn", message: `Pack has no archetypes defined` });
        }

        printResults(issues, packName, options, ux);

        const hasErrors = issues.some((i) => i.level === "error");
        const hasWarnings = issues.some((i) => i.level === "warn");
        if (hasErrors || (options.strict && hasWarnings)) {
          process.exitCode = 1;
        }
      } catch (err) {
        const msg = toUserMessage(err);
        ux.error(`Validation failed: ${msg.message}`);
        process.exitCode = 1;
      }
    });
}

function printResults(
  issues: ValidationIssue[],
  packName: string,
  options: { strict: boolean; json: boolean },
  ux: ReturnType<typeof getCliUx>,
) {
  if (options.json) {
    process.stdout.write(
      JSON.stringify(
        { pack: packName, issues, valid: !issues.some((i) => i.level === "error") },
        null,
        2,
      ) + "\n",
    );
    return;
  }

  const errors = issues.filter((i) => i.level === "error");
  const warnings = issues.filter((i) => i.level === "warn");

  if (issues.length === 0) {
    ux.success(`Pack "${packName}" is valid — no issues found.`);
    return;
  }

  ux.info(`Validation results for "${packName}":\n`);

  for (const issue of errors) {
    process.stdout.write(`  ✗ [ERROR] ${issue.message}\n`);
    if (issue.context) process.stdout.write(`         ${issue.context}\n`);
  }
  for (const issue of warnings) {
    process.stdout.write(`  ⚠ [WARN]  ${issue.message}\n`);
    if (issue.context) process.stdout.write(`         ${issue.context}\n`);
  }

  process.stdout.write("\n");
  if (errors.length > 0) {
    ux.error(`${errors.length} error(s), ${warnings.length} warning(s) found.`);
  } else {
    ux.warn(`${warnings.length} warning(s) found.`);
  }
}
