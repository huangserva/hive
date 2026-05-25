---
title: HippoTeam
started: 2026-05-20
current_phase: maintenance + PM 体系 rollout
status: active
last_review: 2026-05-25
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

### M12 · Cockpit Reports tab · shipped 2026-05-25
- [x] `.hive/reports/*.html` 列表 + 一键打开（复用现有 `open-file` endpoint）
- [x] Cockpit 第 9 个 Reports tab + i18n + parser/UI 测试（本次提交）
- [x] Reports tab 改为当前浏览器新 tab 打开 HTML，避免弹 OS 默认浏览器（本次提交）
- [x] Research / Decisions / Baseline 文档改为当前浏览器新 tab 打开，ideas parser 不再把缩进子条目计为独立 idea（本次提交）
- [x] Cockpit 内嵌文档 viewer：Reports iframe + baseline/research/decisions markdown `<pre>`，不依赖新 tab / 弹窗（5c7227e）
- Q2 答复：要做。优先级从 low 提升为正常队列

### M13 · PM 体系团队共维护 5 层架构 · shipped (Layer 1+2+3+4+5) 2026-05-24
- [x] Layer 1 dispatch prompt 自动注入 PM_DISPATCH_REMINDER（`7c95e2d` + `2432b09`）
- [x] Layer 2 WORKER_RULES + ORCHESTRATOR_RULES + CLAUDE.md + AGENTS.md 明确 PM 文档共维护（`7c95e2d`）
- [x] Layer 3 pre-commit hook 拦截 reports/*.html 缺同日 research/*.md（`7c95e2d` + hook fix `afe9148` + harden `cc529b9`）
- [x] Layer 5 Cockpit orphan report detector → high priority aiAction（`7c95e2d` + nested recursion fix `cc529b9`）
- [x] Layer 4 worker dispatch 注入紧凑 Cockpit snapshot（commit 见本 dispatch report）
- 触发：paseo 调研（5/24）暴露 orch 误读"偏交付 / 偏笔记"为 XOR 而非 AND，连续派 worker 出 3 份 HTML 报告都没补 research note。user 明确要求从 reactive audit 升级为整个团队共同维护 Cockpit / PM 文档。
- 实战首秀：关羽 PTY stuck → orch rescue v3 HTML 时 hook 真拦截 → fix bug → harden audit 6 类 edge cases（10 new tests），1077 tests passing 全绿
- 设计：`.hive/reports/team-pm-co-maintenance-design-2026-05-24.html`
- ADR：`.hive/decisions/2026-05-24-team-pm-co-maintenance.md`

### M14 · mobile + voice 扩张方向（paseo 借鉴） · confirmed (Q4 拍板 5/25)
- [ ] Q4 答复：要纳入 plan.md 作为未来 milestone（user 明示"未来方向是语音控制多 agent 开发"）
- [ ] 排序：skills playbook（M17）先做（独立、不依赖移动端），mobile + voice 作为后续大版本方向
- 核心使能模块：idea-1 (paseo expo-two-way-audio 双向音频，Q5 folded)
- 其余候选 idea：idea-3 (provider catalog) + idea-4 (timeline 模型)
- 开工时拆 sub-task + 起 ADR：自建 mobile vs 借第三方框架 vs 飞书 + voice plugin 第三路径
- [x] 路线 ADR 调研 draft：推荐先走 Feishu voice command MVP，保留 self-built mobile / realtime framework 升级出口（commit 7983182）
- [x] **路线拍板**：user 飞书"干！"确认走 **M14a Feishu voice command MVP**，ADR 转正已采纳（2026-05-25-m14-voice-path.md）
- [x] **M14a Phase 1（f37b21f）**：飞书语音接入 spike（语音事件/音频下载/STT 三未知）+ 第一刀实现（audio→飞书内置 ASR→复用 inbound 注入 orch）。STT 飞书内置 vs 外接 = Q10 待 user 拍；真实飞书 E2E 留后续。
- [x] **M14a Phase 2**：user Q10 拍板 D（本地 STT）。实现 LocalSttProvider：飞书 audio 下载临时文件→本地 `whisper-cli` / `whisper` 转写→复用 inbound 注入；无 CLI 时优雅降级到飞书内置 ASR / drop。

### M15 · Cockpit Questions answer flow · shipped 2026-05-24
- [x] Questions tab Answer button opens a Radix dialog with Q text + textarea
- [x] POST `/api/workspaces/:id/cockpit/questions/:qId/answer` moves open questions into `## 已答`
- [x] questions parser exposes answered history with `answer` metadata
- [x] tests: parser + routes-cockpit + Cockpit Questions UI (`738c657`)
- [x] wave 2: ActionBar / Ideas / Decisions handlers + POST endpoints (`f99b98e`)
- [x] answer route auto-nudges active orchestrator PTY after user answers a question（M17/idea-6 闭环，本次提交）

### M16 · Codex MCP browser E2E 能力 · shipped 2026-05-24
- [x] 调研 browser MCP 候选：Playwright MCP / Chrome DevTools MCP / Browserbase MCP
- [x] 选择 `@playwright/mcp@0.0.75`，通过 Codex builtin preset `-c mcp_servers.playwright.*` 注入
- [x] schema v22 migration 刷新已有 DB 的 builtin Codex preset
- [x] tests: settings API + agent bootstrap + schema migration
- [x] PM docs: `.hive/reports/codex-mcp-browser-spike-2026-05-24.html` + `.hive/research/2026-05-24-codex-mcp-browser.md` + `.hive/decisions/2026-05-24-codex-mcp-browser.md`
- 注：M15 已被 Questions answer flow 占用；本 milestone 顺延为 M16，避免重写已 shipped milestone 编号。

### M17 · paseo skills playbook 体系借鉴 · shipped (idea-2 promote 5/25)
- [x] 把 paseo 5 个 playbook（handoff / advisor / committee / epic / loop）转译成 HippoTeam 形态
- [x] 调研 + 设计产出：`.hive/reports/m17-skills-playbook-design-2026-05-25.html` + `.hive/research/2026-05-25-m17-skills-playbook.md` (`3b9a5f0`)
- [x] Handoff playbook first slice：template seed + ORCHESTRATOR_RULES + Cockpit playbook aiAction + ADR draft (`d1cab8a`)
- [x] Loop playbook second slice：template seed + ORCHESTRATOR_RULES + conservative Cockpit playbook aiAction (`1fa7f2e`)
- [x] Advisor / Committee / Epic final slice：template seed + ORCHESTRATOR_RULES（commit 见本 dispatch report）
- [x] 产出：`.hive/templates/*` playbook 模板 + ORCHESTRATOR_RULES 对应规则 + Cockpit ActionBar 建议
- 触发：idea-2 promote。成熟度🟢高，不依赖 mobile/voice 决策，直接增强当前 PM 体系
- 先派 worker 出调研 + 设计（reports/*.html + research/*.md 配对），再实现
- 排在 M14 mobile+voice 之前做（user 5/25 排序）

### M18 · Provider capability manifest（paseo 借鉴 idea-3） · proposed (Q8 promote 5/25)
- [ ] preset 加详细能力声明（mode / risk / unattended / feature），orch 派单时按能力路由，取代当前 4 preset 平铺枚举
- [ ] **先做 scoping spike**（成熟度🟡）：调研现有 preset 设计的真痛点 + orch 派单实际需要哪些能力维度，产出 reports/*.html + research/*.md，再决定实现范围/是否值得做
- 触发：idea-3 promote，user Q8 答"同意"（5/25）。来源 multica/paseo provider catalog
- 注意：别滑成 multica 式重平台；HippoTeam 保持轻量，manifest 只服务"派单更精准"

### M19 · HippoTeam native app / dashboard · confirmed (user 飞书 5/25)
- [x] 初版路线调研：拆解 paseo app 端 + 对比 PWA / desktop shell / native mobile（`2fa6425`，结论已被 user 覆写为原生-first）
- [x] **路线拍板**：user 明确要原生 APP / 最佳体验，不因实现难或与飞书重叠降级；ADR 已采纳 `.hive/decisions/2026-05-25-hippoteam-frontend-app.md`
- [x] Epic 架构设计：client/daemon 升级 + Expo/RN app + host pairing + direct LAN + encrypted relay + M14 voice convergence（commit e895380）
- [ ] **M19a**：协议 audit + Expo/RN app skeleton + LAN 只读 dashboard（Cockpit summary + Tasks + Workers）
  - [x] 子任务 1：现有 HTTP/WS 协议 audit + native app 稳定 API 缺口分析（report/research 已产出，commit 见 dispatch report）
- [ ] **M19b**：pairing/auth + device registry + scoped direct LAN control（send/approve/stop/restart）
- [ ] **M19c**：encrypted relay remote access（daemon outbound connector + app relay transport + E2E encryption）
- [ ] **M19d**：agent/terminal pane + task operations（transcript first，terminal input later）
- [ ] **M19e**：voice + push convergence（M14 voice command 迁入原生 app，push worker done/high aiAction）
- [ ] **M19f**：beta hardening + distribution（EAS internal/TestFlight/Android internal + docs + baseline 回填）
- 触发：user 问“Paseo 是有 APP 端的，我们是不是可以为 HippoTeam 做一个前端 APP？这样所有任务看起来很方便，也可以有面板。”后继续拍板“要原生、要最好”。

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

**当前阻塞**：无硬阻塞。PM 体系 rollout 基本完成（M13 五层全齐 + M17 五 playbook 全齐 + Cockpit 9 tabs + idea-6 答题闭环）。

**待 user**：最后一次重启 4010 激活本轮累积的 server 改动（idea-6 答题注入 / app.ts 缓存头 / M17+Layer4 RULES / report-file 路由 / Layer4 快照注入）。

**下一步候选**（user 选）：M14 mobile+voice（大版本，开工起 ADR 选路线）／ M11 marketplace 调研是否启动 ／ M8 主动 trigger（观察期）。详见 Open tasks。
