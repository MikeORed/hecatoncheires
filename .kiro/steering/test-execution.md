---
inclusion: manual
---

# Test Execution

Terminal capture is trustworthy. Shell integration works, `execute_pwsh` blocks until the
command actually finishes, and the exit code is reliable for pass/fail. Two caveats:

**Exit codes are a boolean, not the real number.** `0` for success, `1` for any failure —
`cmd /c exit 7` reports `1`. If an exact code matters, read `$LASTEXITCODE`, which is
accurate inside the session.

**Redirect progress-heavy output to a file.** The capture does not collapse cursor-control
escapes, so every progress frame from a TTY-aware tool accumulates. A direct `pnpm test`
exceeds the 30,000 character tool limit with repeated vitest tables. Use the helper, which
makes vitest detect a non-TTY and emit compact output:

```powershell
powershell -ExecutionPolicy Bypass -File .kiro\scripts\run-and-capture.ps1 -Command "pnpm test" -Id "{id}"
```

Pick a fresh 4-hex-char `{id}`, then read `.test-output-{id}.tmp` and
`.test-exit-code-{id}.tmp`, and delete both plus `.test-done-{id}.tmp` afterwards. Confirm
verdicts against the summary lines (`Test Files`, `Tests`) as well as the exit code.

Short commands, builds, lint, and git can run directly.

**If truncation or constant exit codes of `1` ever return**, this is a known regression
with a known cause. Run `Get-ExecutionPolicy -List` and load
`#terminal-capture-forensics` for the diagnosis.
