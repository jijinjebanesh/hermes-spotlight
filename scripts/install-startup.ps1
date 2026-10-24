#requires -version 5.1
<#
.SYNOPSIS
    Registers (or removes) the Hermes Spotlight startup entry.

.DESCRIPTION
    Creates a shortcut in the current user's Startup folder that runs
    start-hermes.vbs through wscript.exe. The entry appears in
    Settings > Apps > Startup as "Hermes Spotlight".

.PARAMETER Uninstall
    Remove the startup shortcut instead of creating it.

.PARAMETER RemoveLegacy
    Also remove superseded Hermes startup entries:
      * Startup\start-hermes-overlay.vbs
      * Startup\start-hermes-gateway.vbs
      * HKCU Run value "electron.app.Electron" (old dev-mode overlay)
    The hermes-window shortcuts are left untouched.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\scripts\install-startup.ps1 -RemoveLegacy
#>
[CmdletBinding()]
param(
    [switch]$Uninstall,
    [switch]$RemoveLegacy
)

$ErrorActionPreference = 'Stop'

$startupDir = [Environment]::GetFolderPath('Startup')
$shortcutPath = Join-Path $startupDir 'Hermes Spotlight.lnk'
$launcherVbs = Join-Path $PSScriptRoot 'start-hermes.vbs'
$launcherPs1 = Join-Path $PSScriptRoot 'start-hermes.ps1'
$appExe = Join-Path $env:LOCALAPPDATA 'Programs\hermes-spotlight\Hermes Spotlight.exe'

if ($Uninstall) {
    if (Test-Path -LiteralPath $shortcutPath) {
        Remove-Item -LiteralPath $shortcutPath -Force
        Write-Host "Removed startup shortcut: $shortcutPath"
    } else {
        Write-Host "Startup shortcut not found: $shortcutPath"
    }
    exit 0
}

foreach ($file in @($launcherVbs, $launcherPs1)) {
    if (-not (Test-Path -LiteralPath $file)) {
        throw "Missing launcher file: $file"
    }
}

if (-not (Test-Path -LiteralPath $startupDir)) {
    New-Item -ItemType Directory -Path $startupDir -Force | Out-Null
}

$wscript = Join-Path $env:WINDIR 'System32\wscript.exe'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)

$shortcut.TargetPath = $wscript
$shortcut.Arguments = '"{0}"' -f $launcherVbs
$shortcut.WorkingDirectory = $PSScriptRoot
$shortcut.Description = 'Starts the Hermes gateway and Hermes Spotlight at sign-in'
$shortcut.WindowStyle = 1

if (Test-Path -LiteralPath $appExe) {
    $shortcut.IconLocation = '{0},0' -f $appExe
}

$shortcut.Save()

if ($RemoveLegacy) {
    foreach ($name in @('start-hermes-overlay.vbs', 'start-hermes-gateway.vbs')) {
        $legacyPath = Join-Path $startupDir $name
        if (Test-Path -LiteralPath $legacyPath) {
            Remove-Item -LiteralPath $legacyPath -Force
            Write-Host "Removed legacy startup entry: $name"
        }
    }

    $runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
    try {
        $runValues = Get-ItemProperty -Path $runKey -ErrorAction Stop
        if ($null -ne $runValues.PSObject.Properties['electron.app.Electron']) {
            Remove-ItemProperty -Path $runKey -Name 'electron.app.Electron' -Force
            Write-Host 'Removed legacy Run value: electron.app.Electron'
        }
    } catch {
        Write-Host ("Could not inspect legacy Run key: {0}" -f $_.Exception.Message)
    }
}

$registered = $shell.CreateShortcut($shortcutPath)
Write-Host ''
Write-Host "Registered startup entry: $shortcutPath"
Write-Host ("  Runs: {0} {1}" -f $registered.TargetPath, $registered.Arguments)
Write-Host ("  App:  {0}" -f $appExe)
Write-Host ''
Write-Host 'Disable it in Settings > Apps > Startup, or run:'
Write-Host ("  powershell -ExecutionPolicy Bypass -File `"{0}`" -Uninstall" -f $PSCommandPath)
