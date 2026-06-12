# Module Map

> 代码模块职责边界。受 200 行限制：高风险/入口文件逐项列，同构小文件按 family 合并。
> **DRAFT 2026-06-12（马超 refresh，待 user 校对）** — 对照 2026-05-31 至今 41 次代码变更刷新：upload-limits 抽常量、marketplace catalog、worker 状态机修 535cfca、嵌套 Claude Code env strip、tasks watcher ENFILE 修、mobile upload 100MB、web TerminalView reparent/parking + shell 防竞态、relay aliyun hard cut、mobile 视频功能。

## 后端 (src/server/)

### Runtime / app shell
- app.ts — 创建 HTTP server、route 分发、app context；静态缓存头（index.html no-cache / assets immutable）。
- routes.ts / route-helpers.ts / route-types.ts — route registry、route DSL、RouteContext + Feishu/push DI 类型。
- http-errors.ts / local-request-guard.ts — HTTP error 类型；runtime API/WS 仅限本机。
- logger.ts / package-version.ts / version-service.ts — 文件 logger；版本读取与上游检查。

### RuntimeStore / workspace state
- runtime-store.ts — RuntimeStore facade，组合 workspace/agent/team/feishu/mobile/PM 服务。
- runtime-store-helpers.ts — 创建 stores/watcher/agentRuntime/lifecycle；接线 stalled-dispatch-nudge 的 user-surface 回调（M30）。
- runtime-database.ts / sqlite-schema.ts — 打开 runtime.sqlite；**当前 schema v32**，迁移调度。
- sqlite-schema-v*.ts — 增量迁移；近期 v28 mobile_chat_messages、v29 device.source、v30 删 pairing code、v31 mobile_media_uploads、v32 agent_run_timeline_events。
- workspace-store*.ts — workspace/worker 内存状态 facade + 契约 + hydration + 三态/pending mutation + support/路径校验。**workspace-store-mutations.markAgentStarted 强制 status='idle'**（535cfca 修复 idea-13 状态错：restart 后不假显示 working；pendingTaskCount 仍保留 backlog 给 WorkerModal/recovery 看，下一次 markTaskDispatched 才转 working）。
- app-state-store.ts / settings-store.ts — app_state 表；command preset/app settings 持久化。

### Agent lifecycle / PTY
- agent-runtime.ts (+ agent-runtime-*.ts/-types.ts) — agent runtime facade、active run/list/stop/ports/close 细分、LiveAgentRun 类型。
- agent-manager.ts / agent-manager-support.ts — node-pty process manager；spawn/onData/onExit/onError/finish。**createAgentSpawnEnv 显式 strip 嵌套 Claude Code env marker**（`AI_AGENT/CLAUDECODE/CLAUDE_CODE_ENTRYPOINT/CLAUDE_CODE_EXECPATH/CLAUDE_CODE_SESSION_ID/CLAUDE_EFFORT`）防从 Claude Code 会话里启动 4010 时父会话 marker 串入子 PTY 导致 orch 不能正常派单；钟馗审后改用 explicit set，无 prefix 守卫（避免误删 `CLAUDE_CODE_OAUTH_TOKEN` 等用户 env）。
- agent-run-bootstrap.ts / -starter.ts / -start-context.ts / -exit-handler.ts — 组装启动命令+PATH+env+thinking、start context、post-start 注入、exit 落盘。
- agent-run-store.ts / -sync.ts / live-run-registry.ts — agent_runs 表 CRUD、live↔persisted 同步、live registry。
- provider-runtime-profile.ts — **M25 provider session 隔离**：per-agent managed CODEX_HOME + session root（config/auth 投影），消除多 codex worker 串线；fresh+resume 都钉死。
- agent-command-resolver.ts / agent-launch-resolver.ts / agent-launch-cache.ts — command/preset 解析、launch config 合并与 cache。
- agent-session-store.ts / agent-tokens.ts — agent_sessions（Layer A session id）；per-agent token。
- agent-startup-instructions.ts / agent-stdin-dispatcher.ts / post-start-input-writer.ts / worker-output-tracker.ts — 启动 guidance；向 PTY 写 team/system/user 消息（worker dispatch 注入 PM_DISPATCH_REMINDER + Cockpit 快照 M13L4）；启动后写初始 prompt；跟踪最近输出。

### Session resume / CLI presets
- claude-command-defaults.ts / claude-session-support.ts / claude-session-coordinator.ts — Claude YOLO 参数、session 解析+resume、capture 协调。
- session-capture*.ts — Claude/Codex/Gemini/OpenCode session id 捕获。
- preset-launch-support.ts / command-preset-defaults.ts / command-preset-store.ts / startup-command-parser.ts / terminal-input-profile.ts — preset augmentation、内置 preset、command_presets 表、startup 解析、终端输入 profile（含 started_at 字段）。

### Team protocol / dispatch / 汇报可靠性
- team-operations.ts — team send/report/status/cancel 核心；dispatch ledger ↔ tasks.md 生命周期收口（reportTask 无条件收尾）。
- team-authz.ts / team-list-enrichment.ts / team-list-serializer.ts — token 权限校验；team list 补 run/session/last line；snake_case 契约。
- dispatch-ledger-store.ts / dispatch-ledger-serializer.ts — dispatches 表 CRUD/状态迁移（状态 queued/submitted/reported/cancelled，**无 in_progress**）；序列化。
- orphaned-dispatch-nudge.ts — L1 worker 退出时检测孤儿 dispatch，nudge orch PTY。
- stalled-dispatch-nudge.ts — **M26/M30**：60s 巡检；worker 回 idle 提示符+submitted 未报→直 nudge worker K 次→回退 orch；**M30 加 always-on user-surface pass**（按时长把超时未报 surface 给 user，不 gate idle/在线，绝不静默）。
- stale-dispatch-status.ts — **M30** 纯函数 summarizeStaleDispatches：按 submittedAt 时长出 stale/escalated 两档；dashboard 计数与 nudge 推送的单一判定源。
- runtime-message-builders.ts / message-log-store.ts / system-message.ts / recovery-summary.ts / restart-policy*.ts — 系统消息文本；messages 表+恢复窗口；Layer B summary；restart policy/fallback。

### Agent Run Timeline（M23）
- agent-run-timeline-store.ts — agent_run_timeline_events 表（seq/epoch/gap 模型，durable 可恢复事件流）。
- routes-run-timeline.ts — timeline tail/before/after cursor fetch API（断线重连 catch-up）。

### Terminal / workspace shell
- terminal-ws-server.ts / terminal-stream-hub.ts / terminal-flow-control.ts / terminal-state-mirror.ts / terminal-protocol.ts — terminal/tasks/plan/cockpit WS 接线、多 viewer stream hub、backpressure/ack、headless scrollback mirror、protocol 类型。
- pty-output-bus.ts — PTY output pub/sub（被 mobile-orchestrator-reply-capture 等订阅）。
- tasks/plan/cockpit-websocket-server.ts — 三类 PM 文件 WS 推送。
- workspace-shell-runtime.ts — workspace shell terminal live runs（含 started_at）。

### PM / .hive docs
- tasks-file.ts / tasks-file-watcher.ts — seed/读写 .hive 文件；chokidar watch tasks/plan/cockpit。**watch glob 收窄到 `reports/*.html` / `reports/*.md` 等具体扩展名，不再递归 `reports/**`**（idea-13 2026-06 ENFILE 根因：视频逐帧 jpg 海塞 reports/ 会把 fd 耗尽 → node-pty 分不到 TTY → worker 启动 2s exit）。
- plan-doc.ts / cockpit-doc.ts — plan.md parser；ParsedCockpit 聚合 + aiActions（reports 聚合、playbook 建议）。
- pm-questions/ideas/baseline/decisions/archive/reports/research/tasks-doc.ts — 各 PM 文档 parser；baseline-doc 含 git staleness 检测；reports-orphan-detector 检测缺 research 的孤儿。
- pm-reports-orphan-detector.ts / pm-templates.ts — 孤儿报告检测；plan/ADR/handoff/research/baseline + 5 playbook 模板。
- tasks-narrative-nudge.ts / milestone-completion-trigger.ts / -nudge.ts — L1 narrative 缺失提醒；milestone shipped 检测 + baseline staleness/handoff nudge。
- hive-team-guidance.ts / session-start-review-message.ts — ORCHESTRATOR/WORKER_RULES/REMINDER/PROTOCOL builder；session-start review 消息。
- cockpit-fidelity-audit.ts — Cockpit 数据保真度审计（findings 注入 sentinel heartbeat）。

### Sentinel
- sentinel-guidance.ts / sentinel-heartbeat.ts — 哨兵规则+heartbeat payload；30 分钟巡检注入 Cockpit+git+fidelity 快照到 sentinel PTY。

### Feishu bridge / approval / voice
- feishu-credentials.ts / feishu-bindings-store.ts / feishu-reaction-store.ts — ~/.config/hive/feishu.json；feishu_bindings、feishu_reactions 表。
- feishu-transport.ts / -utils.ts / -route-resolver.ts / -inbound-handler.ts — lark WSClient inbound/outbound/card；text 切片/card 纯函数；chat→workspace 路由；注入 orch（含图片/附件路径 inbound）。
- feishu-approval-ledger.ts / routes-feishu.ts — in-memory approval ledger；Feishu UI/internal endpoints（approval-request 现也写 mobile_chat_messages，M28）。
- local-stt.ts — 本地 STT provider（Paraformer/sherpa-onnx 主力，Whisper fallback，仍保留抗幻听防线）。
- streaming-stt-online.ts — **M39 进行中**：sherpa-onnx OnlineRecognizer 流式 ASR，替代 VAD 批处理等待。
- local-tts.ts — 本地 TTS provider（edge-tts 晓晓主，piper/say 降级链）。
- fast-voice-reply.ts — GLM 快嘴前台：voice source 秒回、handled/escalate 门控、失败兜底。
- relay-voice-stream-tts.ts — relay voice_stream TTS 路径；带 `hasActiveWebRtcCall` 守卫避免双路播放。
- webrtc-callee.ts — WebRTC 服务端 callee；call 生命周期、answer/ICE、active-call 查询。
- webrtc-upstream-audio.ts — 上行 audio sink：WebRTC PCM 帧→VAD/流式 STT→注入 orchestrator。
- webrtc-downlink-audio.ts — 下行 TTS→PCM→WebRTC audio track 推送；包含帧节奏和增益控制。
- webrtc-signal-protocol.ts — WebRTC offer/answer/candidate/bye 信令帧解析。
- webrtc-vad.ts — 服务端能量 VAD；切 utterance 给上行 STT。

### Mobile backend（src/server）
- routes-mobile.ts — mobile API：token/device CRUD、push-token、dashboard（含 runs.started_at + stale/escalated_dispatches 计数）、tasks、transcript、voice、cockpit（plan/tasks/questions/ideas/actions + baseline/decisions/reports/research/archive）、dispatch/approve/worker controls。**upload 限制经 `upload-limits.ts` 共用常量升 50→100MB**（视频）。
- mobile-auth.ts — capability model、permanent token CRUD、device revoke/delete、push_token。
- mobile-chat-store.ts — mobile_chat_messages CRUD（user_text/orch_reply/worker_report/approval_request/system_event）。
- mobile-orchestrator-reply-capture.ts — **M24/M28** 捕获 orch PTY 对话回复→mobile_chat_messages（mobile 轮开窗、10s 静默 flush、过滤系统/工具/思考行；team mobile-reply 显式写时去重）。
- mobile-media-store.ts — mobile_media_uploads（飞书/手机附件落盘元数据）。
- mobile-push.ts — Expo push best-effort sender（exp.host）；worker_done/approval/high_ai_action/**stale_dispatch（M30）** 通知 + 去重 + invalid token 清理。⚠️ exp.host→FCM，华为机无 GMS 收不到（见 M29 spike）。
- mobile-dashboard-websocket-server.ts — mobile dashboard WS 推送。

### Relay backend（daemon 侧，src/server）
- relay-connector.ts — daemon→relay outbound WS connector；E2E 加密握手、room join、auto-reconnect、pushEvent（dashboard_update/chat_message 实时推 M27）。
- relay-rpc-handler.ts — relay inbound JSON-RPC handler：dashboard/tasks/transcript/voice/dispatch/approve/create-worker 等代理到本地 runtime API（M27 补齐 6 个缺失方法）；`voice.webrtc.iceConfig` 返回 `resolveWebRtcIceServers()`（`HIVE_WEBRTC_ICE_SERVERS_JSON` 注入 TURN）；**upload 共用 `upload-limits.MOBILE_UPLOAD_MAX_BYTES=100MB`**（与 LAN HTTP 路径常量统一）。
- relay-config.ts — ~/.config/hive/relay.json keypair + relay URL 配置。

### File system / routes / 启动
- routes-workspaces/runtime/team/dispatches/tasks/plan/cockpit/fs/settings/ui/version.ts — 各 HTTP endpoint（cockpit 含 report-file 同浏览器 serve + path-traversal 防护）；**routes-settings 新增 `GET /api/settings/marketplace/catalog` + `POST /api/settings/marketplace/import`**（marketplace catalog 读取 + 导入落 role_templates）。
- upload-limits.ts — **mobile upload 体积公共常量**（`MOBILE_UPLOAD_MAX_BYTES=100MB` + `MOBILE_UPLOAD_JSON_BODY_LIMIT_BYTES=140MB`，base64 ~33% 膨胀容差）；routes-mobile + relay-rpc-handler 共用，避免一处升另一处漏（钟馗 B1 修法）。
- marketplace-catalog.ts — **read-only 模板 catalog**（5 个 BUILTIN 缺位的 niche sample：security-auditor / api-designer / k8s-sre / db-migration-engineer / a11y-auditor）；`catalogEntryToRoleTemplateInput` 映射到 RoleTemplateInput → `store.settings.createRoleTemplate` 落 role_templates 表（不并存两套真源）；ADR draft `decisions/draft-2026-06-12-template-marketplace-native.md`。
- fs-browse.ts / fs-pick-folder.ts / fs-sandbox.ts / open-file.ts — 文件浏览/原生选择器/路径 guard/跨平台 open。
- role-template-store.ts / role-templates.ts — role_templates 表 + 内置模板。
- orchestrator-launch.ts / orchestrator-autostart.ts — 默认 orch launch config seed + 创建 autostart。

## 前端 (web/src/)

- app.tsx / main.tsx / AppProviders/AppOverlays/AppWorkspaceContent.tsx / WorkspaceDetail/WorkspaceTerminalPanels.tsx — root 组合、entrypoint、providers、drawers、active workspace 内容、terminal 布局。
- api.ts / reconnecting-websocket.ts / preload-recovery.ts — fetch/WS client + 类型；WS backoff 重连；Vite dynamic-import 失败自动 reload。
- cockpit/* — Cockpit drawer + tabs（Questions/Ideas/Baseline/Decisions/Archive/Reports/Research/Tasks/Timeline）、action bar、文档 viewer、useCockpit。
- plan/* tasks/* terminal/* worker/* workspace/* — Plan drawer；task graph+parser；xterm client+shell；Add Worker/cards/Sentinel/orch pane；Add Workspace/settings/MobileDevicesSection（含 QR 查看）。**terminal/TerminalView.tsx：`useStablePortalHost` + `#hive-terminal-parking-lot` singleton DOM**（切 tab 时把 host node reparent 到新 portal slot 不重建 xterm 不重连 WebSocket；目标丢失 500ms 后才 dispose）。**terminal/useTerminalRun.ts：xterm + addon 异步懒加载**（顶级 `Promise.all([@xterm/xterm, addon-fit, addon-unicode11, addon-clipboard])`，二级 `import('@xterm/addon-web-links' | '@xterm/addon-webgl')` 不阻塞挂载）。**WorkspaceDetail.tsx：shell 启动防竞态**（`shellStartInFlightRef` 同步锁防双击 + workspace token 防切换错挂 + optimistic run TTL 防 stuck）。
- sidebar/* layout/* feishu/* notifications/* demo/* wizard/* ui/* lib/* — sidebar、Topbar/RuntimeStatusStrip、Feishu 灯、通知、demo、首启 wizard、共享 primitives、工具。
- i18n.tsx/uiLanguage.ts + use*.ts(x) — EN/ZH copy、语言状态、shortcuts/panes/version/workspace hooks。

## Mobile app (packages/mobile/)

- app/(tabs)/* — Expo Router 原生 app：Dashboard/Tasks/Workers/Settings/Chat，token auth、voice、push、Stop/Restart/Dispatch、语言切换。
- src/api/client.ts — LAN-first HTTP/WS client（LAN cooldown 跳死探、relay fallback）。
- src/api/relay-transport.ts / relay-transport-registry.ts / relay-device-keys.ts / relay-event-actions.ts — 单例 relay E2E transport（base64 明文握手帧）、注册表防双 transport、设备 keypair、event→action 路由。
- src/api/mobile-runtime-context.tsx / -context-logic.ts / mobile-outbox.ts / mobile-reconnect-policy.ts / mobile-dispatch-history.ts / mobile-diagnostics.ts — runtime context + 纯逻辑、离线 outbox 队列、重连策略、dispatch 历史、连接诊断面板。
- src/lib/relay-config-store.ts / connection-qr.ts — relay 配置的持久化 schema、扫码/手填入参组装、SecureStore 读回校验，以及 **legacy `dmit.servasyy.com` → `aliyun.servasyy.com` 的移动端 hydration 迁移**（`parseStoredRelayConfigWithMigration` 解析时拿到旧 host 改写并立即 secureSet 回写）。⚠️ PM 计划再迁 → `relay.yunzhong2020.com`（servasyy 未备案被阿里云 SNI RST，需迁已备案子域），代码尚未落地（待 ship）。
- src/lib/neural-voice-vad.ts / neural-vad-pcm-probe.ts / silero-vad-shadow.ts — Silero ONNX neural VAD 三阶段：PCM probe、shadow scoring、takeover 判停/打断。
- src/lib/voice-vad.ts — 统一 VAD 入口；音量 fallback + neural 状态机。
- src/lib/webrtc-caller.ts / webrtc-audio-interlock.ts / webrtc-incall-manager.ts — WebRTC caller、expo-audio 互斥、Android InCallManager 音频模式。
- src/lib/chat-media.ts — chat envelope 解析+组装、`isChatMediaImage/Video` 分流、`normalizePickedMediaAttachment`（视频 ImagePicker 没内联 base64 时从 uri 读取兜底）。
- src/components/VideoPreviewModal.tsx — **expo-video 全屏视频预览**（`useVideoPlayer` + `VideoView`，复用 `image-preview-gesture` 双指缩放/双击/pan；headers 透传支持远端鉴权 URL）；idea-15 Phase 1 配套。
- src/lib/webrtc-connection-probe.ts / webrtc-runtime-probe.ts / webrtc-signal-protocol.ts — WebRTC 连接探针、runtime API 可达性、mobile 信令协议。
- src/cockpit/* / components/* / notifications.ts / config.ts / i18n / demo-data.ts — cockpit 视图（Plan/Tasks/Questions/Ideas/Actions）、RN primitives + offline banner、Expo push 注册、relay/版本配置、i18n、demo。
- app.config.ts / eas.json / build-local.sh — Expo/EAS 配置（arm64-only ABI）；**自建本地 gradle 构建脚本（脱离 EAS）**。

## Relay packages

- packages/relay/src — relay-server.ts（轻量 WebSocket room 中转，peer evict + singleton）、keygen.ts/keygen-cli.ts（**生成一套 aliyun hard cut 部署 secrets / Mac 侧 `relay.json` seed**）、index.ts；deploy/*（**checked-in Caddy/nginx/systemd/relay.json 模板，默认公网入口统一为 `aliyun.servasyy.com`**）。⚠️ PM 计划改公网入口 → `relay.yunzhong2020.com`（servasyy 未备案被阿里云 SNI RST），模板尚未更新（待 ship 时一并改 deploy/*.example + README）。
- packages/relay-crypto/src — tweetnacl keys/handshake/channel/encoding；daemon connector 与 mobile transport 共用 E2E 握手与会话加密。

## CLI / Shared

- src/cli/hive.ts — runtime CLI：parse port、logger、app/Feishu 启动、shutdown。
- src/cli/team.ts — agent CLI：list/send/report/status/cancel/feishu/approve/mobile-reply。
- src/shared/types.ts / thinking-levels.ts — HTTP/UI 共享类型；thinking_level 值与标签。
