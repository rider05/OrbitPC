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
