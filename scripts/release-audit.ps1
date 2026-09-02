[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("Quick", "Full")]
    [string]$Mode,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$')]
    [string]$Candidate,

    [switch]$AllowDirty,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$npmArguments = @(
    "run",
    "release:audit",
    "--",
    "--mode",
    $Mode,
    "--candidate",
    $Candidate
)
if ($AllowDirty) {
    $npmArguments += "--allow-dirty"
}
if ($DryRun) {
    $npmArguments += "--dry-run"
}

Push-Location -LiteralPath $repositoryRoot
$auditExitCode = 1
try {
    if ($IsWindows -or $env:OS -eq "Windows_NT") {
        $commandProcessor = if ($env:ComSpec) { $env:ComSpec } else { $env:COMSPEC }
        if (-not $commandProcessor) {
            throw "ComSpec is required to invoke npm safely on Windows."
        }
        & $commandProcessor /d /s /c npm @npmArguments
    }
    else {
        & npm @npmArguments
    }
    $auditExitCode = $LASTEXITCODE
}
finally {
    Pop-Location
}

if ($auditExitCode -ne 0) {
    exit $auditExitCode
}
