<#
.SYNOPSIS
    Runs a command and writes output + exit code to temp files for reliable agent consumption.

.DESCRIPTION
    The IDE's execute_pwsh capture returns after a hard ~900ms window from dispatch,
    regardless of whether the command has finished. It also reports a constant exit
    code of 1. This script bypasses both problems by writing results to disk, which
    the agent reads via read_file.

    CRITICAL: because the harness returns early, the agent MUST NOT read the output
    file until the DONE sentinel exists. The sentinel is written last and is the only
    valid completion signal. Stale files from prior runs are deleted up front so a
    missing sentinel can never be confused with a finished run.

    Completion protocol for the agent:
      1. Invoke this script.
      2. Poll .test-done-{Id}.tmp with read_file until it exists.
      3. Only then read .test-output-{Id}.tmp and .test-exit-code-{Id}.tmp.

.PARAMETER Command
    The command string to execute (e.g., "pnpm test", "pnpm build").

.PARAMETER Id
    A short unique suffix for temp file naming (e.g., "a3f7"). Prevents collisions
    when multiple agents run concurrently.

.PARAMETER WorkDir
    Optional working directory. Defaults to the current directory.

.OUTPUTS
    Writes three files in WorkDir:
      .test-output-{Id}.tmp    — combined stdout+stderr
      .test-exit-code-{Id}.tmp — numeric exit code (0 = success)
      .test-done-{Id}.tmp      — completion sentinel, written LAST

.EXAMPLE
    .\.kiro\scripts\run-and-capture.ps1 -Command "pnpm test" -Id "a3f7"
#>

param(
    [Parameter(Mandatory = $true)]
    [string]$Command,

    [Parameter(Mandatory = $true)]
    [string]$Id,

    [Parameter(Mandatory = $false)]
    [string]$WorkDir = $PWD.Path
)

$outputFile   = Join-Path $WorkDir ".test-output-$Id.tmp"
$exitCodeFile = Join-Path $WorkDir ".test-exit-code-$Id.tmp"
$doneFile     = Join-Path $WorkDir ".test-done-$Id.tmp"

# Delete any stale artifacts from a previous run with this Id BEFORE doing anything
# else. Without this, an agent that reads too early sees the previous run's results
# and can report a false pass.
Remove-Item $outputFile, $exitCodeFile, $doneFile -Force -ErrorAction SilentlyContinue

Push-Location $WorkDir

# Do not let a stderr-writing native command throw; we want to capture, not abort.
$ErrorActionPreference = 'Continue'

$output   = ''
$exitCode = 0

try {
    # Reset so we can tell whether the command actually set an exit code.
    $global:LASTEXITCODE = $null

    $output = Invoke-Expression "$Command 2>&1" | Out-String
    $nativeCode = $LASTEXITCODE
    $cmdletOk = $?

    if ($null -ne $nativeCode) {
        # A native process ran; its exit code is authoritative.
        $exitCode = [int]$nativeCode
    }
    elseif (-not $cmdletOk) {
        # Pure PowerShell pipeline that failed without setting an exit code.
        $exitCode = 1
    }
    else {
        $exitCode = 0
    }
}
catch {
    # A terminating error still has to produce a sentinel, otherwise the agent
    # polls forever with no way to distinguish "running" from "crashed".
    $output   += "`n[run-and-capture] TERMINATING ERROR: $($_.Exception.Message)`n"
    $exitCode  = 1
}
finally {
    Pop-Location

    # Order matters: payload files first, sentinel last.
    $output   | Out-File -FilePath $outputFile   -Encoding utf8
    "$exitCode" | Out-File -FilePath $exitCodeFile -Encoding utf8
    "exit=$exitCode" | Out-File -FilePath $doneFile -Encoding utf8

    # These lines are usually lost to the ~900ms capture window. The agent relies on
    # the sentinel file, not on this output.
    Write-Host "OUTPUT_FILE=$outputFile"
    Write-Host "EXIT_CODE_FILE=$exitCodeFile"
    Write-Host "DONE_FILE=$doneFile"
    Write-Host "EXIT_CODE=$exitCode"
}
