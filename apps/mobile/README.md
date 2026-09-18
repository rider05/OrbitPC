# OrbitPC Mobile (Expo, SDK 57)

React Native + Expo Router app. Track owner: `apps/mobile/**` only (see `plans/mobile-plan.md`).

## Run

```sh
cd apps/mobile
npm install
npm start          # scan QR with Expo Go, or press w for web
```

Mock backend is ON by default (in-memory `src/mocks/mock-server.ts`), so
sign-in → computers → pair → dashboard → command timeline all work with no
server. Point at staging with:

```sh
EXPO_PUBLIC_API_URL=https://api.example.com npx expo start
```

## Structure

```text
app/                 # Expo Router screens (frozen REST/socket contract)
  index.tsx          # auth gate
  sign-in.tsx        # login/register + secure session
  computers/         # list + dashboard (M2a quick actions, M2b power/forms)
  pair.tsx           # QR (expo-camera, permission-at-use) + manual code + confirm
  commands/[id].tsx  # authoritative timeline + safe retry (same idempotency key)
  settings.tsx       # rename / revoke / sign-out
src/
  protocol/types.ts  # FROZEN contract copy — consume only, no shape edits here
  lib/               # config, api client, socket, secure-store, errors, ids
  auth/              # session provider + foreground refetch
  mocks/             # mock-server + Online/Offline/Uncertain fixtures
  components/        # StatusBadge, ActionButton, ConfirmSheet, CommandTimeline
```

## Security rules (never merge otherwise)

- Tokens only in `expo-secure-store` (Keychain/Keystore). Never AsyncStorage/logs.
- Destructive actions: confirm sheet + 10-min recent-auth; `timed_out` shows
  “uncertain — verifying”, resolved by boot-ID, never auto-retried.
- `app.launch` by immutable ID only. No raw paths. No sensitive push payloads.
- No `packages/protocol` or REST/socket shape edits from this track — server RFC.
