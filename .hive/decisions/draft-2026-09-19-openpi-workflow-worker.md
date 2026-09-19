# 决策：OpenPI 作为「可换模型的 workflow worker」，替代 claude-workflow 黑盒

**日期**: 2026-09-19
**状态**: 提案中（user 2026-09-19 提出需求与期望；PM 认同方向，三处待验证 → open-questions Q25）
**线上 issue**: https://github.com/huangserva/hive/issues/2
**关联**: plan.md → idea-17 claude-workflow worker（本决策是其换底座版本）；`decisions/draft-2026-06-15-claude-workflow-worker.md`
**来源**: `research/2026-09-19-openpi-pi-integration.md`、`research/2026-09-19-openpi-memory.md`、`research/2026-09-19-orca-vs-hippoteam-collab-ux.md`

## 背景

user 原话（2026-09-19）：OpenPI 就像最早做的那个——把 HippoTeam 的 dynamic workflow 拆成一个 worker，专门只做任务分解；也可以通过 Claude Code 的壳接其他家的模型。Claude Code 的 dynamic workflow 是黑匣子但强悍，可原模型太贵。**需求**：把 OpenPI 做成可替换模型的 workflow worker，任务分解由它专门做，底层可接便宜国产模型甚至本地模型。**期望**：这样应该是最优的。

现状：idea-17 的 claude-workflow worker（andy）= Claude Code 壳 + Workflow 工具（黑盒）+ GLM 伪装成 Anthropic 端点（`GLM_API_KEY` 直打 open.bigmodel.cn/api/anthropic）。能用但：引擎不可改、模型接法是 hack、受 Claude Code 版本变化牵制。

OpenPI（openpi-dev/openpi，npm `@tt-a1i/openpi`，MIT）：Pi 的扩展包。workflow 原语 `phase / log / agent / pipeline / parallel` 与 Claude Code Workflow 几乎同形；`agent()` 支持 role（explorer / implementer / reviewer / advisor）、schema、inputs、operator、worktree；自定义角色可各自指定模型与 effort；Pi 接任何 OpenAI 兼容 provider。无周额度限制。无跨 session 长期记忆（见 openpi-memory 研究）。

## 决策（提案）

1. **新增 hive worker 预设 `pi`**（现只有 claude / codex / opencode / gemini）。Pi 进 hive 当 worker 是一切的前提。
2. **OpenPI workflow worker 作为 andy 的替代底座**：hive 把整个 workflow 当**一次** dispatch；worker 中途只 `team status`，结束才 `team report`（吸取 andy 的 mid-flight report 坑）。
3. **模型分层保留**：叶子（explorer / reviewer 等）默认便宜模型（GLM-5.x / Qwen / 本地）；控制流脚本仍允许强模型起草——是否让便宜模型自己做任务分解，**按 spike 数据定**，不预设。
4. **现有 `workflows/*.mjs` 迁移到 OpenPI API**，不重写逻辑，只换原语签名（`export const meta` / `label` / `phase` 选项 → OpenPI 的 `agent_type` / `inputs` / `ref`）。
5. **不装 pi-intercom**，跨 worker 通信仍走 hive；worker 跨任务记忆若需要，走 MemOS（开工 `memos search` / 收工一次 `memos add`），不改 OpenPI。

## 落地顺序（每步可独立验收）

- **S1** hive `pi` 预设：spawn 命令、就绪探测、注入模板、WORKER_RULES 注入；集成测试不 mock PTY。→ 派 codex，钟馗审。
- **S2** 一台 Pi worker 装 OpenPI；把 `workflows/full-project-audit-2026-06-29.mjs` 搬到 OpenPI API；叶子用 GLM-5.x 跑一遍；与当初 Claude 跑的 `reports/` 对比质量与成本。
- **S3** 叶子换本地模型（Ollama，Qwen 系列几个尺寸）再跑同一脚本；记录工具调用失败率。拿 S2/S3 数据定第 3 条"分解交给谁"。

## 理由

1. 引擎从黑盒变开源，模型接法从 hack 变原生 provider；两处脆弱同时消除。
2. 脚本同形，迁移成本低；13 份现成 workflow 是已验证资产，不浪费。
3. 成本：叶子跑便宜模型，强模型只在分解/综合两端出现；额度不再卡脖子。
4. 与 Q24（汇报改拉不推）同向：Pi 有 SDK，未来 hive 可用进程内会话替代终端注入。

## 已知代价 / 风险

- **分解质量**：便宜模型做任务分解，上限未知；这是"最优"能否成立的核心变量，S2/S3 前不下结论。
- **本地小模型工具调用不稳**：多步 tool call 常掉链子；要按尺寸测。
- **两个调度器**：hive 账本 vs OpenPI 内部 workflow 状态；边界（一次 dispatch、status 通气、结束 report）必须写进 worker 提示词并 L1 兜底。
- **OpenPI 仍年轻**（f6b49ae，2026-09-15）：API 可能变；锁版本。
- **无长期记忆**：OpenPI 不带；跨任务经验靠 hive 文档体系 + MemOS，不能指望它。

## 结果（后写）

（S2/S3 对比数据：质量 / 成本 / 工具调用失败率；据此回填"分解交给谁"）
