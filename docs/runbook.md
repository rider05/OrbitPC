# Runbook

Source: `plan.md` §19–§20, §24. Keep this current once deployed; test revocation paths before trusting remotely.

## Environments

- **Dev:** `docker compose` for server + Postgres (+ Redis if used); agent/mobile run natively. Use HTTPS tunnel/staging domain for real phone tests. Separate dev/prod credentials.
- **Prod/personal beta:** Express behind Caddy/Nginx (auto-TLS, HTTP→HTTPS, HSTS), managed Postgres with encrypted automated backups + tested restore. Expose only 443. Secrets via host secret manager, never git. Signed versioned agent installers with changelog + rollback.

## Health / monitoring

- Logs: JSON with `requestId`, `commandId`, `computerId`, outcome, latency, error code. No tokens/secrets/clipboard/paths.
- Metrics: agents online, reconnects, command latency/success by name, auth failures, pairing failures, queue depth.
- Alerts: auth anomaly, error spike, revocation use, backup failure, cert expiry, downtime.
- Agent diagnostic bundle: redacted, requires explicit user approval to export.

## Offline / error states

`Online` (heartbeat) / `Offline` (show last-seen) / `Connecting` / `Action queued` / `Needs retry` (same idempotency key, safe only) / `Uncertain` (destructive timeout — show state, verify via boot ID, never blind retry). Destructive rejected offline with `COMPUTER_OFFLINE`. Expiry default 60s. Cleanup job for expired pairings/commands/tokens.

## Incidents

- **Lost phone:** revoke `user_session` from PC UI or DB; old refresh fails, sockets close ≤60s; re-login all devices; check `audit_events` for unknown commands.
- **Compromised account:** rotate DB + secret-manager secrets, revoke all sessions + agent credentials, force re-pair via new device-code, review pairing/command audit.
- **Lost PC / leaked agent credential:** `DELETE /computers/:id` (revoke, keep audit); agent emergency disconnect; rotate credential ID; re-enroll generates new Ed25519 pair.
- **Server outage:** agent backs off (1s→60s jitter), queues bounded locally, reconciles on reconnect with boot ID + cursor; mobile shows last-updated + refetch.
- **DB restore:** restore to new instance, verify migrations, check `commands`/`command_events` continuity, confirm no duplicate exec (agent dedup by `commandId`).

## Release checklist

Migrations tested + rollback noted; protocol compat test (old agent fails closed); auth matrix + replay/expiry tests; restart/shutdown against disposable VM only; revocation timing verified; TLS renewal, backup/restore, and agent upgrade path tested; permissions/signing/changelog done.
