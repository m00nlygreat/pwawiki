$ErrorActionPreference = "SilentlyContinue"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$url = "http://127.0.0.1:4173/index.html?v=20260522-10"

try {
  Invoke-WebRequest -UseBasicParsing $url -TimeoutSec 1 | Out-Null
} catch {
  Start-Process -FilePath "python" -ArgumentList @("-m", "http.server", "4173") -WorkingDirectory $root -WindowStyle Hidden
  Start-Sleep -Milliseconds 800
}

Start-Process $url
