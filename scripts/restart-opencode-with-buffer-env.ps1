# Loads BUFFER_API_KEY from .env into this process (without printing it),
# then restarts the OpenCode background service so the MCP server process
# inherits the variable and can resolve {env:BUFFER_API_KEY}.
$line = Get-Content .env -ErrorAction Stop |
  Where-Object { $_ -match '^\s*BUFFER_API_KEY\s*=' } |
  Select-Object -Last 1
if (-not $line) {
  'BUFFER_API_KEY entry not found in .env'
  exit 1
}
$value = ($line -split '=', 2)[1].Trim().Trim('"', "'")
if ([string]::IsNullOrWhiteSpace($value)) {
  'BUFFER_API_KEY entry is empty'
  exit 1
}
[Environment]::SetEnvironmentVariable('BUFFER_API_KEY', $value, 'Process')
'BUFFER_API_KEY loaded into process environment'
opencode service restart
