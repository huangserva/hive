# Tasks

> 长 narrative 和决策上下文在 `.hive/handoff.html` 和 `.hive/reports/*.html`。
> 这个文件只放 GFM checkbox 格式的当前 sprint 任务和历史归档。

## In progress（两条线并行：关羽改 server / 赵云只写 .hive 文档，不撞）

- [ ] **关羽** dispatch `6b8951b5` — M14a Phase 2：实现 LocalSttProvider（探测+调本机 whisper-cli/whisper 转写，接进飞书桥替代飞书内置 ASR，无 CLI 优雅降级）+ 附 whisper 安装步骤给 user + 测试。user 拍板 D 干
- [ ] **赵云** dispatch `1eb7852c` — 调研给 HippoTeam 做前端 APP/面板（借鉴 paseo app 端）：paseo app 怎么做 + PWA/Tauri/RN 三选项对比 + 桌面壳 vs 移动远程（跟飞书远控重叠）+ 推荐。出 report+research，不实现

> 📱 user 走飞书（chat oc_0d5e…）；两条线 report 回来都走飞书同步 user。真飞书语音 E2E 待 user 配合

## Open（user 回来决定）
- [ ] multica 余下：#4 run 列表最新优先排序+复制一致(S，👍) / #5 Gemini 官方图标(S，看用不用) / #6 复合派单选择器(M，存疑别做成 squad) / #8 OpenCode cwd 防回归测试(低，park)
- [ ] clipboard 写权限 console error（张飞发现 2 条，疑 playwright 环境权限非真 bug）— 先确认真假
- [ ] M14 mobile + voice（Q4 拍板 5/25 纳入 plan）— 排在 M17 之后，开工起 ADR
- [ ] HippoMind workspace 让那边 orch retrofit `.hive/plan.md`（runtime 重启后自动 seed stub）
- [ ] 是否派关羽 export refactor（mouse normalization / port-in-use formatter / terminal-stream-hub binary 3 个私有函数）— 典韦点名要 export 才能直测
- [ ] PM 体系 Phase C-3b（A4-A6 主动 trigger：milestone 完成自动 baseline 体检 / 月度 archive cron / cross-workspace drift）— 观察 1 周 LLM 自觉性后再决定（M8）
- [ ] Marketplace 深度调研是否回灌（M11，独立于 PM 体系决定）
- [ ] 9 个 🟡 中风险 event handler 是否补修（等 logger 抓到证据）

## Done

### 2026-05-24 ~ 25（Feishu e2e + paseo 调研 + Cockpit governance + MCP browser + 全 app E2E + M17 handoff）
- [x] **关羽** dispatch `701ab29f` — M14a Q10 选项 D 调研（openclaw 本地 STT）：**可行+推荐**。openclaw media-understanding/runner 用无 key 本地 CLI auto-detect（sherpa-onnx-offline→whisper-cli→python whisper→才落 provider key）。建议不搬整套，加 LocalSttProvider 借 CLI adapter/fallback：飞书 audio→临时文件→whisper-cli/whisper→解析→复用 inbound 注入。MVP 白名单 whisper-cli/whisper、不引 native binding、不自动下大模型。坑：user 需装 CLI/模型、冷启动、中文质量、CPU timeout。report+research+Q10 更新，全 gate 1161 (`96cee8a`)
- [x] **关羽** dispatch `4109bb4b` — **M14a Phase 1** 飞书语音接入 spike+第一刀：三未知解（①audio msg content 带 file_key→parseAudioContent ②messageResource.get 下载音频 stream ③飞书 speech_to_text.fileRecognize≤60s 但**免费版不支持**）。实现 audio→下载→飞书 ASR→recognition_text→复用 resolveRoute/inbound 注入 orch（标 `[来自飞书语音]`），失败优雅 drop 不接外部。挂 Q10（STT provider 待拍）。report+research 配对，38 focused + 全量 1161 (`f37b21f`+`c29bf2e`)。真飞书 E2E 待 user 配合
- [x] **赵云** dispatch `d84d31fa` — M14 语音/移动选路 ADR 调研：三路横向对比（自建 mobile / 第三方框架 LiveKit-Vapi / 飞书+voice）+ ADR draft。**推荐先走飞书 voice command MVP**（语音→转写→现有 team 协议，复用 M4 桥，ROI 最高，自建/实时框架二阶段）。reports+research+ADR 配对，全 gate 1156 (`7983182`+`933eedc`)。结论已发 user 飞书，路线待拍（Q9）
- [x] **关羽** dispatch `ea4054a2` — 修 orch 终端流式时底部输入框消失：根因 flex 链缺约束（orch PTY slot 修前 overflow visible/min-height auto/flex 0 1 auto → 修后 hidden/0/1 1 0%），OrchestratorPane root + portal slot + WorkspaceDetail 左 pane 补 min-h-0+overflow-hidden + 回归测试。**playwright 真浏览器量 DOM + 80 行流式验输入区全程可见**（top937/bottom954<1000）。纯前端不用重启，build:web 已跑。4 focused + 全量 1156 (`9b63ae2`)
- [x] **赵云** dispatch `98ca899a` — **multica #7** runtime 状态条：GET /api/runtime/status（UI token 保护）返 port/pid/cwd/log_path/db_path/version + RuntimeStatusStrip 挂 sidebar 底部（独立 useRuntimeStatus hook，不动 api.ts；title 露全路径）+ i18n + 测试。不做心跳。全 gate 绿 1156 tests (`89acb07`)。⚠️新 endpoint merge 后需重启 4010；重启后张飞验收
- [x] **关羽** dispatch `03e7da29` — idea-7：Cockpit 内嵌文档 viewer（CockpitDocumentViewer.tsx，reports 用 iframe / baseline-research-decisions 用 doc-file fetch + `<pre>`，Dialog Esc/遮罩关，i18n loading/error）。4 tab 打开按钮改内嵌不再 window.open。**纯前端不用重启**，build:web 已跑。18 focused + 全量 1153 (`5c7227e` + `8dba38e`)
- [x] **张飞** dispatch `5216b120` — 真浏览器验收 idea-7 viewer **PASS**：baseline/research/decisions/reports 全部 app 内 Dialog 打开（始终 1 个 tab、未开新 tab），md 用 pre / report 用 iframe 真渲染，Esc + 关闭按钮可关，0 console error。附 clipboard 写权限噪声 4 条（非阻塞，记 idea-7 待查）
- [x] **张飞** dispatch `d7e73037` — 真浏览器诊断"baseline 点不开"：**功能本身好的**（5 卡片有按钮、点击开新 tab、doc-file 200 返回 markdown、path 格式对）。根因＝**user 浏览器旧 bundle 缓存**（按钮没渲染），硬刷新解决。附带发现 window.open 新 tab 可能被弹窗拦 + 主 app 2 条 clipboard 写权限 error（记 idea-7）
- [x] **关羽** dispatch `66b92abe` — 两个 Cockpit 修复：① ideas parser bug（pm-ideas-doc parseIdeasDoc 改用 topLevelBullet，缩进子条目不再算独立 idea → 修「想法」虚高计数 + ActionBar 一个 idea 刷成多条噪音）② doc-file 路由 serve `.hive/{baseline,research,decisions}/*.md`（path-traversal+目录+后缀防护，text/plain），3 个 tab 加「打开」按钮 window.open 同浏览器。61 focused + 全量 1153 (`9b62207`)。⚠️parser+新路由 merge 后需重启 4010
- [x] **Orchestrator** — 收尾刷 baseline（消 staleness）：module-map（+pm-reports-doc/reconnecting-websocket/preload-recovery，schema v21→v22，标注 dispatcher 快照注入/cockpit reports+playbook/routes-cockpit report-file+answer）+ runtime-flows（Flow1 Layer4 快照、Flow4 reports/answer/9 tabs）+ state-storage（schema v22）
- [x] **赵云** dispatch `b947680a` — **M13 Layer 4**（5 层全齐 shipped）：buildWorkerCockpitSnapshot 生成 4 行紧凑快照（phase + 活跃 milestone + open Q/high 数 + baseline fresh/stale + 共维护提醒，<520 字符），dispatch 当下经 writeSendPrompt 注入到 PM_DISPATCH_REMINDER 之后。真 PTY CLI 测试断言 worker stdin 真带快照。全 gate 绿 1143 tests + orch 复验 19/19 (`62ca462`)。⚠️注入逻辑 merge 后需重启 4010
- [x] **关羽** dispatch `a3b4606e` — report 在同浏览器内打开：runtime 加 GET report-file 路由（只允许 .hive/reports/ 下 .html，path-traversal/非html/不存在分别拒）+ ReportsTab 改 window.open(_blank)，不再 shell OS open 弹默认浏览器。16 focused + 全量 1141 (`4e20c7f`)。⚠️新路由 merge 后需重启 4010
- [x] **赵云** dispatch `73ebadd8` — **M17 收官**（5/5 playbook 全齐）：advisor + committee + epic 三模板 seed + ORCHESTRATOR_RULES 三段 + plan.md M17 标 shipped。advisor/committee/epic **故意不加 aiAction**（无干净触发信号，硬凑会污染 ActionBar，是 PM 主动选择型）。三 gate 绿 1141 tests + orch 复验 31/31 (`4304d2e`)。⚠️RULES merge 后需重启 4010
- [x] **关羽** dispatch `c883244c` — M12 Cockpit Reports tab（第 9 个 tab）：新建 pm-reports-doc parseReportsDoc（扫 reports/*.html 抽 title/date/topic，mtime 倒序）+ cockpit-doc 聚合 + ReportsTab.tsx（镜像 ResearchTab，复用 open-file endpoint）+ i18n + 测试。全 gate 绿 1131 tests + orch 复验 27+3 (`a7c0860`)。⚠️cockpit-doc server 改动 merge 后需重启 4010 才出数据
- [x] **赵云** dispatch `81b4df68` — M17 loop playbook（第 2 个）：playbook-loop 模板 seed + ORCHESTRATOR_RULES loop 段 + cockpit-doc loopPlaybookActions（保守启发式：只认带 verifier 语义的 failed/blocked，调研失败不触发，max 2）+ 测试。三 gate 绿 1121 tests + orch 复验 42/42 (`1fa7f2e`)。⚠️RULES merge 后需重启 4010
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
