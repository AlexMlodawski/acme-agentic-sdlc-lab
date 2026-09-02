[CmdletBinding()]
param()

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
    $Uv = Get-Command uv -ErrorAction SilentlyContinue
    if ($null -eq $Uv) {
        throw "No package .venv was found and uv is not available. Run uv sync --locked first."
    }
    & $Uv.Source sync --locked --project $PackageRoot
    if ($LASTEXITCODE -ne 0) { throw "uv sync failed." }
    if (Test-Path $UnixPython) { $Python = $UnixPython } else { $Python = $WindowsPython }
}

& $Python (Join-Path $PSScriptRoot "validate_local.py")
if ($LASTEXITCODE -ne 0) { throw "Offline package validation failed." }

& $Python -m pytest (Join-Path $PackageRoot "tests")
if ($LASTEXITCODE -ne 0) { throw "Python tests failed." }

Write-Host "PASS: store_support_agent validation and tests completed without tenant access."
