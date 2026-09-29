param([ValidateSet('Broker', 'Gate')][string]$Mode = 'Broker')

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Send-Closed($Value) {
  [Console]::Out.WriteLine(($Value | ConvertTo-Json -Compress -Depth 4))
  [Console]::Out.Flush()
}

if ($Mode -eq 'Gate') {
  try {
    $line = [Console]::In.ReadLine()
    if (-not $line -or $line.Length -gt 32768) { exit 2 }
    $request = $line | ConvertFrom-Json
    if (-not [IO.File]::Exists([string]$request.binary) -or
        -not [IO.Directory]::Exists([string]$request.cwd) -or
        $null -eq $request.args -or $request.args.Count -gt 64) { exit 2 }
    $start = [Diagnostics.ProcessStartInfo]::new()
    if ($null -eq $start.ArgumentList) { exit 2 }
    $start.FileName = [string]$request.binary
    $start.WorkingDirectory = [string]$request.cwd
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
    $start.RedirectStandardInput = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    foreach ($arg in $request.args) { [void]$start.ArgumentList.Add([string]$arg) }
    $process = [Diagnostics.Process]::Start($start)
    $process.StandardInput.Close()
    $stdoutDrain = $process.StandardOutput.BaseStream.CopyToAsync([IO.Stream]::Null)
    $stderrDrain = $process.StandardError.BaseStream.CopyToAsync([IO.Stream]::Null)
    Send-Closed @{ event = 'started'; pid = $process.Id }
    $process.WaitForExit()
    $stdoutDrain.GetAwaiter().GetResult()
    $stderrDrain.GetAwaiter().GetResult()
    exit $process.ExitCode
  } catch { exit 2 }
}

$native = @'
using System;
using System.Runtime.InteropServices;
public static class Phase49JobNative {
  [DllImport("kernel32.dll", SetLastError=true)] public static extern IntPtr CreateJobObject(IntPtr attributes, string name);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool SetInformationJobObject(IntPtr job, int kind, IntPtr info, uint length);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool QueryInformationJobObject(IntPtr job, int kind, IntPtr info, uint length, out uint returned);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool TerminateJobObject(IntPtr job, uint code);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool CloseHandle(IntPtr handle);
}
'@

function Get-JobMembers([IntPtr]$Job) {
  # JOBOBJECT_BASIC_PROCESS_ID_LIST (class 3): two DWORDs then ULONG_PTR[].
  for ($capacity = 16; $capacity -le 256; $capacity *= 2) {
    $length = 8 + ([IntPtr]::Size * $capacity)
    $buffer = [Runtime.InteropServices.Marshal]::AllocHGlobal($length)
    try {
      [Runtime.InteropServices.Marshal]::Copy([byte[]]::new($length), 0, $buffer, $length)
      $returned = [uint32]0
      $ok = [Phase49JobNative]::QueryInformationJobObject($Job, 3, $buffer, [uint32]$length, [ref]$returned)
      if (-not $ok) {
        $code = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
        if ($code -eq 234 -and $capacity -lt 256) { continue } # ERROR_MORE_DATA only
        throw 'JOB_PROCESS_QUERY_FAILED'
      }
      $assigned = [Runtime.InteropServices.Marshal]::ReadInt32($buffer, 0)
      $count = [Runtime.InteropServices.Marshal]::ReadInt32($buffer, 4)
      if ($count -lt 0 -or $assigned -lt $count -or $count -gt $capacity) { throw 'JOB_PROCESS_QUERY_INVALID' }
      if ($assigned -gt $count) { continue }
      $ids = @()
      for ($index = 0; $index -lt $count; $index++) {
        $offset = 8 + ($index * [IntPtr]::Size)
        $ids += [int][Runtime.InteropServices.Marshal]::ReadInt64($buffer, $offset)
      }
      return $ids
    } finally { [Runtime.InteropServices.Marshal]::FreeHGlobal($buffer) }
  }
  throw 'JOB_PROCESS_QUERY_LIMIT'
}

function Wait-IdsGone($Ids) {
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    $remaining = @($Ids | Where-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue })
    if ($remaining.Count -eq 0) { return $true }
    Start-Sleep -Milliseconds 125
  }
  return $false
}

$stage = 'initialize'
$job = [IntPtr]::Zero
$limit = [IntPtr]::Zero
$gate = $null
$assigned = $false
$closed = $false
try {
  if ([IntPtr]::Size -ne 8) { throw 'UNSUPPORTED_POINTER_SIZE' }
  Add-Type -TypeDefinition $native -ErrorAction Stop | Out-Null
  $stage = 'request'
  $line = [Console]::In.ReadLine()
  if (-not $line -or $line.Length -gt 32768) { throw 'REQUEST_INVALID' }
  $request = $line | ConvertFrom-Json
  if (-not [IO.File]::Exists([string]$request.binary) -or
      -not [IO.Directory]::Exists([string]$request.cwd) -or
      $null -eq $request.args -or $request.args.Count -gt 64) { throw 'REQUEST_INVALID' }
  $stage = 'create'
  $job = [Phase49JobNative]::CreateJobObject([IntPtr]::Zero, $null)
  if ($job -eq [IntPtr]::Zero) { throw 'JOB_CREATE_FAILED' }
  $stage = 'limit'
  # x64 JOBOBJECT_EXTENDED_LIMIT_INFORMATION is 144 bytes; LimitFlags is at 16.
  $limit = [Runtime.InteropServices.Marshal]::AllocHGlobal(144)
  [Runtime.InteropServices.Marshal]::Copy([byte[]]::new(144), 0, $limit, 144)
  [Runtime.InteropServices.Marshal]::WriteInt32($limit, 16, 0x2000) # KILL_ON_JOB_CLOSE
  if (-not [Phase49JobNative]::SetInformationJobObject($job, 9, $limit, 144)) { throw 'JOB_LIMIT_FAILED' }
  [Runtime.InteropServices.Marshal]::Copy([byte[]]::new(144), 0, $limit, 144)
  $returned = [uint32]0
  if (-not [Phase49JobNative]::QueryInformationJobObject($job, 9, $limit, 144, [ref]$returned) -or
      (([Runtime.InteropServices.Marshal]::ReadInt32($limit, 16) -band 0x2000) -eq 0)) {
    throw 'JOB_LIMIT_QUERY_FAILED'
  }
  $stage = 'gate'
  $start = [Diagnostics.ProcessStartInfo]::new()
  $start.FileName = (Get-Process -Id $PID).Path
  $start.ArgumentList.Add('-NoProfile')
  $start.ArgumentList.Add('-NonInteractive')
  $start.ArgumentList.Add('-WindowStyle')
  $start.ArgumentList.Add('Hidden')
  $start.ArgumentList.Add('-File')
  $start.ArgumentList.Add($PSCommandPath)
  $start.ArgumentList.Add('-Mode')
  $start.ArgumentList.Add('Gate')
  $start.UseShellExecute = $false
  $start.CreateNoWindow = $true
  $start.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
  $start.RedirectStandardInput = $true
  $start.RedirectStandardOutput = $true
  $start.RedirectStandardError = $true
  $gate = [Diagnostics.Process]::Start($start)
  $stage = 'assign'
  if (-not [Phase49JobNative]::AssignProcessToJobObject($job, $gate.Handle)) { throw 'JOB_ASSIGN_FAILED' }
  $assigned = $true
  $stage = 'launch'
  $gate.StandardInput.WriteLine($line)
  $gate.StandardInput.Flush()
  $started = $gate.StandardOutput.ReadLineAsync()
  if (-not $started.Wait(15000)) { throw 'JOB_LAUNCH_TIMEOUT' }
  $message = $started.Result | ConvertFrom-Json
  if ($message.event -ne 'started' -or [int]$message.pid -le 0) { throw 'JOB_LAUNCH_FAILED' }
  $backendPid = [int]$message.pid
  $stage = 'query'
  $members = @(Get-JobMembers $job)
  if ($members -notcontains $gate.Id -or $members -notcontains $backendPid) { throw 'JOB_MEMBERSHIP_INVALID' }
  Send-Closed @{ event = 'ready'; brokerPid = $PID; gatePid = $gate.Id; backendPid = $backendPid; memberCount = $members.Count }
  $stage = 'command'
  while ($true) {
    $commandTask = [Console]::In.ReadLineAsync()
    while (-not $commandTask.Wait(250)) {
      if ($gate.HasExited) { throw 'JOB_GATE_EARLY_EXIT' }
    }
    $command = $commandTask.Result
    if ($null -eq $command -or $command -eq 'stop') { break }
    if ($command -eq 'members') {
      $members = @(Get-JobMembers $job)
      Send-Closed @{ event = 'members'; pids = $members }
      continue
    }
    throw 'JOB_COMMAND_INVALID'
  }
  $stage = 'stop_query'
  $members = @(Get-JobMembers $job)
  $stage = 'close'
  if (-not [Phase49JobNative]::CloseHandle($job)) { throw 'JOB_CLOSE_FAILED' }
  $closed = $true
  $job = [IntPtr]::Zero
  $stage = 'observe'
  if (-not $gate.WaitForExit(5000) -or -not (Wait-IdsGone $members)) { throw 'JOB_TERMINATION_UNOBSERVED' }
  Send-Closed @{ event = 'stopped'; observed = $true; memberCount = $members.Count }
  exit 0
} catch {
  try { Send-Closed @{ event = 'failure'; stage = $stage; code = 'JOB_BROKER_FAILED' } } catch {}
  exit 1
} finally {
  if ($job -ne [IntPtr]::Zero) {
    if ($assigned) { [void][Phase49JobNative]::TerminateJobObject($job, 1) }
    [void][Phase49JobNative]::CloseHandle($job)
  }
  if ($gate -and -not $gate.HasExited) {
    try { $gate.Kill(); [void]$gate.WaitForExit(5000) } catch {}
  }
  if ($gate) { $gate.Dispose() }
  if ($limit -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::FreeHGlobal($limit) }
}
