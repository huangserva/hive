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

### M22 · Cockpit Timeline + Worker 利用率统计 · shipped 2026-05-26
- [x] Dispatch Timeline 可视化（倒序列表 + 展开查看完整 task/report）`37d25ee`
- [x] Worker 利用率统计（per-worker dispatch count / reported / cancelled / avg completion time）
- [x] 按天 dispatch 趋势柱状图（最近 14 天）
- [x] Worker / status 筛选器
- [x] Cockpit 第 10 个 tab（History icon）+ i18n 中英文

### M8 · PM 体系 Phase C-3b（A4-A6 主动 trigger）· shipped 2026-05-26
- [x] A4: milestone 完成时自动跑 baseline 体检（plan.md chokidar watch + detectNewlyShippedMilestones + housekeeping nudge）`5f4c3bd`
- [x] A7: post-dispatch conditional nudge（3 条规则：新 milestone 首次 dispatch / dispatch 堆积 / narrative 引用已 shipped）`5f4c3bd`
- [x] A5: 月度 archive audit trigger（tasks Done / reports / research 阈值 + 月度 dedupe）`37d25ee`
- [x] A6: cross-workspace drift 检测（schema version / PROTOCOL.md / baseline 文件存在性）`37d25ee`

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

### M11 · HippoTeam-native template catalog · shipped 2026-05-26
- [x] 赵云深度调研 upstream 99d3821 marketplace（429 文件 / 114k 行）— 推荐 B 借鉴概念
- [x] user 确认方案 B：10 个 builtin templates + Add Worker 模板选择器
- [x] 关羽实现：schema v27 seed 10 templates + TemplatePicker UI + governance 纪律内嵌 `9398e09`

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

### M14 · mobile + voice 扩张方向（paseo 借鉴） · shipped (M14a) 2026-05-25
- [x] Q4 答复：纳入 plan.md（user 明示"未来方向是语音控制多 agent 开发"）
- [x] 路线拍板：Feishu voice command MVP 先行，self-built mobile 后续（→ M19 实现）
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
- [x] **先做 scoping spike**（成熟度🟡）：调研现有 preset 设计的真痛点 + orch 派单实际需要哪些能力维度，产出 reports/*.html + research/*.md，再决定实现范围/是否值得做
- [x] **M18a 能力可见版**：后端 manifest + preset/team/mobile 数据暴露 + worker dispatch 上下文注入（不做自动路由，2026-05-29，待 commit hash 回填）
- 触发：idea-3 promote，user Q8 答"同意"（5/25）。来源 multica/paseo provider catalog
- 注意：别滑成 multica 式重平台；HippoTeam 保持轻量，manifest 只服务"派单更精准"

### M19 · HippoTeam native app / dashboard · shipped 2026-05-27（原生 app + dashboard 已上线在用；细分 M19a-h 全 shipped；productization 接 M24。状态从 confirmed 更正——避免被 active-milestone 误选为"当前"）
- [x] 初版路线调研：拆解 paseo app 端 + 对比 PWA / desktop shell / native mobile（`2fa6425`，结论已被 user 覆写为原生-first）
- [x] **路线拍板**：user 明确要原生 APP / 最佳体验，不因实现难或与飞书重叠降级；ADR 已采纳 `.hive/decisions/2026-05-25-hippoteam-frontend-app.md`
- [x] Epic 架构设计：client/daemon 升级 + Expo/RN app + host token auth + direct LAN + encrypted relay + M14 voice convergence（commit e895380）
- [x] **M19a**：协议 audit + Expo/RN app skeleton + LAN 只读 dashboard（Cockpit summary + Tasks + Workers）— shipped `59ea75a`→`1ef7b00`→`d237009`→`a263adf`
  - [x] 子任务 1：现有 HTTP/WS 协议 audit + native app 稳定 API 缺口分析（`59ea75a`）
  - [x] 子任务 2：Expo skeleton + LAN 连接 spike（`1ef7b00`）
  - [x] 子任务 3：mobile API 层 — Bearer auth + dashboard aggregate + WS（`d237009`）
  - [x] 子任务 4：Expo app 对接 mobile API — dashboard/workers/tasks 数据展示（`a263adf`）
- [x] **M19b**：permanent token auth + device registry + scoped direct LAN control（send/approve/stop/restart）— shipped `c83ae50`
  - [x] 子任务 1：API contract + schema 设计 spike（赵云，reports + research）
  - [x] 子任务 2：runtime 后端 permanent token / device registry / capability checks / mobile control endpoints（关羽）
  - [x] 子任务 3：Web 端设备管理 UI — MobileDevicesSection + i18n（马超）
  - [x] 子任务 4：Expo app 配对流程 + SecureStore + control actions（赵云）
  - [x] 子任务 5：集成测试验证 7 tests（典韦）
  - [x] 补丁：devices endpoints UI auth 支持（关羽）
- [x] **M19c**：encrypted relay remote access（daemon outbound connector + app relay transport + E2E encryption）`414cbae` `71730bb`
  - [x] 子任务 1：独立 Node.js WebSocket room relay package（关羽，6 tests）
  - [x] 子任务 2：shared E2E encrypted channel — tweetnacl NaCl box + handshake（吕布，17 tests）
  - [x] 子任务 3：Runtime outbound connector — relay.json config + WS connect + heartbeat + backoff + RPC handler（关羽，10 tests）
  - [x] 子任务 4：Mobile relay transport — LAN→relay fallback + E2E handshake + JSON-RPC（赵云，7 tests）
- [x] **M19d**：agent/terminal pane + task operations（worker transcript + dispatch task history）— `942cf9c`
- [x] **M19e**：voice + push convergence（M14 voice command 迁入原生 app，push worker done/high aiAction）`9b17101`
  - [x] 子任务 1：Push notifications — schema v26 push_token + Expo push API + worker done/high aiAction triggers（赵云）
  - [x] 子任务 2：Voice input — POST /api/mobile/voice/transcribe + VoiceRecordButton + expo-av recording（吕布，8 tests）
- [x] **M19f**：beta hardening + distribution（EAS internal/TestFlight/Android internal + docs + baseline 回填）— shipped（pending commit hash）
- [x] **M19g**：mobile command center UI redesign（3-tab Chat / Status / Settings，Chat 本地 mock + Status 真实 dashboard，version 0.2.0）— pending commit hash
- [x] **M19h**：mobile app 完整视觉设计 spec（6 组基础手机框架 mockup + mobile Cockpit Plan/Tasks/Questions/Ideas/Actions 补充 + navigation / token / component / API mapping）— `.hive/reports/mobile-app-design-spec-2026-05-27.html`
- [x] **M19i**：mobile app 产品级 v2 设计 spec（12 张 image-generated 手机界面 mockup + Chat/Status/Settings/Worker/Cockpit/Approval/Error 全覆盖 + chat 协议 / mobile cockpit auth / push / offline 实施规范）— `.hive/reports/mobile-app-design-v2-2026-05-27.html`
- 触发：user 问“Paseo 是有 APP 端的，我们是不是可以为 HippoTeam 做一个前端 APP？这样所有任务看起来很方便，也可以有面板。”后继续拍板“要原生、要最好”。

### M20 · Sentinel Worker · shipped 2026-05-26
- [x] 新增 `sentinel` worker role，每个 workspace 最多一个，创建时固定使用 Claude preset
- [x] runtime 每 30 分钟向 active sentinel PTY 注入 Cockpit snapshot + git summary heartbeat
- [x] sentinel guidance / startup prompt 明确只观察和提醒，不写文件、不派单、不通知 user
- [x] `team-authz` 限制 sentinel 只能 status/report/help，禁止 send/cancel/list 等 orchestrator 权限
- [x] Workers 面板顶部独立展示 Sentinel 卡片，不混入普通 worker status 分组
- [x] backend 支持编辑 worker description / preset / thinking_level / sentinel heartbeat interval
- [x] tests: heartbeat 注入、创建唯一性、authz 拒绝 send、UI 独立区域

### M24 · Mobile App 产品化实现 · in_progress
- [x] **Phase 1**：Chat 双向消息后端（mobile_chat_messages 表 + mobile prompt / orch_reply 捕获 / dispatch / worker report 写表 + WS push + REST history endpoint）— 2026-05-27
- [x] **Phase 2**：12 页面 UI 实现（Chat/Status/Settings/Worker Detail/Cockpit 5 tabs/Approval/Offline 全部按设计稿实现）— 2026-05-27
- [x] **Phase 3**：Token 认证替代 pairing code（永久 token CRUD + Web 管理 UI + 删除 pairing_codes 表）— 2026-05-28
- [x] **Phase 4**：Demo Mode（假数据预览全部页面，无需 LAN 连接）— 2026-05-27
- [x] **Phase 5**：Orchestrator reply 自动回灌（PTY 输出捕获 → mobile_chat_messages orch_reply）— 2026-05-27
- [x] **Phase 6**：UI 设计对齐 + 实时终端同步（严格对齐 12 张 mockup + Worker/Orch 终端实时轮询 + Cockpit 子页面接真实 API）— 马超完成 2026-05-28
- [x] **Phase 7**：Push Notification + Approval deep link（真实 Expo push 注册 + 通知 deep-link 路由 approval/worker_done/high_ai_action + notifyApprovalRequested 审批推送=手机审批通道 + 冷启动处理）— 关羽 2026-05-30 `18f68f3`。⚠️ Android 真实投递需配 FCM/EAS push credentials（运维）
- [x] **Phase 8**：Error resilience + 离线缓存（连接模式横幅 LAN/relay/离线 + mobile-outbox 持久化队列 prompt/dispatch/approval 入队-flush-去重 + 重连/回前台 syncRevision 增量追平 dashboard/tasks/cockpit/chat）— 关羽 2026-05-30 `fb5999c`。真断网/重连端到端待真机验
- [x] **新增 Worker（手机端）**：Status 页「+」入口 + AddWorkerModal 最简安全版（只用已有 preset、拒 sentinel、不收 startup_command），后端 mobile create-worker + command-presets 端点（admin_runtime，LAN + relay 双通道），6 后端测试 — 马超 2026-05-30（待 commit hash；spike `.hive/reports/2026-05-30-mobile-add-worker-spike.html`，安全边界 ADR `draft-2026-05-30-mobile-add-worker-safety.md`）
- [x] **L1 机制**：设计 milestone shipped → 自动检测缺实施 milestone
- 设计文档：`.hive/reports/mobile-app-design-v2-2026-05-27.html`
- UI 审核报告：`.hive/reports/mobile-ui-audit-2026-05-28.html`
- 决策：Token 完全替代 pairing code（2026-05-28 user 拍板）
- 前置：M19i 设计 spec 已完成

### M23 · Agent Run Timeline 可恢复事件流 · open
- [x] 设计 AgentRunTimelineEvent schema + AgentRunTimelineStore（SQLite durable，seq/epoch/gap 三概念）
- [x] 实现 tail/before/after cursor fetch API（支持断线重连 catch-up）
- [ ] live event reconciliation（WebSocket 推增量 + gap 检测触发 reset）
- [ ] M22 dispatch row drill down 到 run timeline 视图
- [ ] 调研报告：`.hive/reports/idea-4-timeline-comparison-2026-05-27.html`
- 定位：Terminal/PTY 层的可恢复事件流，补充现有全量 snapshot 模式的缺口
- 来源：idea-4 promote（user 拍板 2026-05-27），paseo seq/epoch/gap 模型借鉴
- Phase 1 后端基础：schema/store/API 已完成（2026-05-29，待 commit hash 回填）
- 前置：不依赖其他 milestone，可独立开工

### M25 · Provider session isolation（借鉴 CCB，补 agent runtime 底层差距） · in progress (user 拍板 2026-05-30；Phase 1 派马超 2026-05-30)
- [ ] 为每个 provider 定义显式 session isolation contract：managed home（独立 config/auth/memory 根）+ session root + binding/完成事件 + diagnostics 边界
- [ ] **先做 Codex + Claude**（本仓最常用、坑最多），再 Gemini/OpenCode
  - [x] **Phase 1 = Codex**（马超 `8e9c1a48`，代码完成待 review/commit）：新增 `provider-runtime-profile.ts`（per-agent managed `CODEX_HOME`=`<dataDir>/agents/<seg>/provider/codex/home` + 派生 `sessions/` 根 + config/auth 投影）；`buildAgentRunBootstrap` 在 fresh+resume 都钉死 managed CODEX_HOME/SESSION_ROOT；`session-capture` snapshot/capture 改读 managed 根（消除多 codex worker 串线根源）；dataDir 经 createAgentRuntime→starter 下穿，无 dataDir 退回全局（向后兼容）。强 TDD：`tests/server/codex-provider-isolation.test.ts` 9 条（禁 mock PTY），server tsc 0 错。产出 `research/2026-05-30-codex-session-isolation-contract.md`。**留后续**：legacy 全局 session 迁移、authority fingerprint 持久化、memory/plugins/skills 投影、Claude/Gemini/OpenCode（Phase 2/3）
  - [~] **Phase 2 = Claude**（马超 2026-06-01，已 commit `8a2b0c1`，钟馗审中 `f3d579ba`；真机验门槛=张飞验 macOS Keychain+重定位 HOME 非交互登录通过后才可默认开门控）：`provider-runtime-profile.ts` 加 `resolveClaudeManagedHome`/`resolveClaudeProjectsRoot`/`resolveClaudeSessionEnvRoot`/`materializeClaudeManagedHome`（建 `.claude/projects`+`session-env` 根 + 投影 settings.json/.credentials.json/.claude.json + macOS Keychain 兼容态）；`buildAgentRunBootstrap` 在 resume 校验**之前**物化 managed home，fresh+resume 都钉死 `HOME`+`CLAUDE_PROJECTS_ROOT`；resume 存在性校验经 `withPresetResumeArgs`→`doesCapturedSessionExist`→`hasClaudeSessionFile` 新增 `claudeProjectsRootOverride` 改扫 managed 根（不串全局历史）；`snapshotSessionIdsForCapture` 加 claude projects 覆盖。**契约确认（CCB `claude-session-isolation-contract.md`）**：Claude 无 `CLAUDE_HOME` flag → 隔离必须重定位私有 `HOME`，`CLAUDE_PROJECTS_ROOT`==`<HOME>/.claude/projects`。**默认关闭，`HIVE_CLAUDE_MANAGED_HOME=1` 显式开**（因 macOS 登录态在 Keychain，重定位 HOME 鉴权风险偏高，需张飞真机验后再默认开；区别于 Codex 的文件 auth 可放心默认开）。与 M32 cwd 维解耦。强 TDD：`tests/server/claude-provider-isolation.test.ts` 11 条全绿 + layer-a-resume 真 PTY 回归绿；server tsc 0 错、biome 干净。**留后续**：memory/skills/commands 投影、authority fingerprint、legacy 全局迁移、Gemini/OpenCode（Phase 3）。**钟馗复审 `f3d579ba` 通过（0 blocking，核心 resume 隔离链路成立）**；3 个 medium = **启用门控前硬化清单**：①(必须)MEDIUM 1——managed HOME 重定位后 `~/.gitconfig`/`.ssh`/`.npmrc`/`gh` 等工具配置缺失，Claude agent 的 git/gh/npm 能力会退化，须按 allowlist 投影必要工具配置才能默认开 ②MEDIUM 2——触发绑 `capture source==claude_project_jsonl_dir` 而非 `provider==claude`，自定义 preset 边界要补显式 provider 判定 ③MEDIUM 3——darwin Keychain 分支无测试，拆可注入 platform 纯函数补测 + 张飞真机验
- [ ] 与已有 session capture / Layer A resume / Layer B fallback 对齐，消除 session 串线 / resume 错绑 / provider 状态污染
- [ ] （配套，可单列 M25b）hive doctor / support bundle：一键导出 runtime.sqlite schema/version + agent runs + dispatch ledger + last PTY lines + logs + PM docs orphan 检查
- 来源：钟馗 CCB vs HippoTeam 对比调研（`.hive/reports/2026-05-30-ccb-vs-hippoteam-comparison.html`）排第一的差距；ADR `.hive/decisions/2026-05-30-provider-session-isolation.md`
- 定位：补 agent runtime 底层（CCB 最强、hive 最薄的一维）；接今天修的 worker 卡死/session 判别符（`04024dd`/`6a3b9b5`/`385c0ae0`）往下做厚
- 代价：动 runtime + 测试，改动大风险高，必须分阶段 + 强 TDD（§13 集成测试禁 mock PTY）；不破坏 PM 治理/远控等 hive 差异化优势

### M26 · Worker 汇报可靠性（idle 自愈 + Fix B 误报根治） · shipped 2026-05-30 (`80cfd91`，4010 重启已生效)
- [ ] **L1 机制**：把卡死检测从「时间驱动(4min) nudge orchestrator」升级为「worker PTY 回到 idle 提示符 + 有 submitted 未 report dispatch → 直接 nudge worker stdin 自补 report」，最多 2 次再回退 orchestrator nudge
- [ ] 复用 `hasInteractivePromptReady`（post-start-input-writer）+ Fix A「只看新输出」防旧提示符误触发；idle 检测留 nudge/sentinel 层，不侵入 agent 运行热路径
- [ ] **顺手根治 Fix B 误报**：真 idle 才触发→正在干活的 worker 永不被打扰（本 session 多次误伤赵云/关羽/马超）
- [ ] **L2 提示词**：WORKER_RULES + REMINDER_TAIL 加硬话——文字总结≠汇报，必须运行 team report CLI，turn 结束自检
- 触发：本 session 马超 M25 干完用文字 recap 收尾、没真跑 team report → dispatch 卡 submitted 看着像卡死；agent 状态 `pendingTaskCount>0?working:idle` 是假信号
- 强 TDD（§13 禁 mock PTY）；文件边界避开 M25 未提交改动；PM 待落 ADR
- [x] **加固（马超 2026-05-31，代码完成待 review/commit）：从"只 nudge LLM"升级为"系统直接 surface 给 user，绝不静默"。** 触发：赵云干完 6 项 UX 不跑 team report，是 user 先发现的、不是系统兜住的，user 要彻底解决。
  - 关键澄清：dispatch ledger 状态只有 `queued/submitted/reported/cancelled`，**无 in_progress**——`submitted` 就是"已注入 worker、未 report"的窗口（= "干完没报"场景），现有检测已覆盖；不新增 schema 态（避免迁移风险）。
  - 新增纯函数 `stale-dispatch-status.ts`（`summarizeStaleDispatches`，dashboard 与 nudge 共用单一判定，按 submittedAt 时长出 stale/escalated 两档）。
  - **user 可见看板信号（最关键、立即生效）**：`buildMobileDashboard` 的 cockpit 块新增 `stale_dispatches` / `escalated_dispatches` 计数，user 在手机看板直接看见"N 个派单超时未汇报"，走现有 dashboard 拉取/relay，不靠 LLM nudge。
  - **user 可见推送**：`stalled-dispatch-nudge` 加 `notifyUserOfStaleDispatch` 回调（always-on pass，不 gate worker idle/在线——哪怕 worker 卡死从不回提示符或所有 LLM nudge 被忽略都按时长兜底）；`mobile-push` 加 `notifyStaleDispatch`（stale + escalated 两档各推一次，去重）。⚠️ push 投递半边受 M29 制约（华为机无 GMS，exp.host→FCM 收不到）；**看板计数是当前可靠的 user 可见兜底**，push 待 M29 打通通道后生效。
  - escalation：超 escalated 阈值（默认 8min，约 2 次 worker nudge + orchestrator 兜底应已发生）→ 第二档 user 推送 + 看板 escalated 计数；orchestrator 侧仍是原 fallback nudge。
  - 未破坏 Fix A/B：原 idle 自愈 nudge（submitted + 回 idle 提示符 → nudge worker 最多 K 次 → 回退 orchestrator）原样保留，新机制是其上的 user-surface 层。
  - 改动文件：`stale-dispatch-status.ts`(新)、`mobile-push.ts`、`stalled-dispatch-nudge.ts`、`runtime-store-helpers.ts`、`routes-mobile.ts`；测试 `stale-dispatch-status.test.ts`(新,6)+`stalled-dispatch-user-surface.test.ts`(新,5,真 ledger 无 mock PTY)+`mobile-routes.test.ts`(+1)。
  - 剩余：#4「真在干 vs 干完没报」per-dispatch idle 布尔未单列进 dashboard（需 per-request PTY snapshot，留 Phase2）；现用 stale/escalated 时长分档 + idle-gated nudge 近似区分。

### M27 · Relay 远程体验优化（跳过 LAN 空试 + 实时推送） · shipped 2026-06-01（user 真机验证 4G 确实变快；Part B 推送随 4010 重启生效）· 代码全 commit `ba631cf`
- ✅ **2026-06-01 user 验证**：4G relay 下 app 确实变快（Part A 跳过 LAN 空试生效），Part B 实时推送随 4010 重启生效。剩两项收尾：①4G 攻坚正式 HTML 报告重派马超（吕布之前 opencode context 爆没出完）②仪表盘待办按钮文案 i18n 派关羽（user 已批"可以去做"）。
- 触发：4G relay 连接修好稳定后 user 反馈 ①慢 ②"经常连接像重连"。诊断：app 每请求先试 LAN(client.ts readMobileJson, 4s AbortController)再 fallback relay，4G 下每请求挂 4s + UI 闪连接中；新消息走 5s 轮询有延迟。
- [x] **Part A 跳过 LAN 空试**（马超 `8cb009de`，代码完成待 review/build）：`client.ts` 加 `lanCooldownMs`(默认30s) + `lanCooldownUntil`——LAN 请求失败即开 cooldown 窗口，窗口内 `readMobileJson` 直接走 relay 跳过 ~4s LAN 空试；LAN 成功即解除（回 WiFi 优先直连）；暴露 `resetLanCooldown()` 供网络变化强制重探。TDD 4 条。
- [x] **Part B relay 实时推送**（马超 `8cb009de`，代码完成待 review/build）：daemon `relay-connector` 加 `pushEvent(kind,payload)`（复用 channel.encrypt 推 `{type:'event'}` 无 id 帧给活跃 session）；`app.ts` 在**已有** registerCockpitListener/registerMobileChatListener 通知点同步推 `dashboard_update`/`chat_message`（不另造通知源）；`relay-transport.handleEncryptedPayload` 加 `onEvent` 路由（无 id 的 event 帧不当 RPC 回应）；context 订阅 onEvent→即时 merge chat / 刷 dashboard；chat 轮询 5s→20s 降频兜底。TDD：transport 路由 2 条 + daemon pushEvent 2 条。
- 强 TDD（§13 禁 mock PTY）；不破坏握手/RPC方法/churn修复/evict-old；测试全绿（mobile 40 + server relay 20）；server+mobile tsc 0 错、biome 干净。**B 动 daemon，需 4010 重启生效**。
- **build #19 含全部**：M27 Part A/B + cockpit 一致性批次（milestone 编号 `e4f8106`、Ideas 编号 `b2f4dea`、Tasks 内容对齐 web `8aecdb8`、cockpit 标签页实时 `2956b14`）。Part A/编号/Tasks 装上即生效；Part B 推送 + cockpit 实时需 4010 重启。Action 文案 i18n（后端发 key）单列待 user 拍。
- 关联：本次 4G relay 连接攻坚（5+1 层 bug 全修，commit `9289919`→`dbbb640`，全过程记于 tasks.md 📡🔥 narrative + `.hive/research/2026-05-30-relay-deployment-kit.md`；polished HTML 报告吕布写时 opencode context 超限止损未成，可后续重派）；cockpit 一致性审计 `.hive/reports/2026-05-30-mobile-cockpit-consistency-audit.html`

### M28 · 手机端追平 Web（mobile-vs-web UI 一致性） · in_progress (审查 2026-05-31，63 条确认)
> 依据：workflow 全量审查 `.hive/reports/2026-05-31-mobile-vs-web-ui-audit.html` + `.hive/research/2026-05-31-mobile-vs-web-ui-audit.md`（82 agent / 2.5M tok，0 critical / 10 high / 28 medium / 25 low）。
> 根因不在 UI：**服务端 `routes-mobile.ts` 的 mobile API 只暴露 5 字段**（plan/tasks/questions/ideas/actions），baseline/decisions/research/reports/timeline 源头没输出；且错误处理「清空」而非「降级」。**修服务端一处、多页受益。**
> ⚠️ drift：M24 Phase 5「orch_reply 自动回灌」、Phase 7「审批推送通道」标 done 实则坏了（见 Phase 1 P0/P1）。

- [x] **Phase 1 = P0/P1（阻塞 PM 核心闭环）** — done 2026-05-31（Track A `5a07730` / Track B `05fb52d` + 里程碑排序 `48e3225`；**Track A 需 4010 重启激活，Track B/排序需 #20 装机激活**）
  - **Track A 服务端（派马超）**：`routes-mobile.ts` mobile cockpit/chat API 扩字段 + 修后端根因
    - [x] `orch_reply` 正常对话回复也写 `mobile_chat_messages`（马超：重启用现有 PTY 捕获管道——`startPendingReply` 不再 no-op；mobile 输入开捕获窗，10s 静默 flush，过滤系统消息/派单注入/工具/思考行；`team mobile-reply` 走公共 insert→`noteExplicitReply` 丢弃同轮缓冲防重复）
    - [x] `approval_request` 真正持久化到 chat DB（马超：`team approve` 路由 `approvalLedger.create` 后写一行 outbound approval_request 到 mobile_chat_messages，手机端渲染审批卡；mobile resolve 路径本就不依赖 feishu）⚠️ 见 open-questions：当前仍受 feishu 路由门控，纯 mobile-origin 无 feishu chat 场景待 PM 拍是否解耦
    - [x] run `started_at` 不再硬编码 null（马超：`TerminalRunSummary` 加 `started_at`，agent + shell 两处 listTerminalRuns 回填 `run.startedAt`，`buildMobileDashboard` 输出真实 ISO 时间戳）
    - [x] mobile cockpit API 暴露 decisions/baseline（马超：`/cockpit` 端点复用同一 `parseCockpit` 结果，新增 baseline/decisions/reports/research/archive 字段；timeline 源不在 parseCockpit，留 Phase 3）
  - **Track B 前端独立 P0（派赵云，不依赖 Track A，文件不冲突）**：`packages/mobile/src/*`
    - [x] `thinking_levels` 类型修正（对象数组非 `string[]`）→ 新增 worker 选 thinkingLevel 不再显示原始 value
    - [x] 重连失败 `setDashboard(null)` → 改为保留上次数据降级（命中 user 最怕「出门查一眼全没了」；4G 必现）
  - [x] `ConnectionModeBanner` reconnecting 时显示 disconnected 态而非误显 wifi/relay 图标
  - [x] Dead Button 统一处理（Filter/Menu/「...」点击无响应 → 接功能或隐藏）
  - [x] 最新 active milestone 选择、chat 发送态判定和新英文硬编码已收口（M28 #22）
  - [x] Settings「连接详情」中继/LAN 行改为可点击切换；LAN 可用时前台恢复会先重探 LAN，避免 relay 冷却黏住
- [ ] **Phase 2 = P2（近两 build）**：Sprint Narrative 文字、Cockpit `dashboard==null` 保留旧数据、发文字+附件双消息 bug、Plan 补 Goal/Scope/Risks/currentPhase、补 Baseline/Decisions tab、删除/编辑 Worker、Actions `targetTab` 跳转
  - [x] Chat 图片消息已压缩为单图卡片，发送态区分 `sent` / `queued` / `error`，避免成功后仍显示红叉
  - [x] Chat optimistic 去重改为按 server echo 一对一消费，真实重复发送同文案/同图片不再被误删（**#23 钟馗复审抓到此处仍误删的 HIGH 回归：之前只按文本扫全历史、忽略时间→历史已有同文案就把新连发提前吃掉；马超 2026-05-31 改为「server echo 只能消费在它之前创建的 optimistic」一对一，补反例测试，第三次根治**）
  - [x] Settings 连接徽章状态文案接回 i18n，connected/idle/checking/error 不再直接吐英文 state
  - [x] Workers 卡片状态文案接回 i18n，Working/Idle/Stopped 不再硬编码
  - [x] **#24（赵云 codex 卡死转马超 claude，2026-05-31）多图显示 + composer/标题**：① 发 N 张图原本显示成 N 个空绿框→整合赵云的 `chat-media.ts`（`extractChatMediaItems`/`buildChatMediaEnvelopeJson`），optimistic content 写全部 N 张附件、气泡 `mediaGrid` 渲染 N 个真实缩略图（多图用 104² compact 缩略图）；移除只读单 `media` 的旧 `parseMedia`；#23 去重未丢 uri（content_json 携带 attachments）。② composer 字体 15→14 保 placeholder 单行；③ 左上角标题 `Orchestrator` 硬编码→主标题=当前 workspace 名（取数据）+ 副标题「项目主管·PM」(i18n `chat.header.subtitle`)，保留中继 badge+在线药丸。强 TDD：`__tests__/chat-media.test.ts` 6 测（N 图 round-trip/caption/单图/纯文本无 media/legacy media/丢弃残缺项）。mobile tsc+biome+104 测全绿。待钟馗审 + 真机验。
  - [x] Workers 角色 / 能力 / CLI / 风险 / Unattended 标签全量收口，中文界面不再漏英文
  - [x] **#25 index.tsx i18n 彻底收口（马超 2026-05-31，最后一轮）**：通读全文件，把所有 user 可见硬编码英文接 t()——系统事件标题/摘要（Dispatched / Dispatched→worker / Worker Report / Report from worker + 两条 fallback 摘要，`parseSystemEventPayload` 加 `t` 参数，**复用早已存在但从没接的 `chat.system.*` key** + 新增 reportFallback）、审批兜底主语 `Approval request`、风险标签 `High/Medium Risk`、orch 气泡 senderLabel `Orchestrator`、媒体标签 `Image/Image·size/File/Video/{size} video`（MediaContent 加 useT）。新增 11 个 key（EN+ZH 各）。残留扫描仅剩 `Bearer` auth header（非可见，保留）。mobile tsc+biome+104 测全绿。待钟馗确认 i18n 干净。
  - [x] 状态 / 驾驶舱 / 设置三页的 ConnectionModeBadge 收进标题行，移除独占整行 banner
  - [x] **#26（马超 2026-05-31，钟馗 #24 复审发现的 3 个 regression）**：① 发 1 张图出现 2 个图气泡（真图 + 空绿框）—— 根因：服务端把 1 张图+caption 拆成 2 条 chat 消息（upload echo 带 `media:{}` + prompt echo 文字 `[附件:...]`），客户端 optimistic（attachments[]+caption）与服务端 media echo 文字不一致、按文字 key 去重消不掉 → 重复。修：`chat-message-dedupe.ts` 的 key 改为**带附件按媒体文件名集合**（纯文字仍按文字），同一图的 optimistic 被服务端 media echo 按文件名一对一消掉（沿用 #23 时间门控），剩 1 个图气泡 + 1 个文字气泡。② 文字气泡 ✓：user_text footer 本就无条件渲染发送状态（server 消息 sendSucceeded→sent→✓），#1 去重后最终态=图气泡✓ + 文字气泡✓，清爽；已加 send-status/footer 保证测试。③ placeholder 缩短：`chat.input.placeholder` EN `Message orchestrator...`→`Message...`、ZH `给 orchestrator 发消息...`→`发消息...`，保证单行。强 TDD：dedup +4 测（media echo 消图 / 文字 echo 不误消 / 双 echo 仅 media 消 / 旧图 echo 不消新发）。mobile tsc（我的文件）+biome+113 测全绿。**注**：多图（N>1）服务端拆成 N 条 media echo，optimistic 单条 grid 与之非 1:1，仍可能并存——本派单聚焦 1 图，多图留观察。待钟馗审。
  - [x] Cockpit Plan 里程碑展开详情基础 markdown 渲染（bold/code/quote/list/wiki-link 去壳）已收口
  - [x] **终端（实时）视图渲染改进（马超 2026-05-31，独立 build；`app/agent/[id].tsx`）**：user 截图 orch 终端文字错乱吞字（"secuses/s1rvices"）。根因三层——①`termLine` 用 `'Courier'`，安卓无此族→回退无衬线→不等宽错位；②服务端 headless-xterm 序列化快照只 strip 了 CSI，残留 OSC/字符集/控制字符；③快照 80 列，窄屏 wrap reflow 糊成团。修：① 等宽字体 `Platform.select({ios:'Menlo',default:'monospace'})`；② 新增纯函数 `src/lib/terminal-text.ts`（`sanitizeTerminalLine`/`cleanTerminalLines`：去 OSC/CSI/短转义/孤立 ESC/控制字符 + 解 \r 覆盖 + 去尾随空白），渲染前清洗；③ 终端行包进**横向 ScrollView + 每行 numberOfLines=1**（不再 wrap reflow，长行横向滚动），inline+全屏两处都改。强 TDD：terminal-text 11 测（CSI/OSC/字符集/控制字符/\r 覆盖/CJK 不损/maxLines）。mobile tsc（我的文件）+biome+125 测全绿。**做到 1+2+3 全部**。剩余：深度终端模拟（光标定位/SGR 配色还原）未做，非本轮目标；待钟馗审 + user 真机验。
    - **服务端配套修复（马超 2026-05-31，钟馗审出，需 4010 重启）**：`routes-mobile.ts transcriptLinesFromSnapshot` 之前发手机前 `.replace(/\r/g,'\n')`+每行 `.trim()`，把前导缩进删了、\r 提前拆成残影多行 → 客户端 terminal-text 的缩进保留/\r 覆盖在真实路径失效。改：① 只按 `\n` 切行（不再全量 \r→\n）；② 每行 `.trim()`→`.trimEnd()`（保前导缩进/Tab），空行判断用 `trim().length===0` 不删被保留行缩进；③ 抽 `resolveLineCarriageReturns` 在切行后对每逻辑行解 \r 覆盖（剥行尾 \r\n 残留 + 取最后一次写入），route 输出已正确、与客户端幂等。确认该 transcript 仅 mobile 消费（HTTP `/transcript` + relay `worker.transcript`），未碰 web。强 TDD：+2 route/transcript 层测试（真 PTY 验前导缩进保留 + craft 快照验 \r 覆盖/Tab/ANSI strip）。server tsc + mobile-routes 28 测全绿。
- [ ] **Phase 3 = 低优 + 覆盖缺口专项**：Reports/Research/Archive/Timeline tab、派单状态语义统一、各类样式/截断/key 修复
- [ ] **视觉重设计（设计先行，user 嫌"丑死了"）**：先出高保真 mockup 再照做。
  - [x] 新增 Worker 表单重设计 mockup（马超 2026-05-31）：`.hive/reports/2026-05-31-mobile-add-worker-redesign.html`（2 方向 A 精炼/B 活力，深色高保真，全字段保留）+ 可复用设计 token + 落地映射；索引 `.hive/research/2026-05-31-mobile-design-tokens.md`。**待 user 拍方向（A/B/混搭）** → 排实现（关羽，含抽 theme token + Pill/Field/Input/Button/Sheet 复用组件）→ 钟馗审 → 张飞真机验。
  - [ ] 设计 token 落 `theme.ts` 后，其余手机页（Dashboard/Tasks/Workers/Settings/Chat）按同一 token 统一刷新（根治"东一个西一个的丑"）。
- [x] **QR 读相册修复（马超 2026-05-31，代码完成待钟馗复核+真机验）**：纠偏——根因**不是**"华为无 GMS"（相机实时扫能用已证明解码引擎不靠 GMS），而是 expo-camera 的 `scanFromURLAsync` 接口在安卓本身不靠谱。改法：`settings.tsx` 相册路径绕开 scanFromURLAsync，改纯 JS 链路——`expo-image-manipulator` 归一成 PNG base64 → `upng-js` 解 RGBA → `jsQR` 解码 → 复用 `parseConnectionQr` 录入；相机实时扫不动。抽纯函数 `src/lib/qr-image-decode.ts` + 强 TDD（qrcode 真生成 QR PNG→解出预期，6 测）。**新增原生模块 expo-image-manipulator → 必须重出 build（prebuild 重链），不能热更**。
  - [x] #23 钟馗复审跟进（马超 2026-05-31）：QR 失败态拆三类提示（图里没码 / 有码但非连接配置 / 图片解码失败，不再一律"未找到二维码"）+ i18n 残留补全（host placeholder、Workspace 默认名接 t()）。mobile tsc/biome/96 测全绿。待钟馗三审。
- [ ] **遗漏待补审查**：Workspace 切换、Settings/语言、Feishu 绑定+推送深链、relay token 存储安全、长列表性能、横屏适配
- 关联：修完用本地构建出 build（`.hive/research/2026-05-31-local-build-setup` 路线）；改完必须真机验（非 proxy 指标）
- [x] Track B P0 已在当前 workspace 落地：`thinking_levels` 类型修正、非 silent 重连失败保留旧 dashboard、ConnectionModeBanner 重连态、Cockpit/Tasks/Actions/Worker detail 死按钮收口（`05fb52d`）

### M29 · 推送通知打通（后台也能收提醒） · in_progress (user 拍板 2026-05-31)
> 触发：user 问"app 切后台后谁收消息、微信怎么做到的"。讲清=微信靠**系统推送服务**(APNs/FCM/厂商推送)非"后台常连"；user 拍板立此 milestone。目标：app 不在前台也能收到 worker 完成 / 审批请求 / orch 回复的系统推送，点通知进对应页（微信式体验）。
> 现状：M24 Phase7 做了一半（Expo push 注册真 token + 通知点击 deep-link 路由 approval/worker_done/high_ai_action），**缺实际投递通道**。难点：自建本地构建（已弃 EAS）后推送配置要手动接；国内安卓 FCM 常被墙→可能需厂商推送。
- [x] **Phase 1 = 调研 spike（马超 2026-05-31，代码未改、纯调研）**：产出 `.hive/reports/2026-05-31-push-notification-spike.html` + `.hive/research/2026-05-31-push-notification-spike.md` + ADR draft `draft-2026-05-31-push-channel.md`。**核心结论**：user 华为折叠屏无 GMS → FCM（含现有 exp.host→FCM 链）从根上投递不了，不是缺凭据是选错通道；华为机后台推送唯一可靠系统通道 = HMS Push Kit。三档方案 A 前台服务保活 relay WS（最小、复用 M28、需电池白名单非 100%）→ B HMS Push（华为本命、被杀也唤醒、需华为实名账号+AGC+Expo HMS 坑）→ C 极光/个推聚合（最广最贵）。推荐 A→B 渐进。待 user 拍：①A→B 还是直接 B ②是否注册华为开发者账号（实名，HMS 硬前置）③是否上 C 兼容非华为。
- [ ] **Phase 2 = 最小可用推送**：按 spike 方案接通至少一条通道；server 在 worker_done/approval_request/orch_reply 发推送；本地构建包含推送配置；真机验锁屏收到 + 点击跳转。
- [ ] **Phase 3 = 国内厂商推送可靠性**（如 spike 判定 FCM 不够稳）：对接华为/小米等厂商推送 + 保活策略。
- 关联：[[reference_local_build_apk_delivery]]（推送配置要进本地构建）；Q14（手机审批通道）与本 milestone 协同——审批请求推送是高价值场景。

### M30 · Worker 汇报可靠性加固（干完没报必须系统兜住） · shipped 2026-05-31 (`0ec6c41`，需 4010 重启激活)
> 触发：user 强烈不满——赵云（codex）干完 6 项 UX 却不跑 team report，**是 user 先发现的、不是系统兜住的**。user："你自己接管不是彻底解决"。
> 架构铁律（核查确认）：L2 提示词其实已很全（worker 启动提示 + 每轮 REMINDER_TAIL 都注入"必须 team report，文字总结不算，每轮自检"），但 **L2 能被 LLM 绕过**（codex/gpt-5-mini 较弱，读到仍可能不执行；claude 很少犯）；**L1 无法强制 LLM 跑命令**。故解法不是"逼它报"，而是"它不报也绝不静默、user 一定看得见"。
> 澄清（马超核查）：dispatch ledger 状态只有 queued/submitted/reported/cancelled，**无 in_progress**；"领了活干完不报"整个就是 `submitted` 窗口，现有检测本就覆盖（未加 schema 态，避免迁移风险）。
> 否决"自动收尾兜底"：拿 PTY 最近输出伪造一份 report = 垃圾（同 orch_reply 抓终端乱码坑）+ 可能误判仍在干活的 worker→错误收尾。**伪造汇报比不汇报更糟**，改走"可靠 surface + 继续 nudge + PM 验证收尾"。
- [x] 检测覆盖"干完没报"：submitted 即"在办未报"窗口，复用 M26 idle 自愈 nudge worker；新 `stale-dispatch-status.ts` 纯函数 summarizeStaleDispatches 单一事实源
- [x] **直接 surface 给 user（核心兜底）**：`buildMobileDashboard` cockpit 暴露 `stale_dispatches`/`escalated_dispatches` 计数（4min/8min 两档）→ **user 拉看板必见"N 个派单超时未汇报"，不靠 push/LLM/worker 在线**，到点就亮，硬兜底
- [x] 连续超时→escalated 第二档 + 继续 nudge worker/orchestrator；`stalled-dispatch-nudge` 加 always-on surface pass（不 gate idle，worker 卡死也兜）
- [~] 修"working 假信号"：用 stale/escalated 时长分档近似；per-dispatch idle 布尔需 per-request PTY snapshot（性能成本）留 Phase2
- 强 TDD 禁 mock PTY：stale-status 6 + user-surface 5（真 ledger+可控时钟）+ mobile-routes +1，全绿。⚠️ push 投递半边受 M29 制约（华为无 GMS）→ **可靠 user 可见兜底落在看板计数**，push 待 M29 接通 HMS。关联 [[feedback_worker_reliability_systemic]] [[feedback_verify_dispatch_started_after_restart]]。

### M31 · Worker 模型可见 + 可配置（治本 worker 可靠性） · in_progress (user 拍板 2026-05-31)
> 触发：**user 洞察一针见血**——赵云反复不守规则/不 report/dedup 修 3 次没对的根因是**模型**（codex preset 跑 gpt-5.4-mini，弱，工具纪律差）；马超=claude 可靠。这正是本轮我一直把硬活从赵云转马超的隐性规律，user 把它点破。
> 现状：worker 数据有 preset/provider_family/thinking_level，但**没有具体模型结构字段**；真实模型（gpt-5.4-mini 等）只在 CLI 状态栏 last_pty 看得到。
> 核心：把"哪个 worker 靠谱"从隐藏变成 **user 能看见 + 能调**。
- [x] **Phase 1 调研 spike（马超 2026-05-31，纯调研未改码）**：产出 `.hive/reports/2026-05-31-worker-model-visibility.html` + `.hive/research/2026-05-31-worker-model-visibility.md` + ADR draft `draft-2026-05-31-worker-model-control.md`。**核心结论**：hive 现在根本不控制也不知道 worker 模型——内置 preset 不带模型参数，模型=各 CLI 自身默认（codex 默认就是 gpt-5.4-mini）；真实模型只在 CLI 自绘 PTY 状态栏、无结构字段。要"可见且正确"唯一可靠路径=hive 显式 set `--model`（可见性是可配置性的副产物）。4 CLI 全支持 `--model`（claude/codex/gemini 直接 id，opencode 要 provider/model），完美套用现成 thinking-level 注入器（加 `getModelArgs`）。**捷径**：把 codex 内置 preset 默认模型钉强档即可治本大半，未必需要 per-worker UI。待 user 拍 5 点（默认策略/模型清单/粒度/默认显示/成本）见 ADR。
- [ ] **Phase 2 显示**：worker status 暴露真实模型（结构字段）→ mobile + web worker 卡片显示「跑什么模型」。
- [ ] **Phase 3 可配置**：Add Worker / Worker 设置 里 per-worker 选模型（下穿 launch config → CLI 调用），user 可把关键 worker 升到强模型。
- 关联 [[feedback_worker_reliability_systemic]]（worker 不可靠要治本）；与 M30（看板兜底）互补：M30 兜"不报"，M31 治"为何不报=模型弱"。

### M32 · worker 独立 CODE worktree + 共享 .hive 治理根 · in progress (user 拍板 2026-06-01 "同意！")
> 触发：两个哲学相反竞品（OpenTeams worktree-per-repo / CCB worktree materializer）**独立都指**"无 worktree 隔离"是真缺口（高置信度）。当前所有 agent 共享同一 cwd（`agent-run-starter.ts:94` 写死 `workspace.path`），并行改重叠文件互踩=真实数据风险。
> 依据：spike `.hive/reports/2026-06-01-worktree-isolation-spike.html`+research；ADR `.hive/decisions/2026-06-01-worker-code-worktree-shared-hive.md`（已采纳）。
- [~] **Phase 1（马超 2026-06-01，`28b8417` 初版 → 钟馗审 4 blocker+1 medium → 返工 `9874141b` 完成，待复审）**：`worktree-manager.ts`（worktree add --no-checkout --detach → core.sparseCheckout + info/sparse-checkout `/*`+`!/.hive/` + read-tree -mu；**不再放 .hive symlink**）+ `agent-launch-roots.ts`；改 `agent-run-starter.ts`（先解析 launchRoots + cwd + 3 env）、`agent-run-bootstrap.ts`（session capture 用真实 cwd）、`agent-runtime.ts` 接线。**默认关，`HIVE_WORKER_WORKTREES=1` 显式开**（无分层=零行为变更）。**返工修的 4 blocker+1 medium**：①弃 symlink（symlink-over-tracked-.hive 被 `git add -A` 暂存污染，已实验三组对照证实）改 `HIVE_GOVERNANCE_ROOT` env，sparse skip-worktree 保 add-A 干净；②session capture/resume 改用 worker 真实 cwd(codeRoot)，与 M25 managed-root override 对齐；③ensure 失败 fail-closed（仅非 git workspace 退回，其它抛 `NotAGitWorkTreeError` 阻断）；④健康检查真比对 git-common-dir realpath（绑错 canonical 残留→重建）；⑤路径段复用 `managedAgentSegment` sanitize+hash。强 TDD：真 git 14 测（add-A 干净 / 绑错重建 / fail-closed / capture cwd=codeRoot）全绿 + launch 回归(layer-a-resume/lifecycle/rehydration 真 PTY)全绿；tsc 0 biome 净。ADR 已回填变更。留后续：worker guidance 引用 `$HIVE_GOVERNANCE_ROOT`（默认开启前必做）、DB 元数据表、冷重启残留清理、真机多 worker 验。
- [~] **钟馗复审（`7c6747d3`，2026-06-01）出 4 blocker（PM 判全成立）**：①`git add -A` 会 stage `A .hive`+`D .hive/plan.md` 污染治理（已复现；symlink-over-tracked-.hive 本质脆弱；测试只验 `git diff HEAD` 没验 add-all）②worker cwd=codeRoot 但 session capture/resume 仍用 workspace.path→抓不到 session/resume 错绑（与 M25 重叠）③git repo 隔离失败静默退回主树 cwd→主树裸跑污染（该 fail-closed）④健康检查没 realpath 比对 symlink 目标（注释说有代码没有）→坏残留复用串治理。+ medium 路径 segment 没 sanitize/hash。**返工已完成 commit `6867cc9`，钟馗复审 `4fcd4c6a` 通过（0 新 blocking，4 blocker 全闭环，钟馗重新复现 B1 git add -A 证实新版干净，52/52 回归绿）→ M32 Phase 1 审过**。2 个 non-blocking 是已知启用前置：①MEDIUM 1 worker guidance 仍说"读 ./.hive"（钟馗精确点位 `hive-team-guidance.ts:26-27,120`/`session-start-review-message.ts:6-9`/`team.ts:40`），启用门控前须改引 `$HIVE_GOVERNANCE_ROOT`（建议文案="优先读 $HIVE_GOVERNANCE_ROOT/.hive，未设退回 ./.hive"+启动提示快照测试）②MEDIUM 2 "ADR 不在 commit"=`.hive/decisions/` gitignored 已知设计（ADR 在盘+Cockpit 可见；若要 ADR 进 git 历史是另一项治理决策待 user 拍）。
- [ ] **Phase 2**：PM review/commit 流程（主树查 N worktree diff → apply/cherry-pick → 主树验证 commit；worker worktree 绝不直接 commit）+ 冷重启/残留 ensure（参考 OpenTeams 建失败回滚）。
- 关键约束：**与 M25 都动 launch 路径，必须串行实施避免冲突**（M32 改 cwd，M25 改 env/session）；保留 PM 主树唯一整合点，刻意不做对手的重合并门/per-worker PR。

### M33 · 远程可诊断性 + provider 活动证据（候选 · 双竞品三角合成 idea-8） · proposed
> 触发：双竞品三角合成（[[idea-8]] in `.hive/ideas/inbox.md`）——OpenTeams（全 SQLite 事件流）+ CCB（doctor/support bundle/completion evidence）独立印证。HippoTeam 是三方唯一"远程优先"却最缺"user 手机看底层证据"。拆"假矛盾"：我们卡死**探测**强（M26/M30/哨兵 never-silent），但缺"活着的 agent 此刻在干嘛"的**可解释性证据**。探测≠可解释。
> 现状基础：M25 line 251 已标"可单列 M25b：hive doctor/support bundle"；本 milestone = 因双竞品印证升格独立。
- [ ] 只读 `hive doctor --json`（runtime/schema_version/agents status+pending/dispatches open/relay+mobile+feishu/PM docs orphan）
- [ ] `hive doctor --bundle` 诊断包导出（排 secrets）
- [ ] **provider activity evidence**（采 provider hook/session log 的 last 语义进展/last tool/last assistant chunk → 手机+Cockpit 显示"working, last progress 8m ago, evidence: tool_call"；**不改三态、不自动 kill，只触发 ActionBar 软提醒**）
- 待 user 正式拍板 promote（现 proposed，由 idea-8 incubate）。

### M34 · 未审代码改动看板兜底（"claude 必审"从靠记性→系统拦） · in progress (user 拍板 2026-06-01 "立")
> 触发：本 session **PM 自己演示了这个洞**——审查靠 PM 手动记得派钟馗，结果 PM 图省事自审了 9 行 i18n（`538d004`）漏派钟馗，被 user 当场戳穿"claude 审 claude 不靠谱"。靠人记性会漏，连 PM 自己都漏。
> 目标：coder（尤其 claude preset）report 了**代码改动**、但没有对应 reviewer dispatch 跟上时 → Cockpit **硬亮"⚠️未审"**，never-silent（同构 M30 stale-dispatch 看板兜底，不靠 push/LLM/PM 记性）。
> 关联：[[feedback_no_self_review_claude_code]]（本条根因）；M30 stale-dispatch（同构兜底范式，复用其纯函数 + aiAction 模式）；[[feedback_worker_reliability_systemic]]（治本不靠手动）。
- [x] **设计 spike（马超 2026-06-01）**：产出 `.hive/reports/2026-06-01-unreviewed-code-backstop-spike.html` + `.hive/research/2026-06-01-unreviewed-code-backstop-spike.md`。**核心结论**：①判"产生代码改动"= **worker role 主门(claude coder)+report-only 反向排除器**，弃 git 提交窗口（PM 审后才 commit、M32 worktree 提交不在 main → 高漏报）；②判"已审"= **启发式时序配对**（coder reported 后同 workspace 出现 reviewer dispatch 即消解），精确 link 留 Phase 2；③数据模型 **纯函数零 schema**（照 M30 `summarizeStaleDispatches`，新 `unreviewed-code-status.ts`）；④surfacing 双轨：mobile push+状态计数（照 M30）+ Cockpit ActionBar 合并 DB 派生 action（扩 `AIActionType='unreviewed_code'` high，**注意 aiActions 今天纯文件派生、需在 serve-cockpit 边界合并、不动 parseCockpit**）。**头号误报=spike 类 dispatch（本任务自己即例）→ 必须有 report-only 排除器**。**不需加 schema**（Phase 1 纯函数；Phase 2 可选 `reviews_dispatch_id` 精确配对，仅当启发式噪音不可接受）。
- [~] **实现 Phase 1（马超 `7a5ead11`，2026-06-01，code-complete 待钟馗审）**：新 `unreviewed-code-status.ts`（纯函数 `summarizeUnreviewedCodeDispatches` + `isReportOnlyDispatch` 排除器 + `buildUnreviewedCodeActions` + `augmentAiActionsWithUnreviewedCode` 边界合并器）；`cockpit-doc.ts` 仅扩 `AIActionType+='unreviewed_code'`（parseCockpit/buildAiActions 保持 file-only 不碰 DB）；边界合并接 3 处：`cockpit-websocket-server.ts`(web ActionBar，best-effort try/catch)、`routes-mobile.ts`(buildMobileDashboard 加计数 `unreviewed_code_dispatches`+合并 aiActions / cockpit detail 合并)、`relay-rpc-handler.ts`(远程 parity)；push `notifyUnreviewedCode`(mobile-push.ts，每 dispatch 去重) 经 `stalled-dispatch-nudge.ts` 新增可选 hook `surfaceUnreviewedCode` 复用 M30 60s tick、`runtime-store-helpers.ts` 接线。**report-only 排除器**：含代码 artifact→绝不排除(改动信号优先)；否则 reportText 命中 spike/调研关键词 **或** artifacts 全文档→判 report-only（与 spike 文档字面"且"有意偏离：真实 spike 常无 artifacts，确保 M34 spike 自身被排除）。强 TDD：13 测全绿覆盖 ①未审→亮②出 reviewer→灭(+前置不消解)③spike(有/无 artifacts)→不亮④非 claude coder→不亮⑤parseCockpit file-only 契约+宽限/非 reported/code-artifact override。tsc 0、biome 净；回归 80 测(cockpit-ws/mobile/relay/nudge/app)全绿。钟馗复审（功能本身也走审查闭环）。**commit `7000f5c`；钟馗复审 `d5ea3476` 出 1 BLOCKING + 2 风险（PM 判全成立）→ 返工马超 `e6124fc1` 完成（code-complete 待复审）**：①**BLOCKING**=`workspace-store.listWorkers()` 不返回 `commandPresetId`→`isClaudeCoder` 恒 false→生产里整个兜底形同虚设（第二次"测试绿但生产死"）。**修**：新增**唯一**边界入口 `cockpit-unreviewed-augment.ts::resolveCockpitUnreviewedCode(store, ws, now?)`——内部用 `resolveCommandPresetId`(读 launch config/peekAgentLaunchConfig，真实 preset 源)拼 role map；4 处生产注入点(web WS/mobile dashboard/mobile cockpit/relay/push)全改走它，杜绝各点重复犯错；relay store Pick 补 peekAgentLaunchConfig。**+ 真 store 边界集成测试** `unreviewed-code-backstop-integration.test.ts`(5 测，createRuntimeStore+addWorker+configureAgentLaunch(claude)+dispatchTask+reportTask 真实路径；断言 raw listWorkers 无 preset 但 resolveCommandPresetId 解析出 claude、buildMobileDashboard 真出 unreviewed_code_dispatches≥1、出 reviewer 后清零、codex/spike 不亮)。②HIGH=report-only 收窄：正向代码动词信号(改了/新增/重构…)压过 report-only；无 artifacts 时不用裸"调研/spike"，要强短语(不改产品代码/纯设计/未改…代码)；补测试"无 artifacts + spike 文本 + 改了 src/*.ts→必标"。③MEDIUM i18n：`派 reviewer`→`cockpit.actionBar.action.assignReviewer`+en/zh messages，补 EN/ZH locale 测试。`buildMobileDashboard` 加可注入 `now` 供集成测试越过宽限。tsc 0/biome 净；M34 20 测 + 回归 91 测(cockpit-ws/mobile/relay/nudge/app/web-i18n)全绿。**返工 commit `ff6f29f`（PM 验 20 测绿含 5 真 store 集成）→ 钟馗复审 `e382b71c` 通过（0 blocking，BLOCKER+2 风险全闭环，确认集成测试真穿透 RuntimeStore 能抓旧 bug 回归）→ M34 Phase 1 审过**。1 LOW follow-up：集成测试 `stores` 数组 afterEach 只 splice 没 `store.close()`，建议 close 后再 rm 防未来 watcher/DB handle 泄漏（当前通过，未做）。**Phase 2 留**：reviews_dispatch_id 精确配对（现启发式时序）、扩全 coder（现限 claude）。
- 边界：不阻断 dispatch（不是 gate），只 surface 提醒（PM 仍可判断免审小改）；先覆盖 claude coder，codex/opencode 看需要。

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
