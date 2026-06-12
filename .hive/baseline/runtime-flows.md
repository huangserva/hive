# Runtime Flows

> 主要运行时数据流。只记录稳定路径；细节以代码和测试为准。
> **DRAFT 2026-06-10（马超刷新，待 user 校对）** — 对照近期 git log 刷新：M40 GRM turn 决策链、WebRTC 上下行/播放/撤回、mobile/relay 双通道、aliyun relay 迁移与下发。

## Flow 1: Web UI 派单

```
User
  -> web/src/worker/useWorkerActions.ts
  -> web/src/api.ts POST /api/team/send
  -> routes-team.ts (POST /api/team/send) -> team-operations.ts
  -> team-authz.ts validates orchestrator token
  -> workspace-store-mutations.ts pending_task_count += 1, status=working
  -> dispatch-ledger-store.ts inserts submitted dispatch
  -> agent-stdin-dispatcher.ts writes task + PM_DISPATCH_REMINDER + Cockpit 快照到 worker PTY (M13 L4)
  -> message-log-store.ts records send; web WS shows worker working
```

Notes:
- Protocol state event-driven：send→working、report→idle when pending==0。
- `team cancel`（`POST /api/team/cancel`）显式取消，不等同于 report。

## Flow 2: Worker `team report` 回 orch

```
Worker PTY -> bin/team -> src/cli/team.ts report/status
  -> POST /api/team/report  (必须带 dispatch_id；缺失即 BadRequest)
  -> routes-team.ts + team-authz.ts validates worker token
  -> dispatch-ledger-store.ts 匹配 open dispatch
  -> message-log-store.ts records report
  -> workspace-store-mutations.ts pending_task_count -= 1
  -> agent-stdin-dispatcher.ts injects system message into orchestrator PTY
  -> worker idle when no pending tasks
```

Notes:
- `dispatch_id` 强制：worker 退出后 stale dispatch 必须由 `team cancel` / 哨兵走，不会被新的 report “顺手收口”。
- PTY 退出走 agent-manager-support / exit handler，agent 标记 stopped。

## Flow 3: 飞书 inbound -> orch

```
Feishu chat -> lark.WSClient in feishu-transport.ts
  -> parseTextContent / stripLeadingMentions
  -> feishu-route-resolver.ts maps chat_id -> workspace + orchestrator
  -> feishu-inbound-handler.ts formats "[来自飞书 chat=...]"
  -> agentRuntime.getActiveRunByAgentId checks orch online
  -> store.recordUserInput(workspaceId, orchAgentId, formattedText)
  -> team-operations / message-log-store persist user_input
  -> agent-stdin-dispatcher writes into orchestrator PTY
```

Notes:
- Group chats require @bot；p2p 不需要。
- Phase 2 outbound uses `team feishu reply`；approval cards 用 in-memory ledger。

## Flow 4: PM 文件 -> Cockpit dashboard

```
.hive/{plan.md,tasks.md,open-questions.md, ideas/**, baseline/**, decisions/**, archive/**, reports/**, research/**}
  -> tasks-file-watcher.ts chokidar debounce
  -> RuntimeStore registerCockpitListener callbacks
  -> cockpit-websocket-server.ts publishes /ws/cockpit/:workspaceId
  -> cockpit-doc.ts parseCockpit(workspacePath)
  -> plan / PM parsers (含 pm-reports-doc / pm-baseline-doc staleness) produce ParsedCockpit
  -> web/src/cockpit/useCockpit.ts receives snapshot/update
  -> CockpitDrawer renders 9 tabs + action bar
```

Notes:
- Legacy `/ws/plan/:workspaceId` 保留给 PlanDrawer。
- `aiActions` 含 high/medium questions、ideas、draft decisions、baseline stale、orphan reports、handoff/loop playbook。
- Reports tab 用 routes-cockpit report-file 路由在同浏览器开 HTML；Questions 答复经 answer route nudge orch PTY。

## Flow 5: Mobile App HTTP/WS（LAN）

```
Mobile app (packages/mobile/src/api/client.ts)
  -> POST /api/mobile/tokens (pair)；GET /api/mobile/runtime/status
  -> GET /api/mobile/workspaces  /  GET .../dashboard (含 stale/escalated_dispatches 计数)
  -> GET .../cockpit  /  .../cockpit/doc-file  /  .../cockpit/questions/:id/answer
  -> GET .../workers/:id/transcript  /  .../tasks  /  .../chat/messages
  -> POST .../dispatch | .../prompt | .../approve/:id | .../workers/:id/(stop|restart)
  -> POST .../upload (multipart -> mobile_media_uploads, 5 min staging TTL)
  -> POST /api/mobile/voice/(transcribe|synthesize)
  -> mobile-dashboard-websocket-server.ts pushes /ws/mobile/dashboard 快照与增量
```

Notes:
- 所有 `/api/mobile/*` 走 `mobile-auth.ts` capability 校验（read_dashboard / send_prompt / approve / control_worker / upload）。
- 入站语音先入 `voice-understanding-buffer`（Flow 8），不直接进 orch PTY。

## Flow 6: Mobile App Relay JSON-RPC fallback

```
Mobile app -> relay-transport.ts (singleton via relay-transport-registry)
  -> tweetnacl E2E handshake (packages/relay-crypto)
  -> POST/WS to relay server (aliyun.servasyy.com，daemon 同样连入)
  -> relay-connector.ts (daemon) -> relay-rpc-handler.ts JSON-RPC dispatch
     methods: runtime.status, workspaces.list, workspace.dashboard.get,
              worker.transcript, workspace.tasks, workspace.chat.messages,
              workspace.cockpit{.question.answer},
              workspace.dispatch, workspace.approve, approval.resolve,
              workspace.prompt, workspace.upload,
              worker.stop / worker.restart / worker.create,
              command_presets.list, device.register_push_token,
              voice.transcribe / voice.synthesize / voice.webrtc.iceConfig
  -> 每个 method 映射到对应 runtime API / store mutation；capability 校验同 LAN。
  -> relay-connector.pushEvent 实时回推 dashboard_update / chat_message (M27)。
```

Notes:
- LAN-first，relay 仅作 fallback；client 端 LAN 探测 cooldown 决定切换。
- `voice.webrtc.iceConfig` 返回 `resolveWebRtcIceServers()` 结果，作为 Flow 7 的 ICE 来源。

## Flow 7: WebRTC 语音通话（call / 上行 / 下行 / retract）

```
Mobile (packages/mobile/src/lib/webrtc-caller.ts)
  -> 经 relay 信令 (offer/answer/ICE/bye) -> webrtc-signal-protocol.ts
  -> webrtc-callee.ts (createWebRtcCallee)
       getIceServers() = resolveWebRtcIceServers()  // HIVE_WEBRTC_ICE_SERVERS_JSON 覆盖默认
       resolveWebRtcForceRelayEnabled() -> iceTransportPolicy:'relay'  // HIVE_WEBRTC_FORCE_RELAY=1
  -> @roamhq/wrtc RTCPeerConnection
  -> ontrack -> webrtc-upstream-audio.ts (RTCAudioSink -> VAD/streaming STT)
       partial 触发 voiceIntent verdict（含 intent_generation / should_speculate_tts）
       完成态走 grm-turn-decision.adaptVoiceIntentToGrmTurnDecision
  -> 下行：
       file_segments 模式 -> webrtc-file-downlink-audio.ts
       legacy 整段模式  -> webrtc-downlink-audio.ts (HIVE_WEBRTC_DOWNLINK_MODE 切换)
  -> 下行帧经 sendData -> mobile webrtc-file-downlink-playback.ts 队列播放
```

播放/撤回不变量（见 webrtc-file-downlink-audio.ts + mobile playback）：
- 每个新的 mobile_chat_messages `orch_reply` 解析出 `intent_generation`，落进 `generationByIntentGeneration`。
- 新 generation 抢占未播队列：下发 `retract` 帧 -> mobile `retract(callId, retractGeneration)` 仅清未播 segment。
- 已在播 segment 不被 retract 中断；旧 generation 的补充回复落到旧映射，不再混入当前播单。
- `voice_latency_turn_id` 由 `webrtc-voice-latency.ts` 管理；`team mobile-reply` / 服务端回流通过它 claim 对齐播放。

## Flow 8: 语音意图 + GLM 前台 + PM handoff

```
Mobile/WebRTC inbound voice -> voice-understanding-buffer.ts (默认 1200ms 合窗)
  -> persistInboundChatMessage (mobile_chat_messages user_text)
  -> generateFastVoiceReplyWithGatekeeper (fast-voice-reply.ts, GLM)
       结果： gatekeeper ∈ { handled | escalate | drop } + reply 文本
  -> adaptFastVoiceReplyToGrmTurnDecision (grm-turn-decision.ts)
       branch ∈ { handled | escalate | drop | incomplete }
       allowPmHandoff = branch==='escalate'
  -> handled: insertFastVoiceReply -> recordUserInput(forwardToOrchestrator:false)
     escalate: insertFastVoiceReply + recordUserInput(prompt 含 appendFastReplyCoordination)
     drop:     直接丢弃
     gatekeeper 关闭 (HIVE_GLM_GATEKEEPER=0): 始终 forward 原文
  -> 进入 orchestrator PTY 后走 Flow 1/2 的派单与回报循环
```

PM 结果回流回前台单声道：
- orch / worker 的回复经 `routes-team.ts POST /api/team/mobile-reply` 写 mobile_chat_messages。
- 活跃 WebRTC call 存在时，按 `voice_latency_turn_id` claim 对应 pending handoff turn；
  - 显式 turn id 但未匹配 -> ConflictError，写 `webrtc_handoff_mobile_reply_correlation_rejected`；
  - 多 pending 且未带 turn id -> ConflictError，写 `webrtc_handoff_mobile_reply_ambiguous`；
  - 唯一 pending 且未带 turn id -> claim 最旧的 pending handoff turn。
- 入消息携带 `voice_latency_turn_id` / `intent_generation`，Flow 7 下行据此映射 generation 播放。

## Flow 9: Mobile relay pairing 与持久化迁移（aliyun hard cut）

```
新扫码 / 手填 RelayPairingInput (connection-qr.ts)
  -> buildStoredRelayConfig(input, generateDeviceKeypair())
  -> normalizeRelayUrl: dmit.servasyy.com -> aliyun.servasyy.com
  -> SecureStore key hippoteam.mobileRelayConfig 写入 aliyun 配置

App 启动 hydration (mobile-runtime-context.tsx)
  -> secureGet(RELAY_CONFIG_KEY)
  -> parseStoredRelayConfigWithMigration(stored)
     存量 dmit 配置 -> 解析后内存切到 aliyun + migrated=true -> 立即 secureSet 回写
  -> connect(host, token, nextRelayConfig)
```

Notes:
- Daemon 侧 `~/.config/hive/relay.json`、relay server 部署模板（`packages/relay/deploy/*`）默认公网入口同样为 aliyun。
- `voice.webrtc.iceConfig` 返回的 ICE / TURN 凭据由 daemon 上的 `HIVE_WEBRTC_ICE_SERVERS_JSON` 提供，是 cutover 时另一条独立配置。

## ⚠️ 仍属 device / ops gate 的步骤

代码内已落地的流程对应**外部步骤**不在 CI 范围，必须真机/外部确认：

- 真实 aliyun 切换：DNS、TLS、Web server、daemon `relay.json`、TURN/`HIVE_WEBRTC_ICE_SERVERS_JSON`、新 QR、APK 升级触发存量迁移。
- 真机 WebRTC 端到端：`@roamhq/wrtc` + TURN + mobile client 真实通话回归；retract “未播可撤、在播不撤”、speaking-gap、Orb phase、Android InCallManager 音频路由。
- 本地 STT/TTS、Expo audio、录音权限、设备 AEC：仍 device-sensitive，claim ship 时必须带 4010 runtime log + 手机侧证据。
