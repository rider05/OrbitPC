# OrbitPC — Build Status (auto-generated snapshot)

Generated without a live Node/pnpm/Docker environment, so this reflects source
tree presence, not compiled green builds.

## Built
- Monorepo foundation (`apps/server`, `apps/agent`, `apps/mobile`,
  `packages/protocol`, `packages/config`, `packages/protocol-alias`).
- M1 auth: register/login/refresh/logout/reauthenticate; Argon2id; short JWT;
  refresh rotation; reauth gate.
- Pairing: device-code pairing, QR preview, mobile confirm, credential issue +
  rotation, server stores only hash.
- Presence: `/v1/computers/:id/heartbeat` + `/v1/computers/:id/pending` poll
  relay, WSS `/agent` relay.
- M2a/M2b commands: `system.getStatus`, `system.lock`, `system.sleep`,
  `system.restart`, `system.shutdown`, `app.launch`, `notification.show`,
  `clipboard.setText` (local agent policy + quotas + idempotency + uncertain
  destructive timeout state).
- M3 Stage 1/2 remote screen: `screen.capture` snapshot command and
  ScreenStreamer emitting `screen.frame` over WSS/Socket.IO.
- Mobile UI aligned with plan §28; non-M2 surfaces are explicit placeholders.
- Agent service: `dist/service.js` entrypoint, `installer/install.ps1`,
  `installer/uninstall.ps1`, WinSW wrapper config +
  `installer/install-winsw.ps1`, helper scheduled task config.
- Secure store on Windows wraps `secrets.json` with DPAPI; plaintext fallback
  outside Windows/CI.
- Basic nearby scaffolding: LAN listener + mDNS + nearby auth token + BLE
  advertise (all opt-in).
- Tests: server app/security/e2e/realtime/rateLimit, agent unit + connection
  integration, protocol schema, mobile lib tests.

## Not built / post-MVP
- Real Windows Service packaging (MSI/MSIX, signing, auto-update).
- Session-0 user-session helper running lock/clipboard/capture outside the
  service process.
- WebRTC media path + TURN/STUN + adaptive quality.
- `input.mouse`/`input.keyboard`, touchpad/keyboard UI, gesture profiles.
- `file.list`/`upload`/`download` with approved folders + quotas.
- `audio.start`/`stop`, PC-audio capture/streaming.
- Multi-monitor detection, per-monitor stream, combined view.
- BLE command transport (GATT), not just advertisement/auth.
- Tray UI in Windows, mobile PC Card CPU/RAM/connection badges, full audit
  viewer screen.
- CI execution of realtime/security/e2e tests inside the PR pipeline.
