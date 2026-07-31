<#
.SYNOPSIS
  Launch a long-running command fully DETACHED from the calling process tree, or poll one.

.DESCRIPTION
  Claude Code background Bash tasks are reaped (tool timeout is capped at 600000 ms, and the
  session's job object takes the whole tree down with it). This launcher hands the command to
  the WMI provider host via Win32_Process.Create, so the new process is parented to WmiPrvSE.exe
  -- NOT to the caller, NOT in the caller's job object. Killing the session cannot touch it.

  ponytail: cmd.exe does the redirection and the exit-code marker natively, so there is no
  wrapper node/pwsh process and no polling daemon. Upgrade path if a run ever needs to survive
  a reboot or a logoff: swap Win32_Process.Create for `schtasks /create /sc once`.

.PARAMETER Command
  The command line to run, verbatim, as cmd.exe would see it. Required for -Mode Launch.

.PARAMETER WorkDir
  Working directory for the child. Defaults to packages/backend.

.PARAMETER Label
  Short slug used in the log/pid filenames. Default 'run'.

.PARAMETER Status
  Path to a .pid file (or its run id). Prints RUNNING / FINISHED / DIED and exits.

.EXAMPLE
  pwsh -NoProfile -File scripts\launch-detached.ps1 -Label eval -Command 'node .\scripts\run-eval-golden.mjs --skill cockpit-agent@16'

.EXAMPLE
  pwsh -NoProfile -File scripts\launch-detached.ps1 -Status C:\...\.eval-runs\eval-20260731-153000.pid
#>
[CmdletBinding(DefaultParameterSetName = 'Launch')]
param(
  [Parameter(ParameterSetName = 'Launch', Mandatory)][string]$Command,
  [Parameter(ParameterSetName = 'Launch')][string]$WorkDir = (Split-Path $PSScriptRoot -Parent),
  [Parameter(ParameterSetName = 'Launch')][string]$Label = 'run',
  [Parameter(ParameterSetName = 'Status', Mandatory)][string]$Status
)

$ErrorActionPreference = 'Stop'
$runDir = Join-Path (Split-Path $PSScriptRoot -Parent) '.eval-runs'

# ---------------------------------------------------------------- status mode
if ($PSCmdlet.ParameterSetName -eq 'Status') {
  $pidFile = if (Test-Path $Status) { $Status } else { Join-Path $runDir "$Status.pid" }
  if (-not (Test-Path $pidFile)) { Write-Output 'NOPID'; exit 3 }

  $meta    = Get-Content $pidFile -Raw | ConvertFrom-Json
  $logFile = $meta.log
  $proc    = Get-Process -Id $meta.pid -ErrorAction SilentlyContinue

  # StartTime guards against PID reuse handing us an unrelated process.
  $alive = $proc -and $proc.ProcessName -eq 'cmd' -and
           ([Math]::Abs(($proc.StartTime - [datetime]$meta.started).TotalSeconds) -lt 10)

  $tail = if (Test-Path $logFile) { Get-Content $logFile -Tail 3 } else { @() }
  $done = $tail | Select-String -Pattern '^__EXIT__=(\d+)' | Select-Object -Last 1

  if ($alive) {
    $age  = [int]((Get-Date) - [datetime]$meta.started).TotalSeconds
    $size = if (Test-Path $logFile) { (Get-Item $logFile).Length } else { 0 }
    Write-Output "RUNNING pid=$($meta.pid) age=${age}s logBytes=$size log=$logFile"
    exit 0
  }
  if ($done) {
    Write-Output "FINISHED pid=$($meta.pid) exit=$($done.Matches[0].Groups[1].Value) log=$logFile"
    exit 0
  }
  Write-Output "DIED pid=$($meta.pid) (process gone, no __EXIT__ marker) log=$logFile"
  exit 1
}

# ---------------------------------------------------------------- launch mode
New-Item -ItemType Directory -Force -Path $runDir | Out-Null
$stamp   = Get-Date -Format 'yyyyMMdd-HHmmss'
$runId   = "$Label-$stamp"
$logFile = Join-Path $runDir "$runId.log"
$pidFile = Join-Path $runDir "$runId.pid"

# cmd.exe gives us stdout+stderr redirection and the exit code for free. The `&` chain runs
# the marker append unconditionally, so a crash still lands a __EXIT__ line.
#
# Two cmd.exe traps are deliberately dodged here -- both were observed failing in testing:
#   1. `echo __EXIT__=%ERRORLEVEL%>> file` parses as `0>>` (redirect stdin) when the exit code
#      starts the token, so the marker silently vanished. The redirect goes FIRST instead.
#   2. cmd expands %VAR% for the WHOLE line at parse time, so %ERRORLEVEL% would always read
#      the value from before the command ran. /v:on + !ERRORLEVEL! defers it to execution.
if ($Command -like '*!*') {
  throw "Command contains '!', which cmd /v:on would eat. Wrap the run in a .cmd/.mjs file instead."
}
$inner   = "$Command > `"$logFile`" 2>&1 & >>`"$logFile`" echo __EXIT__=!ERRORLEVEL!"
$cmdLine = "$env:ComSpec /v:on /c `"$inner`""

$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
  CommandLine      = $cmdLine
  CurrentDirectory = $WorkDir
}
if ($r.ReturnValue -ne 0) { throw "Win32_Process.Create failed with ReturnValue=$($r.ReturnValue)" }

# StartTime must come from the OS, not Get-Date, so the status check can compare exactly.
$proc = Get-Process -Id $r.ProcessId
[pscustomobject]@{
  pid     = $r.ProcessId
  runId   = $runId
  log     = $logFile
  started = $proc.StartTime.ToString('o')
  command = $Command
  workdir = $WorkDir
} | ConvertTo-Json | Set-Content -Path $pidFile -Encoding utf8

Write-Output "LAUNCHED pid=$($r.ProcessId) runId=$runId"
Write-Output "log=$logFile"
Write-Output "pid=$pidFile"
