# Tasks

> 长 narrative 和决策上下文在 `.hive/handoff.html` 和 `.hive/reports/*.html`。
> 这个文件只放 GFM checkbox 格式的当前 sprint 任务和历史归档。

## In progress

（空 — PM 体系 5 个 phase 全 shipped。等 user 重启 4010 看 Cockpit + 决定下一步）

- [x] **关羽** dispatch `5def6905` — 实现：飞书消息 emoji reaction 两阶段反馈（M7 UX 补强）
- [x] **关羽** dispatch `71d7fde1` — Debug：飞书 reaction API 调用失败
- [x] **关羽** dispatch `b8562201` — 调研：GitHub 搜 paseo 开源项目，下载 + 出 HTML 报告
- [x] **关羽** dispatch `64807571` — 重做 paseo 调研 v2（commit d3062e2 v1 报告 framing 错误，重做）
- [~] **关羽** dispatch `7ef6ff64` — v3 调研：Paseo / Multica / HippoTeam 三方横向对照报告（决策辅助型） ⊘ 关羽 PTY stuck (last_pty_line='─' 空状态线，working 几小时不动)。v3 HTML 已写好 39K 在工作树，orch 接…
- [x] **关羽** dispatch `9e05b245` — Fix：Cockpit Research tab 时间戳只到日期没分钟
- [~] **赵云** dispatch `82aecc7c` — 实施：PM 体系 governance harden（reports/ ↔ research/ 双产出 enforcement，对应 plan.md M13） ⊘ scope 太小。重派整个团队 PM 共维护体系，含 worker 端 PM 维护 + dispatch prompt 自动注入 + commit hook …
- [x] **赵云** dispatch `295b7861` — 重大设计 + 实施：**整个团队共同维护 Cockpit/PM 文档体系**（pre-emptive，不是 reactive audit）
- [x] **赵云** dispatch `d9638cd3` — Follow-up：M13 governance hook 测试补全 + edge case audit
- [x] **典韦** dispatch `1fddae81` — VERIFICATION TASK：不要做任何实际工作。请直接在 team report 里粘贴：
- [x] **关羽** dispatch `160e5438` — Fix UI bug：Cockpit Questions tab 回答按钮无 handler
- [x] **典韦** dispatch `d4d93723` — Cockpit 完整体检 audit（pre-emptive，不要等 user 发现）
- [x] **赵云** dispatch `22e7791c` — Spike + 实施：给 codex worker 装 MCP browser server，开 UI E2E 能力
- [x] **典韦** dispatch `5a19af15` — Audit 后续：补 4 个 Cockpit tab 组件测试 + POST answer route 测试
- [x] **关羽** dispatch `551b829d` — Phase C-2.5 wave 2：ActionBar + IdeasTab + DecisionsTab dead handlers + 3 个 POST endpoint
## Open（user 回来决定）

- [ ] 配置 `~/.config/hive/feishu.json` → 测真飞书 e2e（M7 blocked）
- [ ] HippoMind workspace 让那边 orch retrofit `.hive/plan.md`（runtime 重启后自动 seed stub）
- [ ] 是否派关羽 export refactor（mouse normalization / port-in-use formatter / terminal-stream-hub binary 3 个私有函数）— 典韦点名要 export 才能直测
- [ ] PM 体系 Phase C-3b（A4-A6 主动 trigger：milestone 完成自动 baseline 体检 / 月度 archive cron / cross-workspace drift）— 观察 1 周 LLM 自觉性后再决定（M8）
- [ ] Marketplace 深度调研是否回灌（M11，独立于 PM 体系决定）
- [ ] Cockpit Reports tab 要不要做（M12, Q2 low priority）
- [ ] 9 个 🟡 中风险 event handler 是否补修（等 logger 抓到证据）
- [ ] multica #4 #5 #6 #7 #8 中优先级（UX 偏好性强）

## Done

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
