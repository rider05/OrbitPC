@echo off
REM run.bat — one-click "run it all" for OrbitPC (Windows cmd).
REM Mirrors the verified pipeline: install, build, typecheck, lint, test,
REM mobile track, prisma, then server + agent smoke tests.
REM Usage:
REM   run.bat                 full pipeline + smoke tests
REM   run.bat --checks-only   skip runtime smoke tests
REM   run.bat --no-mobile     skip the Expo mobile track
REM   run.bat --help          usage
setlocal EnableExtensions
cd /d "%~dp0"

set CHECKS_ONLY=0
set NO_MOBILE=0
if /i "%~1"=="--checks-only" set CHECKS_ONLY=1
if /i "%~1"=="--no-mobile" set NO_MOBILE=1
if /i "%~2"=="--no-mobile" set NO_MOBILE=1
if /i "%~1"=="--help" goto :usage
if /i "%~1"=="-h" goto :usage

echo ============================================
echo  OrbitPC - run it all
echo  root: %CD%
echo ============================================

echo.
echo [0/9] prerequisites...
call node --version
if errorlevel 1 goto :fail
call pnpm --version
if errorlevel 1 goto :fail
call docker --version >nul 2>&1
if errorlevel 1 (
  echo   WARN: docker not found - DB containers will be skipped.
) else (
  echo   docker present.
)

echo.
echo [1/9] pnpm install...
call pnpm install --prefer-offline
if errorlevel 1 goto :fail

echo.
echo [2/9] build (all workspaces)...
call pnpm -r build
if errorlevel 1 goto :fail

echo.
echo [3/9] typecheck (all workspaces)...
call pnpm -r typecheck
if errorlevel 1 goto :fail

echo.
echo [4/9] lint (all workspaces)...
call pnpm -r lint
if errorlevel 1 goto :fail

echo.
echo [5/9] test (all workspaces: protocol 11, server 4, agent 9)...
call pnpm -r test
if errorlevel 1 goto :fail

if "%NO_MOBILE%"=="1" (
  echo.
  echo [6/9] mobile - SKIPPED ^(--no-mobile^).
) else (
  echo.
  echo [6/9] mobile track - npm install + typecheck + test...
  pushd apps\mobile
  call npm install --prefer-offline --no-audit --no-fund
  if errorlevel 1 (
    popd
    goto :fail
  )
  call npm run typecheck
  if errorlevel 1 (
    popd
    goto :fail
  )
  call npm run test
  if errorlevel 1 (
    popd
    goto :fail
  )
  popd
)

echo.
echo [7/9] prisma validate + generate...
if not defined DATABASE_URL set "DATABASE_URL=postgresql://orbit:orbit_dev_pw@localhost:5432/orbit?schema=public"
call pnpm --filter ./apps/server exec prisma validate
if errorlevel 1 goto :fail
call pnpm --filter ./apps/server db:generate
if errorlevel 1 goto :fail

echo.
echo [8/9] docker status (warn-only, daemon often stopped on dev boxes)...
call docker info >nul 2>&1
if errorlevel 1 (
  echo   SKIP: Docker daemon not running. Start Docker Desktop, then:
  echo     docker compose -f infra/docker/compose.yml up postgres redis
) else (
  call docker compose -f infra/docker/compose.yml ps
)

if "%CHECKS_ONLY%"=="1" (
  echo.
  echo [9/9] smoke tests - SKIPPED ^(--checks-only^).
  goto :pass
)

echo.
echo [9/9] smoke tests: server health + agent mock-server...
echo   -- server: start on :3000, probe /health and /v1/health --
powershell -NoProfile -Command "$job = $null; try { $job = Start-Job -ScriptBlock { Set-Location -LiteralPath '%~dp0apps\server'; node dist/server.js }; Start-Sleep -Seconds 4; $h1 = Invoke-RestMethod -Uri 'http://localhost:3000/health' -TimeoutSec 5; if (-not $h1.ok) { throw 'bad /health payload' }; $v1 = Invoke-RestMethod -Uri 'http://localhost:3000/v1/health' -TimeoutSec 5; if ($v1.service -ne 'orbit-server') { throw 'bad /v1/health payload' }; Write-Output ('server OK: ' + ($h1 | ConvertTo-Json -Compress) + ' service=' + $v1.service) } catch { Write-Output ('SERVER_SMOKE_FAIL: ' + $_.Exception.Message); if ($job) { Receive-Job $job 2>&1 | Select-Object -Last 10 }; exit 1 } finally { if ($job) { Stop-Job $job; Remove-Job $job -Force } }"
if errorlevel 1 goto :fail

echo   -- agent: --mock-server boots, runs M2a sequence (getStatus/lock/launch) --
powershell -NoProfile -Command "$job = $null; try { $job = Start-Job -ScriptBlock { Set-Location -LiteralPath '%~dp0apps\agent'; $env:ORBITPC_MOCK_PORT='4455'; node dist/index.js --mock-server }; Start-Sleep -Seconds 6; $o = Receive-Job $job 2>&1 | Out-String; Write-Output $o; if ($o -notmatch 'mock-server') { throw 'no mock-server banner' }; if ($o -notmatch 'succeeded') { throw 'no succeeded results' } } catch { Write-Output ('AGENT_SMOKE_FAIL: ' + $_.Exception.Message); exit 1 } finally { if ($job) { Stop-Job $job; Remove-Job $job -Force } }"
if errorlevel 1 goto :fail

:pass
echo.
echo ============================================
echo  ALL GREEN.
echo  Next: pnpm dev:server  +  pnpm --filter @orbit/agent dev:mock
echo  DB:   docker compose -f infra/docker/compose.yml up postgres redis
echo ============================================
endlocal
exit /b 0

:fail
echo.
echo *** FAILED - see step above. Fix and re-run run.bat ***
endlocal
exit /b 1

:usage
echo Usage: run.bat [--checks-only] [--no-mobile]
echo   no args        full pipeline + server/agent smoke tests
echo   --checks-only  skip runtime smoke tests
echo   --no-mobile    skip the Expo mobile track
endlocal
exit /b 0
