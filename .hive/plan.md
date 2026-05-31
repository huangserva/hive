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

### M28 · 手机端追平 Web（mobile-vs-web UI 一致性） · in_progress (审查 2026-05-31，63 条确认)
> 依据：workflow 全量审查 `.hive/reports/2026-05-31-mobile-vs-web-ui-audit.html` + `.hive/research/2026-05-31-mobile-vs-web-ui-audit.md`（82 agent / 2.5M tok，0 critical / 10 high / 28 medium / 25 low）。
> 根因不在 UI：**服务端 `routes-mobile.ts` 的 mobile API 只暴露 5 字段**（plan/tasks/questions/ideas/actions），baseline/decisions/research/reports/timeline 源头没输出；且错误处理「清空」而非「降级」。**修服务端一处、多页受益。**
> ⚠️ drift：M24 Phase 5「orch_reply 自动回灌」、Phase 7「审批推送通道」标 done 实则坏了（见 Phase 1 P0/P1）。

- [ ] **Phase 1 = P0/P1（阻塞 PM 核心闭环，进下个 build）** — 派单 2026-05-31
  - **Track A 服务端（派马超）**：`routes-mobile.ts` mobile cockpit/chat API 扩字段 + 修后端根因
    - [ ] `orch_reply` 正常对话回复也写 `mobile_chat_messages`（现仅 `team mobile-reply` 写 → 手机看不到普通回复，对话闭环断）
    - [ ] `approval_request` 真正持久化到 chat DB（现服务端从不写、UI 是死码 → `team approve` 安全门在手机端失效）
    - [ ] run `started_at` 不再硬编码 null（Worker 详情 Uptime 永远 `--`）
    - [ ] mobile cockpit API 暴露 decisions/baseline（+ reports/research/timeline/archive 索引），供前端补 tab
  - **Track B 前端独立 P0（派赵云，不依赖 Track A，文件不冲突）**：`packages/mobile/src/*`
    - [ ] `thinking_levels` 类型修正（对象数组非 `string[]`）→ 新增 worker 选 thinkingLevel 不再显示原始 value
    - [ ] 重连失败 `setDashboard(null)` → 改为保留上次数据降级（命中 user 最怕「出门查一眼全没了」；4G 必现）
    - [ ] `ConnectionModeBanner` reconnecting 时显示 disconnected 态而非误显 wifi/relay 图标
    - [ ] Dead Button 统一处理（Filter/Menu/「...」点击无响应 → 接功能或隐藏）
- [ ] **Phase 2 = P2（近两 build）**：Sprint Narrative 文字、Cockpit `dashboard==null` 保留旧数据、发文字+附件双消息 bug、Plan 补 Goal/Scope/Risks/currentPhase、补 Baseline/Decisions tab、删除/编辑 Worker、Actions `targetTab` 跳转
- [ ] **Phase 3 = 低优 + 覆盖缺口专项**：Reports/Research/Archive/Timeline tab、派单状态语义统一、各类样式/截断/key 修复
- [ ] **遗漏待补审查**：Workspace 切换、Settings/语言、Feishu 绑定+推送深链、relay token 存储安全、长列表性能、横屏适配
- 关联：修完用本地构建出 build（`.hive/research/2026-05-31-local-build-setup` 路线）；改完必须真机验（非 proxy 指标）
- [x] Track B P0 已在当前 workspace 落地：`thinking_levels` 类型修正、非 silent 重连失败保留旧 dashboard、ConnectionModeBanner 重连态、Cockpit/Tasks/Actions/Worker detail 死按钮收口（commit hash 待回填）

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

### M27 · Relay 远程体验优化（跳过 LAN 空试 + 实时推送） · in progress · 代码全 commit `ba631cf`，build #19 含全部，待 user 装+4010 重启验证 (派马超 `8cb009de` 2026-05-30)
- 触发：4G relay 连接修好稳定后 user 反馈 ①慢 ②"经常连接像重连"。诊断：app 每请求先试 LAN(client.ts readMobileJson, 4s AbortController)再 fallback relay，4G 下每请求挂 4s + UI 闪连接中；新消息走 5s 轮询有延迟。
- [x] **Part A 跳过 LAN 空试**（马超 `8cb009de`，代码完成待 review/build）：`client.ts` 加 `lanCooldownMs`(默认30s) + `lanCooldownUntil`——LAN 请求失败即开 cooldown 窗口，窗口内 `readMobileJson` 直接走 relay 跳过 ~4s LAN 空试；LAN 成功即解除（回 WiFi 优先直连）；暴露 `resetLanCooldown()` 供网络变化强制重探。TDD 4 条。
- [x] **Part B relay 实时推送**（马超 `8cb009de`，代码完成待 review/build）：daemon `relay-connector` 加 `pushEvent(kind,payload)`（复用 channel.encrypt 推 `{type:'event'}` 无 id 帧给活跃 session）；`app.ts` 在**已有** registerCockpitListener/registerMobileChatListener 通知点同步推 `dashboard_update`/`chat_message`（不另造通知源）；`relay-transport.handleEncryptedPayload` 加 `onEvent` 路由（无 id 的 event 帧不当 RPC 回应）；context 订阅 onEvent→即时 merge chat / 刷 dashboard；chat 轮询 5s→20s 降频兜底。TDD：transport 路由 2 条 + daemon pushEvent 2 条。
- 强 TDD（§13 禁 mock PTY）；不破坏握手/RPC方法/churn修复/evict-old；测试全绿（mobile 40 + server relay 20）；server+mobile tsc 0 错、biome 干净。**B 动 daemon，需 4010 重启生效**。
- **build #19 含全部**：M27 Part A/B + cockpit 一致性批次（milestone 编号 `e4f8106`、Ideas 编号 `b2f4dea`、Tasks 内容对齐 web `8aecdb8`、cockpit 标签页实时 `2956b14`）。Part A/编号/Tasks 装上即生效；Part B 推送 + cockpit 实时需 4010 重启。Action 文案 i18n（后端发 key）单列待 user 拍。
- 关联：本次 4G relay 连接攻坚（5+1 层 bug 全修，commit `9289919`→`dbbb640`，全过程记于 tasks.md 📡🔥 narrative + `.hive/research/2026-05-30-relay-deployment-kit.md`；polished HTML 报告吕布写时 opencode context 超限止损未成，可后续重派）；cockpit 一致性审计 `.hive/reports/2026-05-30-mobile-cockpit-consistency-audit.html`

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
