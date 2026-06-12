# State Storage

> SQLite schemas + 持久化边界。Runtime 默认本机；项目文档在 workspace `.hive/`。
> **DRAFT 2026-05-31（马超 baseline 体检顺手刷新 schema 版本+表，待 user 校对）**

## Data locations

- Persistent runtime DB: `~/.config/hive/runtime.sqlite` when CLI uses a data dir.
- Test/runtime in-memory DB: `openRuntimeDatabase()` uses `:memory:` when no dataDir.
- Runtime logs: `~/.config/hive/logs/runtime-<port>.log` unless `HIVE_LOG=0`.
- Feishu credentials: `~/.config/hive/feishu.json`, read only by runtime.
- Workspace PM/task docs: `<workspace>/.hive/*`, watched with chokidar.
- PTY transcript/scrollback: not persisted into SQLite messages.

## SQLite schema version

- Current schema: `CURRENT_SCHEMA_VERSION = 32` in `src/server/sqlite-schema.ts`。近期：v25 mobile capabilities、v26 Expo push token、v27 builtin role_templates、v28 mobile_chat_messages、v29 mobile_devices.source、v30 drop mobile_pairing_codes、v31 mobile_media_uploads、v32 agent_run_timeline_events。
- `schema_version(version, applied_at)` records applied migrations.
- Migrations live in `sqlite-schema-v*.ts`; schema changes must go through them（禁运行时 ad hoc ALTER）。

## Core tables

- `workspaces` — workspace id/name/path/created_at.
- `workers` — worker id/workspace/name/description/role/last_session_id.
- `messages` — user_input/send/report/status artifacts for recovery and audit.
- `dispatches` — async team send/report/cancel ledger.
- `agent_launch_configs` — startup command/preset/session capture/thinking_level.
- `agent_runs` — run id/agent pid/status/exit/error_tail timestamps.
- `agent_sessions` — last native CLI session id per workspace+agent.
- `command_presets` — built-in/custom CLI preset definitions.
- `role_templates` — built-in/custom worker role templates.
- `app_state` — active workspace and UI-level durable app state.
- `feishu_bindings` — chat_id to workspace binding, unique by chat_id.
- `feishu_reactions` — 消息反馈 emoji（GLANCE/OK 两阶段）。
- `agent_run_timeline_events` — durable 可恢复事件流（seq/epoch/gap，M23）。
- `mobile_devices` — permanent token + capabilities + source + push_token（v30 起取代 pairing codes）。
- `mobile_chat_messages` — 手机双向对话（user_text/orch_reply/worker_report/approval_request/system_event，M24/M28）。
- `mobile_media_uploads` — 手机/飞书附件上传元数据（v31）。

## Persistent across runtime restart

- Workspace list, workers, descriptions, roles.
- Command presets, role templates, app_state.
- Agent launch configs and captured native session ids.
- Agent run records and `error_tail`.
- Team messages and dispatch ledger.
- Feishu chat bindings.
- `.hive/` project docs: tasks, plan, baseline, decisions, research, archive.

## Runtime-memory only

- Live PTY processes and WebSocket clients.
- Terminal mirror scrollback and flow-control counters.
- Agent tokens generated for live PTY env.
- Feishu `ApprovalLedger` pending approvals.
- Feishu transport connection state and lastChatByAgent map.
- Chokidar watcher instances and listener callback sets.
- In-flight process cleanup timers/backpressure state.

## Boundary rules

- SQLite writes should happen before in-memory mutation when both are needed.
- `workspace-store-hydration.ts` resets transient pending state on runtime boot.
- Worker visible state remains only `idle | working | stopped`.
- HTTP/JSON boundary uses snake_case where protocol requires it.
- `.hive/` docs are user-visible source of truth for PM state, not SQLite rows.
