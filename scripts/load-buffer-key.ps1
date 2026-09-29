# Loads BUFFER_API_KEY from the project .env into the current process
# environment without printing the value. Used so OpenCode's MCP server
# process can resolve {env:BUFFER_API_KEY} in opencode.json.
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
