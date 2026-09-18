# Server Track Plan — Express Relay (parallel-safe)

Companions: `plans/pc-agent-plan.md`, `plans/mobile-plan.md`. Source of truth for scope: `plan.md`; contracts: `docs/protocol.md`, `docs/architecture.md`.

## 1. Goal / non-goals

Build the public control plane: auth, device-code pairing, computer/command/audit REST, WSS relay + presence, policy cache, rate limits, observability, deploy. Never executes PC actions, never opens agent sockets as public proxies, never stores file/screen bytes in MVP.

## 2. Ownership (do not cross)

| Path | Owner |
| --- | --- |
| `apps/server/**`, `apps/server/prisma/**` | **server (this track)** |
| `infra/docker/**`, `infra/caddy/**` | server |
| `packages/protocol/**` | FROZEN shared — no direct edit in parallel phase (see §3) |
| `apps/agent/**` | agent track only — do not touch |
| `apps/mobile/**` | mobile track only — do not touch |

Rules: only server migrates DB. Only server defines REST/socket shapes; others consume. No import from agent/mobile code — only `packages/protocol` types.

## 3. Frozen contracts (parallel enabler)

After M0 freeze, all tracks build against these without waiting:

- `docs/protocol.md` v1 envelopes, statuses, error codes (`AUTH_REQUIRED`, `NOT_OWNER`, `COMPUTER_OFFLINE`, …), quotas.
- REST (from `plan.md` §13): `POST /auth/*`, `GET/PATCH/DELETE /computers/:id`, `POST /v1/pairing-sessions/device-code`, `GET /v1/pairing-sessions/:id/status`, `POST /v1/pairing-sessions/:id/confirm`, `POST /computers/:id/commands` (idempotency key), `GET /commands/:id`, `GET /computers/:id/commands`, `GET /computers/:id/audit-events`.
- Socket: rooms `computer:{id}` / `user:{id}`, events `command.request` / `command.result` (with `sequence`), `auth.refresh`, `presence.heartbeat` (incl. `bootId`), server time authoritative (±30s skew, 60s expiry).
- Protocol change process: open RFC in `packages/protocol`, bump `v`, keep `v-1` parser one release, fail-closed compat test. No silent schema edits during M1/M2.

## 4. Build order (server-internal)

1. **M0 foundation:** monorepo + TS/lint/CI, Postgres + Compose, Prisma models (`users`, `user_sessions`, `computers`, `computer_credentials`, `pairing_sessions`, `command_policies`, `commands`, `command_events`, `audit_events`), `GET /v1/health`, seed + migration rollback test.
2. **Auth:** Argon2id, email verify placeholder, 10–15 min JWT + rotating refresh (hash stored), `reauthenticate` (10-min window), throttling, revocation → socket close ≤60s.
3. **Pairing:** device-code issue/poll/confirm, 5-min single-use, bind `computer.owner_user_id`, issue credential ID + store hash only, record Ed25519 `public_key`.
4. **Sockets:** mobile JWT handshake + `auth.refresh` re-auth; agent credential ID + Ed25519 nonce proof + short agent token renewal; heartbeat 20–30s, offline ~75s, `bootId` tracking.
5. **M2a commands:** persist-before-emit, unique `(requester_session_id, idempotencyKey)`, `system.getStatus` (1/5s), `system.lock` (1/10s), `app.launch` by ID (10/hr). Offline destructive → `COMPUTER_OFFLINE`; never queue destructive offline.
6. **M2b commands:** `sleep` (3/hr), `restart/shutdown` (confirm + recent-auth, 2/hr, `timed_out` → mobile `uncertain`), `notification.show` (≤200 chars, 10/hr), `clipboard.setText` (≤4KB opt-in, 10/hr). Server policy view = display cache; local agent deny always wins.
7. **M3 hardening:** Helmet/CSP/CORS/body limits, per-account/IP limits, redacted JSON logs, metrics/alerts, backup/restore drill, Caddy TLS, secret-manager wiring.

## 5. Parallel integration points (no blocking)

- Provide **mocks first:** Postman/seed script + `mock-agent` (replays canned `command.result` sequences) so mobile/agent integrate without live peers.
- Contract tests owned here, runnable by all: schema reject-unknown-fields, 64KB cap, replay/expired/future-dated → `COMMAND_EXPIRED`, wrong-PC → `NOT_OWNER`, revoked session → disconnect ≤60s.
- Integration env: staging domain + tunnel; agent/mobile point at it, never at each other's branches.

## 6. Exit criteria

- M1: pair without PC password, presence trustworthy, revocation closes sockets, audit complete.
- M2a: getStatus/lock/1-app launch E2E across networks with history.
- M2b: destructive with `uncertain` + boot-ID reconcile, quotas enforced, redaction verified.
- M3: beta-ready with monitoring, backups, runbook drill (`docs/runbook.md`).

## 7. Conflict checklist (before every merge)

- [ ] Only touched owned paths?
- [ ] No `packages/protocol` edit without RFC + version bump?
- [ ] No migration conflict (`prisma migrate diff` clean)?
- [ ] Contract tests green?
