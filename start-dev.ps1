$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendDir = Join-Path $root "backend"
$frontendDir = Join-Path $root "frontend"
$backendPython = Join-Path $backendDir "venv\Scripts\python.exe"

if (-not (Test-Path $backendPython)) {
  throw "Backend virtual environment topilmadi: $backendPython"
}

if (-not (Test-Path (Join-Path $frontendDir "package.json"))) {
  throw "Frontend package.json topilmadi: $frontendDir"
}

Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$backendDir'; & '$backendPython' -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$frontendDir'; npm run dev"

Write-Host "Backend va frontend alohida oynalarda ishga tushirildi."
Write-Host "Frontend odatda: http://localhost:5173"
Write-Host "Backend odatda: http://localhost:8000"
