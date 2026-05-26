# Risk Hotspots

> Known risks, triggers, and current workaround. Keep this operational.

## Mobile LAN auth / capability control

- Risk: `mobile_devices` tokens now authorize dashboard reads and control actions; a scope bug can expose dispatch/stop/restart to the wrong device or workspace.
- Trigger: schema v25+ migration, `routes-mobile.ts` control endpoints, `mobile-auth.ts` capability edits, device revoke/expiry changes.
- Current mitigation: `mobile-pairing-integration.test.ts`, `mobile-routes.test.ts`, `mobile-auth.test.ts` cover HTTP+SQLite auth, capability denial, revoke, expiry, and workspace isolation.
- Watch: every new `/api/mobile/*` or `relay-rpc-handler.ts` method must name the required capability explicitly.

## Mobile client transport split

- Risk: mobile client behavior can diverge between LAN HTTP/WS and relay JSON-RPC fallback.
- Trigger: edits to `packages/mobile/src/api/client.ts`, `mobile-runtime-context.tsx`, `relay-transport.ts`, or server endpoint response shapes.
- Current mitigation: `mobile-api-client.test.ts` covers LAN client shapes; `packages/mobile/__tests__/relay-transport.test.ts` covers relay handshake/call/fallback.
- Watch: adding a control endpoint must update both LAN route mapping and relay method mapping.

## Relay / E2E channel

- Risk: relay should forward opaque frames only; auth, room cleanup, and handshake mismatch can cause data leak or stuck mobile sessions.
- Trigger: changes in `packages/relay/src/relay-server.ts`, `packages/relay-crypto/src/*`, `src/server/relay-connector.ts`, `src/server/relay-rpc-handler.ts`.
- Current mitigation: relay server unit tests, relay-crypto tests, relay connector/RPC unit tests.
- Gap: no real cross-process relay integration test yet; MVP verifies pieces, not full daemon↔relay↔mobile path under packet loss.

## Push notifications

- Risk: Expo push is best-effort; duplicate or stale tokens can spam users or silently drop worker-done/high-aiAction alerts.
- Trigger: worker report path in `team-operations.ts`, Cockpit high action changes, `mobile-push.ts`, mobile `notifications.ts`.
- Current mitigation: `mobile-push.test.ts` covers sends, invalid-token cleanup, and dedupe; push failure does not fail runtime work.
- Watch: new high-priority aiAction types must use stable IDs/hashes before being pushed.

## Voice / local STT

- Risk: voice control depends on local binaries and mobile recording permissions; failures can look like dispatch bugs.
- Trigger: `local-stt.ts`, `/api/mobile/voice/transcribe`, `VoiceRecordButton.tsx`, Expo audio dependency changes.
- Current mitigation: `local-stt.test.ts`, `voice-transcribe.test.ts`, and relay voice RPC test cover provider fallback and API shape.
- Watch: cross-platform behavior beyond macOS remains thin; verify iOS/Android recording paths before beta.

## Sentinel / orphaned dispatch detection

- Risk: sentinel and worker-exit fallback can misclassify a slow worker as stale/orphaned, or miss a real stuck dispatch.
- Trigger: `sentinel-heartbeat.ts`, `orphaned-dispatch-nudge.ts`, `workspace-store-mutations.ts`, dispatch ledger state changes.
- Current mitigation: sentinel heartbeat tests and orphaned-dispatch-nudge unit tests cover stale age, worker exit, pending count reset.
- Watch: do not let sentinel role receive normal dispatch nudges; sentinel should observe, not become another worker backlog source.

## PM nudge mechanisms

- Risk: L1 nudges are helpful but can become noisy or race with normal Cockpit watcher updates.
- Trigger: `tasks-narrative-nudge.ts`, `milestone-completion-trigger.ts`, `runtime-store-helpers.ts` plan/tasks listeners.
- Current mitigation: unit tests cover trigger rules, dedupe, no-action suppression; plan websocket/tasks watcher tests still pass.
- Boundary: nudge injection is best-effort; inactive orchestrator PTY means no queued reminder.

## Dispatch lifecycle / stdin forwarding

- Risk: DB state, in-memory pending counts, and PTY stdin writes can diverge on start/stop/report/cancel edge cases.
- Trigger: `team-operations.ts`, `dispatch-ledger-store.ts`, `agent-stdin-dispatcher.ts`, `agent-runtime*.ts`.
- Current mitigation: team atomicity, team protocol e2e, authz, CLI side-effect, and lifecycle tests cover real HTTP+SQLite+PTY paths.
- Rule: DB/ledger mutations must succeed before in-memory state updates; failed stdin forwarding must not corrupt dispatch state.

## Worker settings / startup command persistence

- Risk: worker description/preset/startup command edits can desync UI, SQLite, `team list`, and PTY launch behavior.
- Trigger: `WorkerSettingsDialog.tsx`, `routes-workspaces.ts`, schema v24, `team-list-serializer.ts`, `post-start-input-writer.ts`.
- Current mitigation: runtime-store/runtime-rehydration/app tests cover listWorkers shape and OpenCode startup injection.
- Watch: `TeamListItem` wire format is public CLI/API surface; preserve snake_case serialization.

## Web worker controls / terminal UI

- Risk: start/stop controls and pinned terminal prompt can conflict with live PTY output, scrollback, and batch actions.
- Trigger: `WorkersPane.tsx`, `WorkerCard.tsx`, `useTerminalRun.ts`, terminal mirror/flow-control code.
- Current mitigation: web worker-flow, worker-status-display, terminal-view, terminal-flow-control, terminal-ws tests.
- Watch: UI tests use real server for worker flows; avoid replacing with fetch-only mocks.

## Terminal backpressure and websocket fan-out

- Risk: slow viewers can pause PTY output; watcher/WS snapshot races can cause flaky first messages.
- Trigger: large terminal output, client not acking, concurrent full test suite, plan/cockpit/tasks watchers.
- Current mitigation: terminal flow-control tests, guarded upgrade handlers, mirror scrollback, plan/cockpit/tasks websocket tests.
- Watch: `/ws/plan`, `/ws/cockpit`, `/ws/tasks`, `/ws/mobile/*` should send one snapshot before updates.

## Feishu transport / approvals / local STT bridge

- Risk: Feishu is both remote-control surface and voice entry; inbound delays or approval restart gaps can block high-risk operations.
- Trigger: Lark SDK reconnect, invalid credentials, app permission changes, runtime restart during approval.
- Current mitigation: transport status indicator, in-memory approval ledger with expired/processed card responses, local STT graceful fallback.
- Watch: production logs under `~/.config/hive/logs/runtime-<port>.log`; do not persist Feishu secrets in `.hive/`.

## Baseline and PM docs drift

- Risk: `.hive/baseline/*.md`, plan, and tasks can stale faster than code during M19/M13 rollout.
- Trigger: schema migrations, mobile/relay additions, PM nudge mechanisms, Done backlog growth.
- Current mitigation: baseline staleness git-log detector, Cockpit baseline aiAction, milestone completion nudge.
- Rule: keep each baseline file under 200 lines; refresh after milestone-scale changes, not only after user notices.

## Web asset serving and port confusion

- Risk: user sees stale UI, missing fonts, or broken chunks after rebuild; dev/prod ports can hide the real cause.
- Trigger A: Vite dev 5180 HMR reloads while user works.
- Trigger B: prod 4010 `pnpm build:web` changes content hashes; old tabs request removed assets.
- Current mitigation: index no-cache / assets immutable, preload failure auto-reload, reconnecting websocket backoff.
- Check: user should use 4010 for runtime UI; 5180 is dev HMR.

## Package / beta distribution

- Risk: mobile beta config can drift from actual runtime protocol or fail store builds late.
- Trigger: `packages/mobile/app.config.ts`, `eas.json`, native permissions, Expo dependency changes.
- Current mitigation: mobile README + EAS config + package typecheck; no real EAS build without Apple/Google credentials.
- Watch: before TestFlight/internal release, run device smoke for pairing, push permission, voice record, relay fallback.

## Local data and secrets

- Risk: `.hive/` docs are workspace state; credentials and runtime DB/logs live under `~/.config/hive`.
- Trigger: committing generated docs, reports, local config, runtime sqlite/logs, Expo credentials.
- Current mitigation: `.hive/` mostly ignored after v2.0.0; pre-commit governance checks reports/research pairing.
- Check: before commit, review `git status --short`; only force-add intentional baseline docs.
