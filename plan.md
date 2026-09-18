# Remote PC Control — Implementation Plan

## 1. Goal and product boundary

Build a personal remote-control system in which one user can use a mobile app to securely issue authorized actions to their own Windows PC from anywhere. A single Express server acts as the public rendezvous, authentication, authorization, and message-relay service. A lightweight PC agent maintains an outbound encrypted connection to that server and executes only explicitly allowed commands.

The design deliberately avoids exposing the PC directly to the internet. It also treats the backend as a relay/control plane, not a machine that can execute PC commands itself.

### MVP outcome

From an Android/iOS app, a paired user can see whether a paired PC is online and request a small allowlisted set of actions:

- wake/status information where supported;
- lock, sleep, restart, and shutdown (with confirmations);
- launch selected applications;
- retrieve limited system information (battery/power, CPU/RAM summary, hostname, uptime);
- send a short notification or clipboard text to the PC;
- request a recent activity log.

MVP does **not** include unrestricted shell access, arbitrary process execution, full remote desktop, keyboard/mouse control, public file sharing, or opening inbound ports on the PC.

### Advanced outcome

Add carefully scoped file transfer, screen viewing, remote input, richer automation, multiple PCs, optional collaborative access, and direct peer-to-peer media paths only after the command-control foundation is stable and reviewed.

## 2. Technology choices

Use one TypeScript monorepo to keep a solo project coherent.

| Area | Recommended choice | Why |
| --- | --- | --- |
| Backend | Node.js 22+, Express, TypeScript | Familiar HTTP API surface and single deployment unit |
| Real-time relay | Socket.IO or `ws` over HTTPS/WSS | Persistent bidirectional connection with reconnect support |
| Database | PostgreSQL + Prisma | Durable relational records, migrations, type-safe queries |
| Cache/presence | Redis (optional for first local version) | Socket scaling, rate limits, ephemeral presence |
| PC agent | TypeScript/Node first; package for Windows | Fastest shared protocol implementation; native helpers later if needed |
| Mobile | React Native + Expo development build | Shared Android/iOS app, fast iteration, secure storage |
| Validation | Zod shared schemas | Validate every command at every boundary |
| Auth | Short-lived JWT access tokens + rotating refresh tokens | Mobile-friendly sessions with revocation |
| Deployment | Docker Compose; managed Postgres; TLS reverse proxy | Simple reproducible deployment |

Target Windows first. Keep a small operating-system adapter in the agent so macOS/Linux can be added later without changing the protocol.

## 3. High-level architecture

```text
 Mobile app                          Express control server                 PC agent
 (React Native)                      (HTTPS/WSS, PostgreSQL)               (Windows service/tray)
 ┌─────────────┐  HTTPS/WSS        ┌────────────────────────┐  WSS outbound ┌──────────────────┐
 │ user session│ ─────────────────▶│ API, auth, pairing      │◀──────────────│ authenticated    │
 │ device UI   │◀───────────────── │ command authorization   │──────────────▶│ command executor │
 └─────────────┘                   │ relay, audit log        │               │ OS adapter       │
                                   └────────────────────────┘               └──────────────────┘
                                           PostgreSQL / Redis
```

Message paths:

1. The mobile app authenticates with HTTPS and opens a WSS connection using its short-lived access token.
2. The PC agent authenticates with a device credential and opens an **outbound** WSS connection. This works through typical home NAT and firewalls.
3. The app submits a validated command to the server.
4. The server checks ownership, device state, policy, rate limits, and any required user confirmation; it persists a command record and relays it to the correct online agent.
5. The agent validates the signed/protocol-valid request again, checks its local allowlist, executes through an OS adapter, and returns progress/final result. The server stores an audit event and forwards the result to the app.

## 4. Trust boundaries and core principles

- The server never trusts a mobile client’s claimed PC ID or permissions; it derives authorization from the authenticated account and database relationship.
- The agent never trusts that a command is safe merely because it came from the server. It validates message shape, expiration, command type, local policy, and per-command arguments.
- No long-lived user password or raw secret is sent over WebSocket messages after authentication.
- Every network hop uses TLS. Do not offer plaintext HTTP, WebSocket, or a “skip certificate verification” option.
- The server should relay opaque content only where possible; however, it must inspect command metadata to enforce policy and auditing.
- Default deny: unknown commands, extra payload fields, expired requests, and commands from unpaired devices fail closed.

## 5. Accounts, authentication, and device pairing

### User authentication

- Support email/password for initial development; hash passwords with Argon2id.
- Add passkeys or OAuth later if desired, but retain a secure recovery path.
- Issue a 10–15 minute access JWT and a rotating refresh token. Store refresh-token hashes, device metadata, expiration, and revocation state in PostgreSQL.
- Store mobile refresh tokens only in iOS Keychain / Android Keystore-backed secure storage; never AsyncStorage.
- Require reauthentication for destructive actions and account/pairing changes, based on a configurable recent-auth window (for example 10 minutes).
- Add email verification, login throttling, and optional TOTP before broad deployment.

### Pairing flow

Pairing must establish a durable relationship between one account and one agent installation without asking the user to type a secret into a remote app.

1. User signs in to the PC agent locally and chooses **Pair this PC**.
2. The agent requests a short-lived, single-use pairing session from the server using the user’s local authenticated setup flow. Display a QR code containing only a random pairing ID and one-time pairing secret (or a deep link), valid for 5 minutes.
3. The signed-in mobile app scans the QR code and displays the PC name, account, and expiry for user confirmation.
4. On confirmation, the server creates a `computer` record and issues the agent a random device credential plus a credential ID. The agent stores the secret with Windows DPAPI/credential manager, never in a plain config file.
5. The agent generates an Ed25519 key pair locally. Send its public key during enrollment and keep the private key protected locally. Bind future connection proofs to that key in addition to the stored device credential.
6. Mobile app receives only the computer’s opaque ID and display metadata. It never receives the agent credential.

Require local PC approval for a new account pairing. Let the owner revoke a computer, mobile session, or agent credential from either the app or a local agent UI. Revocation closes active sockets and invalidates pending commands.

## 6. Secure remote communication and WebSocket strategy

### Transport

- Serve REST over HTTPS and sockets over WSS on one public domain, e.g. `api.example.com` and `/socket`.
- Terminate TLS at a reverse proxy (Caddy, Nginx, or a managed load balancer) using automatic certificate renewal. Redirect HTTP to HTTPS; enable HSTS after testing.
- Require TLS 1.2+ (prefer TLS 1.3); validate hostnames and normal certificate chains in both clients.
- Use an outbound agent connection with exponential reconnect. Do not require port forwarding.
- Send application ping/pong every 20–30 seconds and treat a peer as offline after a conservative timeout (e.g. 75 seconds).

### Socket authentication

- Mobile socket handshake: access token in the authorization header or Socket.IO auth payload. Validate issuer, audience, expiry, and session revocation.
- Agent socket handshake: credential ID + nonce-based proof signed by the agent Ed25519 key, plus a short-lived server-issued agent access token. Rotate device credentials periodically and upon revocation.
- Associate each accepted socket server-side with exactly one `userSession` or `computer`. Never accept account/computer IDs supplied in later messages as identity.
- Place sockets in private rooms such as `computer:{id}` and `user:{id}` only after authorization.

### Delivery semantics

- Client-to-server command submission uses an idempotency key generated by the mobile app.
- Server persists the command before emitting it to an agent.
- Agent acknowledges receipt, then emits progress and final result. Each message contains the immutable command ID and a monotonically increasing sequence number for that command.
- Server forwards events to the requesting app and stores authoritative state. On reconnect, the app calls `GET /v1/commands/{id}` or receives missed events since a cursor.
- Use at-least-once delivery, with deduplication by `commandId` in the agent. Never assume exactly-once delivery for a networked system.

### Scaling later

One Express instance can support the MVP. If multiple API instances are added, use the Socket.IO Redis adapter (or a shared pub/sub relay), Redis-backed rate limits/presence, sticky sessions where required, and Postgres as the command/audit source of truth.

## 7. Command protocol

Use versioned, typed JSON envelopes over WSS. Zod schemas should compile for backend, agent, and mobile. Limit payload size (for example 64 KB for command messages) and reject unknown fields.

### Request envelope

```json
{
  "v": 1,
  "type": "command.request",
  "commandId": "uuid",
  "idempotencyKey": "uuid",
  "computerId": "uuid",
  "name": "system.lock",
  "args": {},
  "requestedAt": "2026-09-18T10:00:00.000Z",
  "expiresAt": "2026-09-18T10:01:00.000Z",
  "requestContext": { "mobileSessionId": "uuid" }
}
```

The server adds a command authorization record/signature (or issues the envelope only after authorization). The agent accepts a command only if `computerId` matches itself, the timestamp is fresh, the command is not already finished, and the server identity/session is valid.

### Result envelope

```json
{
  "v": 1,
  "type": "command.result",
  "commandId": "uuid",
  "status": "succeeded",
  "sequence": 3,
  "completedAt": "2026-09-18T10:00:08.000Z",
  "result": { "locked": true },
  "error": null
}
```

Statuses: `queued`, `delivered`, `acknowledged`, `running`, `succeeded`, `failed`, `rejected`, `expired`, `cancelled`, and `timed_out`.

Define stable error codes such as `AUTH_REQUIRED`, `NOT_OWNER`, `COMPUTER_OFFLINE`, `COMMAND_NOT_ALLOWED`, `POLICY_DENIED`, `INVALID_ARGUMENT`, `LOCAL_PERMISSION_DENIED`, `COMMAND_EXPIRED`, `DUPLICATE_COMMAND`, and `EXECUTION_FAILED`. Present friendly messages in mobile; retain technical context in secure logs.

## 8. Allowlisted command catalog

The catalog is the product’s safety boundary. Model each command explicitly, with an argument schema, user-facing label, risk category, server policy, agent policy, timeout, and audit fields.

| Command | MVP | Guardrails |
| --- | --- | --- |
| `system.getStatus` | Yes | Read-only, rate-limit |
| `system.lock` | Yes | Immediate; audit |
| `system.sleep` | Yes | App confirmation; agent can reject when policy forbids |
| `system.restart` / `system.shutdown` | Yes | Explicit confirmation + recent auth; optional 30-second local abort window |
| `app.launch` | Yes | Only named apps/approved paths configured locally; no arbitrary arguments initially |
| `notification.show` | Yes | Length/type limits; no scripts/URLs executed automatically |
| `clipboard.setText` | Yes | Text only, byte limit, opt-in local policy |
| `file.*` | Later | Folder allowlists, scan/quota/expiry |
| `screen.*`, `input.*` | Later | Separate high-risk consent/session model |
| `shell.execute` | Never in consumer MVP | Do not expose arbitrary shell execution |

Store the local allowlist in an agent-owned configuration UI. The app may request an approved application by immutable ID, not a raw path. Resolve and validate the path locally; never concatenate a shell command string. Invoke programs with argument arrays and safe OS APIs.

## 9. PC agent design

### Installation and runtime

- Start as a signed/installer-managed Windows desktop app with a tray UI plus a background service where practical. The service maintains connectivity; the tray UI shows status, last command, pairing, policies, and an emergency “disconnect/revoke” action.
- Use least privilege. Most commands run as the currently logged-in user; a separate elevated helper is introduced only for narrowly defined operations and communicates through a local authenticated IPC channel.
- Do not run the whole agent as Administrator. Avoid UAC bypasses and commands that weaken Windows security.
- Store device credential and private key using DPAPI/Windows Credential Manager, scoped to the appropriate account/service identity.
- Auto-update only with signed releases, HTTPS downloads, version pinning/rollback policy, and clear update audit events. Defer auto-update until after MVP if signing infrastructure is not ready; do not silently execute unsigned updates.

### Internal modules

- `ConnectionManager`: WSS lifecycle, token renewal, heartbeat, backoff, network-state awareness.
- `EnrollmentManager`: pairing QR, device key creation, credential rotation/revocation.
- `CommandDispatcher`: validates, deduplicates, queues, times out, and routes commands.
- `PolicyEngine`: reads local policy and command allowlist; always default-deny.
- `WindowsAdapter`: safe native/PowerShell/API implementations per command. Keep shell use isolated and avoid string interpolation.
- `StatusCollector`: selected health signals; no broad data collection.
- `AuditWriter`: structured local activity records with rotation.
- `LocalControl`: tray UI/local IPC and emergency disconnect.

### Execution rules

- Maintain a bounded command queue and per-command timeouts.
- Acknowledge only after validation; report `running` before actions that can take time.
- Persist recently completed command IDs and outcomes so retransmissions are idempotent across reconnects/restarts.
- Recheck local policy immediately before execution, even if server previously allowed it.
- For sleep/restart/shutdown, flush result/audit messages before triggering the OS action; send a best-effort final message and allow status reconciliation after reconnect.

## 10. Mobile app design

### Screens for MVP

1. Onboarding/sign in and session management.
2. Computer list with online/offline/last-seen state.
3. Pair computer (scan QR; confirmation).
4. Computer dashboard: status, approved actions, recent activity.
5. Action confirmation for destructive commands, including recent-auth prompt.
6. Command detail: state timeline, friendly failure message, retry where safe.
7. Settings: rename computer, notification preference, revoke computer/session, account security.

### Client behavior

- Use HTTPS for initial fetches and WSS for real-time state. The UI must work without an active socket by showing cached status as “last updated” and fetching on foreground.
- Cache only minimal non-sensitive metadata. Keep tokens in secure storage.
- Generate idempotency keys before submit and retain pending-command state locally until resolution.
- Do not optimistically claim an OS action succeeded: show `Sending`, then authoritative command state.
- Use push notifications later for completion/offline alerts; never put sensitive command details in notification text.

## 11. Express backend design

### Responsibilities

- User auth, sessions, refresh-token rotation, and reauthentication checks.
- Pairing-session creation/confirmation and device credential lifecycle.
- REST resources for computers, policies, commands, files, and audit history.
- WSS authentication, routing, presence, acknowledgments, and reconnect reconciliation.
- Command authorization: ownership, active pairing, command schema, rate limits, risk confirmation, computer state, and policy checks.
- Immutable audit events and operational metrics.

### Explicit non-responsibilities

- Do not execute PC actions directly.
- Do not expose agent sockets as public general-purpose proxies.
- Do not retain screen/file content by default when a relay can stream it; keep retention policies explicit.

### Suggested Express modules

```text
apps/server/src/
  app.ts
  server.ts
  config/
  middleware/        # auth, validation, errors, rate limits
  modules/
    auth/
    pairing/
    computers/
    commands/
    sockets/
    audit/
    files/           # later
  lib/               # crypto, ids, logger, errors
  prisma/
```

Apply Helmet/CSP where relevant, strict CORS for known mobile/web origins, request body limits, schema validation, structured logs with secret redaction, per-account/IP rate limiting, and centralized error handling. Keep server secrets in a managed secret store or deployment environment, never source control.

## 12. Database schema

Use UUID primary keys, UTC timestamps, and `created_at`/`updated_at`. Encrypt particularly sensitive metadata at rest if the database platform does not already provide managed encryption.

| Table | Key fields / purpose |
| --- | --- |
| `users` | id, email, password_hash, verified_at, MFA settings, status |
| `user_sessions` | id, user_id, refresh_token_hash, device metadata, expiry, revoked_at, last_seen_at |
| `computers` | id, owner_user_id, display_name, platform, agent_version, public_key, status, last_seen_at, revoked_at |
| `computer_credentials` | id, computer_id, credential_hash, issued_at, expires_at, rotated_at, revoked_at |
| `pairing_sessions` | id, owner_user_id, secret_hash, expires_at, used_at, requested_computer metadata |
| `command_policies` | id, computer_id, command_name, enabled, config JSON, updated_by, updated_at |
| `commands` | id, idempotency_key, computer_id, requester_session_id, name, args_redacted, status, expiry, timestamps, result_redacted, error_code |
| `command_events` | id, command_id, sequence, event_type, payload_redacted, occurred_at |
| `audit_events` | id, actor type/id, computer_id, action, outcome, IP/device context, metadata_redacted, occurred_at |
| `file_transfers` (later) | id, computer_id, direction, status, object key, hash, size, expires_at |

Constraints and indexes:

- Unique `(requester_session_id, idempotency_key)` on `commands`.
- Unique `(command_id, sequence)` on `command_events`.
- Index `computers(owner_user_id, revoked_at)`, `commands(computer_id, created_at DESC)`, and `audit_events(computer_id, occurred_at DESC)`.
- Foreign keys with careful retention rules: audit records should preserve actor snapshots or controlled nullability rather than cascade-delete accountability.

Never store raw passwords, refresh tokens, pairing secrets, device credentials, or private keys. Redact clipboard/file names/arguments in general logs; retain only what is needed for user-visible history and incident review.

## 13. REST API outline

All endpoints are versioned under `/v1`, require JSON, and return a stable error shape:

```json
{ "error": { "code": "COMMAND_NOT_ALLOWED", "message": "This action is not enabled on the computer.", "requestId": "..." } }
```

| Method and path | Purpose |
| --- | --- |
| `POST /auth/register`, `POST /auth/login` | Create/sign in user (development/prod policy differs) |
| `POST /auth/refresh`, `POST /auth/logout` | Rotate or revoke session |
| `POST /auth/reauthenticate` | Issue recent-auth proof for sensitive actions |
| `GET /computers` | List owner’s computers |
| `GET /computers/:id` | Computer state and allowed actions |
| `PATCH /computers/:id` | Rename / manage permitted metadata |
| `DELETE /computers/:id` | Revoke computer pairing; do not erase audit records |
| `POST /pairing-sessions` | Create short-lived pairing session |
| `POST /pairing-sessions/:id/confirm` | Confirm scanned pairing session |
| `POST /computers/:id/commands` | Submit validated command with idempotency key |
| `GET /commands/:id` | Command state and result |
| `GET /computers/:id/commands` | Paginated history |
| `GET /computers/:id/audit-events` | Paginated audit trail |
| `GET/PATCH /computers/:id/policies` | Read/manage local policy metadata (server never overrides local deny) |

Use opaque cursor pagination, not page numbers, for event/history feeds. Agent enrollment and credential rotation routes should be separate, authenticated agent-only endpoints with strict rate limits.

## 14. NAT, firewall, and connectivity

### MVP

- Agent makes a persistent outbound WSS connection to port 443 on the public server.
- Home NAT maps this outbound flow automatically; no router configuration or inbound Windows firewall rule is needed.
- Corporate networks may block WSS/proxy traffic. Detect connection failure, show a clear diagnostic, and support proxy configuration only if required later.
- Windows firewall should allow the installed agent’s outbound connection; do not create a broad inbound rule.
- “Wake PC from anywhere” is not reliably possible if the PC is asleep/offline. Treat it as a separate optional feature using Wake-on-LAN through a local companion/relay on the same LAN—not the core MVP promise.

### Later for screen/control

- WebRTC can try direct peer connections with STUN. Expect many users to require a TURN relay, especially behind symmetric NAT/corporate networks.
- Operate coturn with authenticated, short-lived TURN credentials, bandwidth quotas, and region-aware capacity. Never expose an unauthenticated open relay.
- Keep command/control signaling through the Express server even when media takes a peer-to-peer/TURN path.

## 15. File transfer roadmap

Do not begin with full filesystem browsing. Start only after command security and auditing are solid.

### Phase 1: approved-folder transfers

- Agent owner configures explicit allowed folders and whether upload, download, or both are allowed.
- App browses a server/agent-provided virtual listing limited to those roots; canonicalize paths and reject traversal/symlinks escaping the root.
- Use pre-signed object-storage URLs for large chunks, with server-issued authorization bound to user, computer, transfer, size, SHA-256 hash, direction, and short expiration.
- Agent scans/uploads/downloads in chunks with resume tokens, size quotas, hash verification, and malware-scanner integration where feasible.
- Download files only to a dedicated mobile app folder; ask confirmation before overwriting. Expire staged storage promptly.

### Phase 2: richer UX

- Selective sync, background transfer notifications, version conflicts, and optional end-to-end encryption design review.

Avoid passing multi-megabyte file bytes through ordinary WebSocket command messages.

## 16. Screen viewing and remote control roadmap

Treat this as a separate security-sensitive product increment.

1. **Screen snapshots**: one explicitly requested, watermarked image; local visible consent indicator.
2. **View-only streaming**: WebRTC stream with TURN fallback, per-session expiry, bitrate limits, and a persistent local “screen sharing active” indicator.
3. **Remote input**: requires a fresh high-risk consent session, local approval by default, visible indicator, instant local stop button/hotkey, idle timeout, and full audit trail.
4. **Unattended control**: only after threat review, platform-specific secure desktop/UAC behavior, robust account recovery, and enterprise-grade controls. It should not be silently enabled by default.

Do not attempt to bypass UAC, the Windows secure desktop, lock screen, DRM-protected content, or OS accessibility protections.

## 17. Permissions and privacy

- Explain each permission at the moment it is needed. Mobile: camera only for QR scanning, notifications only for status/completion. PC: no admin privileges by default.
- Make clipboard, app launching, shutdown/restart, file roots, screen capture, and remote input individually visible/enabled in local PC settings.
- Provide a clear device list, last-seen information, last action, credential/session revocation, and account logout controls.
- Retain audit metadata for a documented period (e.g. 90 days for MVP) and provide deletion/export policy consistent with the intended jurisdiction. Avoid collecting file contents, screen images, or full command arguments unless the feature requires it.

## 18. Threat model and mitigations

| Threat | Mitigation |
| --- | --- |
| Stolen mobile token | Short access token, rotating refresh tokens, secure storage, session/device revocation, recent-auth for risky actions |
| Account takeover | Argon2id, verification, throttling, MFA/passkeys later, login/audit alerts |
| Rogue pairing | Short-lived single-use QR secret, local PC initiation/approval, display-confirmed identity, pairing audit |
| Compromised server relay | TLS, agent local allowlist, signed/expiring commands, minimal secrets, hardened deployment, monitoring; consider end-to-end command signatures later |
| Malicious command payload | Shared strict schemas, unknown-field rejection, explicit catalog, no shell-string construction, local policy recheck |
| Replay/duplicate command | Command ID, idempotency key, expiration, nonce/session binding, server and agent deduplication |
| Exposed PC on internet | Outbound-only WSS, no port forwarding/inbound listener |
| Agent credential theft | DPAPI/credential store, key proof, rotation/revocation, installer/update integrity |
| Denial of service | Body/socket limits, rate limits, bounded queues, timeouts, backoff, capacity monitoring |
| Sensitive logs | Secret redaction, least-data audit payloads, retention/rotation, access controls |
| Unsafe files/screens | Explicit scopes and consent, path containment, malware/hash checks, watermark/indicator, storage expiry |

Before release, conduct a focused security review of pairing, session refresh, agent enrollment, command authorization, OS invocation, and update delivery. Consider an external penetration test before allowing unattended remote input or non-owner sharing.

## 19. Logging, observability, and supportability

- Create structured JSON logs with `requestId`, `commandId`, `computerId`, actor type, outcome, latency, and error code. Never log tokens, credentials, pairing secrets, clipboard contents, or full sensitive paths.
- Maintain a user-visible audit trail: sign-in, pairing, pairing/revocation, policy changes, each command request/result, and agent version/connection events.
- Metrics: active agents, online rate, socket reconnects, command latency/success rate by name, failed auth, pairing failures, queue depth, file/TURN usage later.
- Alerts: agent auth anomaly, error-rate spike, credential revocation used, database backup failure, certificate expiry, and server availability.
- Add a diagnostic bundle generator in the agent that redacts secrets and requires user approval before export.

## 20. Error handling, offline behavior, and recovery

### User-facing states

- `Online`: live agent heartbeat.
- `Offline`: no recent heartbeat; show last seen.
- `Connecting`: agent/app is establishing a socket.
- `Action queued`: server accepted it but agent has not acknowledged.
- `Action needs retry`: safe idempotent request can be resent using the same key.
- `Action uncertain`: timeout occurred after dispatch; show current state and do not blindly repeat destructive operations.

### Rules

- Default command expiry is 60 seconds. Do not queue destructive actions for a PC that is currently offline.
- Read-only, safe requests can optionally be queued for a very short period only if the user explicitly sees that behavior; defer this until after MVP.
- Agent reconnect uses exponential backoff with jitter (e.g. 1 s → 2 → 4 → … capped at 60 s) and resets after stable connectivity.
- On reconnect, agent sends current status, active/recent command state, and a resume cursor. Server reconciles missed results without rerunning completed commands.
- Persist client command state in the backend; mobile and agent local caches are accelerators, not authority.
- Define server-side job cleanup for expired pairing sessions, commands, token records, and temporary transfer objects.

## 21. Repository layout

```text
remote-pc-control/
  apps/
    server/                 # Express API + socket relay
    agent/                  # Windows agent + tray UI
    mobile/                 # React Native app
  packages/
    protocol/               # Zod schemas, message/event types, error codes
    config/                 # shared lint/TS config
    ui/                     # optional shared visual tokens
  infra/
    docker/                 # development/prod container files
    caddy/                  # TLS/reverse-proxy config
    terraform/              # later infrastructure-as-code
  docs/
    architecture.md
    threat-model.md
    protocol.md
    runbook.md
  .github/workflows/
  plan.md
```

Use `pnpm` workspaces or Turborepo. Keep protocol compatibility explicit: changes to `packages/protocol` require a protocol-version decision, tests, and agent/mobile/server compatibility notes.

## 22. Milestones

### Milestone 0 — foundation (1–2 weeks)

- Set up monorepo, TypeScript, linting, formatting, tests, CI, Docker Compose, Postgres, and environment validation.
- Define threat model, protocol v1 schemas, error codes, database migrations, secrets policy, and command catalog.
- Create local dev certificates/workflow; production uses a real public TLS domain.

**Exit:** authenticated health check, migrations, shared schema package, CI green.

### Milestone 1 — secure pairing and presence (1–2 weeks)

- Implement user sessions, agent enrollment key pair/credential storage, pairing QR, computer records, agent WSS handshake, heartbeat, and online/last-seen display.
- Implement computer/session revocation and audit events.

**Exit:** a user can pair one Windows PC and see trustworthy online/offline state from the app.

### Milestone 2 — command-control MVP (2–3 weeks)

- Implement persisted command lifecycle, idempotency, socket relay, reconnection reconciliation, policies, and first allowlisted actions.
- Build agent local configuration/tray status and mobile dashboard/confirmations/history.
- Add rate limits, input validation, audit redaction, and failure UX.

**Exit:** lock/status/approved app launch/restart actions work securely across separate networks, with correct result history.

### Milestone 3 — hardening and deploy (1–2 weeks)

- Add test coverage, dependency/vulnerability scanning, structured observability, backups, TLS proxy, production deployment, secret management, and recovery runbook.
- Test revocation, key rotation, network loss, duplicate delivery, system reboot, and agent upgrade paths.

**Exit:** a small personal beta can operate safely with monitoring and restore procedures.

### Milestone 4 — file transfers (2–4 weeks)

- Add approved-folder policy, transfer model, object storage, chunk/hash/resume flow, quotas, expiry, and mobile UX.

### Milestone 5 — view/control research and implementation (4+ weeks)

- Prototype snapshots → view-only WebRTC → gated remote input, with TURN deployment and a dedicated security review at each gate.

## 23. Testing strategy

| Level | What to test |
| --- | --- |
| Unit | Schemas, policy decisions, token handling, path containment, command mapping, error codes, deduplication |
| Integration | Express + Postgres + sockets, pairing lifecycle, auth refresh/revocation, persisted command transitions |
| Agent integration | Windows adapter behavior, protected secret storage abstraction, service/tray IPC, restart/reconnect |
| Mobile integration | Secure storage, action confirmations, offline screens, state reconciliation |
| End-to-end | Pair from local PC, connect through internet-like network, command success/failure, revocation, upgrade |
| Security | Fuzz protocol schemas, replay/expired messages, authorization matrix, rate-limit tests, dependency scans, manual threat cases |
| Resilience | Kill server/socket, lose Wi-Fi, reboot agent, duplicate messages, database failover/restore, clock skew |

Use test accounts and a dedicated disposable Windows VM. Avoid testing restart/shutdown against the development workstation without explicit safeguards. Add a manual release checklist for permissions, signing, migrations, rollback, and revocation behavior.

## 24. Deployment plan

### Development

- Run server, Postgres, and Redis (if used) with Docker Compose; run agent/mobile natively for OS/device access.
- Use an HTTPS tunnel or staging domain to test real mobile connectivity. Keep development credentials separate from production.

### Production/personal beta

- Deploy Express behind Caddy/Nginx or managed HTTPS load balancer on a small VM/container platform.
- Use managed Postgres with automated encrypted backups and tested restoration; use managed Redis only when socket scaling needs it.
- Lock database/private services to the application network. Expose only HTTPS/WSS on 443.
- Set environment secrets through the host secret manager; rotate them and document ownership.
- Build signed, versioned agent installers. Publish a changelog and rollback path before enabling automatic updates.

### Operating checklist

- Monitor TLS renewal, uptime, database health/backups, error rate, and authentication anomalies.
- Maintain a runbook for lost phone, compromised account, lost PC, leaked secret, server outage, database restore, and agent rollback.
- Test disable/revoke procedures at least once before trusting the system remotely.

## 25. Future enhancements

- Multiple computers and computer groups owned by one account.
- Per-command schedules and safe automation rules.
- Push completion/offline alerts.
- Wake-on-LAN via a trusted LAN companion.
- Passkeys, TOTP, trusted-device controls, and security notifications.
- macOS/Linux adapters.
- Shared access with expiring roles and owner approval (requires a new authorization/threat-model pass).
- End-to-end encrypted command metadata/file contents after carefully designing recoverability and auditing tradeoffs.
- WebRTC view/control with TURN, recording policy, and enterprise controls.
- Admin/diagnostic dashboard for the owner, never an unrestricted shell.

## 26. First implementation backlog

Work in this order to avoid building a remote-code-execution surface by accident:

1. Initialize monorepo and protocol package; write schema/policy unit tests first.
2. Create Postgres models and auth/session endpoints.
3. Build a Windows agent that creates a key pair, enrolls, and maintains authenticated WSS presence only.
4. Build mobile sign-in, computer list, and pairing scanner/confirmation.
5. Add persisted, idempotent `system.getStatus` end-to-end.
6. Add `system.lock`, then one locally approved `app.launch` action.
7. Add confirmation/recent-auth requirements for sleep/restart/shutdown.
8. Add audit history, revocation, reconnect reconciliation, limits, and deployment hardening.
9. Run the test/security/recovery checklist before adding files or screen sharing.

## 27. Definition of done for MVP

MVP is complete only when a user can securely pair a Windows PC, use a signed-in mobile app over a different network to see its real state and invoke the defined allowlisted commands, and then inspect accurate outcomes and audit history. The system must survive expected disconnects without replaying destructive operations, revoke access promptly, expose no inbound PC control port, validate every message at both server and agent, and provide a documented recovery path for lost devices and service outages.
