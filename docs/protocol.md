# Protocol v1

Source: `plan.md` §7–§8. Schemas live in `packages/protocol` (Zod, shared by server/agent/mobile). Max 64KB per command message; reject unknown fields.

## Versioning

- Envelope field `v: 1`. Bump `v` on breaking change; keep `v-1` parser for one release.
- Old agent + new server must fail closed (`INVALID_ARGUMENT` / `COMMAND_NOT_ALLOWED`), never execute.

## Request envelope (mobile → server → agent)

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

Agent accepts only if: `computerId` == self, `requestedAt` within ±30s of server time, `expiresAt` not passed (server enforces), not already finished (`commandId` dedup, persisted across restarts), server identity valid.

## Result envelope (agent → server → mobile)

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

Statuses: `queued`, `delivered`, `acknowledged`, `running`, `succeeded`, `failed`, `rejected`, `expired`, `cancelled`, `timed_out`. Destructive timeout after dispatch → `timed_out` + mobile shows `uncertain`, resolved by boot-ID comparison on reconnect.

## Error codes

`AUTH_REQUIRED`, `NOT_OWNER`, `COMPUTER_OFFLINE`, `COMMAND_NOT_ALLOWED`, `POLICY_DENIED`, `INVALID_ARGUMENT`, `LOCAL_PERMISSION_DENIED`, `COMMAND_EXPIRED`, `DUPLICATE_COMMAND`, `EXECUTION_FAILED`. Stable shape:

```json
{ "error": { "code": "COMMAND_NOT_ALLOWED", "message": "This action is not enabled on the computer.", "requestId": "..." } }
```

## Command catalog (MVP)

| Name | Stage | Quota / rule |
| --- | --- | --- |
| `system.getStatus` | M2a | 1 req/5s, cache 5s, includes boot ID |
| `system.lock` | M2a | 1 req/10s |
| `app.launch` | M2a (1 app) | by immutable ID only, no raw args, 10/hr |
| `system.sleep` | M2b | confirm, 3/hr |
| `system.restart` / `system.shutdown` | M2b | confirm + 10-min recent-auth, abort toast where OS allows, 2/hr, never queued offline |
| `notification.show` | M2b | ≤200 chars, 10/hr |
| `clipboard.setText` | M2b opt-in | ≤4KB text, 10/hr |
| `file.*`, `screen.*`, `input.*` | later | separate consent model |
| `shell.execute` | never | — |

Local agent policy is authoritative; server policy view is display cache only.

## Delivery

- At-least-once; dedup by `commandId` in agent + unique `(requester_session_id, idempotencyKey)` in DB.
- Server persists before emit. Agent acks after validation. Each result carries monotonic `sequence` per `commandId`.
- Reconnect: app calls `GET /v1/commands/:id` or replays since cursor; agent sends status + boot ID + recent outcomes; server reconciles without rerunning completed commands.
- Heartbeat ping 20–30s; offline after ~75s. Backoff 1s→60s cap with jitter.
