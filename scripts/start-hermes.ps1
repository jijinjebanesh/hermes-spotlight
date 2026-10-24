#requires -version 5.1
<#
.SYNOPSIS
    Starts the Hermes gateway (if needed) and the Hermes Spotlight app.

.DESCRIPTION
    Designed to run at sign-in from the Windows Startup folder. It is
    idempotent: if the gateway or the app is already running, it leaves it
    alone. The app is launched with --hidden so it waits in the tray/global
    hotkey instead of popping open on every login.

.PARAMETER ShowWindow
    Launch Hermes Spotlight with its window visible instead of --hidden.

.PARAMETER SkipGateway
    Do not start the Hermes gateway; only launch the app.

.PARAMETER GatewayTimeoutSeconds
    Startup deadline passed to `hermes gateway ensure` (default 60).

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\scripts\start-hermes.ps1 -ShowWindow
#>
[CmdletBinding()]
param(
    [switch]$ShowWindow,
    [switch]$SkipGateway,
    [int]$GatewayTimeoutSeconds = 60
)

$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
$hermesHome = if ($env:HERMES_HOME) { $env:HERMES_HOME } else { Join-Path $env:LOCALAPPDATA 'hermes' }
$logDir = Join-Path $env:LOCALAPPDATA 'Hermes Spotlight\logs'
$logPath = Join-Path $logDir 'startup.log'

if (-not (Test-Path -LiteralPath $logDir)) {
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
}

function Write-Log {
    param([string]$Message)

    $line = '{0}  {1}' -f (Get-Date).ToString('yyyy-MM-dd HH:mm:ss'), $Message
    try {
        if ((Test-Path -LiteralPath $logPath) -and ((Get-Item -LiteralPath $logPath).Length -gt 1MB)) {
            Move-Item -LiteralPath $logPath -Destination ($logPath + '.1') -Force
        }
        Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8
    } catch {
        # Startup must never fail because logging failed.
    }
}

function Test-GatewayRunning {
    try {
        $processes = Get-CimInstance -ClassName Win32_Process `
            -Filter "Name='python.exe' OR Name='pythonw.exe' OR Name='hermes.exe'" `
            -ErrorAction Stop

        foreach ($process in $processes) {
            if ($process.CommandLine -and $process.CommandLine -match 'hermes_cli\.main\s+gateway\s+run') {
                return $true
            }
        }
    } catch {
        Write-Log ("Could not inspect gateway processes: {0}" -f $_.Exception.Message)
    }
    return $false
}

function Wait-ForGateway {
    param(
        [int]$TimeoutSeconds,
        [System.Diagnostics.Process]$Process
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        if (Test-GatewayRunning) { return 'ready' }
        # If `gateway ensure` already gave up, stop waiting and try the
        # fallback immediately instead of burning the whole timeout.
        if ($Process -and $Process.HasExited) { return 'exited' }
        Start-Sleep -Milliseconds 1000
    }

    if (Test-GatewayRunning) { return 'ready' }
    return 'timeout'
}

function Start-LegacyGateway {
    $legacyGateway = Join-Path $hermesHome 'gateway-service\Hermes_Gateway.cmd'
    if (-not (Test-Path -LiteralPath $legacyGateway)) {
        Write-Log ("Gateway runtime script not found: {0}" -f $legacyGateway)
        return $null
    }

    try {
        Write-Log 'Starting gateway via Hermes_Gateway.cmd.'
        return Start-Process -FilePath $env:ComSpec `
            -ArgumentList @('/c', ('"{0}"' -f $legacyGateway)) `
            -WindowStyle Hidden -PassThru
    } catch {
        Write-Log ("Gateway launch failed: {0}" -f $_.Exception.Message)
        return $null
    }
}

function Start-Gateway {
    # Prefer the local runtime script generated in HERMES_HOME: it sets the
    # environment up explicitly and works even when the optional Windows
    # service registration is disabled or stale.
    $process = Start-LegacyGateway
    if ($process) { return $process }

    $hermesExe = Join-Path $hermesHome 'bin\hermes.exe'

    if (Test-Path -LiteralPath $hermesExe) {
        try {
            Write-Log 'Starting Hermes gateway with "hermes gateway ensure".'
            $stdout = Join-Path $logDir 'gateway.out.log'
            $stderr = Join-Path $logDir 'gateway.err.log'
            $arguments = @('gateway', 'ensure', '--timeout', [string]$GatewayTimeoutSeconds)

            $ensure = Start-Process -FilePath $hermesExe -ArgumentList $arguments `
                -WindowStyle Hidden -PassThru `
                -RedirectStandardOutput $stdout -RedirectStandardError $stderr

            Write-Log ("Gateway ensure launched (PID {0})." -f $ensure.Id)
            return $ensure
        } catch {
            Write-Log ("gateway ensure failed to launch: {0}" -f $_.Exception.Message)
        }
    } else {
        Write-Log ("hermes.exe not found at {0}" -f $hermesExe)
    }

    return $null
}

function Test-AppRunning {
    return [bool](Get-Process -Name 'Hermes Spotlight' -ErrorAction SilentlyContinue)
}

function Resolve-AppExecutable {
    $candidates = @()

    if ($env:HERMES_SPOTLIGHT_EXE) {
        $candidates += $env:HERMES_SPOTLIGHT_EXE
    }

    $candidates += (Join-Path $env:LOCALAPPDATA 'Programs\hermes-spotlight\Hermes Spotlight.exe')
    $candidates += (Join-Path $projectRoot 'release\win-unpacked\Hermes Spotlight.exe')

    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate)) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }

    return $null
}

Write-Log '--- Hermes startup launcher begin ---'

try {
    $gatewayProcess = $null

    if ($SkipGateway) {
        Write-Log 'Gateway start skipped (-SkipGateway).'
    } elseif (Test-GatewayRunning) {
        Write-Log 'Gateway already running; leaving it alone.'
    } else {
        $gatewayProcess = Start-Gateway
        if (-not $gatewayProcess) {
            Write-Log 'WARNING: could not launch the Hermes gateway.'
        }
    }

    if (Test-AppRunning) {
        Write-Log 'Hermes Spotlight already running; leaving it alone.'
    } else {
        $appExe = Resolve-AppExecutable
        if (-not $appExe) {
            Write-Log 'ERROR: Hermes Spotlight executable not found. Install it or set HERMES_SPOTLIGHT_EXE.'
            exit 1
        }

        $appDir = Split-Path -Parent $appExe
        if ($ShowWindow) {
            Start-Process -FilePath $appExe -WorkingDirectory $appDir | Out-Null
            Write-Log ("Launched (visible): {0}" -f $appExe)
        } else {
            Start-Process -FilePath $appExe -ArgumentList '--hidden' -WorkingDirectory $appDir | Out-Null
            Write-Log ("Launched (hidden): {0}" -f $appExe)
        }
    }

    # Give the gateway a bounded amount of time to come up, but do it after the
    # app has launched so a slow gateway never delays the overlay.
    if ($gatewayProcess) {
        $waitSeconds = [Math]::Min($GatewayTimeoutSeconds + 5, 90)
        $outcome = Wait-ForGateway -TimeoutSeconds $waitSeconds -Process $gatewayProcess

        if ($outcome -eq 'ready') {
            Write-Log 'Gateway is ready.'
        } elseif ($outcome -eq 'exited') {
            # Give a successfully-started runtime a moment to show up before
            # assuming `gateway ensure` failed.
            $grace = Wait-ForGateway -TimeoutSeconds 3 -Process $null

            if ($grace -eq 'ready') {
                Write-Log 'Gateway is ready.'
            } else {
                Write-Log 'Gateway launcher exited without a running gateway; trying the fallback.'
                $fallback = Start-LegacyGateway

                if ($fallback) {
                    $fallbackOutcome = Wait-ForGateway -TimeoutSeconds 20 -Process $fallback
                    if ($fallbackOutcome -eq 'ready') {
                        Write-Log 'Gateway is ready via fallback.'
                    } else {
                        Write-Log ("ERROR: gateway fallback did not become ready ({0})." -f $fallbackOutcome)
                    }
                } else {
                    Write-Log 'ERROR: gateway fallback could not be started.'
                }
            }
        } else {
            Write-Log ("WARNING: gateway still starting after {0}s; not starting a second one." -f $waitSeconds)
        }
    }

    exit 0
} catch {
    Write-Log ("ERROR: {0}" -f $_.Exception.Message)
    exit 1
}
