# Risk Hotspots

> Known risks, triggers, and current workaround. Keep this operational.

## Mobile LAN auth / capability control

- Risk: `mobile_devices` tokens now authorize dashboard reads and control actions; a scope bug can expose dispatch/stop/restart to the wrong device or workspace.
- Trigger: schema v25+ migration, `routes-mobile.ts` control endpoints, `mobile-auth.ts` capability edits, device revoke/expiry changes.
- Current mitigation: `mobile-token-integration.test.ts`, `mobile-routes.test.ts`, `mobile-auth.test.ts` cover HTTP+SQLite auth, capability denial, deletion/revoke behavior, and workspace isolation.
- Watch: every new `/api/mobile/*` or `relay-rpc-handler.ts` method must name the required capability explicitly.

## Mobile client transport split

- Risk: mobile client behavior can diverge between LAN HTTP/WS and relay JSON-RPC fallback.
- Trigger: edits to `packages/mobile/src/api/client.ts`, `mobile-runtime-context.tsx`, `relay-transport.ts`, or server endpoint response shapes.
- Current mitigation: `mobile-api-client.test.ts` covers LAN client shapes; `packages/mobile/__tests__/relay-transport.test.ts` covers relay handshake/call/fallback.
- Watch: adding a control endpoint must update both LAN route mapping and relay method mapping.

## Aliyun relay hard cut rollout

- Risk: **存量手机只有装到带迁移逻辑的新 APK，`SecureStore` 里的 relay 配置才会从 `dmit.servasyy.com` 迁到 `aliyun.servasyy.com`**；旧包会继续拿旧 host 连接。
- Trigger: `packages/mobile/src/lib/relay-config-store.ts`, `packages/mobile/src/api/mobile-runtime-context.tsx`, `packages/mobile/app/(tabs)/settings.tsx`, 以及任何新的 pairing / relay config 写入路径。
- Current mitigation: `relay-config-store.test.ts` 覆盖 build-time 与 read-time 迁移；`mobile-runtime-webrtc-disconnect.test.ts` 覆盖 hydration 后回写持久化；settings cluster tests 已覆盖旧 relay URL 在 UI/runtime 中的读写链路。
- Watch: 线上切换时必须把 **新 APK、QR/pairing 原文、Mac `~/.config/hive/relay.json`、公网 relay deploy 模板、以及 WebRTC/TURN 对外口径** 一起切到 aliyun；否则会出现新旧 host 混跑。
- Residual: **旧 QR 原始内容仍可能写着 dmit**；新 app 会迁移后再落盘，但旧 app 不会，且 user 如果长期不升级就不会触发迁移。

## Push notifications

- Risk: Expo push is best-effort; duplicate or stale tokens can spam users or silently drop worker-done/high-aiAction alerts.
- Trigger: worker report path in `team-operations.ts`, Cockpit high action changes, `mobile-push.ts`, mobile `notifications.ts`.
- Current mitigation: `mobile-push.test.ts` covers sends, invalid-token cleanup, and dedupe; push failure does not fail runtime work.
- Watch: new high-priority aiAction types must use stable IDs/hashes before being pushed.

## Voice / local STT

- Risk: voice control depends on local/native ASR/TTS binaries, Android audio session behavior, and mobile recording permissions; failures can look like dispatch bugs.
- Trigger: `local-stt.ts`, `streaming-stt-online.ts`, `/api/mobile/voice/transcribe`, WebRTC upstream/downlink voice paths, `VoiceRecordButton.tsx`, Expo audio dependency changes.
- Current mitigation: STT main path has moved from Whisper to Paraformer via `sherpa-onnx` 1.13.2; recognizer is module-level cached (`760ec6a`) instead of reloading the 78MB model per utterance. App side adds Silero `voice_prob` quality gate (`00adc92`) to drop low-quality segments locally. TTS defaults to edge-tts Xiaoxiao with piper/say fallback; `relay-voice-stream-tts.ts` is an independent relay TTS path.
- Watch: M39 `streaming-stt-online.ts` is in progress; OnlineRecognizer endpoint parameters can inject too early/late. Verify Android recording, speech quality gating, and streaming ASR together before beta.

## WebRTC realtime call path

- Risk: M37/M38 WebRTC is the highest-risk voice path: signaling/TURN, native audio, upstream STT, downlink TTS, and barge-in all interact.
- Trigger: `webrtc-callee.ts`, `webrtc-upstream-audio.ts`, `webrtc-downlink-audio.ts`, `webrtc-signal-protocol.ts`, `webrtc-vad.ts`, and `src/cli/hive.ts` callee initialization.
- External SPOF: Aliyun coturn `106.14.227.192` is the only TURN node; `@roamhq/wrtc` native binding is required server-side.
- Current risk: no fallback if signaling/TURN disconnects mid-call; downlink drift compensation, gain (`HIVE_WEBRTC_DOWNLINK_GAIN`), and double-playback elimination are numeric-sensitive; Android InCallManager audio-mode switching and recorder interlock caused the 2.8.x crash chain.
- Gap: server-side `webrtc-*.ts` family has no `tests/server/` dedicated coverage; much of the path is device-sensitive and verified on real phones.
- Current mitigation: relay-only fallback flag; downlink gain is env-tunable; mobile path has multiple reviewer passes; barge-in/downlink drift have unit tests.

## Neural voice VAD (Silero ONNX, mobile)

- Risk: Silero ONNX controls barge-in/speech-end sensitivity; native binding failures or threshold drift can break real-time talkback.
- Trigger: `packages/mobile/src/lib/neural-voice-vad*`, `neural-vad-pcm-probe`, `silero-vad-shadow`, `voice-vad.ts`.
- Current risk: `onnxruntime-react-native` native binding can crash (`.install()` FATAL happened before); skipping probe→shadow→takeover flag order can make barge-in regress; `voice_prob` thresholds directly affect interruption sensitivity.
- Current mitigation: catch-before-import native probe, config plugin registers `OnnxruntimePackage`, feature flags isolate phases, and `[SILERODBG]` logs support true-device threshold tuning.

## GLM fast voice reply front desk

- Risk: fast replies depend on external GLM API and must not claim work that only orchestrator can do.
- Trigger: `src/server/fast-voice-reply.ts`, GLM model changes (`glm-4-flash`, `glm-5.1`), prompt/history/status context changes.
- Current risk: GLM outage/timeout must degrade to fixed confirmation; feeding history/status can hit the timeout wall (raised 2500→5000ms); front desk can over-claim dispatch/control actions if prompt regresses.
- Current mitigation: `HIVE_GLM_GATEKEEPER=0` rollback switch; timeout/abort resolves to null then fixed short fallback; system prompt forbids over-claiming (`22d4224`); currently no server tests for this path.

## Sentinel / orphaned dispatch detection

- Risk: sentinel and worker-exit fallback can misclassify a slow worker as stale/orphaned, or miss a real stuck dispatch.
- Trigger: `sentinel-heartbeat.ts`, `orphaned-dispatch-nudge.ts`, `workspace-store-mutations.ts`, dispatch ledger state changes.
- Current mitigation: sentinel heartbeat tests and orphaned-dispatch-nudge unit tests cover stale age, worker exit, pending count reset; worker restart no longer clears `pendingTaskCount` (`cc52a87`) and frontend uses terminal runs to override stale fake-idle cache (`e924dd6`).
- Watch: do not let sentinel role receive normal dispatch nudges; sentinel should observe, not become another worker backlog source.

## PM nudge mechanisms

- Risk: L1 nudges are helpful but can become noisy or race with normal Cockpit watcher updates.
- Trigger: `tasks-narrative-nudge.ts`, `milestone-completion-trigger.ts`, `runtime-store-helpers.ts` plan/tasks listeners.
- Current mitigation: unit tests cover trigger rules, dedupe, no-action suppression; plan websocket/tasks watcher tests still pass.
- Boundary: nudge injection is best-effort; inactive orchestrator PTY means no queued reminder.

## Dispatch lifecycle / stdin forwarding

- Risk: DB state, in-memory pending counts, and PTY stdin writes can diverge on start/stop/report/cancel edge cases.
- Trigger: `team-operations.ts`, `dispatch-ledger-store.ts`, `agent-stdin-dispatcher.ts`, `agent-runtime*.ts`.
- Current mitigation: team atomicity, team protocol e2e, authz, CLI side-effect, and lifecycle tests cover real HTTP+SQLite+PTY paths; pending-count/status recovery has been hardened by `cc52a87` / `e924dd6`.
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
- Watch: before TestFlight/internal release, run device smoke for token entry, push permission, voice record, relay fallback. The Expo SDK56 `expo-av`→`expo-audio` migration is a native-audio regression point and must be revalidated on SDK upgrades.

## Local data and secrets

- Risk: `.hive/` docs are workspace state; credentials and runtime DB/logs live under `~/.config/hive`.
- Trigger: committing generated docs, reports, local config, runtime sqlite/logs, Expo credentials.
- Current mitigation: `.hive/` mostly ignored after v2.0.0; pre-commit governance checks reports/research pairing.
- Check: before commit, review `git status --short`; only force-add intentional baseline docs.
