# OrbitPC — Complete Implementation Plan

> **Project:** OrbitPC  
> **Type:** Secure cross-platform remote PC control and remote desktop system  
> **Primary client:** Android  
> **PC target:** Windows initially  
> **Communication:** Bluetooth, LAN/Wi-Fi, and Internet  
> **Architecture:** Mobile app + Windows agent + secure backend/control plane  
> **Status:** Master implementation roadmap

---

## 1. Project Vision

OrbitPC allows a phone to securely control and interact with a personal Windows PC.

The phone can act as:

- Remote monitor
- Touchpad
- Mouse
- Keyboard
- Gesture controller
- PC status dashboard
- File manager
- Clipboard interface
- Audio interface
- Remote application launcher
- Remote desktop controller

OrbitPC supports three connectivity modes:

1. **Bluetooth** — nearby/offline control
2. **LAN/Wi-Fi** — fast local control
3. **Internet/WAN** — secure remote control from anywhere

Security is a core design requirement. The system must never expose the user's PC directly to the public Internet merely to enable remote control.

---

# 2. Core Design Principles

1. Security-first architecture
2. Least-privilege PC agent
3. Explicit pairing and device authorization
4. TLS/WSS for Internet communication
5. Default-deny command validation
6. Allowlisted commands
7. No unrestricted remote shell in the consumer MVP
8. Destructive actions require confirmation
9. Idempotent command handling
10. Audit important actions
11. LAN/direct connections should remain available when Internet is unavailable
12. Bluetooth should provide an additional nearby/offline transport
13. Screen and input control should be added progressively after the secure command-control foundation is stable
14. Do not bypass Windows UAC, secure desktop, DRM restrictions, or other OS security boundaries

---

# 3. High-Level Architecture

```text
                         INTERNET
                            │
                     HTTPS / WSS / WebRTC
                            │
                  ┌─────────────────────┐
                  │ OrbitPC Control     │
                  │ Server              │
                  │                     │
                  │ Auth                │
                  │ Pairing             │
                  │ Authorization       │
                  │ Presence            │
                  │ Command Relay       │
                  │ Audit               │
                  └─────────┬───────────┘
                            │
                       WSS / TLS
                            │
                    ┌───────▼────────┐
                    │ Windows PC     │
                    │ OrbitPC Agent  │
                    └───────┬────────┘
                            │
                  Local authenticated IPC
                            │
                 ┌──────────▼──────────┐
                 │ User Session Helper │
                 └──────────┬──────────┘
                            │
              ┌─────────────┼─────────────┐
              │             │             │
            Input         Screen        Files
              │             │             │
           Windows        Capture        Storage
             APIs        Pipeline
```

For local operation:

```text
Android
   │
   ├── Bluetooth ───────────────► Windows Agent
   │
   └── LAN / Wi-Fi ────────────► Windows Agent
```

For Internet operation:

```text
Android
   │
   ├── HTTPS/WSS ─► OrbitPC Server ─► Windows Agent
   │
   └── WebRTC media path ─────────────► Windows Agent
```

The backend acts primarily as a secure control plane and relay. It must not become a general-purpose remote shell or arbitrary proxy.

---

# 4. Main Components

## 4.1 Android Mobile App

Responsibilities:

- User authentication
- Device pairing
- PC discovery
- PC online/offline state
- Remote command UI
- Touchpad
- Keyboard
- Screen viewer
- Gestures
- File manager
- Clipboard
- Audio controls
- Multi-monitor selection
- Connection management
- Security settings
- Audit/activity history

Recommended stack:

- React Native
- Expo development build
- TypeScript
- React Navigation
- Zustand or Redux Toolkit
- React Native Gesture Handler
- React Native Reanimated
- Secure storage
- WebSocket client
- WebRTC library where appropriate

---

# 5. Windows PC Agent

The PC agent is responsible for communicating with OrbitPC and executing authorized local operations.

Recommended architecture:

```text
OrbitPC Agent
│
├── Windows Service
│   ├── Secure connection
│   ├── Enrollment
│   ├── Heartbeat
│   ├── Command queue
│   ├── Authentication
│   └── Recovery
│
├── User Session Helper
│   ├── Mouse input
│   ├── Keyboard input
│   ├── Screen capture
│   ├── Application launch
│   ├── Notifications
│   └── User-session operations
│
└── Tray UI
    ├── Connection status
    ├── Pairing
    ├── Permissions
    └── Emergency disconnect
```

Windows Session 0 isolation means privileged service functionality and interactive user-session functionality should not simply be placed in one process.

Do not run the entire agent as Administrator.

---

# 6. Backend / Control Server

Recommended stack:

- Node.js 22+
- TypeScript
- Express
- Socket.IO or `ws`
- PostgreSQL
- Prisma
- Redis when horizontal scaling is required
- Docker
- TLS reverse proxy

Responsibilities:

- Authentication
- Session management
- Device pairing
- PC registration
- Authorization
- Command validation
- Command persistence
- Command relay
- Presence
- Reconnection
- Audit events
- Rate limiting
- Revocation
- WebRTC signaling

The server must NOT:

- Execute arbitrary PC commands
- Become an unrestricted proxy
- Store screen content unnecessarily
- Store file contents unnecessarily
- Accept unrestricted shell commands

---

# 7. Authentication

Use:

- Argon2id for password hashing
- Short-lived access JWTs
- Rotating refresh tokens
- Secure mobile token storage
- Recent authentication for destructive actions
- Device/session revocation

Never store:

- Raw passwords
- Raw refresh tokens
- Private keys
- Permanent secrets in plaintext

---

# 8. Secure PC Pairing

Recommended flow:

```text
Windows PC
   │
   │ Generate pairing QR/code
   ▼
OrbitPC Mobile
   │
   │ User authenticates
   │
   │ Scans QR / enters code
   ▼
OrbitPC Server
   │
   │ Verifies authorization
   ▼
PC ↔ Mobile pairing established
```

The PC agent should generate a device key pair.

Recommended:

- Ed25519 identity key
- Windows DPAPI / Credential Manager for secret protection
- Device-specific credentials
- Revocation support

The server must never trust a client merely because it claims a `computerId`.

---

# 9. Connection Modes

## 9.1 Bluetooth

Purpose:

- Nearby offline control
- No Internet dependency
- Emergency local control
- Low-latency basic input

Possible capabilities:

- Pairing
- Status
- Mouse
- Keyboard
- Basic commands
- Clipboard
- Limited file transfer

Bluetooth should not automatically expose every advanced feature.

---

## 9.2 LAN / Wi-Fi

Purpose:

- High-speed local communication
- Lower latency
- Screen streaming
- Remote input
- File transfer

Discovery options:

- mDNS
- UDP discovery
- QR/manual pairing
- Local network service discovery

Example:

```text
Phone ── Wi-Fi ──► PC
```

Prefer direct LAN communication when both devices are trusted and reachable.

---

## 9.3 Internet / WAN

Internet mode should avoid inbound ports on the PC.

Preferred architecture:

```text
Phone ──WSS──► OrbitPC Server ◄──WSS── PC
```

The PC maintains an outbound connection.

Later:

```text
Phone ◄──────── WebRTC P2P / TURN ────────► PC
```

Use:

- STUN
- TURN
- Short-lived TURN credentials
- WebRTC data/media channels

Keep command/control authorization on the OrbitPC control plane.

---

# 10. Command Protocol

All commands should use versioned typed envelopes.

Example:

```json
{
  "v": 1,
  "type": "command.request",
  "commandId": "cmd_123",
  "idempotencyKey": "idem_123",
  "computerId": "pc_123",
  "name": "system.lock",
  "args": {},
  "createdAt": "2026-01-01T00:00:00Z",
  "expiresAt": "2026-01-01T00:01:00Z"
}
```

Result:

```json
{
  "v": 1,
  "type": "command.result",
  "commandId": "cmd_123",
  "status": "succeeded",
  "sequence": 1,
  "result": {},
  "error": null
}
```

Every command should have:

- Unique command ID
- Idempotency key
- Expiration
- Computer ID
- Authorization context
- Schema validation
- Stable error code

---

# 11. Initial Allowlisted Commands

## System

```text
system.getStatus
system.lock
system.sleep
system.restart
system.shutdown
```

Destructive operations must require explicit confirmation.

## Applications

```text
app.listApproved
app.launch
```

Only approved applications should be launchable.

## Clipboard

```text
clipboard.getText
clipboard.setText
```

Clipboard synchronization should be opt-in.

## Notifications

```text
notification.show
```

## Future

```text
file.list
file.upload
file.download
screen.start
screen.stop
input.mouse
input.keyboard
audio.start
audio.stop
```

---

# 12. Remote Desktop

Remote desktop should be implemented after the secure command foundation.

Development progression:

### Stage 1 — Screen snapshots

Capture periodic screenshots and send compressed images.

### Stage 2 — View-only streaming

Add continuous screen streaming.

### Stage 3 — WebRTC

Use WebRTC for low-latency media.

### Stage 4 — Remote input

Add:

- Mouse movement
- Left/right click
- Double click
- Scroll
- Drag
- Keyboard
- Touch gestures

### Stage 5 — Advanced control

Add:

- Multi-monitor
- Monitor switching
- Resolution awareness
- Adaptive quality
- FPS controls
- Bitrate controls

---

# 13. Screen Streaming Pipeline

```text
Windows Desktop
      │
      ▼
Screen Capture
      │
      ▼
Frame Processing
      │
      ▼
Hardware/Software Encoding
      │
      ▼
WebRTC / Local Transport
      │
      ▼
Android Decoder
      │
      ▼
Phone Display
```

The implementation should adapt to:

- Network bandwidth
- Device performance
- Battery level
- Resolution
- FPS
- Latency

Recommended user controls:

```text
Quality:
Low
Medium
High
Ultra

FPS:
15
30
60

Resolution:
Auto
720p
1080p
Source
```

---

# 14. Touchpad Mode

The phone screen becomes a laptop-style touchpad.

Gestures:

```text
One finger      → Move cursor
Single tap      → Left click
Double tap      → Double click
Two fingers     → Scroll
Two-finger tap  → Right click
Drag            → Mouse drag
Pinch           → Optional zoom
```

Add sensitivity settings:

```text
Cursor speed
Acceleration
Scroll speed
Tap-to-click
Natural scrolling
```

---

# 15. Keyboard Mode

The phone can act as a PC keyboard.

Support:

- Alphabet
- Numbers
- Symbols
- Enter
- Escape
- Tab
- Backspace
- Shift
- Ctrl
- Alt
- Windows key
- Function keys
- Arrow keys

Special combinations:

```text
Ctrl+C
Ctrl+V
Ctrl+X
Ctrl+Z
Alt+Tab
Ctrl+Shift+Esc
Win+D
```

High-risk system shortcuts should require explicit user action and should not be accidentally triggered by gestures.

---

# 16. Gesture Controller

Optional gesture mapping:

```text
Swipe up       → Volume up
Swipe down     → Volume down
Two-finger tap → Right click
Three-finger tap → Custom action
Pinch          → Zoom
Long press     → Right click
```

Allow users to customize mappings.

---

# 17. File Manager

File management should be scoped.

Do not expose the entire PC filesystem by default.

Example approved folders:

```text
Documents
Downloads
Pictures
Desktop
OrbitPC Shared
```

Security requirements:

- Path containment
- Allowed-directory policies
- File size limits
- Transfer quotas
- Hash verification
- Resumable transfers
- Chunked uploads/downloads
- Optional malware scanning
- User confirmation for sensitive operations

---

# 18. Clipboard Sync

Features:

- PC → phone
- Phone → PC
- Manual sync
- Optional automatic sync

Security:

- Explicit permission
- Disable automatic synchronization by default if appropriate
- Avoid retaining clipboard history on the server
- Do not log clipboard contents

---

# 19. Audio

Possible features:

- PC audio → phone
- Media controls
- Volume control
- Mute
- Playback status

Audio streaming should preferably use a direct WebRTC/media path rather than sending continuous media through the command database.

---

# 20. Multi-Monitor Support

Detect:

```text
Monitor 1
Monitor 2
Monitor 3
```

Mobile UI:

```text
[ Monitor 1 ]
[ Monitor 2 ]
[ Monitor 3 ]
[ All / Combined ]
```

Allow:

- Switch monitor
- Fit-to-screen
- Native aspect ratio
- Resolution awareness

---

# 21. Database

Recommended entities:

```text
users
user_sessions
computers
computer_credentials
pairing_sessions
command_policies
commands
command_events
audit_events
file_transfers
```

Important constraints:

- Unique computer identity
- Revocable sessions
- Command expiration
- Idempotency keys
- Ownership relationships
- Audit timestamps
- Index frequently queried fields

Never store raw authentication secrets.

---

# 22. REST API

Base:

```text
/api/v1
```

Authentication:

```text
POST /auth/register
POST /auth/login
POST /auth/refresh
POST /auth/logout
POST /auth/revoke
```

Computers:

```text
GET  /computers
GET  /computers/:id
DELETE /computers/:id
POST /computers/:id/revoke
```

Pairing:

```text
POST /pairing/start
POST /pairing/approve
POST /pairing/complete
```

Commands:

```text
POST /computers/:id/commands
GET  /commands/:id
GET  /computers/:id/commands
```

Audit:

```text
GET /computers/:id/audit
```

Policies:

```text
GET /computers/:id/policies
PATCH /computers/:id/policies
```

---

# 23. WebSocket Architecture

Use:

```text
HTTPS
WSS
```

Connection flow:

```text
Connect
   ↓
Authenticate
   ↓
Validate device
   ↓
Join private computer room
   ↓
Heartbeat
   ↓
Command relay
   ↓
Result
```

Requirements:

- Heartbeats
- Reconnection
- Authentication
- Private rooms
- Rate limiting
- Command expiration
- Duplicate detection
- Sequence numbers

---

# 24. Reliability

Connection states:

```text
Online
Connecting
Offline
Reconnecting
Action queued
Retrying
Uncertain
```

Do not blindly queue destructive actions while offline.

Command expiration:

```text
Default: 60 seconds
```

Use exponential backoff for reconnect attempts.

After PC restart, reconcile state rather than replaying destructive commands.

---

# 25. Security Threat Model

Threats:

- Stolen mobile device
- Stolen refresh token
- Account takeover
- Rogue pairing
- Compromised server
- Replay attacks
- Malicious command payload
- Exposed PC
- Credential theft
- File abuse
- Sensitive logs
- Denial of service
- Unauthorized screen/input access

Mitigations:

- Strong authentication
- Token rotation
- Device revocation
- Pairing approval
- TLS
- Schema validation
- Allowlisted commands
- Command expiration
- Idempotency
- Rate limiting
- Audit logs
- Least privilege
- Local confirmation for high-risk actions

---

# 26. Privacy

Users should have independent permissions for:

```text
Clipboard
App launching
Shutdown/restart
File access
Screen viewing
Mouse control
Keyboard control
Audio
```

Avoid storing:

- Screen recordings
- File contents
- Clipboard contents
- Keyboard data

unless explicitly required and authorized.

---

# 27. Repository Structure

```text
orbitpc/
│
├── apps/
│   ├── mobile/
│   │   ├── app/
│   │   ├── components/
│   │   ├── screens/
│   │   ├── navigation/
│   │   ├── services/
│   │   ├── store/
│   │   ├── hooks/
│   │   └── utils/
│   │
│   ├── server/
│   │   ├── src/
│   │   │   ├── auth/
│   │   │   ├── pairing/
│   │   │   ├── computers/
│   │   │   ├── commands/
│   │   │   ├── websocket/
│   │   │   ├── audit/
│   │   │   ├── policies/
│   │   │   └── webRTC/
│   │   └── prisma/
│   │
│   └── agent/
│       ├── src/
│       │   ├── service/
│       │   ├── session/
│       │   ├── commands/
│       │   ├── input/
│       │   ├── screen/
│       │   ├── files/
│       │   ├── audio/
│       │   ├── bluetooth/
│       │   ├── lan/
│       │   ├── networking/
│       │   └── security/
│       └── installer/
│
├── packages/
│   ├── protocol/
│   ├── config/
│   ├── validation/
│   └── ui/
│
├── infra/
│   ├── docker/
│   ├── nginx/
│   ├── postgres/
│   └── turn/
│
├── docs/
│   ├── architecture.md
│   ├── security.md
│   ├── protocol.md
│   ├── pairing.md
│   └── threat-model.md
│
├── tests/
│
├── .github/
│   └── workflows/
│
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.json
└── plan.md
```

---

# 28. Mobile Screen Structure

```text
Onboarding
│
├── Sign In
├── Sign Up
└── Pair PC

Home
│
├── Computers
│   └── PC Card
│       ├── Online status
│       ├── CPU
│       ├── RAM
│       └── Connection
│
└── Selected PC
    ├── Dashboard
    ├── Remote Screen
    ├── Touchpad
    ├── Keyboard
    ├── Files
    ├── Clipboard
    ├── Audio
    ├── Apps
    ├── Activity
    └── Settings
```

---

# 29. PC Tray Application

Tray interface:

```text
OrbitPC
──────────────
● Connected

Computer:
My-PC

Network:
LAN + Internet

Permissions:
Screen       ON
Input        ON
Clipboard    OFF
Files        OFF

[Pair Device]
[Security]
[Disconnect]
[Exit]
```

Include an obvious emergency disconnect.

---

# 30. Development Phases

## Phase 1 — Foundation

Build:

- Monorepo
- TypeScript configuration
- Shared protocol
- Server
- PostgreSQL
- Prisma
- Mobile shell
- Windows agent shell

Deliverable:

```text
Mobile ↔ Server ↔ Agent
```

with authenticated connectivity.

---

## Phase 2 — Secure Pairing

Implement:

- Account authentication
- PC registration
- QR pairing
- Device identity
- Token storage
- Revocation
- Presence

Deliverable:

```text
Phone securely paired with PC
```

---

## Phase 3 — Command-Control MVP

Implement:

- PC status
- Lock
- Sleep
- Restart
- Shutdown
- Approved app launch
- Notifications
- Clipboard
- Audit history

Deliverable:

```text
Secure remote PC control
```

---

## Phase 4 — Bluetooth

Implement:

- Bluetooth discovery
- Secure local pairing
- Connection state
- Basic command transport
- Mouse/keyboard transport

Deliverable:

```text
Phone ↔ Bluetooth ↔ PC
```

without Internet.

---

## Phase 5 — LAN

Implement:

- Local discovery
- Direct LAN connection
- Low-latency commands
- Screen snapshots
- Screen streaming foundation
- Mouse
- Keyboard

Deliverable:

```text
Phone ↔ Wi-Fi ↔ PC
```

---

## Phase 6 — Remote Desktop

Implement:

- Screen capture
- Encoding
- Streaming
- Touchpad
- Mouse
- Keyboard
- Gestures
- Adaptive quality
- FPS selection

Deliverable:

```text
Phone as remote monitor + controller
```

---

## Phase 7 — Internet Mode

Implement:

- WSS relay
- NAT traversal
- STUN
- TURN
- WebRTC signaling
- WebRTC media/data
- Connection fallback

Deliverable:

```text
Phone ↔ Internet ↔ PC
```

---

## Phase 8 — File Manager

Implement:

- Approved folders
- Directory browsing
- Upload
- Download
- Chunking
- Resume
- Hash verification
- Quotas
- Transfer progress

---

## Phase 9 — Audio

Implement:

- PC audio capture
- Audio encoding
- WebRTC audio
- Volume
- Mute
- Playback control

---

## Phase 10 — Multi-Monitor

Implement:

- Monitor detection
- Monitor switching
- Per-monitor streaming
- Combined desktop
- Resolution handling

---

## Phase 11 — Production Hardening

Implement:

- Security testing
- Penetration testing
- Rate limiting
- Revocation
- Logging
- Monitoring
- Crash reporting
- Signed updates
- Windows installer
- Mobile release builds
- Server deployment
- Backup and recovery

---

# 31. Testing Strategy

## Unit Tests

Test:

- Protocol validation
- Authentication
- Authorization
- Command schemas
- Path containment
- Idempotency
- Permission checks

## Integration Tests

Test:

```text
Mobile → Server → Agent
```

including:

- Disconnects
- Reconnects
- Expired commands
- Duplicate commands
- Revocation

## Security Tests

Test:

- Invalid JWT
- Expired JWT
- Replayed command
- Invalid computer ID
- Unauthorized pairing
- Unauthorized command
- Path traversal
- Oversized payload
- Malicious file
- Rate-limit bypass

## Performance Tests

Measure:

- Screen FPS
- Input latency
- CPU usage
- RAM usage
- Battery usage
- Network bandwidth
- File transfer speed

---

# 32. Deployment

## Development

```text
Docker Compose
├── Server
├── PostgreSQL
├── Redis
└── TURN
```

## Production

Recommended:

```text
Reverse Proxy
     │
     ▼
OrbitPC API / WSS
     │
 ┌───┴────┐
 │        │
Postgres Redis
```

TURN should be deployed separately as required.

Use:

- HTTPS
- WSS
- TLS certificates
- Environment secrets
- Database backups
- Monitoring
- Log aggregation

---

# 33. Performance Goals

Initial targets:

```text
Command latency on LAN:
< 50 ms target

Interactive remote input:
Low-latency priority

Screen:
30 FPS target
60 FPS optional

LAN:
High quality / low latency

Internet:
Adaptive quality

File transfer:
Resume after interruption
```

Actual performance should be measured rather than assumed.

---

# 34. MVP Definition

OrbitPC MVP is complete when:

- A Windows PC can securely pair with a mobile device
- Mobile can authenticate
- PC maintains an outbound secure connection
- Mobile can see PC online/offline state
- Allowlisted commands work
- Destructive commands require confirmation
- Commands are validated by both server and agent
- Duplicate commands are not accidentally executed
- Revocation works
- Important actions are auditable
- PC requires no public inbound control port
- Disconnect/reconnect does not replay destructive operations

---

# 35. Full OrbitPC Definition

The complete product is achieved when the user can:

```text
Open OrbitPC
      ↓
Select PC
      ↓
Connect via Bluetooth / LAN / Internet
      ↓
View PC screen
      ↓
Touch screen to control mouse
      ↓
Use phone keyboard
      ↓
Use gestures
      ↓
Open applications
      ↓
Browse files
      ↓
Transfer files
      ↓
Sync clipboard
      ↓
Control audio
      ↓
Switch monitors
      ↓
Disconnect securely
```

---

# 36. Future Features

Potential future extensions:

- Multiple PCs
- Multiple mobile controllers
- Remote Wake-on-LAN
- Scheduled actions
- Smart automation
- Game/controller mode
- Presentation mode
- Media-center remote
- Remote webcam preview
- Remote microphone
- Device health dashboard
- Bandwidth diagnostics
- Connection quality indicator
- Custom gesture profiles
- Per-application control profiles
- Team/family access with explicit permissions

Collaborative or unattended access should only be added after a dedicated security/threat review.

---

# 37. Important Security Restrictions

Never make these default features:

```text
❌ Arbitrary shell execution
❌ Arbitrary PowerShell execution
❌ Public PC listening port
❌ Permanent plaintext credentials
❌ Silent screen capture
❌ Silent keyboard capture
❌ Silent clipboard collection
❌ Unlimited filesystem access
❌ Bypassing UAC
❌ Bypassing secure desktop
❌ DRM/security-boundary bypass
```

OrbitPC should remain a user-authorized remote-control system, not a generic remote-access backdoor.

---

# 38. Recommended Build Order

The most practical order is:

```text
1. Monorepo
        ↓
2. Server
        ↓
3. Database
        ↓
4. Authentication
        ↓
5. PC Agent
        ↓
6. Secure Pairing
        ↓
7. WSS Connection
        ↓
8. Command Protocol
        ↓
9. Basic PC Commands
        ↓
10. Bluetooth
        ↓
11. LAN
        ↓
12. Screen Capture
        ↓
13. Remote Input
        ↓
14. WebRTC
        ↓
15. Internet Remote Desktop
        ↓
16. File Transfer
        ↓
17. Clipboard
        ↓
18. Audio
        ↓
19. Multi-Monitor
        ↓
20. Security Hardening
        ↓
21. Release
```

---

# 39. Final Architecture Goal

```text
                         ┌───────────────────┐
                         │   Android App     │
                         │                   │
                         │ Dashboard         │
                         │ Touchpad          │
                         │ Keyboard          │
                         │ Remote Screen     │
                         │ Files             │
                         │ Clipboard         │
                         │ Audio             │
                         └─────────┬─────────┘
                                   │
                  ┌────────────────┼────────────────┐
                  │                │                │
              Bluetooth           LAN            Internet
                  │                │                │
                  └────────────────┼────────────────┘
                                   │
                           ┌───────▼────────┐
                           │ OrbitPC Server  │
                           │                 │
                           │ Auth            │
                           │ Pairing         │
                           │ Authorization   │
                           │ Command Relay   │
                           │ Presence        │
                           │ Audit           │
                           │ WebRTC Signaling│
                           └───────┬─────────┘
                                   │
                                  WSS
                                   │
                           ┌───────▼────────┐
                           │ Windows Agent   │
                           │                 │
                           │ Service         │
                           │ Session Helper  │
                           │ Input           │
                           │ Screen          │
                           │ Files           │
                           │ Audio           │
                           │ Bluetooth       │
                           └─────────────────┘
```

---

# 40. Project Success Criteria

OrbitPC should ultimately provide:

- Secure pairing
- Strong authentication
- Encrypted communication
- Local Bluetooth operation
- Local LAN operation
- Internet operation
- Remote screen viewing
- Mouse control
- Keyboard control
- Touch/gesture control
- File management
- Clipboard synchronization
- Audio streaming/control
- Multi-monitor support
- Reliable reconnection
- Permission controls
- Auditability
- Revocation
- Least-privilege PC execution
- No unnecessary public PC exposure

The system should be developed incrementally, with the secure command/control foundation completed before enabling full remote desktop and remote input capabilities.
