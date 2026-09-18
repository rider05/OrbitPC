# Threat Model

Source: `plan.md` §4, §18. Review gate required before M3 beta and again before any file/screen/input work.

## Assumptions

- Owner controls both phone and PC; single-user, no sharing in MVP.
- Server is honest-but-curious relay: trusted for availability/ordering, not trusted to execute or to bypass agent allowlist.
- Attacker can: steal tokens, phish, replay traffic, DoS, compromise server, steal agent disk (without DPAPI key).
- Out of scope for MVP: E2E-encrypted command bodies, unattended remote input, multi-user sharing.

## Threats → mitigations

| Threat | Mitigation (implemented where) |
| --- | --- |
| Stolen mobile token | 10–15 min JWT, rotating refresh (hash stored), Keychain/Keystore only, revocation closes socket ≤60s, recent-auth for destructive |
| Account takeover | Argon2id, email verify, login throttle, TOTP later, audit alerts |
| Rogue pairing | Device-code flow, 5-min single-use, both-side confirm, no password on PC, pairing audit |
| Compromised server relay | TLS 1.2+, agent local allowlist wins, expiring commands, minimal secrets, hardened deploy; E2E signatures later |
| Malicious payload | Shared Zod, unknown-field reject, 64KB cap, explicit catalog, no shell-string concat, arg arrays only |
| Replay/duplicate | `commandId` + idempotency key + `expiresAt` + nonce/session binding, server+agent dedup |
| PC exposed inbound | Outbound-only WSS:443, no port forward, no TCP listener (named-pipe IPC only) |
| Agent credential theft | DPAPI/Credential Manager, Ed25519 proof, rotation/revocation, signed installer/updates only |
| DoS | Body/socket limits, per-command quotas, bounded queues, timeouts, backoff, monitoring |
| Sensitive logs | Redact tokens/secrets/clipboard/paths, 90-day retention, access-controlled audit |
| Unsafe files/screens | Deferred past MVP; later: folder roots, traversal reject, hash/quota/expiry, consent indicator |

## Do-not-do list

No `shell.execute`, no raw path from mobile (ID only), no UAC/secure-desktop bypass, no silent unsigned update, no plaintext WS, no skip-cert-verify flag, no sensitive data in push text, no auto-retry of destructive `uncertain` commands.

## Pre-release review checklist

Pairing (device-code + enrollment), session refresh + socket re-auth, agent enrollment/rotation, command auth matrix (owner/non-owner/expired/replayed/wrong-PC/revoked/offline-destructive), OS invocation (arg safety, Session 0 IPC ACL), update delivery/signing, backup/restore, revocation timing test.
