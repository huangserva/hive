# M19 native app architecture design

**Date**: 2026-05-25
**Paired report**: `.hive/reports/m19-native-app-architecture-2026-05-25.html`
**Dispatch**: `c8867a7c-f157-4ed9-84cb-37d3cfa68a5d`

## Context

User rejected the previous PWA-first recommendation and explicitly asked for the best native app direction:

- Native app, not PWA.
- Do not avoid hard work because it is hard.
- Do not avoid native app just because Feishu remote control overlaps part of the surface.
- Design first, no implementation yet.

The ADR `.hive/decisions/2026-05-25-hippoteam-frontend-app.md` is already adopted for native app direction. This note indexes the design sources and decision basis for the full epic plan.

## Epic immutable requirements

- First-party native iOS/Android client, using Expo / React Native unless a later implementation spike disproves it.
- Runtime becomes a stable daemon with versioned HTTP/WS protocols for app clients.
- Mobile must work outside `127.0.0.1`: host pairing + direct LAN + encrypted relay.
- App content includes dashboard, Cockpit data, tasks, workers, agent/terminal panes, and voice-control convergence with M14.
- No downgrade to PWA-only; no public unauthenticated runtime; no relay that can read project/agent content.

## Local paseo source index

- `~/development/paseo/docs/architecture.md`
  - Defines paseo as client-server: daemon manages agents; mobile app, CLI, desktop connect via WebSocket.
  - Relay is optional encrypted bridge for remote access.
  - Desktop app can spawn daemon as managed subprocess.
- `~/development/paseo/docs/product.md`
  - Product strategy: cross-device, self-hosted, BYOK, no forced cloud.
  - Current state includes desktop, mobile, web, CLI, voice mode, scheduled agents.
- `~/development/paseo/packages/app/package.json`
  - Expo / React Native app with Expo Router, React Native Web, WebView, notifications, audio, EAS/Playwright/Maestro tooling.
- `~/development/paseo/packages/app/app.config.js`
  - iOS/Android permissions, EAS updates, Android cleartext HTTP for local hosts, Expo plugins.
- `~/development/paseo/packages/app/src/runtime/host-runtime.ts`
  - `HostRuntimeController` manages direct/relay/socket/pipe connections, probing, connection status, agent directory refresh.
- `~/development/paseo/packages/app/src/types/host-connection.ts`
  - HostConnection variants: direct TCP, direct socket, direct pipe, relay.
- `~/development/paseo/packages/app/src/utils/connection-selection.ts`
  - Chooses best available connection by probe latency.
- `~/development/paseo/packages/relay/src/*`
  - E2E encrypted relay primitives and tests.
- `~/development/paseo/packages/desktop/package.json`
  - Electron wrapper; useful for later desktop shell, not the M19 first target.
- `~/development/paseo/packages/app/src/screens/sessions-screen.tsx`
  - Sessions/agent history as mobile screen reference.
- `~/development/paseo/packages/app/src/screens/projects-screen.tsx`
  - Projects screen reference.
- `~/development/paseo/packages/app/src/panels/*`
  - Agent/file/terminal/browser/draft panels; useful for HippoTeam pane model.

## HippoTeam source index

- `.hive/reports/hippoteam-frontend-app-eval-2026-05-25.html`
  - Previous app route evaluation; useful as baseline but superseded by user native-app decision.
- `.hive/decisions/2026-05-25-hippoteam-frontend-app.md`
  - Adopted native app ADR.
- `.hive/plan.md`
  - M19 now becomes confirmed epic with M19a-M19f phases.
- Current server architecture:
  - `src/server/app.ts` for HTTP app and static serving.
  - `src/server/routes-cockpit.ts`, `src/server/cockpit-websocket-server.ts` for Cockpit API/WS.
  - `src/server/tasks-websocket-server.ts`, `src/server/routes-tasks.ts` for tasks.
  - `src/server/terminal-websocket-server.ts`, `src/server/terminal-stream-hub.ts` for terminal stream.
  - `src/server/routes-team.ts` / team operations for send/report/control.
  - `src/server/routes-runtime.ts` for runtime status.

## External source index

- Expo overview: https://docs.expo.dev/
  - Universal Android/iOS/web app stack.
- Expo Router: https://docs.expo.dev/router/introduction/
  - File-based routing for universal React Native apps.
- EAS: https://docs.expo.dev/tutorial/eas/introduction/
  - Build, Update, Submit workflows for Android/iOS.
- Expo SecureStore: https://docs.expo.dev/versions/latest/sdk/securestore/
  - Encrypted storage; Android Keystore-backed SharedPreferences, iOS Keychain.
- Expo Notifications: https://docs.expo.dev/versions/latest/sdk/notifications/
  - Push/local notifications; production push requires platform credentials.
- Expo Audio: https://docs.expo.dev/versions/latest/sdk/audio/
  - Recording permissions/audio APIs relevant to M14 convergence.
- Cloudflare Tunnel: https://developers.cloudflare.com/tunnel/
  - Reference for mapping public hostname to local services and secure origin connectivity.
- Cloudflare locally-managed tunnels: https://developers.cloudflare.com/tunnel/advanced/local-management/
  - Useful deployment reference for local daemons, but not a substitute for HippoTeam per-device auth/E2E app protocol.

## Design decisions

### App framework

Use Expo / React Native:

- Matches paseo's successful shape.
- Gives iOS/Android first while preserving web option.
- Expo Router and EAS reduce route/build/distribution setup.
- Expo modules cover SecureStore, Notifications, Audio, WebView.

### Daemon protocol

Do not create a separate mobile backend. Upgrade HippoTeam runtime into a stable daemon:

- Reuse current Cockpit/tasks/terminal APIs where possible.
- Add versioned schemas and capability negotiation.
- Add mobile-specific aggregate streams to reduce app chattyness.
- Keep team protocol as backend primitive; expose app-friendly actions with capability checks.

### Remote access

Remote access is required, not optional:

- M19a starts with LAN direct read-only to prove app/dashboard shape.
- M19b adds pairing/auth/capabilities and control.
- M19c adds encrypted relay.
- Relay must not read workspace content; app/daemon own E2E encryption.
- Cloudflare Tunnel can be a personal deployment shortcut but cannot replace product-level device pairing and capability model.

### Terminal strategy

Do not make full PTY input the first slice:

- First: agent transcript reader and last output summaries.
- Later: advanced terminal pane via WebView + xterm reuse, then optional native renderer.
- This keeps M19a useful without pulling terminal binary frame/input correctness into the first phase.

### Voice convergence

M14a Feishu voice command is transitional. Native app becomes the proper voice surface:

- voice-to-text command draft first;
- then audio upload/STT via daemon;
- later realtime voice/TTS/interruptions.

## Proposed M19 phases

- M19a: protocol audit + Expo app skeleton + LAN read-only dashboard.
- M19b: pairing/auth + scoped direct LAN control.
- M19c: encrypted relay remote access.
- M19d: agent/terminal pane + task operations.
- M19e: voice + push convergence.
- M19f: beta hardening/distribution.

Each phase must have a verifier and gate. The report contains the detailed table.

## Open risks

- Mobile remote access expands HippoTeam's threat surface substantially.
- Pairing/auth needs real integration tests and a revocation story.
- Relay protocol requires threat-model review before real use.
- Mobile terminal input is hard and should remain a later phase.
- Expo/RN dependency and native build chain are larger than current web-only stack.

## Recommendation

Proceed with M19a only after user reviews the architecture:

1. freeze mobile API contract and capability model;
2. create Expo/RN app skeleton;
3. implement host profile + LAN direct read-only dashboard;
4. do not implement relay/control/voice until M19a gate passes.
