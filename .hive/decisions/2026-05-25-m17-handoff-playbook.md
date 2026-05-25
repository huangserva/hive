# 决策：M17 handoff playbook first

**日期**: 2026-05-25
**状态**: 已采纳
**确认日期**: 2026-05-25
**关联**: plan.md → M17 paseo skills playbook 体系借鉴

## 背景

paseo skills playbook 调研后，M17 决定先把 5 个 playbook 中的 handoff 落地。HippoTeam 已经踩过 worker stuck / rescue / 跨 session 续接时缺少结构化 brief 的坑：接手者只能从散落的聊天、tasks.md、reports 里猜当前状态，容易丢失任务语义。

## 决策

- playbook 先作为 PM 文档制品落地，不另造 runtime。
- 先模板后自动化：第一步 seed `.hive/templates/playbook-handoff.template.md`，让 handoff brief 有固定字段。
- Cockpit ActionBar 只建议“准备 handoff brief”，不自动执行 playbook。
- M17 五个 playbook 里先做 handoff，再考虑 loop / advisor / committee / epic。

## 理由

1. handoff 对 worker rescue、dispatch reassign、跨 session 续接收益最大，且实现风险最低。
2. HippoTeam 当前 PM 体系已经有 plan/tasks/Cockpit，不需要复制 paseo runtime 才能获得 handoff 的主要价值。
3. 自动执行 playbook 可能误触发或制造噪音；ActionBar 只给建议更符合当前保守策略。

## 已知代价

- 第一版不会自动生成 handoff draft，只把模板、规则和 ActionBar 建议放到位。
- ActionBar 触发只覆盖取消/接手中的 dispatch，可能漏掉沉默 stuck 的 worker；后续可接 runtime 状态再扩展。
- `.hive/PROTOCOL.md` 由 runtime 重写，RULES 变更需要重启运行中的 4010 才让已有 orchestrator 看到。

## 结果（后写）

（实施后回填实际效果）
