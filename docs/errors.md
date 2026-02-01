# Scaffoldix Error Reference

This document lists all Scaffoldix error codes, their causes, and how to resolve them.

## Philosophy

Error codes are **stable public API contracts**:

- Codes are SCREAMING_SNAKE_CASE identifiers
- Codes never change once released
- Each error includes actionable guidance
- Stack traces are hidden by default (use `--debug` for troubleshooting)

## Exit Code Ranges

| Range | Category   | Description                         |
| ----- | ---------- | ----------------------------------- |
| 1     | Internal   | Unexpected internal error           |
| 10-19 | Pack       | Pack operations (add, remove, list) |
| 20-29 | Manifest   | Manifest and archetype errors       |
| 30-39 | Generation | Input, template, and output errors  |
| 40-49 | Patch      | Patch application errors            |
| 50-59 | Hook       | Hook and check command errors       |
| 60-69 | State      | Project state errors                |
| 70-79 | Filesystem | Filesystem operation errors         |
| 80-89 | Git        | Git operation errors                |

## Common Errors

### PACK_NOT_FOUND

**Exit Code:** 10

**When it happens:** Attempting to use a pack that is not installed.

**Typical cause:**

- Typo in pack name
- Pack was never installed
- Pack was removed

**How to fix:**

1. List installed packs: `scaffoldix pack list`
2. Install the pack: `scaffoldix pack add <source>`

---

### MANIFEST_NOT_FOUND

**Exit Code:** 20

**When it happens:** No `archetype.yaml` or `pack.yaml` found in the pack directory.

**Typical cause:**

- Pack source directory is incorrect
- Manifest file has wrong name
- Pack is incomplete

**How to fix:**

1. Verify the pack directory contains `archetype.yaml` or `pack.yaml`
2. Check the pack source URL/path is correct
3. Ensure the manifest file is named correctly (case-sensitive)

---

### MANIFEST_INVALID

**Exit Code:** 21

**When it happens:** The manifest file fails schema validation.

**Typical cause:**

- Missing required fields (name, version)
- Invalid YAML syntax
- Type errors (e.g., version is not a string)

**How to fix:**

1. Check the error message for specific validation failures
2. Review the manifest schema documentation
3. Validate YAML syntax with a linter

---

### ARCHETYPE_NOT_FOUND

**Exit Code:** 24

**When it happens:** The specified archetype does not exist in the pack.

**Typical cause:**

- Typo in archetype name
- Archetype was removed from pack
- Using wrong pack

**How to fix:**

1. List available archetypes: `scaffoldix archetypes list --pack <pack>`
2. Check the archetype name spelling
3. Use the correct pack name

---

### INPUT_VALIDATION_FAILED

**Exit Code:** 30

**When it happens:** User-provided input fails validation.

**Typical cause:**

- Required input not provided
- Input doesn't match expected format
- Input violates schema constraints

**How to fix:**

1. Review the error message for which input failed
2. Check the archetype's input schema
3. Provide valid values for all required inputs

---

### OUTPUT_CONFLICT

**Exit Code:** 36

**When it happens:** Generation would overwrite existing files.

**Typical cause:**

- Target directory already contains files
- Running generation multiple times

**How to fix:**

1. Choose a different target directory
2. Delete or rename conflicting files
3. Use `--force` flag to allow overwrites (use with caution)

---

### PATCH_MARKER_NOT_FOUND

**Exit Code:** 40

**When it happens:** A patch operation references a marker that doesn't exist in the target file.

**Typical cause:**

- Target file was modified and marker was removed
- Marker ID is incorrect in manifest
- Patch was designed for different file version

**How to fix:**

1. Check if the marker exists in the target file
2. Verify the marker ID matches what's in the manifest
3. Re-add the marker to the target file if it was removed

---

### PATCH_FILE_NOT_FOUND

**Exit Code:** 42

**When it happens:** A patch operation targets a file that doesn't exist.

**Typical cause:**

- File was deleted or moved
- Patch is run before file is created
- Path in manifest is incorrect

**How to fix:**

1. Ensure the target file exists
2. Check the file path in the manifest
3. Run generation to create the file first

---

### CHECK_FAILED

**Exit Code:** 52

**When it happens:** A check command returned a non-zero exit code.

**Typical cause:**

- Linting errors in generated code
- Type errors
- Test failures

**How to fix:**

1. Review the check command output
2. Fix the issues identified
3. Re-run generation

---

### HOOK_FAILED

**Exit Code:** 50

**When it happens:** A pre/post generation hook failed.

**Typical cause:**

- Hook script has errors
- Required dependencies not installed
- Permission issues

**How to fix:**

1. Check the hook command and its output
2. Verify all dependencies are installed
3. Check file permissions

---

### STATE_READ_FAILED

**Exit Code:** 60

**When it happens:** Failed to read the project state file (`.scaffoldix/state.json`).

**Typical cause:**

- File is corrupted
- Permission denied
- Invalid JSON

**How to fix:**

1. Check file permissions
2. Validate the JSON syntax
3. Delete and regenerate if corrupted (loses history)

---

### STATE_MIGRATION_FAILED

**Exit Code:** 62

**When it happens:** Failed to migrate project state to a newer schema version.

**Typical cause:**

- State file is corrupted
- Incompatible modifications made manually

**How to fix:**

1. Back up the current state file
2. Delete `.scaffoldix/state.json`
3. Re-run generation (loses history)

---

### INTERNAL_ERROR

**Exit Code:** 1

**When it happens:** An unexpected error occurred.

**Typical cause:**

- Bug in Scaffoldix
- Unexpected system state

**How to fix:**

1. Run with `--debug` flag for more information
2. Report the issue at https://github.com/scaffoldix/scaffoldix/issues
3. Include the full error output and debug logs

## Getting Debug Information

To see full stack traces and detailed error information:

```bash
scaffoldix generate --debug
```

This will show:

- Full stack traces
- Original error causes
- Internal state information

Use this when reporting bugs or troubleshooting complex issues.
