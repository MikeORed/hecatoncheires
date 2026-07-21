---
inclusion: always
---

# Test Execution Protocol

## Problem

The agent's terminal capture on Windows/PowerShell garbles output and may report
incorrect exit codes (e.g., exit 1 when tests actually passed). The agent MUST NOT
trust raw `execute_pwsh` output or exit codes for test validation.

## Standard: File-Based Test Output

When running tests or build commands where pass/fail matters, use this pattern:

1. **Generate a short random suffix** (4 hex chars, e.g., `a3f7`) to use in filenames.
   This prevents collisions when multiple agents run concurrently.

2. Run the command with output redirected to uniquely-named temp files:

```powershell
pnpm test 2>&1 | Out-File -FilePath .test-output-{id}.tmp -Encoding utf8; echo $LASTEXITCODE | Out-File -FilePath .test-exit-code-{id}.tmp -Encoding utf8
```

Replace `{id}` with the chosen suffix (e.g., `.test-output-a3f7.tmp`).

3. Read the output files using `read_file` (reliable, never garbled):
   - `.test-output-{id}.tmp` — full test runner output
   - `.test-exit-code-{id}.tmp` — actual numeric exit code (`0` = pass)

4. Interpret results from the file content, not from the terminal capture.

5. Clean up temp files after reading:

```powershell
Remove-Item ".test-output-{id}.tmp", ".test-exit-code-{id}.tmp" -ErrorAction SilentlyContinue
```

## Concurrency Safety

Each agent session MUST pick its own unique suffix before executing. The agent knows
the suffix it chose, so it can read back the correct files without ambiguity. Two
agents running tests simultaneously will write to different files (e.g.,
`.test-output-a3f7.tmp` vs `.test-output-c9e1.tmp`) with no collision.

## File Location

Temp files are written to the working directory of the command (typically the package
root, e.g., `packages/core/`). Read them relative to that location.

## File Naming Convention

| File | Purpose |
|------|---------|
| `.test-output-{id}.tmp` | Stdout + stderr from the most recent test run |
| `.test-exit-code-{id}.tmp` | Numeric exit code on a single line |

These files are gitignored via `*.tmp` in the root `.gitignore`.

## When to Use This Protocol

- Any `vitest`, `jest`, or test runner invocation where the agent needs to verify pass/fail
- Any build command (`tsc`, `pnpm build`) where exit code drives decision-making
- Lint commands where the agent needs to parse specific errors

## When NOT Needed

- Simple file operations, directory listings, or git commands
- Commands where the agent does not need to interpret output (fire-and-forget)

## When the User Provides Terminal Output

If the user pastes terminal output directly in chat, trust that over any prior
garbled agent-captured output. The user's terminal is authoritative.

## Known Noise

PowerShell's `2>&1` capture produces a `NativeCommandError` / `CategoryInfo` block
for commands that write to stderr (pnpm's `$ vitest run` line triggers this). This is
harmless — look for the actual test summary lines (`Test Files`, `Tests`, `Duration`)
to determine results.
