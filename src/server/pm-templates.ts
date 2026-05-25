export const PLAN_TEMPLATE = `---
title: {{PROJECT_NAME}}
started: {{YYYY-MM-DD}}
current_phase: discovery
status: active
last_review: {{YYYY-MM-DD}}
---

## 目标
（一句话项目目标）

## 里程碑
- [ ] M1: {{milestone_description}}
- [ ] M2: ...

## Scope
- in: ...
- out: ...

## 已知 risk
- ...

## 当前 phase
discovery — 等 user 进一步明确需求
`

export const ADR_TEMPLATE = `# 决策：{{DECISION_TITLE}}

**日期**: {{YYYY-MM-DD}}
**状态**: 提案中 / 已采纳 / 已废弃
**关联**: plan.md → {{MILESTONE_REF}}

## 背景
（为什么要做这个决策）

## 决策
（具体选了什么）

## 理由
1. ...
2. ...

## 已知代价
- ...

## 结果（后写）
（实施后回填实际效果）
`

export const HANDOFF_TEMPLATE = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>{{PROJECT_NAME}} · session 交接</title>
<style>
  /* 复用 .hive/reports/*.html 现有 dark theme style — orch 起手时可以从最近 handoff 直接 cp 整套 CSS */
  body { background: #0d1117; color: #e6edf3; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  /* ... */
</style>
</head>
<body>
<h1>{{PROJECT_NAME}} · session 交接</h1>
<p>日期：{{YYYY-MM-DD}}</p>

<h2>这次做了什么</h2>
<!-- commit table or bullet list -->

<h2>当前状态</h2>
<!-- 已绿 / 待验证 / blocked -->

<h2>下一次 session 接手要做的</h2>
<!-- 具体 actionable 列表 -->
</body>
</html>
`

export const PLAYBOOK_HANDOFF_TEMPLATE = `# Handoff Playbook Brief

> 用于 worker rescue / reassign / 跨 session 续接。目标是让接手者不靠聊天上下文猜测。

## 任务

- 原 dispatch / milestone：
- 原始任务语义：调研 / investigate / 实现 / fix / review / test / other
- **硬规则：保任务语义。调研 / investigate 不得在交接中悄悄变成修复 / fix；review 不得变成实现。**

## 上下文

（为什么做这件事、user 真正关心什么、跟 plan.md 哪个 milestone 相关）

## 相关文件

-

## 当前状态

- 已完成：
- 未完成：
- blocked / stuck 原因：

## 已尝试

-

## 已做决策

-

## 验收标准

-

## 约束

- 不要触碰：
- 必须验证：
- PM 文档需要同步：
`

export const PLAYBOOK_LOOP_TEMPLATE = `# Loop Playbook Brief

> 用于 worker / verifier 循环：重复执行一组有界动作，直到具体 verifier 通过或达到停止条件。

## 目标

- 原 dispatch / milestone：
- 原始任务语义：调研 / investigate / 实现 / fix / review / test / other
- **硬规则：保任务语义。调研 / investigate 不得在 loop 中悄悄变成修复 / fix；review 不得变成实现。**

## Verifier（具体命令或检查）

- 命令 / 检查：
- 通过判据：
- 失败判据：

## 停止条件

- max iterations：
- 成功判据：
- 达到上限后的处理：

## 每轮动作

1. 运行 verifier
2. 根据失败输出做最小修正 / 等待 / 收集证据
3. 记录本轮结果
4. 再次运行 verifier

## 失败如何上报

- 最后一次 verifier 输出：
- 已尝试的轮次：
- 剩余风险 / 阻塞：
- 需要 user / PM 拍板的问题：
`

export const PLAYBOOK_ADVISOR_TEMPLATE = `# Advisor Playbook Brief

> 用于只读第二意见：找另一个 agent 对一个尖锐问题给出带理由的推荐，不派实现活。

## 问题

- 原 dispatch / milestone：
- 尖锐问题：
- 原始任务语义：调研 / investigate / 实现 / fix / review / test / other
- **硬规则：保任务语义。advisor 只给第二意见，不把 review 变成实现，不把调研 / investigate 变成修复 / fix。**

## 上下文

（为什么现在需要第二意见、user 真正关心什么、跟 plan.md 哪个 milestone 相关）

## 相关文件

-

## 已考虑 / 已否决的选项

- 选项 A：
- 选项 B：
- 已否决：

## Advisor 约束

- **只读，不改代码，不改文件，不运行破坏性命令。**
- 尽量选择不同 provider / 不同推理风格的 agent，形成真实对比。
- 输出必须包含：推荐 / 理由 / 风险 / 反例 / 需要 PM 再确认的问题。

## Orch 综合

- advisor 推荐：
- orch 裁决：
- 采纳 / 不采纳理由：
`

export const PLAYBOOK_COMMITTEE_TEMPLATE = `# Committee Playbook Brief

> 用于难题 / 卡死时召两个对立的高推理 advisor。committee 负责提出对立 plan，不直接改代码。

## 难题

- 原 dispatch / milestone：
- 卡死点：
- 原始任务语义：调研 / investigate / 实现 / fix / review / test / other
- **硬规则：保任务语义。committee 不把调研 / investigate 变成修复 / fix；review 不得变成实现。**

## 两个对立 advisor

- Advisor A 立场：
- Advisor B 立场：
- 为什么需要对立：

## 输入材料

- 相关文件：
- 已失败尝试：
- 已否决方案：
- 验收标准：

## Committee 约束

- **高推理 advisor 只读，不改代码，不改文件。**
- 先各自出 plan，再由 orch 对照 plan 做 review。
- orch 拥有综合、取舍和实现路由；不能盲从任一 advisor。

## 对照 review

- A plan 摘要：
- B plan 摘要：
- diff：
- orch 综合结论：
- 后续派给谁实现：
`

export const PLAYBOOK_EPIC_TEMPLATE = `# Epic Playbook Brief

> 用于大型多阶段工作。epic 是 plan.md 的扩展，不是替代；给一个大 M-item 增加不可变需求和阶段闸门。

## Epic 目标

- 对应 plan.md milestone：
- 用户目标：
- 原始任务语义：调研 / investigate / 实现 / fix / review / test / other
- **硬规则：保任务语义。epic planning 不得悄悄扩大需求或把调研 / investigate 改成修复 / fix。**

## 不可变需求（planning 前锁定）

- 必须满足：
- 明确不做：
- 成功定义：
- 变更流程：任何需求变更必须回到 user / PM 确认，planner / reviewer agent 不能改需求。

## 阶段计划

| 阶段 | 目标 | 交付物 | verifier | 闸门 |
|---|---|---|---|---|
| 1 |  |  |  |  |
| 2 |  |  |  |  |

## 对抗式 planning / review

- planner 输入：
- reviewer 输入：
- reviewer 不能改需求，只能指出风险、缺口和阶段闸门问题。
- PM 裁决：

## 执行记录

- 当前阶段：
- 已完成阶段：
- 阻塞：
- 下一阶段进入条件：
`

export const RESEARCH_TEMPLATE = `# 调研：{{TOPIC}}

**日期**: {{YYYY-MM-DD}}
**触发**: （什么问题催生了这次调研）
**关联**: plan.md / decisions/{{ADR_FILENAME}}

## 问题
...

## 探索过程
（数据 / 实验 / 对比）

## 结论
（一句话答案）

## 影响
- 是否要改 plan?
- 是否要写 ADR?
`

export const MILESTONE_REVIEW_TEMPLATE = `# Milestone Review · {{MILESTONE_NAME}}

**日期**: {{YYYY-MM-DD}}
**对比基线**: plan.md commit {{PLAN_COMMIT_HASH}}

## 计划 vs 实际
| Milestone | 计划 | 实际 | 差距 |
|---|---|---|---|
| ... | ... | ... | ... |

## 跑偏点
（哪些事跟 plan 不一致）

## 调整建议
（要不要改 plan / 加 ADR / 重新 align）

## Next
（review 后 user 需要拍板的事）
`

export const OPEN_QUESTIONS_TEMPLATE = `# Open Questions

> AI 自动维护此文件。每条 Q 是 AI 遇到"自己办不了、必须问 user"的事。user 在 Cockpit Questions tab 答复。

## 待 user 拍板（按优先级）

### 🔴 high — 阻塞 ongoing 工作

（暂无）

### 🟠 medium — 影响下一步规划

（暂无）

### 🟢 low — 灰度区

（暂无）

## 已答（archive 留追溯）

（暂无）
`

export const IDEAS_INBOX_TEMPLATE = `# Ideas Inbox

> 低承诺想法收集。user 或 AI 都可以加。AI 每开 session 扫一遍找成熟的 promote 到 plan / ADR。

## inbox（按加入时间倒序）

（暂无）

## promoted

（暂无）
`

export const BASELINE_INDEX_TEMPLATE = `# Baseline · {{PROJECT_NAME}}

> 项目稳定上下文。AI 启动 session 必读，代码大变动时同步更新。每个子文档限 200 行内，超了拆 + 归档。

- [module-map.md](module-map.md) — 代码模块图
- [runtime-flows.md](runtime-flows.md) — 主要数据流
- [state-storage.md](state-storage.md) — SQLite schemas + 持久化边界
- [test-gates.md](test-gates.md) — 测试要求 + 跑测命令
- [risk-hotspots.md](risk-hotspots.md) — 已知 risk + workaround
`

export const BASELINE_MODULE_MAP_TEMPLATE = `# Module Map

> 描述项目核心模块的职责边界。orch 派单时知道找哪个文件。

## 后端 (src/server/)

（待 AI 起草，从 ls src/server/ + 主要文件头注释提取）

## 前端 (web/src/)

（待 AI 起草）

## CLI (src/cli/)

（待 AI 起草）

## Shared (src/shared/)

（待 AI 起草）
`

export const BASELINE_RUNTIME_FLOWS_TEMPLATE = `# Runtime Flows

> 主要的运行时数据流，让 orch 一眼看清"消息从哪来、经过谁、到哪去"。

## Flow 1: User 在 web UI 派单

\`\`\`
（待 AI 起草数据流图，类似 feishu-bridge-plan-2026-05-21.html 的架构图风格）
\`\`\`

## Flow 2: Worker team report 回 orch

（待 AI 起草）

## Flow 3: 飞书 inbound → orch

（待 AI 起草，可以参考 .hive/reports/feishu-bridge-plan-2026-05-21.html 的图）
`

export const BASELINE_PLACEHOLDER_TEMPLATE = `# {{TITLE}}

> 待 AI 起草。保持 200 行以内；超出时拆分并把历史细节移到 .hive/archive/。

（暂无）
`
