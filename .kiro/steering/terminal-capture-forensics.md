---
inclusion: manual
---

# Terminal Capture Forensics (archive)

Investigation record for a resolved defect. Load this only if terminal capture regresses:
truncated output, exit codes stuck at `1`, or results that look stale.

**Delete this file once terminal capture has been stable for a few months.** It exists
purely so the diagnosis does not have to be rediscovered.

## Root cause

The effective PowerShell `ExecutionPolicy` was `Restricted`, so `shellIntegration.ps1`
(unsigned) could not run. Kiro launches its shell with:

```
powershell.exe -noexit -command try { . "...\shellIntegration.ps1" } catch {}
```

The bare `catch {}` swallowed the failure silently. Nothing surfaced it anywhere.

One failure cascaded into three defects:

| Consequence | Symptom |
|---|---|
| No OSC 633 command-end markers | Kiro fell back to a **1000ms bounded output flush** as its completion signal → truncation |
| No `OSC 633;D;<code>` | `exitCode: "(undefined)"` → hardcoded `fallbackExitCode: 1` |
| Return fired before the command finished | read-before-write race → **false passes** |

The Kiro log at `%APPDATA%\Kiro\logs\<timestamp>\` stated it plainly:

```
[error] [Terminal] Shell integration timed out {"terminalId":1,"timeout":10000}
[info]  [Terminal] Output flush bounded timeout fired, reading current output
[info]  [Terminal] Command execution completed {"exitCode":"(undefined)","timedOut":false}
[info]  [Terminal] Exit code was undefined, using fallback {"fallbackExitCode":1}
```

Four dispatches returned 1007ms, 1004ms, 1007ms, and 1015ms after execution began.

## Fix

```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

Then restart Kiro. Shell integration is only attempted at shell startup.

## Verification, before and after

| Check | Before | After |
|---|---|---|
| Capture window | cut at ~930ms | 400 lines to t=6244ms + END marker |
| `pnpm test` direct | summary lost | `Test Files 21 passed (21)` / `Tests 208 passed (208)` |
| Exit code, success | 1 | 0 |
| 7-second command | returned at ~1s, kept running | waited the full 7s |
| Race | false pass reproducible | file present immediately on return |
| PSReadLine echo garbling | present | gone |

## Diagnosing a regression

1. `Get-ExecutionPolicy -List` — `CurrentUser` should be `RemoteSigned`. A corporate GPO
   on `MachinePolicy` or `UserPolicy` overrides it and silently restores the whole problem.
2. Grep the newest Kiro log for `Shell integration timed out`. Its presence means the
   fallback path is active.
3. Probe the session directly: `Get-Variable __VSCodeOriginalPrompt -Scope Global`. Absent
   means shell integration did not load.

## Dead ends, so they are not retried

- **No PSReadLine setting fixes the echo garbling.** The full `Set-PSReadLineOption`
  surface was enumerated; nothing controls rendering. Redraw-per-keystroke is by design
  ([issue #420](https://github.com/PowerShell/PSReadLine/issues/420)). The garbling turned
  out to be a downstream symptom and vanished when shell integration started working.
- **No Windows update helps.** Tested directly: the OS went 26100 → 26200 and Windows
  PowerShell 5.1.26100.8875 → .8894, while PSReadLine stayed at 2.0.0 and all three
  defects reproduced identically. Windows PowerShell 5.1 is frozen and permanently ships
  PSReadLine 2.0.0.
- **Upgrading PSReadLine would not have helped.** Bracketed paste requires the *terminal*
  to send `ESC[200~` markers; no such marker appeared in any captured output.

## Open Kiro bugs, not fixable locally

- Every dispatch logs `"timeout":null`. The `timeout` parameter of `execute_pwsh` does not
  reach the terminal layer, so it cannot bound a long-running command.
- The `catch {}` around shell integration startup hides a fatal misconfiguration. A warning
  there would have made this a one-minute diagnosis instead of a long investigation.
- Window-title OSC sequences leak into output as
  `:\WINDOWS\System32\WindowsPowerShell\v1.0\powershell.exe\` after native commands.
  Cosmetic; never appears in captured files.
