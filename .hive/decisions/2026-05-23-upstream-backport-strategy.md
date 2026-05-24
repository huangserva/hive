# 决策：upstream backport 按 domain 拆 cherry-pick，不 merge main

**日期**: 2026-05-23
**状态**: 已采纳
**关联**: plan.md → M5 Upstream backports

## 背景

upstream `tt-a1i/hive` 自我们 fork base (`53e6324`) 之后产出 31 commit，含：
- 8 条 🟢 应回灌（bug fix / hardening）
- 18 条 🟡 看情况（含 marketplace 大改 7 commit / agent 命名 / 等）
- 14 条 🔴 跳过（release notes / version bump / 上游商业叙事）

需要决定怎么处理这 31 commit。

## 决策

**按 domain 拆 cherry-pick，不 merge upstream/main 整包**。具体策略：

- Step 1 强相关 backport：`a2945fe` (team cancel) + `53e3645` (tasks WS hardening)。各自独立 commit
- Step 2 弱相关 backport：`71fdaaf` (port-in-use) + `b34cfe4` (drawer width) + `e57c6be + 7bda143` (OpenCode mouse 成组) + `4c34bf6` 部分 (terminal perf 拆开做 server-only)
- Marketplace 整包 (`99d3821` + 6 个 polish round = 429 文件 / 114k 行) **跳过**

## 理由

1. **方向已分叉**：HippoTeam 跟 upstream 有 rebrand + 飞书桥 + PM 体系 + Cockpit + 等大量差异，merge main 会产生大量 conflict
2. **marketplace 跳过**：跟 PM 体系方向冲突（marketplace 是 worker 角色市场，PM 是 orch 工作流升级），且体积巨大维护成本高
3. **按 domain 拆**：每条 backport 独立 commit + 独立 test，user 看每条都能 review，回退也容易
4. **避免 merge main 黑盒**：merge 一次性把 31 commit 全吸过来，conflict 解决时哪条改动是哪个 commit 引入难追溯

## 已知代价

- 每条 commit 都要手工解冲突（特别是 hive-team-guidance.ts / i18n.tsx / package.json 都被我们改过）
- typewriter 测试经常要 sync（upstream 改了 schema 我们已经 +1 了）
- 跟 upstream 距离越拉越远，未来更难 sync

## 结果

shipped：
- Step 1: `473dc46` + `02abda0` + `24fc7d5` + tests
- Step 2: `dbc7a1e` + tests

跳过：marketplace + 4 个版本 bump + 6 条 release notes + 上游商业叙事

详见 `.hive/reports/upstream-diff-2026-05-24.html` 完整 31 commit 分类表。
