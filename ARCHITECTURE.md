# Hive 架构

## 概览

Hive 是一个运行在本地浏览器中的多 CLI agent 协作工作台，由一个常驻 Node.js runtime 服务和若干 node-pty 子进程组成。每个 workspace 包含一个 Orchestrator agent 和若干 Worker agent，所有 agent 均作为 PTY 子进程在后台并行运行，通过 xterm.js WebSocket 终端向用户展示输出。

一次派单的完整流动：Orchestrator 在终端中执行 `team send <worker> <task>`，CLI（`src/cli/team.ts`）读取注入的 `HIVE_PORT / HIVE_PROJECT_ID / HIVE_AGENT_ID / HIVE_AGENT_TOKEN` 环境变量，向本机 HTTP 服务发 `POST /api/team/send`；路由层（`routes-team.ts`）完成 JWT token 校验与 RBAC 角色检查，随即调用 `team-operations.ts` 的 `dispatchTask()`；在一次 SQLite 事务中，`dispatch-ledger-store.ts` 将记录写入 `dispatches` 表（状态 `queued → submitted`），`tasks-file.ts` 同步更新 `.hive/tasks.md`，`agent-stdin-dispatcher.ts` 将格式化好的中文系统消息通过 `post-start-input-writer.ts` 的 bracketed-paste 协议注入目标 Worker 的 PTY stdin；Worker 执行完毕后调用 `team report`，经同样路径反向注入 Orchestrator stdin，`dispatches` 状态置为 `reported`，`.hive/tasks.md` 对应行打勾，并可选触发移动端 Expo 推送。

## 运行形态

单进程 Node.js 22+ 服务，绑定 `127.0.0.1`，HTTP（含 WebSocket upgrade）走同一端口；所有 agent 为该进程的 node-pty 子进程；持久化到单个 `runtime.sqlite` 文件；前端为 React 19 + Vite 6，与服务端通过 tRPC 11 + WebSocket 双向通信，终端流量走独立 `/ws/terminal/:runId` 通道。

## 子系统

### Agent 生命周期 / 运行时

**职责**：负责 agent 进程从启动配置持久化、PTY 子进程派生、运行状态双层跟踪（内存 + SQLite），到重启/恢复策略注入、stdin 提示写入及进程退出清理的全生命周期管理。

**关键文件**：

- `/Users/huangzongning/development/hive-serva/src/server/agent-runtime-contract.ts` — `AgentRuntime` 接口定义，门面契约
- `/Users/huangzongning/development/hive-serva/src/server/agent-runtime.ts` — `createAgentRuntime()` 工厂，组装所有子模块
- `/Users/huangzongning/development/hive-serva/src/server/agent-manager.ts` — 持有 node-pty `IPty` 实例 Map，执行真正的 spawn/stop/resize
- `/Users/huangzongning/development/hive-serva/src/server/agent-run-starter.ts` — 协调 bootstrap → spawn → 注册 → token → post-start 写入全流程
- `/Users/huangzongning/development/hive-serva/src/server/agent-run-store.ts` — SQLite CRUD，覆盖 `agent_runs` 与 `agent_launch_configs` 两张表
- `/Users/huangzongning/development/hive-serva/src/server/live-run-registry.ts` — 纯内存 Map，存 `LiveAgentRun` + `pendingExitCode` + exit Promise

**关键数据模型**：`LiveAgentRun`（内存，含 PTY 句柄引用）、`AgentRunRecord`（内存，含 PTY 控制句柄 + errorTailBuffer）、`PersistedAgentRun`（SQLite `agent_runs` 表）、`AgentLaunchConfigInput`（SQLite `agent_launch_configs` 表）。

**在整体中的位置**：所有其他子系统写 stdin 或停止 agent 均通过 `AgentRuntime` 门面，是驱动 PTY 层的唯一权威入口；`PtyOutputBus` 从本子系统产生，向上游终端层和 Team 协议层广播输出。

---

### 终端 / PTY 层

**职责**：将底层 PTY 进程的原始字节分发给多个 WebSocket 客户端，维护无头终端状态镜像（scrollback 10K 行），管理 workspace shell 会话生命周期，以及双水位线背压控制。

**关键文件**：

- `/Users/huangzongning/development/hive-serva/src/server/terminal-ws-server.ts` — HTTP upgrade 网关，路由 `io`/`control` 两条 WS 通道，并托管 cockpit/plan/tasks WS 服务器
- `/Users/huangzongning/development/hive-serva/src/server/terminal-stream-hub.ts` — 核心多路复用器，每个 `runId` 维护 `RunState`（含 `TerminalStateMirror` 和 viewers Map）
- `/Users/huangzongning/development/hive-serva/src/server/pty-output-bus.ts` — 以 `runId` 为 key 的轻量 pub/sub 总线
- `/Users/huangzongning/development/hive-serva/src/server/terminal-state-mirror.ts` — 基于 `@xterm/headless` + `@xterm/addon-serialize` 的无头终端，提供 `getSnapshot()` 和 `lastPtyLine()`
- `/Users/huangzongning/development/hive-serva/src/server/terminal-flow-control.ts` — 每个 WebSocket viewer 独立的背压控制器，跟踪 `bufferedAmount` 和 `unackedBytes`
- `/Users/huangzongning/development/hive-serva/src/server/worker-output-tracker.ts` — 为无 UI 的 agent run 保持 headless mirror，供 `team list` 接口读取 `lastPtyLine`

**关键数据模型**：`PtyOutputBus`（内存 pub/sub）、`FLOW_CONTROL` 常量（`WS_BUFFERED_HIGH/LOW_WATER: 16KB/8KB`、`UNACKED_HIGH/LOW_WATER: 100KB/50KB`、`BATCH_INTERVAL_MS: 4ms`）、`TerminalControlClientMessage`/`TerminalControlServerMessage`（control 通道 JSON 协议）。本子系统无 SQLite 表，所有状态均为内存 Map，PTY 输出不落库。

**在整体中的位置**：消费 `PtyOutputBus`，是 PTY 字节流到浏览器终端的唯一传输路径；同时提供 `TerminalStateMirror` 供崩溃恢复子系统重建上下文。

---

### Team 协议 / 派单

**职责**：为多 agent workspace 提供类型安全的派单协议（`team send/report/status/cancel`），维护 dispatch 状态机并通过 PTY stdin 即时推送至目标 agent。

**关键文件**：

- `/Users/huangzongning/development/hive-serva/src/cli/team.ts` — CLI 二进制入口，解析子命令后向 runtime HTTP 发请求
- `/Users/huangzongning/development/hive-serva/src/server/routes-team.ts` — HTTP 路由层，鉴权 + RBAC 后委托 store
- `/Users/huangzongning/development/hive-serva/src/server/team-operations.ts` — 核心业务：`dispatchTask / reportTask / cancelTask / statusTask / recordUserInput`，负责 DB 事务、任务文件更新、nudge 触发
- `/Users/huangzongning/development/hive-serva/src/server/dispatch-ledger-store.ts` — SQLite CRUD，维护 `queued → submitted → reported/cancelled` 状态机
- `/Users/huangzongning/development/hive-serva/src/server/agent-stdin-dispatcher.ts` — PTY 注入层，构建中文系统消息并写入目标 agent PTY stdin
- `/Users/huangzongning/development/hive-serva/src/server/post-start-input-writer.ts` — 交互式 CLI 写入适配器，处理 prompt-ready 等待（最长 8s）和 bracketed paste 时序

**关键数据模型**：`DispatchRecord`（`dispatches` 表，含 `id/workspaceId/fromAgentId/toAgentId/text/status/reportText/artifacts/sequence`）、`TeamListItem`（含 `pendingTaskCount/lastPtyLine`）、`HiveEnv`（CLI 进程必须的四个环境变量）。

**在整体中的位置**：Hive 多 agent 协作的核心协议实现层，承上（HTTP/CLI）启下（PTY stdin 注入），横跨 SQLite 持久化和实时 PTY 通信。

---

### 任务图 / PM 文档子系统

**职责**：管理 `.hive/` 目录下所有项目管理 Markdown 文件（`tasks.md`、`plan.md`、`open-questions.md`、`ideas/inbox.md`、`decisions/`、`research/`、`reports/`、`baseline/`、`archive/`）的读写、解析、文件监视、WebSocket 实时推送，以及 milestone shipped 自动 nudge。

**关键文件**：

- `/Users/huangzongning/development/hive-serva/src/server/tasks-file.ts` — `TasksFileService`，对外统一读写 API，`ensurePmDocs` 批量初始化全部 PM 文档
- `/Users/huangzongning/development/hive-serva/src/server/tasks-file-watcher.ts` — chokidar 监视 `.hive/` 下 9 类路径，100ms 防抖后分三路通知
- `/Users/huangzongning/development/hive-serva/src/server/cockpit-doc.ts` — 聚合解析器，调用所有 `pm-*-doc` 解析器，生成含 `aiActions` 智能建议的 `ParsedCockpit`
- `/Users/huangzongning/development/hive-serva/src/server/plan-doc.ts` — 解析 `plan.md`（frontmatter + milestones + scope + risks）
- `/Users/huangzongning/development/hive-serva/src/server/milestone-completion-trigger.ts` — diff 前后 plan 快照，检测 `status → shipped` 并注入 housekeeping nudge

**关键数据模型**：`ParsedCockpit`（聚合所有子解析结果 + `aiActions: AIAction[]`）、`ParsedPlan`/`ParsedMilestone`（`PlanMilestoneStatus`）、`ParsedTasks`（`PMTaskSection[]`）、`PMDecision`。本子系统无 SQLite 表，全部持久化在 `.hive/` 目录的 Markdown 文件中。

**在整体中的位置**：`TasksFileService` 是 Team 协议子系统的下游写手（dispatch 行更新），同时通过三路 callback Set 扇出向终端 WS 服务和移动端推送实时变更。

---

### 持久化 / SQLite

**职责**：通过 better-sqlite3 维护单一 `runtime.sqlite` 文件，提供版本化 Schema 迁移（当前 `CURRENT_SCHEMA_VERSION=31`）和分域 Store 接口，供 `RuntimeStore` 统一组装和调用。

**关键文件**：

- `src/server/runtime-database.ts` — 打开或创建 `runtime.sqlite`（支持 `:memory:` 测试模式）
- `src/server/sqlite-schema.ts` — 基础表定义 + `v1-v31` 全部迁移，版本记录写入 `schema_version` 表
- `src/server/runtime-store-helpers.ts` — `createRuntimeStoreServices` 实例化所有 store，`createRuntimeStoreLifecycle` 封装 agent 启动/停止流程
- `src/server/runtime-store.ts` — `RuntimeStore` 接口（约 40 个方法），是所有 HTTP/WebSocket 路由的唯一依赖入口
- `src/server/workspace-store.ts` — 内存 Map 缓存 + SQLite 双写，加速 workspace/worker 读路径
- `src/server/dispatch-ledger-store.ts` — `dispatches` 表全生命周期 CRUD

**关键数据模型**（见下方"数据模型"节汇总）。

**在整体中的位置**：所有子系统的持久化底座；`RuntimeStore` 门面是 HTTP 层与所有领域 store 之间的唯一桥梁，测试时传空 `dataDir` 即走内存 DB。

---

### 飞书 / 移动端集成

**职责**：将飞书 IM（文字/语音、审批卡片）和手机 App（REST API、WebSocket 推送、端到端加密 relay RPC、Expo Push Notification）接入 runtime，让外部用户通过外部渠道向 Orchestrator 下发指令和审批风险操作。

**关键文件**：

- `/Users/huangzongning/development/hive-serva/src/server/feishu-transport.ts` — `FeishuTransport`，持有 `lark.Client` 和 `lark.WSClient`，飞书集成核心入口
- `/Users/huangzongning/development/hive-serva/src/server/feishu-inbound-handler.ts` — 将飞书聊天事件转化为 `recordUserInput()` 调用
- `/Users/huangzongning/development/hive-serva/src/server/relay-connector.ts` — 管理到 relay 服务器的 WS 连接、NaCl 握手、会话加密
- `/Users/huangzongning/development/hive-serva/src/server/relay-rpc-handler.ts` — 实现 relay 信道上的所有 RPC 方法
- `/Users/huangzongning/development/hive-serva/src/server/mobile-auth.ts` — Bearer token 鉴权、capability 检查，操作 `mobile_devices` 表
- `/Users/huangzongning/development/hive-serva/src/server/local-stt.ts` — 本地 whisper-cli 语音转文字，飞书/relay 共用

**关键数据模型**：`feishu_bindings` 表（群与 workspace 绑定）、`mobile_devices` 表（设备鉴权）、`mobile_chat_messages` 表、`mobile_media_uploads` 表（实体文件存 `~/.config/hive/uploads/`，SQLite 存元数据）、`ApprovalLedger`（纯内存 Map，重启后清空）。

**在整体中的位置**：外部通道的统一适配层，最终均通过 `RuntimeStore.recordUserInput()` 将消息注入 Orchestrator PTY stdin，与内部 Team 协议汇聚于同一写入点。

---

### Session 捕获 / 崩溃恢复

**职责**：在 agent 进程启动后自动嗅探并持久化底层 AI 工具（Claude/Codex/Gemini/OpenCode）的 session ID，崩溃重启时注入接力上下文；由 Sentinel 子系统提供周期性一致性心跳巡检。

**关键文件**：

- `/Users/huangzongning/development/hive-serva/src/server/session-capture.ts` — 统一 facade，四路 source（`claude_project_jsonl_dir / codex_session_jsonl_dir / gemini_session_json_dir / opencode_session_db`）分发
- `/Users/huangzongning/development/hive-serva/src/server/claude-session-coordinator.ts` — 竞争协调器，`claimedByProjectKey` 防止多 agent 抢占同一 session ID
- `/Users/huangzongning/development/hive-serva/src/server/agent-run-bootstrap.ts` — 启动流程编排：快照 → 注入环境变量 → 后台捕获 → 写 `AgentSessionStore`
- `/Users/huangzongning/development/hive-serva/src/server/restart-policy.ts` — 崩溃恢复策略：查前序 run → 调 `buildRecoverySummary` → 注入 stdin
- `/Users/huangzongning/development/hive-serva/src/server/recovery-summary.ts` — 聚合最近 1 小时 `RecoveryMessage` + 未完成任务 + `tasks.md` 内容
- `/Users/huangzongning/development/hive-serva/src/server/sentinel-heartbeat.ts` — 定时（30min）聚合 cockpit/git/orphaned dispatch/fidelity audit 快照写入 sentinel run stdin

**关键数据模型**：`SessionIdCaptureConfig`（联合类型，标识 source + pattern）、`SessionCaptureSnapshot`（含 `knownSessionIds: Set<string>`）、`CaptureWaiter`（内存，竞争协调）、SQLite `agent_sessions` 表（`workspace_id + agent_id PK, last_session_id`）、`RecoveryMessage`（联合类型：`user_input | send | report | status`）。

**在整体中的位置**：在 Agent 生命周期子系统的启动和退出两端插入横切逻辑，依赖终端镜像（`TerminalStateMirror`）和 PM 文档子系统（`tasks.md` 内容）构建恢复上下文。

---

## 子系统依赖关系

```
CLI (team.ts)
     │ HTTP POST /api/team/*
     ▼
routes-team.ts  ──────────────────────────────────┐
     │                                            │
     ▼                                            │
team-operations.ts                                │
  ├── dispatch-ledger-store.ts (SQLite)           │ RuntimeStore
  ├── tasks-file.ts (.hive/tasks.md)              │ (门面)
  └── agent-stdin-dispatcher.ts                  │
           │                                      │
           ▼                                      │
  post-start-input-writer.ts                      │
           │ writeInput(runId, text)               │
           ▼                                      │
     AgentManager  ◄── AgentRuntime ◄─────────────┘
    (node-pty IPty)       (门面)
           │
           ▼
     PtyOutputBus (pub/sub)
      ├──► TerminalStreamHub ──► WebSocket 终端 (浏览器 xterm.js)
      │       └── TerminalStateMirror (headless xterm, scrollback)
      └──► WorkerOutputTracker (无 UI agent 的 headless mirror)

Session 捕获 / 崩溃恢复
  ├── agent-run-bootstrap.ts ──► AgentRunStarter (启动前/后插入)
  ├── restart-policy.ts ──► AgentRuntime.writeInput (崩溃重启注入)
  └── sentinel-heartbeat.ts ──► AgentRuntime.writeRunInput (30min 心跳)
              ├── cockpit-doc.ts (读 .hive/)
              └── dispatch-ledger-store.ts (orphaned dispatches)

任务图 / PM 文档
  ├── tasks-file-watcher.ts (chokidar) ──► 三路 callback Set
  │      ├──► TasksWebSocketServer (推送 /ws/tasks/:id)
  │      ├──► PlanWebSocketServer (推送 /ws/plan/:id)
  │      └──► CockpitWebSocketServer (推送 /ws/cockpit/:id)
  │              └── cockpit-doc.ts (全量重读 .hive/)
  └── milestone-completion-trigger.ts ──► AgentRuntime.writeInput (nudge)

飞书 / 移动端集成
  ├── feishu-inbound-handler.ts ──► RuntimeStore.recordUserInput()
  ├── relay-rpc-handler.ts ──► RuntimeStore (所有 RPC 方法)
  └── mobile-push.ts ──► Expo Push API (外网推送)

持久化 / SQLite
  └── RuntimeStore (门面) ──► 所有领域 store 的唯一上游
        ├── workspace-store (内存 Map + SQLite 双写)
        ├── dispatch-ledger-store
        ├── agent-run-store
        ├── message-log-store
        ├── mobile-auth-store / mobile-chat-store / mobile-media-store
        └── feishu-bindings-store
```

---

## 数据模型

### SQLite 表（`runtime.sqlite`，`CURRENT_SCHEMA_VERSION=31`）

| 表名 | 主键 | 说明 |
|---|---|---|
| `schema_version` | `version` | 迁移版本记录 |
| `workspaces` | `id` | 工作区（名称、路径） |
| `workers` | `id` | Agent/Worker，含 `role`、`last_session_id`、`config_json` |
| `agent_runs` | `run_id` | 运行历史：`pid / status / exit_code / error_tail / started_at / ended_at` |
| `agent_launch_configs` | `(workspace_id, agent_id)` UNIQUE | 启动配置：`command / args_json / command_preset_id / thinking_level / resume_args_template / session_id_capture_json` |
| `agent_sessions` | `(workspace_id, agent_id)` UNIQUE | 最近一次 session ID（用于 resume） |
| `dispatches` | `id` UUID，`sequence` AUTOINCREMENT | 派单账本：`from_agent_id / to_agent_id / text / status / report_text / artifacts` |
| `messages` | `sequence` AUTOINCREMENT | 消息日志：`type ∈ {user_input, send, report, status, system_env_sync, system_recovery_summary}` |
| `command_presets` | `id` | 命令预设（内置 + 用户自定义） |
| `role_templates` | `id` | 角色模板（Orchestrator/Coder/Reviewer/Tester/自定义） |
| `app_state` | `key` | KV 全局状态（如 `active_workspace_id`） |
| `feishu_bindings` | `id`，`chat_id` UNIQUE | 飞书群与 workspace 绑定 |
| `mobile_devices` | `id`，`token` UNIQUE | 移动设备鉴权：`capabilities / device_type / push_token` |
| `mobile_chat_messages` | `id` | 移动聊天记录：`direction(inbound\|outbound) / message_type / content_json` |
| `mobile_media_uploads` | `id` | 移动端上传文件元数据，实体写 `~/.config/hive/uploads/` |

### 核心内存类型

| 类型 | 所在文件 | 说明 |
|---|---|---|
| `LiveAgentRun` | `agent-runtime-types.ts` | `AgentRunSnapshot + startedAt`，运行时内存对象 |
| `AgentRunRecord` | `agent-manager.ts` | `LiveAgentRun + process(PTY 句柄) + errorTailBuffer` |
| `DispatchRecord` | `dispatch-ledger-store.ts` | 派单完整实体，状态机 `queued→submitted→reported/cancelled` |
| `ParsedCockpit` | `cockpit-doc.ts` | 聚合所有 PM 文档解析结果 + `aiActions: AIAction[]` |
| `ParsedPlan` / `ParsedMilestone` | `plan-doc.ts` | plan.md 结构化解析，`PlanMilestoneStatus` 驱动 milestone nudge |
| `TeamListItem` | `shared/types.ts` | `{ id, name, role, status, pendingTaskCount, lastPtyLine }` |
| `SessionIdCaptureConfig` | `session-capture.ts` | 联合类型，标识 source 和 pattern |
| `RecoveryMessage` | `message-log-store.ts` | 崩溃恢复摘要来源：`user_input | send | report | status` |
| `ApprovalLedger` | `feishu-approval-ledger.ts` | 纯内存 Map，`PendingApproval`，重启后清空 |
| `CaptureWaiter` | `claude-session-coordinator.ts` | 内存竞争协调器，含 `knownSessionIds + onCapture` 回调 |

### 文件系统持久化（无 SQLite）

PM 文档子系统完全依赖 `.hive/` 目录下的 Markdown 文件：`tasks.md`（GFM task list）、`plan.md`（frontmatter + milestones）、`open-questions.md`、`ideas/inbox.md`、`decisions/*.md`（ADR）、`research/*.md`、`reports/*.md`、`baseline/`（5 个子文件，含 git log 陈旧检测）、`archive/`。

---

## 设计约束与注意点

### 有意取舍

**门面模式层叠（AgentRuntime + RuntimeStore）**
两层门面并非过度抽象，而是职责边界的明确分割：`AgentRuntime` 封装进程级操作（spawn/kill/stdin），`RuntimeStore` 封装数据级操作（workspace/dispatch/message）。两者均支持接口替换，测试时传 `:memory:` DB 或 mock PTY 无需修改调用方。

**双层状态管理（内存 Map + SQLite）**
`AgentManager` 和 `LiveRunRegistry` 持有内存态（含 PTY 句柄），SQLite 持有持久态。读路径通过 `syncPersistedRun` 懒同步，写路径双写。这是为了保证 PTY 句柄不需要序列化（无法序列化），同时在服务重启后能从 SQLite 恢复历史记录。代价是两者可能短暂不一致，`markUnfinishedRunsStale` 在启动时做自愈补偿。

**PTY 输出不落库**
终端原始字节流仅在内存中通过 `PtyOutputBus` 广播和 `TerminalStateMirror` 缓存（10K 行 scrollback），不写 SQLite。这是性能取舍：高频字节流入库代价过高；崩溃恢复通过 `RecoveryMessage`（结构化消息）而非原始输出重建上下文。

**PM 文档纯文件系统持久化**
`.hive/` 目录下所有项目管理状态存储在 Markdown 文件而非 SQLite，使得 agent 可以直接用文件读写工具操作任务图，无需通过 API。代价是并发写入无事务保护，依赖 `chokidar` 变更通知而非 DB trigger。

**无心跳 / 无超时 / 无卡死检测**
agent 状态机仅有 `working / idle / stopped` 三态，完全由协议事件驱动（`send → working`，`report → idle`，PTY exit → `stopped`）。卡死的 agent 持续显示 `working`，由用户手动判断。这是有意去除的复杂度，避免误判和复杂的超时状态机。

**RBAC 硬编码**
`team-authz.ts` 中 orchestrator/worker 的允许命令集用 `Set` 硬编码（orchestrator 只能 `send/list/cancel`，worker 只能 `report/status/help`）。简单明确，无需 DB 配置，但新增角色需修改代码。

### 已知不对称与技术债

**`ApprovalLedger` 纯内存**：飞书审批的 `PendingApproval` 重启后全部丢失，悬挂的审批卡片按钮将返回「已过期」toast。属有意接受的简化，未来可落 SQLite。

**`MobileOrchestratorReplyCapture` 已禁用**：原始 PTY 输出含大量噪音，orchestrator 回复须由业务代码显式调用 `insertMobileChatMessage`，自动捕获能力注释掉留待后续改进。

**`relay-rpc-handler` 的 `voice.transcribe` 使用同步文件 API**（`mkdtempSync/writeFileSync`），而飞书侧使用异步版本，属已知不对称实现。

**`feishu-route-resolver` 硬编码 orchestratorAgentId 格式**（`${workspaceId}:orchestrator`），与 `workspace-store-support.ts` 的 `getOrchestratorId()` 约定耦合，重构 ID 格式时需双处同步修改。

**`cockpit-doc` 无缓存**：`parseCockpit()` 每次调用全量重读磁盘，适合低频更新（每次 chokidar 变更触发），高频场景（如 cockpit WS 连接激增）可能成为瓶颈。

**`milestone-completion-trigger` 的去重是进程级内存**：`nudgedMilestones Set` 进程重启后清空，设计上接受重复 nudge，不做持久化去重。

### 关键约定

- `HIVE_BIN_DIR` 前置注入 PTY 子进程 `PATH`，使内部 `team` CLI 工具优先于系统同名命令，实现零污染用户系统。
- 每条注入消息末尾追加 `<hive-system-reminder>` XML 块，应对 agent `/compact` 后丢失身份上下文的兜底机制。
- 所有多表写操作通过 `db.transaction()` 原子提交，`FeishuReactionStore` 是唯一不写 SQLite 的例外（纯内存 Map）。
- `PendingExitCode` 竞态处理：node-pty `onExit` 可能在 `LiveRunRegistry.add()` 之前触发，用 `pendingExitCodes Map` 暂存，`startLiveRun` 尾部检测后补触发，防止 exit 事件丢失。
- Session 捕获使用「快照-差值」策略：启动前拍 `knownSessionIds` 快照，只接受快照之后出现的新 ID，避免重放历史 session；`claude-session-coordinator` 的 `claimedByProjectKey` 进一步防止同 workspace 下多 agent 抢占同一 session。