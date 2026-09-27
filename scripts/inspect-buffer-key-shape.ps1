# Reports only shape metadata about BUFFER_API_KEY in .env (never the value),
# to diagnose a 401 from Buffer without exposing the secret.
$line = Get-Content .env -ErrorAction Stop |
  Where-Object { $_ -match '^\s*BUFFER_API_KEY\s*=' } |
  Select-Object -Last 1
if (-not $line) {
  'BUFFER_API_KEY entry not found in .env'
  exit 1
}
$raw = ($line -split '=', 2)[1]
$value = $raw.Trim().Trim('"', "'")
'length=' + $value.Length
'raw-had-surrounding-whitespace=' + ($raw -ne $raw.Trim())
'raw-was-quoted=' + ($raw.Trim().StartsWith('"') -or $raw.Trim().StartsWith("'"))
'value-contains-inner-whitespace=' + ($value -match '\s')
'value-contains-curly-braces=' + ($value -match '[{}]')
