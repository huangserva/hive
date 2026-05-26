# HippoTeam Mobile

HippoTeam Mobile is the native companion app for a local HippoTeam runtime. It gives paired phones a compact dashboard for workspaces, Cockpit status, workers, tasks, voice dispatch, and control actions.

## Requirements

- Node.js 22+
- pnpm 10+
- Expo CLI (`npx expo`)
- iOS Simulator, Android Emulator, or a physical device with Expo Go / development build

## Development

```sh
cd packages/mobile
npx expo start
```

The app is LAN-first. Enter the host running Hive, for example `192.168.1.20:4010`, then pair with a code generated from the HippoTeam web settings page.

## Pairing Flow

1. Open HippoTeam web on the host machine.
2. Generate a mobile pairing code from Workspace Settings.
3. Open the mobile app Settings tab.
4. Enter the runtime host and six-digit pairing code.
5. The app stores the device token in SecureStore and registers an Expo push token when notification permission is granted.

Manual token entry remains available as an advanced fallback for development.

## EAS Builds

Internal preview builds are configured in `eas.json`.

```sh
cd packages/mobile
eas build --profile preview --platform ios
eas build --profile preview --platform android
```

Production submit settings intentionally use `PLACEHOLDER` values. Replace them with the Apple ID, ASC app ID, and Google Play service account file before a store submission.

## Architecture

- **LAN-first transport**: direct HTTP and WebSocket calls to the local runtime.
- **Relay fallback**: encrypted relay transport is available when pairing returns relay metadata.
- **E2E encryption**: relay frames use the shared `packages/relay-crypto` NaCl channel.
- **Capability gates**: device tokens carry capabilities such as `read_dashboard`, `send_prompt`, `approve_risk`, and `admin_runtime`.
- **Push notifications**: worker completion and high-priority Cockpit actions use Expo push as best-effort delivery.
- **Voice control**: voice recordings are transcribed by the runtime and inserted into dispatch prompts.
