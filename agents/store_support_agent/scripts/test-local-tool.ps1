[CmdletBinding()]
param(
    [string]$BaseUrl = "http://127.0.0.1:4000"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$PackageRoot = Split-Path -Parent $PSScriptRoot
$UnixPython = Join-Path $PackageRoot ".venv/bin/python"
$WindowsPython = Join-Path $PackageRoot ".venv/Scripts/python.exe"

if (Test-Path $UnixPython) {
    $Python = $UnixPython
} elseif (Test-Path $WindowsPython) {
    $Python = $WindowsPython
} else {
    throw "Package .venv not found. Run uv sync --locked in $PackageRoot first."
}

& $Python (Join-Path $PSScriptRoot "test_local_tool.py") --base-url $BaseUrl
if ($LASTEXITCODE -ne 0) { throw "Local tool integration test failed." }
