---
status: confirmed
date: 2026-05-27
---

# 设计 Milestone Shipped → 自动检测缺实施 Milestone

**状态**: confirmed ｜ **日期**: 2026-05-27

## 决策

扩展现有 milestone completion trigger（L1 机制），当检测到 plan.md 中有 shipped 的设计类 milestone（名字含 spec/design/设计/mockup）后面没有对应的 open 实施 milestone 时，在 Cockpit ActionBar 生成 high priority aiAction 提醒 PM 开实施 milestone。

## 背景

PM 在设计文档交付后忘记主动开实施 milestone，需要 user 手动提醒。这属于 PM 核心职责疏忽，L2 政策（"记住"）不可靠，必须 L1 硬编码保证。

## 方案

在 `src/server/cockpit-doc.ts` 的 aiActions 算法中新增一条规则：

1. 扫描 plan.md 中所有 shipped milestone
2. 对于名字匹配设计类关键词的 milestone，检查其后是否存在同系列的 open/in_progress 实施 milestone
3. 如果没有，生成 aiAction: `{ type: 'missing_impl_milestone', priority: 'high', description: 'M19i 设计已 shipped，缺对应实施 milestone' }`

## 否决方案

- sentinel 巡检加规则：L2 级别，依赖 prompt 遵守，不够硬
- PM memory/承诺：已证明不可靠
