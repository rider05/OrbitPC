# OrbitPC Agent — Windows Service installer
# Usage (elevated PowerShell):
#   .\install.ps1 -InstallDir "C:\OrbitPCAgent" -NodePath "C:\Program Files\nodejs\node.exe"
# Builds the agent, copies dist + assets, and registers a service:
#   sc.exe create OrbitPCAgent binPath= "...\node.exe\" \"...\dist\service.js\"" start= auto
param(
  [string]$InstallDir = "$env:ProgramData\OrbitPC\agent",
  [string]$NodePath   = "$env:ProgramFiles\nodejs\node.exe"
)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path $NodePath)) { throw "node.exe not found at $NodePath (Node 22+ required)" }

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..\..')
Push-Location $repoRoot
try {
  pnpm --filter @orbit/protocol build
  pnpm --filter @orbit/agent build
} finally { Pop-Location }

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
Copy-Item -Recurse -Force (Join-Path $repoRoot 'apps\agent\dist') $InstallDir
Copy-Item -Force (Join-Path $repoRoot 'apps\agent\package.json') $InstallDir

$bin = "`"$NodePath`" `"$InstallDir\dist\service.js`""
sc.exe create OrbitPCAgent binPath= $bin start= auto DisplayName= "OrbitPC Agent"
sc.exe description OrbitPCAgent "OrbitPC M2 agent: secure remote command relay (device credential + Ed25519 proof)."
sc.exe failure OrbitPCAgent reset= 86400 actions= restart/5000/restart/10000/restart/30000
Write-Host "Service registered. Start with: sc.exe start OrbitPCAgent"
Write-Host "Pair first on this box: node `"$InstallDir\dist\index.js`" --pair"
