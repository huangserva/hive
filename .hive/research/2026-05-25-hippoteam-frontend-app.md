# HippoTeam frontend app evaluation

**Date**: 2026-05-25
**Paired report**: `.hive/reports/hippoteam-frontend-app-eval-2026-05-25.html`
**Dispatch**: `1eb7852c-a496-41bc-98fb-aca344eccc31`

## Question

User asked whether HippoTeam should have a frontend APP like paseo, mainly so all tasks are easy to see and there is a dashboard/panel.

The key ambiguity: "APP" can mean installable desktop/web app, desktop shell, or true mobile remote app. The user need is task visibility + dashboard, not necessarily native mobile.

## Local source index

### paseo

- `~/development/paseo/docs/product.md`
  - Product claims desktop, mobile, web, CLI.
  - Core philosophy: cross-device, self-hosted, local-first, BYOK.
  - Current state includes Electron desktop, iOS/Android mobile, web, CLI, voice mode, scheduled agents.
- `~/development/paseo/docs/architecture.md`
  - Client-server architecture: Node daemon manages agents; mobile app, desktop app, CLI connect via WebSocket.
  - App uses direct or relay connection. Relay is optional encrypted bridge for remote access.
  - Desktop app is Electron wrapper and can spawn daemon as managed subprocess.
- `~/development/paseo/packages/app/package.json`
  - Expo / React Native app (`expo`, `react-native`, `expo-router`, `react-native-web`).
  - Supports iOS, Android, web export, Playwright E2E, Maestro flows.
  - Includes voice/audio dependencies and terminal webview dependencies.
- `~/development/paseo/packages/app/app.config.js`
  - Expo app config, iOS/Android permissions, EAS updates, web single output.
  - Android allows cleartext HTTP for local network hosts.
- `~/development/paseo/packages/app/public/manifest.json`
  - PWA manifest: `display: "standalone"`, icons, start URL, theme/background colors.
- `~/development/paseo/packages/desktop/package.json`
  - Electron wrapper around the app/server/cli, with electron-builder and auto-update pieces.
- `~/development/paseo/packages/app/src/runtime/host-runtime.ts`
  - HostRuntimeController tracks saved host connections, direct/relay/socket/pipe connections, probing, online/offline/error states, agent directory refresh.
- `~/development/paseo/packages/app/src/types/host-connection.ts`
  - HostConnection union includes direct TCP, direct socket, direct pipe, relay.
- `~/development/paseo/packages/app/src/screens/sessions-screen.tsx`
  - Sessions screen renders agent history via AgentList.
- `~/development/paseo/packages/app/src/screens/projects-screen.tsx`
  - Project list and project settings routing.

### HippoTeam

- `CLAUDE.md`
  - HippoTeam shape: local Node runtime + browser web UI, PM-driven multi-agent workspace.
  - Current Cockpit is PM dashboard.
  - Feishu bridge already handles remote control and approval.
- `.hive/plan.md`
  - M14 is mobile + voice direction; M14a already chose Feishu voice command MVP.
  - Cockpit, Reports tab, RuntimeStatusStrip, PM co-maintenance are shipped.

## External source index

- MDN PWA installability: https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable
  - PWA install needs manifest and secure context; localhost/127.0.0.1 qualify.
  - Installed PWA can launch standalone with app icon.
- Tauri: https://tauri.app/
  - Tauri 2.0 positions as small/secure/cross-platform; supports existing web frontend and desktop/mobile.
- Electron: https://www.electronjs.org/
  - Mature cross-platform desktop app framework, Chromium + Node, app installers, auto-update ecosystem.
- Expo: https://docs.expo.dev/
  - Universal Android/iOS/web app stack. Relevant if HippoTeam decides to build native mobile.

## Findings

### What paseo does

Paseo has a real cross-device architecture, not only a web dashboard:

1. A local daemon owns agent processes and WebSocket protocol.
2. Expo app is a cross-platform client for mobile and web.
3. Electron desktop app wraps the web app and can manage a local daemon subprocess.
4. Relay solves remote access without opening local ports directly.
5. The app includes host profiles, direct/relay connection selection, sessions/projects/workspaces, terminal and agent panes, voice features.

The important lesson is not "use Expo" directly. The lesson is that mobile app only works because paseo also built host connection, pairing, relay, reconnection, and daemon protocol boundaries.

### What HippoTeam already has

HippoTeam already has a good dashboard substrate:

- Cockpit 9 tabs for PM docs.
- Tasks tab / task graph.
- Workers status cards.
- Feishu bridge for remote control.
- RuntimeStatusStrip for local runtime identity.

Therefore "frontend app" should first mean "make the current dashboard installable and app-like", not "rewrite UI in React Native".

## Option comparison

### Option A: PWA-first

Add manifest/icons/standalone display/install CTA to existing web app. Consider dashboard-first layout later. Do not aggressively cache realtime API/WS state.

Pros:
- Lowest work.
- Directly reuses current React web UI and Cockpit.
- Satisfies "方便看任务 + 面板" for local desktop/laptop users.
- Localhost is valid for PWA installability.

Cons:
- Does not solve remote mobile access by itself.
- Runtime still needs to be running separately.

### Option B: Tauri/Electron desktop shell

Package existing web UI and manage local runtime lifecycle from a desktop app.

Pros:
- Stronger "real app" feel.
- Can own tray, logs, auto-start, deep links, native open-file behavior.
- Electron is what paseo uses for desktop; Tauri offers smaller app size.

Cons:
- New build/sign/update chain.
- More security surface.
- Does not solve phone remote access.
- Overkill if dashboard visibility is the main ask.

### Option C: Expo / React Native mobile app

Build new mobile client with host pairing, auth, push, dashboard, possibly voice.

Pros:
- Best long-term mobile UX.
- Can converge with M14 voice/mobile direction.
- Can support native notifications, voice, QR pairing.

Cons:
- Largest scope.
- Requires remote access layer because HippoTeam binds `127.0.0.1`.
- Overlaps with Feishu bridge for remote control.
- Needs app distribution, certificates, mobile testing, security model.

## Recommendation

Use PWA-first:

1. M-app-1: manifest/icons/standalone/install CTA for existing HippoTeam web.
2. M-app-2: dashboard-first layout using Cockpit summary + Tasks + Workers.
3. M-app-3: only if PWA is not enough, spike Tauri/Electron desktop shell for runtime lifecycle.
4. M-app-4: only if Feishu remote control cannot satisfy visual dashboard needs, design mobile app + relay/tunnel.

## Decision basis

- User need is task visibility/dashboard, not explicit native mobile.
- HippoTeam web already has the dashboard data and components.
- Runtime loopback binding makes mobile remote app a backend/security problem, not just a frontend task.
- Feishu bridge is already the chosen remote-control path for M14a.
- PWA gives immediate app-like UX with the least duplicated surface.

## Follow-up if accepted

- Implement PWA manifest/icons/install CTA.
- Keep service worker minimal or absent for first slice to avoid stale realtime UI.
- Design dashboard-first view without removing Cockpit drawer.
- Add ADR confirmation if user accepts PWA-first route.
