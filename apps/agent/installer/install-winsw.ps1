# Register the OrbitPC Agent as a real Windows service via WinSW.
# WinSW is a single-exe service wrapper; it reports SERVICE_RUNNING to the SCM
# (unlike sc.exe against a raw console node.exe, which cannot).
# Usage (elevated PowerShell):
#   .\install-winsw.ps1
param(
  [string]$InstallDir = "$env:ProgramData\OrbitPC\agent",
  [string]$NodePath   = "$env:ProgramFiles\nodejs\node.exe",
  [string]$WinSwUrl   = "https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW-x64.exe"
)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path $NodePath)) { throw "node.exe not found at $NodePath (Node 22+ required)" }
New-Item -ItemType Directory -Force -Path "$InstallDir\logs" | Out-Null

$zip = Join-Path $env:TEMP 'OrbitPC-build.zip'
Push-Location (Resolve-Path (Join-Path $PSScriptRoot '..\..\..'))
try {
  pnpm --filter @orbit/protocol build
  pnpm --filter @orbit/agent build
} finally { Pop-Location }

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..\..')
Copy-Item -Recurse -Force (Join-Path $repoRoot 'apps\agent\dist') $InstallDir
Copy-Item -Force (Join-Path $repoRoot 'apps\agent\package.json') $InstallDir

$winsw = Join-Path $InstallDir 'OrbitPCAgent.exe'
Invoke-WebRequest -Uri $WinSwUrl -OutFile $winsw
Copy-Item -Force (Join-Path $PSScriptRoot 'winsw.xml') (Join-Path $InstallDir 'OrbitPCAgent.xml')

& $winsw install
Write-Host "Installed OrbitPCAgent service. Start: & \"$winsw\" start  (or sc.exe start OrbitPCAgent)"
