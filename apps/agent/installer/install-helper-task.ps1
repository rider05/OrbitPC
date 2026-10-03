# Launch the OrbitPC user-session helper at every interactive logon.
# The helper hosts interactive-only operations (clipboard, notification,
# screen capture) outside the Session-0 service process.
param(
  [string]$InstallDir = "$env:ProgramData\OrbitPC\agent",
  [string]$NodePath   = "$env:ProgramFiles\nodejs\node.exe"
)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path (Join-Path $InstallDir 'dist\helper.js'))) { throw "helper.js missing under $InstallDir\dist" }
$action = New-ScheduledTaskAction -Execute $NodePath -Argument "\"$InstallDir\dist\helper.js\""
$trigger = New-ScheduledTaskTrigger -AtLogOn
Register-ScheduledTask -TaskName 'OrbitPCHelper' -Action $action -Trigger $trigger -RunLevel Highest -Force | Out-Null
Write-Host 'OrbitPCHelper scheduled task created (on logon, highest privileges).'
