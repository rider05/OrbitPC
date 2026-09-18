# Mobile Track Plan — React Native App (parallel-safe)

Companions: `plans/server-plan.md`, `plans/pc-agent-plan.md`. Source of truth: `plan.md` §10; contracts: `docs/protocol.md`, `docs/architecture.md`.

## 1. Goal / non-goals

Own sign-in → pair → dashboard → confirm → history UX. Works offline-first (cached `last-updated` + foreground refetch), never claims success optimistically, never stores tokens outside secure storage, never puts sensitive details in push text. No file/screen/input work in MVP.

## 2. Ownership (do not cross)

| Path | Owner |
| --- | --- |
| `apps/mobile/**` | **mobile (this track)** |
| `apps/server/**`, `infra/**`, `*.prisma` | server track only — do not touch |
| `apps/agent/**` | agent track only — do not touch |
| `packages/protocol/**` | FROZEN shared — consume only (see §3) |

Rules: no API/DB/socket-shape changes from here — request via server RFC. No hardcoded secrets. Tokens in iOS Keychain / Android Keystore-backed storage (expo-secure-store), never AsyncStorage. Only `packages/protocol` types shared.

## 3. Consumed contracts (no waiting)

Build against frozen REST/socket + `mock-server`/`mock-agent` from server track until staging live:

- Auth: `POST /auth/register|login|refresh|logout|reauthenticate`; 10–15 min access, rotating refresh; recent-auth (10-min) gate for destructive + pairing confirm.
- Pairing: scan QR (contains `pairingId` only) or enter user code → show PC name + account + expiry → `POST /v1/pairing-sessions/:id/confirm` → receive opaque `computerId` + metadata only (never agent credential).
- Commands: `POST /computers/:id/commands` with client-generated `commandId` + `idempotencyKey`; poll `GET /commands/:id` + socket `command.result` (`sequence`-ordered); cursor replay on reconnect. Quotas/errors per `docs/protocol.md` (`COMPUTER_OFFLINE`, `COMMAND_EXPIRED`, … with friendly copy).
- Sockets: JWT in auth payload, `auth.refresh` on rotation, rooms `user:{id}`; heartbeat drives Online/Offline/last-seen + `bootId` display; push later = opaque ("open app"), details via HTTPS.

## 4. Build order (mobile-internal)

1. **Shell + auth:** onboarding/sign-in, session mgmt, secure-store wrapper, logout/revoke, foreground refetch + `last-updated` pattern.
2. **Pair:** camera-permission-at-use QR scanner + manual code entry, confirmation sheet (PC name/account/expiry), error states (expired/used/pairing-failed).
3. **Dashboard M2a:** computer list (online/offline/last-seen/bootId), status cards, `getStatus` (5s cache note), `lock` (tap → Sending → authoritative state), single approved `app.launch` button (by ID, no path shown).
4. **M2b safety UX:** destructive confirm sheets + recent-auth prompt, `sleep/restart/shutdown` `uncertain` banner ("verifying via reboot") with boot-ID resolution, `notification.show` (≤200) + opt-in `clipboard.setText` (≤4KB) forms with quota errors, command-detail timeline + safe-retry (same key, idempotent only — never retry destructive `uncertain`).
5. **History/settings:** paginated commands/audit (cursor, not page numbers), rename computer, notification pref, revoke computer/session, account security. Offline/error copy pass + redacted logging.

## 5. Parallel integration points

- Daily: run against server `mock-server` + contract fixtures; weekly staging E2E with real agent (M2a first, M2b after server/agent signal ready).
- Provide UI-state fixtures (`Online`, `Offline`, `Uncertain`) so server/agent can verify error-code copy without mobile branch access.

## 6. Exit criteria

- M1: sign-in → scan → confirm → paired list with trustworthy presence, revocation works from app.
- M2a: getStatus/lock/launch across networks, no optimistic success, history correct.
- M2b: destructive gates + `uncertain` flow correct, quotas surfaced friendly, no token in logs/storage audit.
- Never merged: raw-path launch, sensitive push payloads, tokens in AsyncStorage/logs.

## 7. Conflict checklist (before every merge)

- [ ] Only `apps/mobile/**` touched?
- [ ] No protocol/REST/socket edits?
- [ ] Secure-store + opaque-push rules intact?
- [ ] Destructive never auto-retries?
