# 调研：multica 借鉴评估

**日期**: 2026-05-20
**触发**: user 让看 `~/development/multica` 项目对 hive-serva 有什么可借鉴
**关联**: plan.md → M2 multica 借鉴

## 问题

multica 是个独立的 multi-agent 桌面应用（Tauri + Go + React + Postgres + Electron）。对我们 hive-serva 有借鉴价值吗？哪些可借哪些不可借？

## 探索过程

派关羽做了两轮：
1. **首轮**：concept-level 调研，列 multica 的核心机制（per-agent 派单串行队列 / prompt 注入模板 / 32 项队列上限 / 128 条去重窗口）
2. **二轮**（user 不满意首轮太浅）：深度调研含具体源码路径 + 工作量估算

二轮产出 8 条借鉴项报告（HTML 交付）含 ⭐ 评分 + 工程量。

## 结论

multica 是**重型平台**（1564+ tracked files），不适合整体移植。但有 8 条可借鉴：

- ⭐⭐⭐ #1: thinking_level per-worker（让 user 给每个 worker 单独配 reasoning effort）
- ⭐⭐⭐ #2: Add Worker picker 改善（thinking_level 选项可视化）
- ⭐⭐⭐ #3: 后端错误消息透传 UI（不要把所有错都包成 "Failed to X"）
- ⭐⭐ #4-#8 其他（terminal 排序 / CLI icon polish / squad composite selector / status bar / etc）— UX 偏好性强

## 影响

- **已 ship**: #1 + #2 (`8a2295c`) + #3 (`c223f31`)
- **未 ship**: #4-#8 UX 偏好类，user 选择不做（master plan 5/20 决定 "停在 3 ⭐⭐⭐ 高优"）
- **方向影响**: 启发后续 PM 体系 master plan 的"渐进 ship + 让 user 决定 UX 类的事"思路

## 参考

详细报告：`.hive/reports/multica-borrowing-2026-05-20.html`（23K，含 ⭐ 评分 + 工作量 + 源码路径 + 改造 plan）
