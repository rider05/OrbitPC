# Remove the OrbitPC Agent service (does NOT delete pairing secrets).
param([switch]$DeleteSecrets)
$ErrorActionPreference = 'Stop'
sc.exe stop OrbitPCAgent 2>$null | Out-Null
Start-Sleep -Seconds 1
sc.exe delete OrbitPCAgent | Out-Null
if ($DeleteSecrets) {
  Remove-Item -Recurse -Force "$env:ProgramData\OrbitPC\agent" -ErrorAction SilentlyContinue
  Write-Host "Secrets and agent data removed."
}
Write-Host "Service removed."
