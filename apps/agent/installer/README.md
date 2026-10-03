# OrbitPC Agent Installer

Registers `dist/service.js` as the `OrbitPCAgent` Windows service (auto-start,
SCM-managed restarts on failure). Sources build via pnpm and are copied to
`%ProgramData%\OrbitPC\agent`.

## Install (elevated)

```powershell
cd apps\agent
.\installer\install.ps1 -InstallDir "C:\ProgramData\OrbitPC\agent"
sc.exe start OrbitPCAgent
```

### Recommended: WinSW service wrapper

For a real Windows service (proper `SERVICE_RUNNING` reporting to the SCM):

```powershell
.\installer\install-winsw.ps1
```

This builds the agent, downloads `WinSW-x64.exe`, registers it as
`OrbitPCAgent.exe` with `OrbitPCAgent.xml` beside it, and installs the service.
Use this instead of `install.ps1` for production-like deployments.

### User-session helper (interactive ops outside Session 0)

```powershell
.\installer\install-helper-task.ps1
```

Registers a scheduled task that runs `dist/helper.js` at interactive logon with
highest privileges. The service forwards lock/clipboard/notification/capture
operations to this helper via named-pipe IPC (see `src/ipc.ts`).

## Uninstall

```powershell
.\installer\uninstall.ps1 [-DeleteSecrets]
```

## Notes / limitations

- The agent is a console Node process; under a real production rollout wrap it
  with WINSW (bundled here) or `node-windows` for proper SERVICE_RUNNING
  reporting — `sc.exe` accepts console apps for dev/personal deployments.
- Pairing secrets live in `%ProgramData%\OrbitPC\agent\secrets.json` today;
  wire Windows DPAPI (`secure-store.ts` TODO) before shipping beyond personal use.
- Session-0: interactive features (lock screen, toast, clipboard, screen
  capture) run in the user session via the helper IPC path; the service alone
  should no-op on them on a locked/blank screen.
