[CmdletBinding()]
param(
    [string]$ModelId = "groq/openai/gpt-oss-120b",
    [string]$OutputPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$PackageRoot = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    $OutputPath = Join-Path $PackageRoot "agents/store_support_agent.yaml"
}

$UnixPython = Join-Path $PackageRoot ".venv/bin/python"
$WindowsPython = Join-Path $PackageRoot ".venv/Scripts/python.exe"
if (Test-Path $UnixPython) {
    $Python = $UnixPython
} elseif (Test-Path $WindowsPython) {
    $Python = $WindowsPython
} else {
    $Uv = Get-Command uv -ErrorAction SilentlyContinue
    if ($null -eq $Uv) {
        throw "No package .venv was found and uv is not available. Run uv sync --locked first."
    }
    & $Uv.Source run --locked --project $PackageRoot python `
        (Join-Path $PSScriptRoot "materialize_agent.py") `
        --model-id $ModelId --output $OutputPath
    if ($LASTEXITCODE -ne 0) { throw "Agent materialization failed." }
    exit 0
}

& $Python (Join-Path $PSScriptRoot "materialize_agent.py") `
    --model-id $ModelId --output $OutputPath
if ($LASTEXITCODE -ne 0) { throw "Agent materialization failed." }
