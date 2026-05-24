---
title: HippoTeam
started: 2026-05-20
current_phase: maintenance + PM 体系 rollout
status: active
last_review: 2026-05-24
---

## 目标

把 `tt-a1i/hive` fork 维护成 **huangserva 自用的 HippoTeam 多 agent 工作台**，重点能力：飞书远控（含审批卡片）、orchestrator 升级为项目主管（PM）、保持跟上游有价值改动同步。

## 里程碑

### M1 · 稳定性强化（基础设施） · shipped 2026-05-20
- [x] P0 logger（`~/.config/hive/logs/runtime-<port>.log` + uncaught hooks）
- [x] 5 个 event handler 防崩（PTY / WebSocket / upgrade try/catch）
- [x] worker stop/restart 卡 working 的 pending bug fix（stopped-only guard）
- [x] dev 模式 `team` PATH bug fix（POSIX sh wrapper）

### M2 · multica 借鉴 · shipped 2026-05-20
- [x] #1 + #2 per-worker thinking_level + Add Worker picker (`8a2295c`)
- [x] #3 后端错误消息透传 UI (`c223f31`)
- [x] 二轮深度调研 8 条具体借鉴项 HTML 报告
- 余下 #4-#8 UX 偏好类，等 user 看 demo 决定

### M3 · Rebrand → HippoTeam · shipped 2026-05-21~24
- [x] Topbar 圆圈 H logo + favicon + HTML title (`539266f`)
- [x] package.json `@huangserva/hippoteam` + README + i18n 16 处
- [x] 移除 upstream npm update badge（fork 后比较无意义）

### M4 · Feishu Bridge Plan B（远程飞书远控 + 审批卡片） · shipped 2026-05-21
- [x] Phase 0 schema v21 + credentials loader + bindings store (`6d7bba2`)
- [x] Phase 1 inbound WS transport + route resolver + handler (`d595f6f`)
- [x] Phase 2 outbound `team feishu reply` + 长消息切片 (`10815af`)
- [x] Phase 3 UI: Topbar 飞书状态灯 + WorkspaceSettings dialog (`fd0db8e`)
- [x] Phase 4 testability refactor + bug fix (500→404)
- [x] Phase 5 审批卡片（Hermes 风格）+ ApprovalLedger + sendApprovalCard (`e601c38`)
- 16 个 commit / 132 个 feishu 测试，详见 `.hive/reports/feishu-bridge-plan-2026-05-21.html`

### M5 · Upstream backports · shipped 2026-05-23~24
- [x] Step 1 强相关：53e3645 tasks WS hardening + a2945fe team cancel (`473dc46` + `02abda0` + `24fc7d5`)
- [x] Step 2 弱相关：71fdaaf port-in-use + b34cfe4 drawer width + e57c6be+7bda143 OpenCode mouse + 4c34bf6 部分 (`dbc7a1e`)
- 详见 `.hive/reports/upstream-diff-2026-05-24.html`

### M6 · PM 体系 Phase A · shipped 2026-05-24
- [x] 5 个文档模板 (`pm-templates.ts`)
- [x] workspace 第一次启动自动 seed `.hive/plan.md` + `.hive/templates/`
- [x] ORCHESTRATOR_RULES 加 PM 段（中文）+ ORCHESTRATOR_REMINDER_TAIL 加一句（英文）
- [x] PROTOCOL.md builder 加 `.hive/` 目录约定段

### M6.1 · PM 体系 Phase B（plan.md drawer UI）· shipped 2026-05-24
- [x] plan-doc parser + chokidar watch + WebSocket 推送
- [x] PlanDrawer 720px + 6 子组件（PlanHeader / MilestoneList / MilestoneCard / Goal / Scope / Risk）
- [x] 50 个测试 (`588a9c9` + `9619d26`)

### M6.2 · PM 体系 Phase C-1（4 个新文档类型）· shipped 2026-05-24
- [x] 5 个新模板（OPEN_QUESTIONS / IDEAS_INBOX / 3 个 BASELINE）
- [x] ensurePmDocs 扩展 seed 11 个新文件 + 3 个新模板
- [x] ORCHESTRATOR_RULES 加 6 节（Open Questions / Ideas / Baseline / Decisions / Archive / Cross-workspace）
- [x] PROTOCOL.md 目录约定扩展
- [x] 24 个测试 + 修 plan WS race (`82fc5a2` + `64c7236`)

### M6.3 · PM 体系 Phase C-3a（session-start review nudge）· shipped 2026-05-24
- [x] runtime 一次性注入 system message （3 启动路径 fresh / Layer A resume / Layer B fallback）
- [x] idempotent dedupe Set in closure
- [x] 仅 orchestrator agent 生效，worker 不打扰
- [x] 12 个测试 (`be1d633` + `9d1467b`)

### M6.4 · PM 体系 Phase C-2（Cockpit UI dashboard）· shipped 2026-05-24
- [x] 5 个新 parser (questions / ideas / baseline / decisions / archive) + cockpit-doc aggregate
- [x] /ws/cockpit/:id + GET /api/workspaces/:id/cockpit endpoint
- [x] CockpitDrawer 720px + 6 tabs + 底部 ActionBar (aiActions 渲染)
- [x] Topbar 改造：取代独立 Plan / Todo 按钮，Todo 变浮动 mini
- [x] 63 个测试 (`7d7ba26` + `b5898c6` + `34f7c0d`)

### M7 · 真飞书 e2e 验证 · shipped (partial) 2026-05-24
- [x] 凭证 `~/.config/hive/feishu.json` + chat 绑定 + 重启 4010
- [x] 飞书 inbound → hive WSClient → route → orch stdin 注入（多次实测通）
- [x] orch 派 worker（paseo 调研 3 轮 dispatch）+ `team feishu reply` outbound（10+ 次）
- [x] reaction 两阶段反馈 GLANCE → OK（`63c4228` + `9498f96`，飞书肉眼验过）
- [ ] 审批卡片 ✅/❌ 真按一次（未触发 high-risk action，待真实场景）

### M8 · PM 体系 Phase C-3b（A4-A6 主动 trigger）· proposed
- [ ] A4: milestone 完成时自动跑 baseline 体检（plan.md 文件 watch + change detector）
- [ ] A5: 月度 archive audit cron / 文件大小 watcher
- [ ] A6: cross-workspace drift 检测（每天 1 次扫描）
- 前提：先观察 1-2 周 LLM 在 C-1 RULES 引导下 A2-A6 自觉性是否足够

### M9 · PM 体系完整性补全 · shipped 2026-05-24
- [x] Cockpit 加 Tasks tab + Research tab（8 tabs 总计）(`973c4f6`)
- [x] Cockpit drawer scroll fix（overflow-y-auto）(`973c4f6`)
- [x] baseline 5 个子文档 stub → 真填 (`8837995`)
- [x] 42 个新测试 (`a41ae22`)

### M10 · PM 全套 i18n · shipped 2026-05-24
- [x] 104 个新 i18n key（中英文各）
- [x] 22 个组件 useI18n 化（Cockpit 8 tabs + ActionBar + drawer + PlanDrawer 7 子组件 + Feishu indicator + WorkspaceSettings 飞书段 + Topbar Cockpit 按钮）
- [x] CJK 扫描 0 命中（PM 范围内无硬编码中文）
- [x] 17 个 i18n 测试（完整性 + 切换 + 组件级）
- 详见 `2b3e2ed` + `7be5d22`

### M11 · Upstream marketplace 评估 · open
- [ ] 关羽深度调研 upstream 99d3821 marketplace（429 文件 / 114k 行）
- [ ] 决定回灌 / 借鉴概念 / 跳过

### M12 · Cockpit Reports tab · open (low)
- [ ] `.hive/reports/*.html` 列表 + 一键打开
- low priority, 备份选项

### M13 · PM 体系团队共维护 5 层架构 · shipped (Layer 1+2+3+5) 2026-05-24
- [x] Layer 1 dispatch prompt 自动注入 PM_DISPATCH_REMINDER（`7c95e2d` + `2432b09`）
- [x] Layer 2 WORKER_RULES + ORCHESTRATOR_RULES + CLAUDE.md + AGENTS.md 明确 PM 文档共维护（`7c95e2d`）
- [x] Layer 3 pre-commit hook 拦截 reports/*.html 缺同日 research/*.md（`7c95e2d` + hook fix `afe9148` + harden `cc529b9`）
- [x] Layer 5 Cockpit orphan report detector → high priority aiAction（`7c95e2d` + nested recursion fix `cc529b9`）
- [ ] Layer 4 Cockpit snapshot 注入所有 PTY agent · proposed（下个 dispatch）
- 触发：paseo 调研（5/24）暴露 orch 误读"偏交付 / 偏笔记"为 XOR 而非 AND，连续派 worker 出 3 份 HTML 报告都没补 research note。user 明确要求从 reactive audit 升级为整个团队共同维护 Cockpit / PM 文档。
- 实战首秀：关羽 PTY stuck → orch rescue v3 HTML 时 hook 真拦截 → fix bug → harden audit 6 类 edge cases（10 new tests），1077 tests passing 全绿
- 设计：`.hive/reports/team-pm-co-maintenance-design-2026-05-24.html`
- ADR：`.hive/decisions/2026-05-24-team-pm-co-maintenance.md`

### M14 · mobile + voice 扩张方向（paseo 借鉴） · proposed (待 Q4)
- [ ] Q4 答复方向：候选 1（先 ideas 观察）/ 2（mobile-voice spike POC）/ 3（先抠 skills playbook）
- 触发：paseo 调研 user 明示"未来方向是语音控制多 agent 开发"
- 候选 idea：ideas/inbox.md idea-1 (expo-two-way-audio) + idea-2 (skills playbook) + idea-3 (provider catalog) + idea-4 (timeline 模型)
- 阻塞 Q4 user 答复才能拆 sub-task

### M15 · Cockpit Questions answer flow · shipped 2026-05-24
- [x] Questions tab Answer button opens a Radix dialog with Q text + textarea
- [x] POST `/api/workspaces/:id/cockpit/questions/:qId/answer` moves open questions into `## 已答`
- [x] questions parser exposes answered history with `answer` metadata
- [x] tests: parser + routes-cockpit + Cockpit Questions UI (`738c657`)
- [x] wave 2: ActionBar / Ideas / Decisions handlers + POST endpoints (`f99b98e`)

### M16 · Codex MCP browser E2E 能力 · shipped 2026-05-24
- [x] 调研 browser MCP 候选：Playwright MCP / Chrome DevTools MCP / Browserbase MCP
- [x] 选择 `@playwright/mcp@0.0.75`，通过 Codex builtin preset `-c mcp_servers.playwright.*` 注入
- [x] schema v22 migration 刷新已有 DB 的 builtin Codex preset
- [x] tests: settings API + agent bootstrap + schema migration
- [x] PM docs: `.hive/reports/codex-mcp-browser-spike-2026-05-24.html` + `.hive/research/2026-05-24-codex-mcp-browser.md` + `.hive/decisions/2026-05-24-codex-mcp-browser.md`
- 注：M15 已被 Questions answer flow 占用；本 milestone 顺延为 M16，避免重写已 shipped milestone 编号。

## Scope

**in（覆盖范围）**：
- 多 agent 协作（orchestrator + worker，4 preset）
- 飞书远控（文本消息 + 审批卡片）
- PM 体系（plan / decisions / research / handoff）
- 跟上游 bug fix / hardening 同步

**out（明确不做）**：
- 上游 marketplace 整包回灌（与 HippoTeam 方向分叉）
- 凭据回传 / telemetry（保持本地）
- npm 发布（fork 自用，不发包）
- 多用户 ACL（单 user 场景，第一个点的算数）

## 已知 risk

| Risk | 影响 | 缓解 |
|---|---|---|
| lark SDK 重连稳定性 | 飞书 inbound 可能丢消息 | 生产观察 1-2 周看 reconnect 频率 |
| upstream 持续分叉 | sync 成本上升 | 按问题域拆小任务回灌，不做 merge main |
| typewriter 测试盲区（私有函数无法直测） | OpenCode mouse / port-in-use / WS binary 等 | 已记录为 Open task，看运行后真实问题再决定是否 export refactor |
| `.hive/plan.md` 让 orch 写但 LLM 偷懒不维护 | PM 体系沦为空架子 | system prompt 加强引导 + 每轮 reminder + Phase B UI 反馈让"跑偏"可见 |
| Marketplace 决策悬而未决 | 错过有价值的预制 worker 资产 | 派关羽深度调研出 HTML 报告 |

## 当前 phase

**maintenance + PM 体系 rollout**

主要工作模式：
1. orch 维护这份 plan.md，每完成一个 milestone 就 mark + 记 commit hash
2. user 提需求 → orch 评估属于哪个 milestone（或开新 milestone）→ 派 worker → review → commit
3. 决策性的事写到 `.hive/decisions/YYYY-MM-DD-slug.md`（参考 templates/adr.template.md）
4. session 结束前更新 `.hive/handoff.html` 给下一个 session 接手
5. 重大调研产物（如本次 upstream-diff、feishu plan、PM proposal）放 `.hive/reports/*.html`

**当前阻塞**：M7（等 user 配凭证）+ M10（等 user 决定 marketplace 是否调研）
