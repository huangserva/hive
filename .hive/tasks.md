# Tasks

> 长 narrative 和决策上下文在 `.hive/handoff.html` 和 `.hive/reports/*.html`。
> 这个文件只放 GFM checkbox 格式的当前 sprint 任务和历史归档。

## In progress

- [ ] **赵云** dispatch `81b4df68` — 【M17 playbook #2：loop · TDD】playbook-loop 模板 seed + ORCHESTRATOR_RULES loop 段 + Cockpit playbook aiAction（保守）+ 测试。沿用 handoff 同套模式 (d1cab8a)

## Open（user 回来决定）

- [ ] **本轮 greenlit 串行队列**（都触碰 cockpit-doc.ts，串行避免撞）：①M17 loop（赵云进行中）→ ②M12 Reports tab（Cockpit 列 reports/*.html + 一键打开）→ ③M13 Layer 4（Cockpit snapshot 注入所有 PTY worker，治 worker 看不见 PM 状态）
- [ ] M17 余下 3 个 playbook（advisor → committee → epic，loop 后按赵云推荐顺序）
- [ ] M14 mobile + voice（Q4 拍板 5/25 纳入 plan）— 排在 M17 之后，开工起 ADR
- [ ] HippoMind workspace 让那边 orch retrofit `.hive/plan.md`（runtime 重启后自动 seed stub）
- [ ] 是否派关羽 export refactor（mouse normalization / port-in-use formatter / terminal-stream-hub binary 3 个私有函数）— 典韦点名要 export 才能直测
- [ ] PM 体系 Phase C-3b（A4-A6 主动 trigger：milestone 完成自动 baseline 体检 / 月度 archive cron / cross-workspace drift）— 观察 1 周 LLM 自觉性后再决定（M8）
- [ ] Marketplace 深度调研是否回灌（M11，独立于 PM 体系决定）
- [ ] M13 Layer 4 Cockpit snapshot 注入所有 PTY agent（典韦 opencode preset 连续 2 次不 commit 暴露的洞）
- [ ] 9 个 🟡 中风险 event handler 是否补修（等 logger 抓到证据）
- [ ] multica #4 #5 #6 #7 #8 中优先级（UX 偏好性强）

## Done

### 2026-05-24 ~ 25（Feishu e2e + paseo 调研 + Cockpit governance + MCP browser + 全 app E2E + M17 handoff）
- [x] **赵云** dispatch `8e5bb22e` — 浏览器刷新 bug 根治：app.ts 缓存头（index.html no-cache / assets immutable）+ preload-recovery.ts（Vite chunk 失败自动重载）+ reconnecting-websocket.ts（tasks/terminal/cockpit WS backoff 重连）+ ActionBar 英文漏翻修正。三 gate 绿 1117 tests + orch 复验 21/21 (`3164deb`)。⚠️app.ts 改动 merge 后需重启 4010
- [x] **关羽** dispatch `23eb5cec` — idea-6 闭环：Cockpit 答 question 后自动 nudge orchestrator（answer route→store.notifyQuestionAnswered→writeQuestionAnsweredPrompt 注入 orch PTY；无 active run 优雅 no-op；真 PTY 集成测试无 mock）。三 gate 绿 1114 tests，更新 plan.md M15 (`a990f14`)。⚠️merge 后需重启 4010
- [x] **张飞** dispatch `7a86c021` — 全 app 真浏览器 UI sweep：16 PASS / 0 console error / 1 medium（派单提到 Reports tab 但实际只有 8 tab——Reports 是 M12 未建，预期内非 bug）/ 1 low（ActionBar 英文模式漏翻"查看"，已派赵云修）/ 1 未验证（Questions submit 因无 open question，待 idea-6 落地后造测试数据验）。报告 + research (`eed047e`)
- [x] **关羽** dispatch `ded4e020` — 修张飞巡检发现 #1 aria-describedby（dialog console warning 归零）+ #3 Todo Add Task Save/Cancel affordance + #4 移除 unsupported audio preload。浏览器验证 0 warning (`94dccfc`)
- [x] **赵云** dispatch `4da9662b` — M17 handoff playbook 实现：ADR draft + playbook-handoff 模板 seed + ORCHESTRATOR_RULES handoff 段 + Cockpit playbook aiAction（保守，只 cancel 行触发 max 2）+ tests，1109 tests (`d1cab8a` + `308fc0a`)
- [x] **关羽** dispatch `77f695e8` — 修 Questions parser 静默丢弃非数字 ID：`Q\d+` → `Q[\w-]+`，answer flow 支持非数字 ID，TDD 红→绿 + 浏览器验证 (`708fa0f`)
- [x] **张飞** dispatch `d969941a` — 全 app E2E 巡检：0 blocker / 2 medium / 2 low，findings 报告 + 可复用 regression smoke runbook (`4f0c1b9`)
- [x] **Orchestrator** — M17 handoff bookkeeping：Q7 挂确认归档 ADR + idea-5 记 thinking_level 缓做 + PROTOCOL.md regen (`7d29e89`) + web rebuild
- [x] **Orchestrator** — Q7 确认归档（user 答"可以的"）：M17 handoff ADR draft → 已采纳，提交。后续 4 playbook 基调定。顺手记 idea-6（答 question 自动 nudge orch）
- [x] **赵云** dispatch `e73a7988` — M17 调研+设计：paseo 5 playbook 转译 HippoTeam 设计（templates/RULES/ActionBar 着力点 + 优先级）。推荐先做 handoff。全 gate 过 (1103 tests) (`3b9a5f0` + `81fc4c9`)
- [x] **关羽** dispatch `8501d6e0` — 真浏览器 E2E 验证 Cockpit（playwright MCP）：8 tab 全渲染真数据 + Questions answer flow 真点 PASS + Ideas promote dialog 渲染 PASS + Decisions 0 draft SKIP，0 console error，报告 + research 自己 commit (`c98659b`)
- [x] **Orchestrator** — PM doc 对账（5/25）：Q4/Q2/Q5 答复归档，M12 queued / M14 confirmed / M17 promoted from idea-2，清理 tasks.md In-progress 堆积
- [x] **典韦** dispatch `d4d93723` + `5a19af15` — Cockpit 完整体检 audit + 补 4 个 tab 组件测试 + POST answer route 测试（典韦 opencode preset 写文件但没 commit，orch rescue `bca29a2`）
- [x] **关羽** dispatch `551b829d` — Phase C-2.5 wave 2：ActionBar + IdeasTab + DecisionsTab handlers + 3 个 POST endpoint (`f99b98e` + `aec2598`)
- [x] **关羽** dispatch `160e5438` — Fix UI bug：Cockpit Questions tab 回答按钮无 handler (`738c657` + `96dd211`)
- [x] **赵云** dispatch `22e7791c` — Spike + 实施：给 codex worker 装 MCP browser server (playwright)，schema v22 (`9638a92`)
- [x] **赵云** dispatch `295b7861` + `d9638cd3` — 整个团队共同维护 Cockpit/PM 文档体系（M13 Layer 1+2+3+5）+ hook 测试补全 edge case audit
- [x] **关羽** dispatch `5def6905` + `71d7fde1` — 飞书消息 emoji reaction 两阶段反馈 GLANCE→OK + debug API 失败（M7 UX 补强）
- [x] **关羽** dispatch `b8562201` + `64807571` + `7ef6ff64`(stuck→orch rescue) — paseo 调研 v1→v2→v3 三方横向对照报告
- [x] **关羽** dispatch `9e05b245` — Fix：Cockpit Research tab 时间戳只到日期没分钟 (`9167a6a`)
- [x] **典韦** dispatch `1fddae81` — VERIFICATION TASK：echo 验证 M13 Layer 1 PM_DISPATCH_REMINDER 注入成功

### 2026-05-23 ~ 24
- [x] **Orchestrator** — 重启 4010 + 浏览器刷新 + 真用 Cockpit dashboard（user 自己做的）
- [x] **关羽 + 典韦** — PM 体系 M10 全套 i18n：104 个新 i18n key (×2 locale) + 22 个组件 useI18n 化 + 17 个 i18n 测试 + CJK scan 0 命中 (`2b3e2ed` + `7be5d22`)
- [x] **关羽 + 赵云 + 典韦** — PM 体系 M9 完整性补全：Cockpit 加 Tasks/Research tab + drawer scroll fix + baseline 5 子文档真填（172+77+60+46+73 行）+ 42 个新测试 (`8837995` + `973c4f6` + `a41ae22`)
- [x] **关羽 + 赵云 + 典韦** — PM 体系 Phase C-2 Cockpit UI：5 parser + cockpit-doc aggregate + WS + HTTP endpoint + 10 React 组件 + Topbar 改造（取代 Plan/Todo 独立按钮）+ 63 个新测试 (`7d7ba26` + `b5898c6` + `34f7c0d`)
- [x] **赵云 + 典韦** — PM 体系 Phase C-3a：session-start review nudge（runtime 一次性注入 system message + 3 启动路径 + idempotent + 12 tests）(`be1d633` + `9d1467b`)
- [x] **关羽 + 赵云 + 典韦** — PM 体系 Phase C-1 文件层：4 个新文档（open-questions / ideas / baseline / archive）+ 6 节 ORCHESTRATOR_RULES + 24 个新测试 + 修 plan WS race (`82fc5a2` + `64c7236`)
- [x] **典韦** — PM 体系 Phase B 50 个新测试 (`9619d26`)
- [x] **Orchestrator** — Retrofit `.hive/plan.md` 实样（HippoTeam 10 个 milestones，M1-M6 shipped、M7 blocked、M8-M10 proposed/open）(`57df9d4`)
- [x] **典韦** — Step 2 + PM Phase A 32 个新测试（agent-launch-cache / pm-templates / ensurePmDocs / PROTOCOL.md）(`47e4d0f`)
- [x] **关羽** — Step 2 上游回灌：71fdaaf + b34cfe4 + e57c6be+7bda143 + 4c34bf6 部分 (`dbc7a1e`)
- [x] **关羽** — PM 体系 Phase A：5 个文档模板 + workspace 种子 + system prompt PM 段 (`10322f9`)
- [x] **Orchestrator** — Restructure tasks.md as GFM checkbox + biome HTML ignore + PM proposal HTML (`41dfac0`)
- [x] **关羽** + **典韦** — Step 1 上游回灌：53e3645 tasks WS hardening (`473dc46`) + a2945fe team cancel (`02abda0`) + tests (`24fc7d5`)
- [x] **关羽** — Upstream tt-a1i/hive 5/20 之后 31 个 commit 调研 + 🟢🟡🔴 分类报告
- [x] **关羽** — Rebrand Hive → HippoTeam (`539266f`)：Topbar 圆圈 H logo + favicon + HTML title + package.json @huangserva/hippoteam + README + i18n 16 处 + 移除 upstream npm update badge

### 2026-05-21（飞书桥 Plan B · 16 commit · 757 tests · 132 个 feishu 测试）
- [x] **关羽** + **典韦** — Phase 0：schema v21 + credentials loader + bindings store + RuntimeStore 接线 (`6d7bba2` + `8b5f1a9`) + 45 tests
- [x] **关羽** + **典韦** — Phase 1 inbound：feishu-transport + route-resolver + inbound-handler (`d595f6f` + `445bebd`) + 16 tests
- [x] **关羽** + **典韦** — Phase 2 outbound：team feishu reply CLI + /internal/feishu/outbound + 长消息切片 (`10815af` + `640aaaa`) + 31 tests
- [x] **关羽** — Phase 3 UI：4 个 UI-token endpoints + Topbar 飞书状态灯 + WorkspaceSettings dialog (`fd0db8e`)
- [x] **关羽** + **典韦** — Phase 4 testability refactor + tests + bug fix：parseFeishuReplyArgs/chunkFeishuText/FeishuOutboundTransport export + 38 tests + NotFoundError 404 修复 (`19819b5` / `553f896` / `a879ca6`)
- [x] **关羽** + **典韦** — Phase 5 审批卡片（Hermes 风格）：ApprovalLedger + sendApprovalCard + card.action.trigger + 双语 system prompt (`e601c38` + `1198fe8` + `4347c98` + `6fb3d45`)

### 2026-05-20（多 worker 协作前期 + multica 借鉴）
- [x] **关羽** — multica #3 后端错误消息透传 UI（12 endpoint readErrorMessage，`c223f31`）
- [x] **关羽** — multica #1 + #2 per-worker thinking_level + Add Worker picker（schema v20，`8a2295c` + `d4b64b5`）
- [x] **关羽** — multica 二轮深度调研 → 8 条具体借鉴项报告
- [x] **关羽** — 修 dev 模式 `team` 命令 PATH bug（POSIX sh wrapper 双模式）
- [x] **关羽** — 修 worker stop/restart 卡 working 的 pending bug（方案 B + stopped-only guard）
- [x] hive 旧仓库 archive 到 `~/development/hive.archived-2026-05-20`
- [x] hive-serva 全部改动 push 到 huangserva/hive（remote 改成 SSH）
- [x] **关羽** — P0 logger + 5 个 event handler 防崩
- [x] **典韦** — 全仓 event handler 未 catch 扫描 → 3 🔴 + 9 🟡
- [x] **关羽** — 调研报告（日志、12 commit、hive vs hive-serva、npm 1.3.0）
