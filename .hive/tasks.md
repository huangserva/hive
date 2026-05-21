# Tasks

## In progress

**飞书桥 Plan B 实施中**（设计：`.hive/reports/feishu-bridge-plan-2026-05-21.html`）

**全部 5 个 Phase 完成（含审批卡片）。** 等 user 回来配 feishu.json + 重启 4010 → 真飞书 e2e。

15 个 commit + 757 tests + 132 个 feishu 测试。Phase 5 加了飞书审批卡片（Hermes 风格）：orchestrator 派高风险任务前必须 `team approve` → 飞书弹卡片 → user 手机点 ✅/❌ → 注入回 orch。

Phase 0 完成（`6d7bba2` + `8b5f1a9`）：schema v21 + credentials loader + bindings store + RuntimeStore 接线 + startup log + 45 个新测试。
Phase 1 inbound 实现 + tests 完成（`d595f6f` + `445bebd`）：feishu-transport / route-resolver / inbound-handler 三件 + 16 个新测试。
Phase 2 outbound 实现 + tests 完成（`10815af` + `640aaaa`）：team feishu reply CLI + /internal/feishu/outbound endpoint + transport-utils refactor + sendMessage + 长消息 25KB 切片 + orch system prompt 加 reminder + 31 个新测试。
Phase 3 UI 实现完成（`fd0db8e`）：4 个 UI-token endpoints + web api.ts + Topbar 飞书状态灯（5s poll）+ Sidebar workspace ⚙ 入口 + WorkspaceSettings dialog + transport.getStatus()。TaskLog 飞书标记跳过（web 没有 persistent message log UI 可挂）。
当前 656 tests 全绿。

Phase 4 准备 refactor 完成（`19819b5`）：parseFeishuReplyArgs + chunkFeishuText + FeishuOutboundTransport interface 全部 export。
Phase 4 测试补全完成（待 commit）：parseFeishuReplyArgs (9 tests) + chunkFeishuText (10 tests) + 4 个 UI-token endpoints integration (19 tests) = 38 个新测试。
Phase 4 bug fix（待 commit）：典韦发现 POST /api/feishu/bindings 用不存在 workspace_id 返回 500 → 关羽 fix 加 NotFoundError 转 404 + listFeishuBindings 也 wrap。我 sync 那条测试期望 (500 → 404)。
当前 694 tests 全绿。Phase 5 留给 user 决定（已知局限见 handoff.html）。

后续节奏（user 出门，orchestrator 自主决定）：
- 关羽 Phase 1 完 → 派 典韦 加测试 → review → commit → push
- Phase 2 派 关羽 outbound (team feishu reply + feishu-outbox)
- Phase 3 派 关羽 UI 绑定 + 状态灯
- Phase 4 派 典韦 e2e 测试 + 文档
- 阻塞点：实现可以无飞书凭证完成，但 user 出门后 e2e 验证需要 user 回来配置 ~/.config/hive/feishu.json

## Done

- [x] **关羽**: multica #3 — 后端错误消息透传 UI。12 个 endpoint 走 `readErrorMessage`。`c223f31` 已 push。116 files / 564 tests 全过。
- [x] **关羽**: multica #1 + #2 — per-worker thinking_level 选择器 + Add Worker picker。Schema v20 + Claude `--effort` / Codex `-c model_reasoning_effort=...` 注入。`8a2295c` + `d4b64b5` 已 push。
- [x] **关羽**: multica 二轮深度调研 → 8 条具体借鉴项报告
- [x] **关羽**: 修 dev 模式 `team` 命令 PATH bug（POSIX sh wrapper 双模式 + bin dir resolve 简化）
- [x] **关羽**: 修 worker stop/restart 卡 working 的 pending bug（方案 B + stopped-only guard）
- [x] hive 旧仓库 archive 到 `~/development/hive.archived-2026-05-20`
- [x] hive-serva 全部改动 push 到 huangserva/hive（remote 改成 SSH）
- [x] **关羽**: P0 logger + 5 个 event handler 防崩
- [x] **典韦**: 全仓 event handler 未 catch 扫描 → 3 🔴 + 9 🟡
- [x] **关羽**: 调研报告（日志、12 commit、hive vs hive-serva、npm 1.3.0）

## Open（user 回来决定）

- 重启 4010 让今天所有改动生效（破坏性，杀所有 worker）
- multica #4 #5 #6 #7 #8 中优先级（UX 偏好性强，应由 user 看 demo 决定）
- 9 个 🟡 中风险 event handler 是否补修（等 logger 抓到证据）
