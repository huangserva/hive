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
