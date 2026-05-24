# 决策：Cockpit 取代 Topbar 独立 Plan / Todo 按钮

**日期**: 2026-05-24
**状态**: 已采纳
**关联**: plan.md → M6.4 PM Phase C-2

## 背景

PM Phase B ship 后 Topbar 有独立 Plan drawer 按钮 + 现有 Todo drawer 按钮。Phase C-2 设计 Cockpit dashboard 含 8 tabs 覆盖 Plan / Tasks / Questions / Ideas / Decisions / Research / Baseline / Archive。

新增 Cockpit 后 Topbar 选择：
- A. Cockpit 取代独立 Plan / Todo 按钮（Topbar 只剩 Cockpit + Feishu + Lang + 🔔）
- B. 保留 Plan / Todo 独立按钮，加 Cockpit 平级

## 决策

走 **A** — Cockpit 取代独立 Plan / Todo。Todo 变浮动 mini drawer（右下角小图标）作为 sprint 快查兜底，保留现有 aria-label "Toggle Todo" 兼容现有 web tests。

## 理由

1. **聚焦**：3 个 PM 入口（Plan / Todo / Cockpit）分散注意力，user 不知道默认开哪个
2. **统一控制台**：Cockpit 作为 PM 控制台一站式打开看全部，符合 master plan "人 CEO + AI COO" 共享 dashboard 思路
3. **Todo mini 兜底**：sprint 快查仍是高频场景，浮动 mini 避免完全失去
4. **跟 master plan 设计一致**：PM master plan 第 5 节明确 "Topbar 取消独立 Todo / Plan 按钮，合并成一个 🎯 Cockpit 按钮"
5. **既有 web tests 不破**：浮动 Todo 保留 aria-label "Toggle Todo"，9 个现有 tests 不需要 sync

## 已知代价

- 现有 user 习惯了点 Plan / Todo 直接打开，要重新学 "进 Cockpit → 切对应 tab"
- 默认进入 Cockpit 显示 Plan tab，user 想看 Todo 要多点一次 tab

## 结果

shipped commit `b5898c6` (Phase C-2 frontend) + `34f7c0d` (tests)：
- Cockpit 按钮放 Topbar 中间，左侧 Feishu 右侧 Lang / 🔔
- Cockpit drawer 720px 8 tabs + 底部 ActionBar
- Todo 浮动 mini button 右下角

user 反馈：能正常使用，对 Todo 浮动位置无意见。

后续：Cockpit Reports tab (Q2) low priority 备选；若 user 觉得 tab 顺序不舒服可调整 CockpitTabs.tsx。
