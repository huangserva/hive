# 决策：整个团队共同维护 Cockpit / PM 文档体系

**日期**: 2026-05-24
**状态**: 已采纳
**关联**: plan.md → M13

## 背景

paseo 调研暴露 governance failure：orchestrator 派 worker 产出多份 HTML 报告，但没有同步补 `.hive/research/` note；Cockpit Questions / Ideas / Plan / Research 没有及时反映实际工作。旧模型把 PM 文档维护放在 orchestrator review worker report 之后，属于 reactive 补救，容易漏。

## 决策

采用整个团队共同维护 Cockpit / PM 文档体系的 5 层架构：

1. dispatch prompt 自动注入 PM 文档共维护要求
2. WORKER_RULES 明确 worker 文档职责
3. pre-commit hook 检查 reports / research 双产出
4. 后续把 Cockpit snapshot 注入所有 PTY agent
5. Cockpit orphan/audit aiActions 兜底

本轮实施 Layer 1、2、3、5；Layer 4 留独立迭代。

## 理由

1. worker 是最早知道任务产物和决策的人，必须在任务入口就看到 PM 文档职责。
2. pre-commit hook 能在 LLM 忽略提示词时提供 git 层硬约束。
3. Cockpit aiActions 保留为最后兜底，但不能成为主路径。
4. Layer 4 涉及 PTY 生命周期和 dispatch I/O 成本，需要单独设计和测试。

## 已知代价

- worker prompt 更长，dispatch 注入 token 成本增加。
- hook 的 reports / research 匹配以日期为主，可能对非调研 HTML 需要 ignore heuristic。
- Layer 4 仍未实施，worker 还不能自动看到完整 Cockpit snapshot。

## 结果（后写）

已实施 Layer 1、2、3、5，commit `4ffe027`。验证通过：`pnpm test`、`pnpm build`、`pnpm check`、`pnpm exec tsc -p tsconfig.build.json --noEmit`，并完成 dispatch payload / pre-commit hook / Cockpit orphan detector 手动 sanity。
