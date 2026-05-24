# Module Map

> 代码模块职责边界。受 200 行限制：主要入口/高风险文件逐项列；同构小文件按 family 合并。

## 后端 (src/server/)

### Runtime / app shell
- app.ts — 创建 HTTP server、route 分发、静态资源与 app context。
- routes.ts — HTTP route registry，按 method/path 匹配 RouteDefinition。
- route-helpers.ts — route DSL、参数读取、JSON 响应工具。
- route-types.ts — RouteContext、body 类型、Feishu transport DI 类型。
- http-errors.ts — BadRequest/Conflict/NotFound/PtyInactive 等 HTTP error。
- local-request-guard.ts — 限制 runtime API/WS 仅本机请求。
- logger.ts — 最小文件 logger、uncaught/unhandled 日志落盘。
- package-version.ts — 读取 package version。
- version-service.ts — 上游版本检查服务。

### RuntimeStore / workspace state
- runtime-store.ts — RuntimeStore facade，组合 workspace/agent/team/feishu/PM 服务。
- runtime-store-helpers.ts — 创建 stores、watcher、agentRuntime、lifecycle helpers。
- runtime-database.ts — 打开 better-sqlite3 runtime.sqlite 并初始化 schema。
- sqlite-schema.ts — 当前 schema v21 与迁移调度。
- sqlite-schema-v*.ts — 历史 schema migration，小步 ALTER/CREATE。
- workspace-store.ts — workspace/worker 内存状态 facade。
- workspace-store-contract.ts — workspace store 类型契约。
- workspace-store-hydration.ts — runtime 启动时从 SQLite 恢复 workspace/worker。
- workspace-store-mutations.ts — worker 三态/pending/task mutation。
- workspace-store-support.ts — workspace helper、状态推导、默认 orchestrator。
- workspace-path-validation.ts — workspace 路径合法性检查。
- app-state-store.ts — app_state 表读写。
- settings-store.ts — command preset、app settings 持久化 facade。

### Agent lifecycle / PTY
- agent-runtime.ts — agent runtime facade。
- agent-runtime-*.ts — active run/list/stop/ports/close/contract 细分模块。
- agent-manager.ts — node-pty process manager。
- agent-manager-support.ts — PTY spawn、onData/onExit/onError、finish run。
- agent-run-bootstrap.ts — 组装 CLI 启动命令、PATH、env、thinking args。
- agent-run-starter.ts — start context、post-start input、session review 注入。
- agent-run-start-context.ts — agent start 所需 workspace/config/context。
- agent-run-exit-handler.ts — exit/error 后状态落盘与 cleanup。
- agent-run-store.ts — agent_runs 表 CRUD。
- agent-run-sync.ts — live run 与 persisted run 同步。
- agent-runtime-types.ts — LiveAgentRun 等运行时类型。
- live-run-registry.ts — live run registry。
- agent-command-resolver.ts — shell command/preset resolution。
- agent-launch-resolver.ts — launch config/preset 合并。
- agent-launch-cache.ts — agent launch config cache。
- agent-session-store.ts — agent_sessions 表，Layer A session id。
- agent-tokens.ts — per-agent token 生成与校验。
- agent-startup-instructions.ts — agent 启动注入的 team guidance。
- agent-stdin-dispatcher.ts — 向 agent PTY 写入 team/system/user 消息。
- post-start-input-writer.ts — PTY 启动后写初始 prompt/env review。
- worker-output-tracker.ts — 跟踪 worker 最近输出行。

### Session resume / CLI presets
- claude-command-defaults.ts — Claude 默认 YOLO 参数。
- claude-session-support.ts — Claude session 文件解析与 resume support。
- claude-session-coordinator.ts — Claude session capture 协调。
- session-capture*.ts — Claude/Codex/Gemini/OpenCode session id 捕获。
- preset-launch-support.ts — command preset augmentation support。
- command-preset-defaults.ts — Claude/Codex/OpenCode/Gemini 内置 preset。
- command-preset-store.ts — command_presets 表 CRUD。
- startup-command-parser.ts — startup command 解析。
- terminal-input-profile.ts — OpenCode 等终端输入 profile 推导。

### Team protocol / dispatch
- team-operations.ts — team send/report/status/cancel 核心业务。
- team-authz.ts — agent token 权限与角色校验。
- team-list-enrichment.ts — team list 输出补充 run/session/last line。
- team-list-serializer.ts — team list snake_case 输出契约。
- dispatch-ledger-store.ts — dispatches 表 CRUD/状态迁移。
- dispatch-ledger-serializer.ts — dispatch record 序列化。
- runtime-message-builders.ts — send/report/user_input 系统消息文本。
- message-log-store.ts — messages 表 CRUD/恢复窗口。
- system-message.ts — 系统消息格式 helper。
- recovery-summary.ts — Layer B recovery summary。
- restart-policy*.ts — agent restart policy 与 fallback。

### Terminal / workspace shell
- terminal-ws-server.ts — terminal/tasks/plan/cockpit WS 接线入口。
- terminal-stream-hub.ts — PTY output 多 viewer stream hub。
- terminal-flow-control.ts — websocket backpressure/ack 控制。
- terminal-state-mirror.ts — headless xterm scrollback mirror。
- terminal-protocol.ts — terminal WS protocol 类型。
- pty-output-bus.ts — PTY output pub/sub。
- tasks-websocket-server.ts — /ws/tasks/:workspaceId。
- plan-websocket-server.ts — /ws/plan/:workspaceId。
- cockpit-websocket-server.ts — /ws/cockpit/:workspaceId。
- workspace-shell-runtime.ts — workspace shell terminal live runs。

### PM / .hive docs
- tasks-file.ts — .hive/tasks.md/plan/templates/baseline seed 与读写。
- tasks-file-watcher.ts — chokidar watch tasks/plan/cockpit PM 文件。
- task markdown parsers live in web/src/tasks; server only stores file text.
- plan-doc.ts — plan.md parser。
- cockpit-doc.ts — ParsedCockpit 聚合器与 aiActions。
- pm-questions-doc.ts — open-questions.md parser。
- pm-ideas-doc.ts — ideas/inbox.md parser。
- pm-baseline-doc.ts — baseline dir metadata parser。
- pm-decisions-doc.ts — decisions dir parser。
- pm-archive-doc.ts — archive/YYYY-MM parser。
- pm-templates.ts — plan/ADR/handoff/research/baseline 模板。
- hive-team-guidance.ts — ORCHESTRATOR_RULES/REMINDER/PROTOCOL builder。
- session-start-review-message.ts — session-start PM review system message。

### Feishu bridge / approval
- feishu-credentials.ts — 读取 ~/.config/hive/feishu.json。
- feishu-bindings-store.ts — feishu_bindings 表 CRUD。
- feishu-transport.ts — lark WSClient、inbound、outbound、card action。
- feishu-transport-utils.ts — text parse/chunk/card builder pure helpers。
- feishu-route-resolver.ts — chat_id 到 workspace/orch 路由。
- feishu-inbound-handler.ts — 飞书消息注入 orch stdin。
- feishu-approval-ledger.ts — in-memory approval ledger。
- routes-feishu.ts — Feishu UI/internal HTTP endpoints。

### File system / UI routes
- routes-workspaces.ts — workspace CRUD/autostart endpoints。
- routes-runtime.ts — runs/terminal/runtime endpoints。
- routes-team.ts — team CLI HTTP bridge。
- routes-dispatches.ts — dispatch list/cancel UI endpoints。
- routes-tasks.ts — tasks.md API。
- routes-plan.ts — plan.md API。
- routes-cockpit.ts — cockpit aggregate API。
- routes-fs.ts — file browser/picker endpoints。
- routes-settings.ts — settings endpoints。
- routes-ui.ts — UI session/bootstrap endpoints。
- routes-version.ts — version info endpoint。
- fs-browse.ts — server-side file browser。
- fs-pick-folder.ts — native folder picker integration。
- fs-sandbox.ts — allowed path guard。
- role-template-store.ts — role_templates table CRUD。
- role-templates.ts — built-in worker/orch role templates.
- orchestrator-launch.ts — default orchestrator launch config seed。
- orchestrator-autostart.ts — workspace create autostart helper。

## 前端 (web/src/)

- app.tsx — root state composition and workspace selection wiring。
- main.tsx — React entrypoint。
- api.ts — fetch/WebSocket client functions and shared response types。
- AppProviders.tsx — app-level providers。
- AppOverlays.tsx — dialogs/drawers composition。
- AppWorkspaceContent.tsx — active workspace main content。
- WorkspaceDetail.tsx — workspace page shell。
- WorkspaceTerminalPanels.tsx — terminal panels layout。
- cockpit/* — Cockpit drawer, tabs, action bar, useCockpit hook。
- plan/* — legacy Plan drawer sections and parser UI rendering。
- tasks/* — task graph drawer, markdown parser/editor, tasks hook。
- terminal/* — xterm client, workspace shell dialog, terminal run hooks。
- worker/* — Add Worker, cards, modal, orchestrator pane, worker actions。
- workspace/* — Add Workspace, browse dialogs, settings, command preset select。
- sidebar/* — workspace sidebar and avatar/color helpers。
- layout/* — Topbar, HippoLogo, MainLayout, language/sidebar resize。
- feishu/* — Feishu status indicator。
- notifications/* — notification provider/settings/workspace notices。
- demo/* — demo mode fixtures and state。
- wizard/* — first-run wizard。
- ui/* — shared Avatar/Confirm/EmptyState/Tooltip/toast primitives。
- lib/* — utility helpers and swallowed-error logger。
- i18n.tsx/uiLanguage.ts — EN/ZH copy and language state。
- use*.ts(x) — app hooks for shortcuts, panes, version, workspace CRUD。

## CLI (src/cli/)

- hive.ts — runtime CLI: parse port, logger, app/Feishu startup, shutdown。
- team.ts — agent CLI: list/send/report/status/cancel/feishu/approve commands。

## Shared (src/shared/)

- types.ts — HTTP/UI shared domain types。
- thinking-levels.ts — supported thinking_level values and labels。
