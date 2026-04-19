$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendDir = Join-Path $root "backend"
$frontendDir = Join-Path $root "frontend"
$venvDir = Join-Path $backendDir "venv"
$pythonExe = Join-Path $venvDir "Scripts\python.exe"

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw "npm topilmadi. Node.js o'rnatilganiga va npm PATH ichida ekaniga ishonch hosil qiling."
}

$pythonCommand = Get-Command python -ErrorAction SilentlyContinue
if (-not $pythonCommand) {
  throw "python topilmadi. Python o'rnatilganiga va PATH ichida ekaniga ishonch hosil qiling."
}

if (-not (Test-Path (Join-Path $frontendDir "package.json"))) {
  throw "Frontend package.json topilmadi: $frontendDir"
}

if (-not (Test-Path (Join-Path $backendDir "requirements.txt"))) {
  throw "Backend requirements.txt topilmadi: $backendDir"
}

Write-Host "Frontend dependency o'rnatilishi boshlanmoqda..."
Push-Location $frontendDir
try {
  npm install
} finally {
  Pop-Location
}

Write-Host "Backend virtual environment tayyorlanmoqda..."
Push-Location $backendDir
try {
  & $pythonCommand.Source -m venv venv
  if (-not (Test-Path $pythonExe)) {
    throw "Virtual environment yaratildi, lekin python executable topilmadi: $pythonExe"
  }
  & $pythonExe -m pip install --upgrade pip
  & $pythonExe -m pip install -r requirements.txt
} finally {
  Pop-Location
}

Write-Host "Setup yakunlandi."
Write-Host "Keyingi qadam: .\\start-dev.ps1"
