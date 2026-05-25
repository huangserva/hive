# Risk Hotspots

> Known risks, triggers, and current workaround. Keep this operational.

## Lark SDK reconnect / Feishu transport

- Risk: `lark.WSClient` reconnect behavior is SDK-owned; inbound can be delayed or missed.
- Trigger: network flap, invalid credentials, app permission changes.
- Current mitigation: transport status indicator, reconnect count logging, no runtime retry loop.
- Watch: production logs under `~/.config/hive/logs/runtime-<port>.log`.

## Feishu approval ledger is in-memory

- Risk: pending approval cards expire silently on runtime restart.
- Trigger: restart/kill after `team approve` but before user taps Allow/Deny.
- Current mitigation: card action returns expired/processed toast; orchestrator must wait for injected result.
- Future: persist approvals if this becomes common.

## YOLO mode + approval prompt layering

- Risk: CLI agents run with permissive preset args; safety depends on orchestrator following approval rules for Feishu-origin high-risk actions.
- Trigger: destructive command request via Feishu, e.g. rm/git push/drop/delete/write external service.
- Current mitigation: ORCHESTRATOR_REMINDER_TAIL says high-risk Feishu actions require `team approve`.
- Boundary: no keyword interceptor; this is policy/prompt-driven, not hard enforcement.

## Upstream divergence

- Risk: upstream tt-a1i/hive keeps moving; HippoTeam has rebrand, Feishu, PM, cockpit changes.
- Trigger: cherry-pick broad upstream features such as marketplace or terminal rewrites.
- Current mitigation: backport small bugfix/hardening commits by domain; avoid merge-main.
- Watch: conflicts in Topbar, i18n, package name, terminal, team protocol, schema.

## Dispatch 409 / open dispatch edge cases

- Risk: `team report` can return ConflictError/409 when no open dispatch exists or dispatch was canceled/reported.
- Trigger: stale worker, manual stop/restart, duplicate report, explicit missing dispatch id.
- Current mitigation: `team status` exists for non-dispatch progress; pending reset on new PTY session.
- Watch: user-visible error should preserve backend message, not generic fallback.

## Private helper testability

- Risk: important behavior hidden inside class/private functions becomes hard to test without mock-heavy tests.
- Trigger: Feishu card builders, transport chunking, CLI arg parsing, terminal input profiles.
- Current mitigation: extracted utils for Feishu text/chunk/card parsing and CLI parse functions.
- Rule: export pure helpers for unit tests; keep real HTTP/PTÝ integration for contracts.

## Terminal backpressure and websocket fan-out

- Risk: slow viewers can pause PTY output; watcher/WS snapshot race can cause flaky tests.
- Trigger: large terminal output, client not acking, concurrent full test suite.
- Current mitigation: terminal flow-control tests, guarded upgrade handlers, mirror scrollback.
- Watch: `/ws/plan` and `/ws/cockpit` snapshot listeners must not race first message.

## Archive discipline is not automatic

- Risk: plan/tasks/handoff/reports grow until Cockpit becomes noisy.
- Trigger: many Done items, long handoff, repeated review evidence in active files.
- Current mitigation: PM rules require audit and user-confirmed archive to `.hive/archive/YYYY-MM/`.
- Gap: no automated archive mover or UI affordance yet.

## Baseline can drift

- Risk: baseline files become stale and mislead future orchestrator sessions.
- Trigger: module moves, schema migrations, Feishu/PM flow changes, upstream backports.
- Current mitigation: Cockpit `baseline-stale` aiAction when stubs/missing files exist.
- Rule: update baseline after milestone-scale changes; keep each file under 200 lines.

## Web asset serving: rebuild churn + dev/prod port confusion

- Risk: 浏览器跑着跑着要手动刷（字体掉/连不上/状态陈旧）。两条独立成因。
- Trigger A（dev 5180）：worker 编辑 `web/src/*` → Vite HMR 重载 user 开着的 tab。
- Trigger B（prod 4010）：`pnpm build:web` 换 content-hash → 旧页面引用的旧 hash 资源 404。
- Current mitigation: app.ts 缓存头（index.html no-cache / assets immutable）+ `preload-recovery.ts`（chunk 失败自动 reload）+ `reconnecting-websocket.ts`（WS backoff 重连）。
- 关键操作事实：`pnpm dev` 起双端口 = 4010 后端(+serve dist) / 5180 Vite dev(HMR，代理到 4010)。**user 固定看 4010**；诊断刷新类问题先确认端口（5180 上 app.ts 缓存修复无效）。

## Local data and secrets

- Risk: `.hive/` docs are repo/workspace files; Feishu credentials are local config.
- Trigger: accidental commit of secrets, confusing `.hive` docs with `~/.config/hive`.
- Current mitigation: `feishu.json` lives under `~/.config/hive`, not workspace.
- Check: before commit, review `git status --short` and avoid generated/secrets churn.
