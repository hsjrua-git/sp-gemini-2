<#
  Student Panel - Windows bootstrap.

  Double-click setup.bat (which calls this), or run in PowerShell:
      powershell -ExecutionPolicy Bypass -File setup.ps1

  It elevates to Administrator, makes sure Node.js (>=20) and PostgreSQL are
  installed (via winget), then hands off to scripts\setup.mjs, which configures
  the database, builds the app, starts it, and opens your browser.
#>

$ErrorActionPreference = 'Stop'

# --- Re-launch elevated if we are not already Administrator ----------------
$principal = New-Object Security.Principal.WindowsPrincipal(
  [Security.Principal.WindowsIdentity]::GetCurrent())
$isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
  Write-Host "Requesting Administrator privileges..." -ForegroundColor Yellow
  $psi = "-NoExit -ExecutionPolicy Bypass -File `"$PSCommandPath`""
  Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $psi
  exit
}

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root
Write-Host ""
Write-Host "Student Panel - Windows bootstrap" -ForegroundColor Cyan
Write-Host "Project root: $Root"

# --- Helpers ---------------------------------------------------------------
function Test-Command($name) {
  return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

function Update-Path {
  # Reload PATH from the machine + user environment so freshly-installed tools
  # are visible without opening a new window.
  $machine = [System.Environment]::GetEnvironmentVariable('Path', 'Machine')
  $user    = [System.Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = "$machine;$user"
}

function Get-NodeMajor {
  if (-not (Test-Command node)) { return 0 }
  try {
    $v = (& node -v).TrimStart('v')   # e.g. 20.11.1
    return [int]($v.Split('.')[0])
  } catch { return 0 }
}

# --- winget ----------------------------------------------------------------
if (-not (Test-Command winget)) {
  Write-Host ""
  Write-Host "winget (the Windows Package Manager) was not found." -ForegroundColor Red
  Write-Host "Install 'App Installer' from the Microsoft Store, then re-run this script."
  Write-Host "Alternatively, install Node.js 20+ and PostgreSQL manually and run:"
  Write-Host "    node scripts\setup.mjs"
  Read-Host "Press Enter to exit"
  exit 1
}

# --- Node.js ---------------------------------------------------------------
if ((Get-NodeMajor) -lt 20) {
  Write-Host ""
  Write-Host "Installing Node.js LTS via winget..." -ForegroundColor Cyan
  winget install --exact --id OpenJS.NodeJS.LTS `
    --accept-package-agreements --accept-source-agreements
  Update-Path
}
if ((Get-NodeMajor) -lt 20) {
  Write-Host "Node.js 20+ is still not available on PATH." -ForegroundColor Red
  Write-Host "Close this window and run setup again (a fresh session picks up the new PATH)."
  Read-Host "Press Enter to exit"
  exit 1
}
Write-Host ("Node.js " + (& node -v) + " is ready.") -ForegroundColor Green

# --- PostgreSQL ------------------------------------------------------------
if (-not (Test-Command psql)) {
  Write-Host ""
  Write-Host "Installing PostgreSQL via winget..." -ForegroundColor Cyan
  Write-Host "The installer may ask you to set a password for the 'postgres' superuser."
  Write-Host "Remember it - the next step may ask for it to create the app database."
  winget install --exact --id PostgreSQL.PostgreSQL `
    --accept-package-agreements --accept-source-agreements
  Update-Path

  # winget may not add the PostgreSQL bin folder to PATH; find and add it.
  if (-not (Test-Command psql)) {
    $pg = Get-ChildItem 'C:\Program Files\PostgreSQL' -Directory -ErrorAction SilentlyContinue |
          Sort-Object Name -Descending | Select-Object -First 1
    if ($pg) {
      $bin = Join-Path $pg.FullName 'bin'
      if (Test-Path $bin) { $env:Path = "$bin;$env:Path" }
    }
  }
}
if (-not (Test-Command psql)) {
  Write-Host "PostgreSQL's psql is still not on PATH." -ForegroundColor Red
  Write-Host "Close this window and run setup again once installation has finished."
  Read-Host "Press Enter to exit"
  exit 1
}
Write-Host "PostgreSQL client (psql) is ready." -ForegroundColor Green

# --- Hand off to the cross-platform orchestrator ---------------------------
Write-Host ""
Write-Host "Handing off to the setup orchestrator..." -ForegroundColor Cyan
& node (Join-Path $Root 'scripts\setup.mjs')
$code = $LASTEXITCODE

Write-Host ""
if ($code -ne 0) { Write-Host "Setup exited with code $code." -ForegroundColor Yellow }
Read-Host "Press Enter to close this window"
exit $code
