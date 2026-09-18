# PC Agent Track Plan — Windows Agent (parallel-safe)

Companions: `plans/server-plan.md`, `plans/mobile-plan.md`. Source of truth: `plan.md` §9; contracts: `docs/protocol.md`, `docs/architecture.md`.

## 1. Goal / non-goals

Own WSS connectivity + safe local execution. Two processes (Session 0 split): `agent-service` (connectivity/enrollment/queue) + `agent-ui` tray helper per user session (execution/status). Never listen on TCP, never run as full admin, never build `shell.execute`, never concat shell strings, never bypass UAC.

## 2. Ownership (do not cross)

| Path | Owner |
| --- | --- |
| `apps/agent/**` | **agent (this track)** |
| `apps/server/**`, `infra/**`, `*.prisma` | server track only — do not touch |
| `apps/mobile/**` | mobile track only — do not touch |
| `packages/protocol/**` | FROZEN shared — consume only (see §3) |

Rules: no REST/DB schema changes from here. No server/mobile imports — only `packages/protocol` types. Credential + Ed25519 private key via DPAPI/Credential Manager, scoped to service identity; helper never holds long-lived secret.

## 3. Consumed contracts (no waiting)

Build against frozen server API + `docs/protocol.md` v1 from day one; use server's `mock-server` (canned `command.request` + auth) until staging is live:

- Pairing: `POST /v1/pairing-sessions/device-code` → show user code + QR of `pairingId` only → poll `GET .../status` with one-time secret → receive credential ID + credential on approval. Generate Ed25519 pair locally first, send `public_key` at enrollment.
- Sockets: outbound WSS:443, credential ID + Ed25519 nonce proof, short agent-token renewal without queue drop, `auth.refresh`, ping 20–30s, backoff 1s→60s jitter, heartbeat includes `bootId`/`bootTime` (`GetTickCount64` + boot time).
- Commands: validate `computerId` == self, ±30s skew, `expiresAt` enforced, `commandId` dedup persisted across restarts, unknown fields → `rejected`, per-command timeouts, ack-after-validate → `running` → final `sequence`d result. Destructive: flush-then-act best-effort, then `uncertain` until reconnect reconciles via new `bootId`.
- Protocol changes: never edit schemas locally to "make it work" — file RFC to server track.

## 4. Build order (agent-internal)

1. **Shell + IPC:** service skeleton (WSS lifecycle, token renewal, backoff) + named-pipe IPC (SDACL SYSTEM + user SID, command ID + nonce per message) + tray status/last-command/pairing/policy view + emergency disconnect. Prove service↔helper round-trip with fake command.
2. **Enrollment:** device-code UI, keypair gen, DPAPI store, rotation/revocation handlers, diagnostic bundle (redacted, opt-in export).
3. **Dispatcher:** `CommandDispatcher` (validate/dedup/queue/timeout/route) + `PolicyEngine` (default-deny, local authoritative) + `AuditWriter` rotation + persisted completed-ID store.
4. **M2a adapters (`WindowsAdapter`):** `system.getStatus` (battery/CPU/RAM/hostname/uptime + bootId, 5s cache), `system.lock` (`LockWorkStation`), `app.launch` single allowlisted ID → resolve path locally, arg-array spawn, no raw args.
5. **M2b adapters:** `notification.show` (toast, ≤200 chars), `clipboard.setText` (≤4KB, opt-in flag), `system.sleep` / `restart` / `shutdown` (pre-flush result, abort toast where supported, `ExitWindowsEx`/`shutdown.exe` via safe APIs, no string concat).
6. **Hardening:** least-privilege check (no admin), pipe ACL test, fuzz schemas, replay/expired/duplicate tests, kill-socket/Wi-Fi/reboot/upgrade drills on disposable VM only.

## 5. Parallel integration points

- Weekly: run server contract tests + staging E2E (`getStatus` → `lock` → `launch`); report only `INVALID_ARGUMENT`/`COMMAND_NOT_ALLOWED` mismatches, don't patch server types locally.
- Provide `mock-status` payload so mobile can render dashboard before live agent exists.

## 6. Exit criteria

- M1: device-code pair, presence + bootId live, revocation wipes credential + closes socket, audit visible.
- M2a: getStatus/lock/1-app launch from different network with correct history.
- M2b: destructive shows `uncertain` → boot-ID verified, quotas/timeouts hold, no replay executes twice.
- Never merged: arbitrary shell, raw-path launch, inbound listener, unsigned auto-update.

## 7. Conflict checklist (before every merge)

- [ ] Only `apps/agent/**` touched?
- [ ] No protocol/REST/DB edits?
- [ ] IPC ACL + DPAPI scoping intact?
- [ ] Dedup store + `uncertain` path tested?
