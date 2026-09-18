# Architecture

Source: `plan.md` §3–§6, §9, §11–§12, §14. This file is the build reference; `plan.md` wins on conflict.

## Components

```text
Mobile (RN/Expo) --HTTPS/WSS--> Express (HTTPS/WSS, Postgres) <--WSS outbound-- PC agent (Windows)
```

- **Server:** auth, pairing, computers, commands, sockets, audit. Never executes PC actions. Stateless except Postgres (+ optional Redis for pub/sub, rate limits, presence when scaled).
- **Agent (Windows):** two processes due to Session 0 isolation:
  - `agent-service` (SYSTEM/service account): WSS lifecycle, enrollment, queue, DPAPI credential store, forwards validated commands over IPC.
  - `agent-ui` (per logged-in user, tray): executes `lock`, `app.launch`, `notification.show`, `clipboard.setText`, collects status. Shows status/last command/pairing/policies + emergency disconnect.
  - IPC: named pipe, SDACL = SYSTEM + logged-in user SID only, per-message command ID + nonce, no TCP listener.
- **Mobile:** sign-in, computer list, QR pair, dashboard, confirmations, history. HTTPS for fetch, WSS for live state, secure-store tokens only, opaque push.

## Message path

1. Mobile authenticates (HTTPS), opens WSS with access token, re-auths on refresh via `auth.refresh`.
2. Agent opens outbound WSS:443 with credential ID + Ed25519 nonce proof, renews short-lived agent token without dropping queue.
3. App `POST /computers/:id/commands` with idempotency key → server checks ownership, pairing, schema, rate limit, confirmation/recent-auth, computer online (destructive rejected offline) → persists `commands` row → emits to `computer:{id}` room.
4. Agent validates (computerId match, fresh timestamp, not finished, server identity), checks local PolicyEngine (authoritative), dispatches via helper, acks → `running` → final `command.result` with monotonic `sequence`.
5. Server stores `command_events`, forwards to `user:{id}`, mobile reconciles via `GET /commands/:id` or cursor replay.

## Trust boundaries

- Server never trusts client-claimed PC ID; derives from session + DB.
- Agent never trusts server alone; rechecks schema + local allowlist immediately before exec.
- Sockets bound to exactly one `userSession` or `computer`; later messages cannot change identity.
- Server time authoritative; allow ±30s skew, enforce `expiresAt` (default 60s).

## Data

Postgres tables: `users`, `user_sessions` (refresh hash), `computers` (incl. `public_key`, `boot_id`, `last_seen_at`), `computer_credentials` (hash only), `pairing_sessions` (secret hash, 5-min), `command_policies`, `commands` (unique `(requester_session_id, idempotency_key)`), `command_events` (unique `(command_id, sequence)`), `audit_events`. Redact args/results in logs; encrypt at rest via managed Postgres.

## Scaling

MVP: single Express instance. Later: Socket.IO Redis adapter, Redis presence/rate limits, sticky sessions, Postgres as truth. Media (WebRTC/TURN) stays out of MVP.
