# Remote PC Control

Personal remote-control system: a mobile app securely issues allowlisted actions to the owner's Windows PC via an Express relay. The PC agent holds an outbound WSS connection; the PC is never exposed inbound.

See `plan.md` for the full implementation plan (source of truth for scope and security decisions).

## Repo layout (target)

```text
remote-pc-control/
  apps/
    server/   # Express API + socket relay
    agent/    # Windows agent (service + user-session helper + tray)
    mobile/   # React Native + Expo app
  packages/
    protocol/ # Zod schemas, message/event types, error codes
    config/   # shared TS/lint config
  infra/
    docker/   # Compose for server/postgres/redis
    caddy/    # TLS reverse-proxy config
  docs/
    architecture.md
    threat-model.md
    protocol.md
    runbook.md
  plan.md
```

## MVP scope

- Pair one PC via device-code flow (PC shows code/QR, signed-in app approves). No password typed on PC.
- See online/offline/last-seen + boot ID.
- M2a: `system.getStatus`, `system.lock`, one approved `app.launch`.
- M2b: `system.sleep`, `system.restart`/`system.shutdown` (confirm + recent-auth), `notification.show`, opt-in `clipboard.setText`.
- Never: `shell.execute`, remote desktop/input, inbound PC ports, UAC bypass.

## Docs

- `docs/architecture.md` — components, message paths, agent service/helper split.
- `docs/protocol.md` — v1 envelopes, error codes, catalog + quotas, delivery rules.
- `docs/threat-model.md` — threats, mitigations, review gate.
- `docs/runbook.md` — dev/prod ops, incidents, release checklist.

## Realtime relay (M3)

- Agent WSS: `wss://<host>/agent?computerId=<id>` with `Authorization: Bearer <device credential>`.
  Heartbeat (`presence.heartbeat`/`pong`), pending command push on connect + on submit,
  result ingestion (persisted like the REST relay, then hinted to the owner), `revoked` close.
- Mobile hint channel: socket.io namespace `/socket`, JWT handshake auth, `auth.refresh` re-auth,
  `command.result` hints. HTTPS polling remains authoritative (plan.md §6).
- Rate limit: baseline 300 req/min per IP; tighter per-action and login limits apply.
- Refresh-token reuse revokes the session immediately and closes its sockets.
- Revocation (`DELETE /computers/:id`, logout) closes the relevant sockets immediately.

## Dev (once M0 lands)

1. `docker compose -f infra/docker/compose.yml up postgres redis`
2. `pnpm install && pnpm dev`
3. Server health: `GET /v1/health`
4. Never commit secrets; use host secret manager / `.env` (gitignored).

## Security rules

- Default deny everywhere; double validation (server + agent local policy wins).
- Short JWT (10–15 min) + rotating refresh; DPAPI for agent secret; Ed25519 key proof.
- Revocation must close sockets ≤60s. Destructive commands are `uncertain` until boot-ID reconciliation — never auto-retry.
