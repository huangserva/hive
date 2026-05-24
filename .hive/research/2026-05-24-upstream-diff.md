# 调研：upstream tt-a1i/hive 31 commit 差异

**日期**: 2026-05-24
**触发**: user 问 "原 hive 目前是不是有变化"，想看 fork base 后上游做了什么
**关联**: decisions/2026-05-23-upstream-backport-strategy.md + plan.md → M5

## 问题

1. upstream `tt-a1i/hive` HEAD 是什么版本？
2. 自我们 fork base (`53e6324`, 5/20 21:27) 之后有多少 commit？
3. 哪些值得回灌？哪些跟我们方向冲突跳过？

## 探索过程

派关羽：
1. git remote add upstream-tta1i + fetch（HEAD = `9075611`, 5/22 21:44 "Fix marketplace import test casing"）
2. git log 拿到 5/20 21:27 到 5/22 21:44 之间所有 commit
3. 每条 commit 评估对 HippoTeam 的相关性
4. 输出 🟢🟡🔴 三档分类 HTML

## 结论

31 commit 分布：
- **🟢 8 应回灌**：a2945fe (dispatch cancel) + 53e3645 (tasks WS hardening) + 71fdaaf (port-in-use) + 4c34bf6 (terminal perf) + e57c6be + 7bda143 (OpenCode mouse 成组) + b34cfe4 (drawer width) + 535cfca (已覆盖)
- **🟡 18 看情况**：含 marketplace 大改 7 commit + agent 命名 + restore task graph entry + etc
- **🔴 14 跳过**：release notes / version bump / 上游商业叙事 / cross-agent memory roadmap / npm trusted publishing

**Top 3 强相关**：
1. a2945fe + 53e3645 (Step 1): dispatch cancel 是 PM 体系协调税补漏，tasks WS hardening 是 PM dashboard 基础数据流
2. 71fdaaf + b34cfe4 + e57c6be+7bda143 + 4c34bf6 部分 (Step 2): UX 改善

**marketplace 跳过**：跟 PM 体系方向冲突（marketplace 是 worker 角色市场，PM 是 orch 工作流升级）+ 429 文件体积过大

## 影响

- 直接驱动 M5 Upstream backports 实施（Step 1: `473dc46`+`02abda0`+`24fc7d5` / Step 2: `dbc7a1e`）
- 确立 "按 domain 拆 cherry-pick" 上游 sync 策略（见 decisions/2026-05-23-upstream-backport-strategy.md）
- marketplace 决策 open，user 看完 plan-tree 评估后倾向跳过

## 参考

详细分类表 + 每条 commit 一句话理由：`.hive/reports/upstream-diff-2026-05-24.html`
