<#
.SYNOPSIS
  Post-stack-deletion cleanup of Hecatoncheires RETAIN-policy resources.

.DESCRIPTION
  When a Hecatoncheires stack is deleted (or rolled back and deleted), a set of
  resources carry RemovalPolicy.RETAIN and survive the delete. Bedrock account-
  level invocation-logging config is account state and also survives. These
  orphans then block a fresh `cdk deploy` with "already exists" collisions.

  This script deletes those retained resources so the environment can be
  redeployed clean. It is idempotent: resources already gone are skipped, not
  treated as errors.

  Authored against commit: 4b915781edb0b785575de39f89ec2228e2d53233
  (short: 4b91578 — "docs(.initial-planning): refactor phase sequencing and
  keystone validation strategy")

  As the retained-resource set changes over time, extend the
  $RetainedResources / cleanup steps below and bump the commit stamp.

.PARAMETER Stage
  Deployment stage (e.g. "dev"). Drives resource name derivation.

.PARAMETER Account
  Target AWS account ID. Used for the S3 overflow bucket name.

.PARAMETER Region
  Target AWS region (e.g. "us-east-1").

.PARAMETER Profile
  AWS CLI profile to use for all calls.

.PARAMETER IncludeBedrockLoggingConfig
  Also delete the account-level Bedrock invocation-logging configuration.
  Off by default because it is account-wide state, not stack-scoped.

.PARAMETER WhatIf
  Report what would be deleted without deleting anything.

.EXAMPLE
  ./scripts/cleanup-retained-resources.ps1 -Stage dev -Account 723944466306 -Region us-east-1 -Profile temp-creds-1 -WhatIf

.EXAMPLE
  ./scripts/cleanup-retained-resources.ps1 -Stage dev -Account 723944466306 -Region us-east-1 -Profile temp-creds-1
#>

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Stage,
  [Parameter(Mandatory = $true)][string]$Account,
  [Parameter(Mandatory = $true)][string]$Region,
  [Parameter(Mandatory = $true)][string]$Profile,
  [switch]$IncludeBedrockLoggingConfig,
  [switch]$WhatIf
)

# Intentionally NOT 'Stop'. The AWS CLI writes to stderr for expected cases
# (e.g. ResourceNotFoundException on describe-table), and with 'Stop' that
# stderr text terminates the script. Native-command exit codes are checked
# explicitly via $LASTEXITCODE instead.
$ErrorActionPreference = 'Continue'

# --- Derived resource names (mirror NamingGenerator, packages/core) ---
$prefix          = "hecaton-$Stage"
$grantLedger     = "$prefix-grant-ledger"
$agentRegistry   = "$prefix-agent-registry"
$bedrockLogGroup = "/aws/bedrock/invocations/$Stage"
$overflowBucket  = "$prefix-bedrock-logs-overflow-$Account-$Region"

$common = @('--profile', $Profile, '--region', $Region)

function Write-Step  ($m) { Write-Host "==> $m" -ForegroundColor Cyan }
function Write-Skip  ($m) { Write-Host "    skip: $m" -ForegroundColor DarkGray }
function Write-Act   ($m) { Write-Host "    delete: $m" -ForegroundColor Yellow }
function Write-Done  ($m) { Write-Host "    done: $m" -ForegroundColor Green }

# Run an aws CLI call, returning $true on success. Any error is swallowed and
# reported so a missing resource never aborts the run.
#
# stderr is redirected to stdout at the process level (not via PowerShell's
# 2>&1 merge) so that CLI diagnostics — e.g. an expected ResourceNotFoundException
# from describe-table — do not trip $ErrorActionPreference = 'Stop'.
function Invoke-Aws {
  # NOTE: the parameter is CliArgs, not Args. `$Args` is an automatic variable
  # in PowerShell and cannot be used as a bound parameter name — it silently
  # binds to zero elements, which made every call run a bare `aws` and report
  # failure. See the ACTIVE-resources-reported-missing bug.
  param([string[]]$CliArgs, [switch]$Quiet)
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $out = & aws @CliArgs 2>&1 | Out-String
    $ok = $LASTEXITCODE -eq 0
  } finally {
    $ErrorActionPreference = $prev
  }
  if (-not $ok -and -not $Quiet) { Write-Host "    aws: $($out.Trim())" -ForegroundColor DarkGray }
  return $ok
}

Write-Host ""
Write-Host "Hecatoncheires retained-resource cleanup" -ForegroundColor White
Write-Host "  stage=$Stage account=$Account region=$Region profile=$Profile" -ForegroundColor White
if ($WhatIf) { Write-Host "  MODE: WhatIf (no deletions)" -ForegroundColor Magenta }
Write-Host ""

# --- DynamoDB tables (RemovalPolicy.RETAIN) ---
foreach ($table in @($grantLedger, $agentRegistry)) {
  Write-Step "DynamoDB table: $table"
  $exists = Invoke-Aws -Quiet -CliArgs (@('dynamodb', 'describe-table', '--table-name', $table) + $common)
  if (-not $exists) { Write-Skip "not present"; continue }
  if ($WhatIf) { Write-Act "$table (WhatIf)"; continue }
  Write-Act $table
  [void](Invoke-Aws -CliArgs (@('dynamodb', 'delete-table', '--table-name', $table) + $common))
  Write-Done "delete requested (async; table enters DELETING)"
}

# --- CloudWatch log group (RemovalPolicy.RETAIN) ---
Write-Step "CloudWatch log group: $bedrockLogGroup"
$lgJson = (& aws logs describe-log-groups --log-group-name-prefix $bedrockLogGroup @common 2>&1 | Out-String)
$lgExists = ($LASTEXITCODE -eq 0) -and ($lgJson -match [regex]::Escape($bedrockLogGroup))
if (-not $lgExists) {
  Write-Skip "not present"
} elseif ($WhatIf) {
  Write-Act "$bedrockLogGroup (WhatIf)"
} else {
  Write-Act $bedrockLogGroup
  [void](Invoke-Aws -CliArgs (@('logs', 'delete-log-group', '--log-group-name', $bedrockLogGroup) + $common))
  Write-Done "deleted"
}

# --- S3 overflow bucket (named bucket; RemovalPolicy.RETAIN) ---
Write-Step "S3 bucket: $overflowBucket"
$bucketExists = Invoke-Aws -Quiet -CliArgs @('s3api', 'head-bucket', '--bucket', $overflowBucket, '--profile', $Profile, '--region', $Region)
if (-not $bucketExists) {
  Write-Skip "not present"
} elseif ($WhatIf) {
  Write-Act "$overflowBucket (empty + delete) (WhatIf)"
} else {
  Write-Act "$overflowBucket (empty first, then delete)"
  # Buckets must be empty before deletion. `s3 rm --recursive` is a no-op on an
  # empty bucket, so this is safe even for a freshly created overflow bucket.
  [void](Invoke-Aws -CliArgs @('s3', 'rm', "s3://$overflowBucket", '--recursive', '--profile', $Profile, '--region', $Region))
  [void](Invoke-Aws -CliArgs @('s3api', 'delete-bucket', '--bucket', $overflowBucket, '--profile', $Profile, '--region', $Region))
  Write-Done "deleted"
}

# --- Account-level Bedrock invocation-logging config (opt-in) ---
Write-Step "Bedrock invocation-logging config (account-level state)"
if (-not $IncludeBedrockLoggingConfig) {
  Write-Skip "left in place (pass -IncludeBedrockLoggingConfig to remove)"
} elseif ($WhatIf) {
  Write-Act "delete-model-invocation-logging-configuration (WhatIf)"
} else {
  Write-Act "delete-model-invocation-logging-configuration"
  [void](Invoke-Aws -CliArgs (@('bedrock', 'delete-model-invocation-logging-configuration') + $common))
  Write-Done "cleared"
}

Write-Host ""
Write-Host "Cleanup pass complete." -ForegroundColor White
Write-Host "Note: DynamoDB deletes are async. Confirm with describe-table (expect ResourceNotFoundException) before redeploying." -ForegroundColor DarkGray
Write-Host ""
