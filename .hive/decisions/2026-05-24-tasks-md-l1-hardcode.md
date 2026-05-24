# 决策：tasks.md dispatch lifecycle L1 硬编码，不靠 LLM 自觉

**日期**: 2026-05-24
**状态**: 已采纳
**关联**: plan.md → L1 hardcoding candidate 1

## 背景

PM Phase C-1 ORCHESTRATOR_RULES 加了 "你必须实时 Edit .hive/tasks.md 反映 dispatch 状态" 规则（L2 政策）。

但 user 立刻就发现 drift："你说的 task #10 我怎么在 todo 里看不到？" — orch（我）派了 task 但忘 sync tasks.md。

讨论时 user 提出 "Cockpit 是否有硬编码需求，不完全放在 L2 ?"，引发 3 层分层讨论：
- L1 机制 / 代码（硬编码不可绕过）
- L2 政策 / 提示词（LLM 可绕过）
- L3 LLM 选择（LLM 实际行为）

## 决策

把 tasks.md dispatch lifecycle 维护 **从 L2 升到 L1**：
- `team send` 成功 → runtime 自动追加 `- [ ] **<worker>** dispatch `<id8>` — <task>` 到 ## In progress
- `team report` 成功 → runtime 自动把对应行从 `[ ]` 改 `[x]`
- `team cancel` 成功 → runtime 自动改 `[~] ⊘ <reason>`

ORCHESTRATOR_RULES 软化为："runtime 自动维护 dispatch lifecycle 行；你不需要手动 Edit 追踪 dispatch 状态，但仍可：加 ## Open 段、整理 ## Done 段、加 narrative 注释行"。

## 理由

1. **L2 永远不够**：LLM 偷懒就 drift，提示词加多严也防不住每次 dispatch 都记得 sync
2. **L1 物理兜底**：runtime 调用是确定性的，dispatch / report / cancel 必触发文件 update
3. **保留 LLM curatorial 空间**：runtime 只 append / 改 checkbox，不动其他行。orch 仍可加 narrative / Open 段 / Done 段重组
4. **节省 LLM token**：不用每轮提醒 "记得 sync tasks.md"，prompt 更短
5. **跟 hive 设计哲学一致**：hive 已有大量 L1 硬编码（状态机三态 / dispatch ledger / SQL 约束），tasks.md sync 属于同类

## 已知代价

- tasks.md 变成 machine-curated（行格式固定）
- 跨进程 file lock 没做，多个 runtime 同时写同一 workspace 会 race（MVP 单 runtime 安全）
- runtime 只 append/update，不重组 Done / 不归档 cancelled（仍需 orch 周期 curatorial cleanup）

## 结果

shipped commit `56d2d7f` candidate 1 + 候选 2 baseline staleness 一起：
- `tasks-file.ts` 加 recordDispatchSent / recordDispatchDone / recordDispatchCancelled
- `team-operations.ts` 接钩 dispatchTask / reportTask / cancelTask
- `hive-team-guidance.ts` RULES 软化
- 27 个新测试（commit `169824f`），1048 tests 全过

后续：observation — 1 周看 drift 是否真的消失。若 orch 把 ## Done 段维护得乱 / 把 cancelled 行不主动归档，考虑加更多 L1。
