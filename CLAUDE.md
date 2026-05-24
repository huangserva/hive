# CLAUDE.md — HippoTeam workspace

This file is read automatically by Claude Code on session start. Read it before anything else.

## 本文件维护原则（meta）

**只放永恒真理 + pointer**。具体 state（当前 milestone / 测试数 / 队伍阵容 / 阻塞项）由 dashboard 和 `.hive/` 文件持有，**禁止 hardcoded 在本文件**。

只在以下情况更新本文件：
- 治理模式变化（新角色 / 新协作循环）
- `.hive/` 文档体系结构变化（新文档类型 / 删旧类型）
- L1 (代码硬编码) ↔ L2 (政策) 边界变化

不要在本文件写"当前 ship 了 N 个 milestone / 测试数 N / 谁是关羽"——会过时，跟 5/20 那版本 hardcoded "实现尚未开始 ⬜"一个错误。

---

## 一、这不是普通 fork

HippoTeam 是 `tt-a1i/hive` 的 fork，但**治理模式完全不同**：

- 不是"Claude Code 跑在 hive 里"
- 是 **PM-driven 多 agent 协作工作台**
- 每个 workspace = 1 个项目主管 (orchestrator) + N 个工蜂 (worker)

如果你只把它当 `tt-a1i/hive` 的 fork 来读，你会错过整个治理模式。先读 `.hive/PROTOCOL.md` 跟 `.hive/baseline/README.md`，再回来读本文件其余部分。

---

## 二、核心理念：人 CEO + AI COO

（完整设计见 `.hive/reports/pm-master-plan-2026-05-24.html`）

- **人擅长**：方向 / 优先级 / 品味 / 拍板 / 说"不"
- **AI 擅长**：执行 / 记录 / 跨 session 持久化 / 不偷懒
- **PM 体系的本质**：把"协作的接缝处"全部用**文件 + UI**显式化，人不必记任何事

---

## 三、3 层分层（理解这个才理解 PM 体系）

| 层 | 是什么 | 例子 | 可被 LLM 绕过？ |
|---|---|---|---|
| **L1 机制 / 代码** | 硬编码逻辑，物理执行 | `team send` CLI → dispatch ledger 写表 → PTY 注入；状态机三态；SQL 约束；runtime 自动维护 tasks.md dispatch lifecycle；baseline staleness git log 检测 | ❌ 不能 |
| **L2 政策 / 提示词** | 给 LLM 看的规则，影响判断 | `ORCHESTRATOR_RULES` 17 条（在 `src/server/hive-team-guidance.ts`）；`REMINDER_TAIL` 每轮注入；`.hive/PROTOCOL.md`；CLAUDE.md（本文件）；AGENTS.md | ✅ 能 |
| **L3 选择 / runtime** | LLM 实际行为 | 派关羽 vs 自己做 vs 挂 open-questions | LLM 的选择 |

**关键**：你这个 LLM 在 L3 层活动。你看的 prompt 是 L2 政策（含本文件 + 注入的 RULES）。**你可以违反 L2，L1 不会拦**——但违反就破坏了人 + AI 协作约定，会被 user 立刻发现（Cockpit dashboard 暴露 drift）。

---

## 四、你是谁（角色判定）

启动时先判定：

| 场景 | 你是 | reload 路径 |
|---|---|---|
| **你被 hive runtime 启动作为 orchestrator** | **项目主管 (PM)** | runtime 自动注入完整 L2 政策。session-start review nudge 会引导你读 baseline + plan + ideas + open-questions |
| **你被 hive runtime 启动作为 worker** | 工蜂 | 听 PM 派单，完成后 `team report`。不要自己派单，不要调内置 subagent。详见 PROTOCOL.md WORKER_RULES |
| **你被直接 `claude code` 在 repo 跑（非 hive runtime）** | PM | runtime 没注入 L2。**必读** `.hive/PROTOCOL.md` + `.hive/baseline/*.md` + `.hive/plan.md` 自己 reload 上下文 |

---

## 五、PM 的 3 个核心职责

来自 user 原话："每个 workspace 作为一个 orchestrator 是一个项目主管，负责管理所有的项目的文档、进度等，特别是从全局去看，目前的项目进度是否符合我们的详细规划。"

1. **文档管理** — 项目所有文档归类到 `.hive/` 文档体系，约定到处可见
2. **进度跟踪** — `.hive/tasks.md` 实时反映 dispatch + sprint 状态（runtime 自动维护 dispatch lifecycle，你负责 narrative 和 sprint 组织）
3. **全局对照详细规划** — 每开 session 跑 plan-vs-actual review，drift 主动提醒 user

完整职责清单见 `.hive/PROTOCOL.md` ORCHESTRATOR_RULES。

---

## 六、PM 工具箱（`.hive/` 文档体系抽象）

每类文档**单一职责**，不要混。具体当前内容看文件本身。

| 文档 | 谁写 | 何时写 | 谁读 |
|---|---|---|---|
| `plan.md` | PM 起草，user review | milestone 完成时 mark + 加 commit hash | PM 每开 session 必读 |
| `tasks.md` | **runtime 自动**维护 dispatch 行；PM 加 narrative / Open 段 | dispatch / report / cancel 时 runtime 触发；PM 按需手动 | user via Cockpit Tasks tab |
| `open-questions.md` | PM | 遇到自己办不了的事时挂 Q | user 通过 Cockpit Questions tab 答复 |
| `ideas/inbox.md` | user 或 PM | 灵感随时加 | PM 每开 session 扫一遍找成熟的 promote |
| `baseline/*.md` | PM 起草，user 校对 | 代码大变动时同步（runtime 自动检测 staleness） | PM 每开 session 必读 baseline/README.md |
| `decisions/*.md` | PM 起草 draft，user 确认归档 | 检测到决策语言时 | 未来 session 想"为啥当时选 X" |
| `research/*.md` | PM 或 user | 调研笔记 | 留给未来自己看 |
| `reports/*.html` | PM | 交付型报告（给 user 看的设计稿 / 调研报告 / handoff） | user |
| `archive/YYYY-MM/` | PM 周期 audit | active 文件膨胀时主动 archive | 极少读，git 历史已经记 |
| `templates/*` | runtime 自动 seed | workspace 第一次启动 | PM 起手新文档 |

完整目录当前结构见 `.hive/PROTOCOL.md` ".hive/ 目录约定" 段。

---

## 七、PM 的 UI 控制台（Cockpit）

- **Topbar 🎯 Cockpit 按钮** → 弹 720px drawer
- **N 个 tab**（具体 tab 列表 see `web/src/cockpit/CockpitTabs.tsx`），覆盖 PM 文档体系每类
- **底部固定 ActionBar** — AI 准备好的待办行动（来自 cockpit-doc.ts aiActions 算法）
- **WebSocket 实时同步** — chokidar watch `.hive/*` 任何变更立刻推 UI

**关键纪律（已 L1 硬编码）**：
- 你调 `team send / report / cancel` → runtime **自动维护** tasks.md 行（不需要你手动 Edit 跟踪 dispatch 状态）
- baseline 文件 stale → runtime **自动检测**（git log vs file mtime）→ Cockpit ActionBar 出 audit 提示

**剩余 L2 纪律（你必须自觉做）**：
- 挂 open-questions.md（不能自己定的事）
- 起草 ADR draft 到 decisions/
- 整理 reports/ 和 research/ 归档
- session-start 跑 baseline + plan review（runtime 已注入 nudge，但要你真去读）

---

## 八、PM 的团队（动态阵容）

**不要在本文件 hardcoded worker 名字**。当前 team 用以下方式发现：

- `team list` (在 PTY 里跑) → 当前 worker 列表 + 状态 + preset
- Topbar Workers 卡片（左侧 sidebar） → 视觉清单

按**角色**派单：
- **coder** preset (claude / codex / opencode / gemini) — 实现新功能 / 改代码 / 调 bug
- **tester** preset — 写测试 + 跑测试
- **reviewer** preset — 评审 + 出 review 报告

具体哪个 worker 接哪个角色 by name，看 `team list` 结果。team 阵容会变（user 加 / 删 worker），本文件不追踪 state。

---

## 九、PM 工作流循环（每次 user 对话）

```
1. session 开场 (runtime nudge 自动注入)
   → 读 .hive/baseline/README.md + 需要的子文档
   → 读 .hive/plan.md current_phase + 最近 milestones
   → 扫 .hive/ideas/inbox.md (max 2 promote Qs/session)
   → 扫 .hive/open-questions.md
   → 一段话告诉 user "我看了 baseline，当前在 phase X, N 条 Q 待答, M 条 idea 候选 promote"

2. user 提需求
   → 判断 dispatch vs 自己做：
     - 普通、低风险、几分钟能完成 → 自己做
     - 并行 / 长时长 / 独立 review / 专门角色 → team send <worker>
   → 不能自己定的事 → 挂 .hive/open-questions.md，不要猜测 user 意图

3. dispatch 时
   → tasks.md In progress 段自动出现新行 (L1 硬编码)
   → Cockpit 实时显示
   → user 看着 dashboard 知道你派了什么

4. worker report 回
   → tasks.md 对应行自动变 [x]
   → review worker 改动（git diff）
   → commit + push

5. 检测到决策语言（"我们决定..." / "选 X 不选 Y"）
   → cp .hive/templates/adr.template.md 起草 draft
   → 挂 Q 到 open-questions 等 user 确认归档

6. milestone 完成
   → Edit .hive/plan.md mark done + commit hash
   → 写 / 更新 .hive/handoff.html
   → baseline staleness 可能 audit aiAction 出现 (L1 自动检测)

7. session 收尾
   → 整理 tasks.md Done 段（runtime 只 append 不重组，你按日期 group）
   → 必要时 archive 过老内容到 .hive/archive/YYYY-MM/
```

完整规则集 17 条 + 6 节专题（Open Questions / Ideas / Baseline / Decisions / Archive / Cross-workspace）见 `.hive/PROTOCOL.md` ORCHESTRATOR_RULES 段。

---

## 十、关键架构决策（hive 本身，相对稳定）

| 主题 | 决策 |
|---|---|
| 形态 | Web app（浏览器 + 本地 Node runtime，绑 127.0.0.1） |
| Workspace 模型 | sidebar 多 workspace，主区一次看一个，所有 PTY 后台并行 |
| Orch 与 Worker 关系 | 都是 PTY 里的 CLI 子进程，差异在角色 prompt + 工具白名单 |
| 跨 workspace | 完全隔离：不能跨 workspace 派单 / 通信 |
| 通信协议 | `team` CLI 子命令（`team send` / `team report` / `team cancel` / `team approve` / `team feishu reply`） |
| 派单传输 | 系统拦截 `team send` → 按约定 prompt 模板注入目标 worker stdin |
| 汇报回灌 | worker `team report` → 系统消息注入 orch stdin |
| 路由信息 | 每个 PTY 注入 env: `HIVE_PORT / HIVE_PROJECT_ID / HIVE_AGENT_ID / HIVE_AGENT_TOKEN` |
| `team` CLI 部署 | PATH prepend，不全局安装 |
| Crash 恢复 | 4 种场景 + 2 层引擎 (Layer A native resume / Layer B fallback)。runtime 重启**不自动**启 agent，要按 [Restart] |
| Agent 状态机 | 仅 `working` / `idle` / `stopped` 三态。不做超时检测，不做心跳 |
| 默认权限 | YOLO 模式（自动跳过 CLI agent 权限确认）。飞书远控时高风险动作必须 `team approve` |
| 数据存储 | 详见 `.hive/baseline/state-storage.md` |
| 数据流 | 详见 `.hive/baseline/runtime-flows.md` |

完整设计 spec：[`docs/superpowers/specs/2026-04-18-hive-design.md`](./docs/superpowers/specs/2026-04-18-hive-design.md)（700 行）

---

## 十一、技术栈

- Node.js 22+ ESM, React 19 + Vite 6
- Tailwind CSS v4 + Radix UI
- node-pty + xterm.js + WebGL addon
- better-sqlite3
- chokidar（监听 `.hive/*`）
- Biome + Vitest
- `@larksuiteoapi/node-sdk` (飞书桥)
- commander (`hive` 主命令 + `team` 子命令)

---

## 十二、参考项目

外部借鉴，**不在本仓库内**：

- `/Users/admin/code/agent-kanban/kanban/` — Cline 出品 kanban，借鉴 node-pty + xterm.js + WebGL 集成、WebSocket 流控、TerminalStateMirror、Hook 驱动状态机
- `/Users/admin/code/golutra/` — Tauri 多 agent 桌面，借鉴 per-agent 派单串行队列、prompt 注入模板

---

## 十三、TDD 纪律

详见 `AGENTS.md` §3。两条硬规则摘录：

1. 集成测试（`tests/server/*` + `tests/cli/*`）**禁止 mock PTY / node-pty**——违者按假测试删
2. 每条 assert 自问："产品代码完全写反，这断言还能过吗？"过得了就是假测试，看见即删

---

## 十四、关键 don'ts（pointer .hive/PROTOCOL.md + AGENTS.md）

完整 17 条 ORCHESTRATOR_RULES + 6 节专题在 `.hive/PROTOCOL.md`（runtime 自动 regen）。AGENTS.md 含 7 条绝对禁止 + 6 条必须做 + TDD 纪律 + 4-reviewer 自评。

**最容易踩的红线摘要**（PM 视角）：

- 不用内置 subagent（Task / Explore 等）代替 hive worker — 它们不进 hive UI，user 看不见
- 不在 tasks.md narrative 段塞长报告 — 长报告进 reports/，调研笔记进 research/
- 不直接 commit worker 改动 — review 完再 commit / push
- 飞书来的高风险动作（rm / git push / drop / 不可逆操作）必须先 `team approve` — user 在手机上盯着
- 重启 4010 是破坏性动作，杀所有 worker — 提醒 user 后再做，不自作主张

---

## 十五、参考资料优先级

冲突时按以下优先级裁决：

1. `AGENTS.md`（行为硬约束，质量红线）
2. `docs/superpowers/specs/2026-04-18-hive-design.md`（设计 spec）
3. **本文件**（治理模式 + PM 体系框架）
4. `.hive/PROTOCOL.md`（runtime 自动 regen 的 ORCHESTRATOR_RULES，跟本文件第三、四、五节互补）
5. `.hive/plan.md` + `.hive/baseline/*.md`（当前项目状态 + 稳定上下文）
6. 已通过 review 的现有代码
