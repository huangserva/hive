# 上游 tt-a1i/hive 更新 triage — 索引笔记

- 日期：2026-06-11
- 交付报告：[`reports/2026-06-11-upstream-hive-triage.html`](../reports/2026-06-11-upstream-hive-triage.html)
- 方式：3-bucket 并行（马超=worker可靠性 / 关羽=终端shell / 赵云=marketplace+UI+兜底）各读真 diff，PM 汇总+裁决分歧

## 问题

user 要：上游原版 `tt-a1i/hive`（HippoTeam 的 fork 源）有哪些更新我们用得上？分叉点 merge-base `9363632`(2026-05-17)，上游 `upstream-tta1i/main` 领先 **117 commit**。

## 探索过程

- `git fetch upstream-tta1i`（remote 已存在），`git merge-base HEAD upstream-tta1i/main` = 9363632。
- 分类：marketplace/模板 11、docs/release ~30（忽略）、其余实质 fix/feat。
- 拆 3 bucket 并行，硬规则"读 git show 真 diff 别只看 title"+ 逐条评 6 项（做什么/能否用/cherry-pick vs 重做/工作量/价值/推荐）+ 对照 fork 现状。

## 结论（核心）

HippoTeam fork 改动巨大，**上游候选绝大多数"已吸收"或"架构分叉不能直接 cherry-pick"**。真金极少：

- **拿（小、立刻）**：`535cfca` worker status idle on start（命中 idea-13 状态错）、`eac529f` shell label 回收、`ed042e2` silentReload 自动重载修复。
- **重做（M，待 user 拍）**：shell 启动防竞态最小三件套、terminal 性能/滚动子集、`c920110` CLI logos polish。
- **战略待拍**：marketplace 模板市场 — 不 cherry-pick，若做则 HippoTeam-native 重做（catalog 落到现有 role_templates/command_presets）。
- **已吸收/跳过**：a2945fe、53e3645、b34cfe4、71fdaaf(likely)、OpenCode mouse；TerminalBottomPanel/Cmd+W/Node24/hive-update/PWA大块/worker命名 全跳。

## 关键裁决：535cfca（bucket A vs C 分歧）

- 马超(A)：拿（idea-13 bug）。赵云(C)：跳过（称"会丢 pendingTaskCount/回滚已审 pending 行为"）。
- **PM 读真 diff 裁决：马超对，赵云的反对不成立**。535cfca **只改 status='idle'，pendingTaskCount 原样保留**（注释明写 backlog 仍由 count 展示）。我们 `workspace-store-mutations.ts:49` 仍 `getStatusFromPendingCount(pendingTaskCount)` → restart 后 pending>0 假显示 working。
- 教训：并行 bucket 撞出的分歧必须 PM 读源码裁决，不能信任单 worker 单方判断（赵云没看清 diff 只动 status 不动 count）。

## 影响 / 下一步

- 待 user 拍两个决策：① `535cfca` 拿不拿（PM 推荐拿，派 implement 单）② marketplace 战略（做不做 + native 重做边界）。
- hygiene：a2945fe/53e3645 等"已吸收上游 X"结论 git log 看不出，建议落进 `baseline/` 或 ARCHITECTURE.md 免未来重复 triage（马超提议）。
- 关联：[[feedback_research_no_current_state_lens]]（本单是特例——user 明确要"我们用得上的"，故 applicability 评估是目标）；idea-13（535cfca 是其"状态错"维度的现成解）。

## 参考 pointer

- 候选 commit：535cfca / eac529f / ed042e2 / c920110 / 4c34bf6 / 30ea1e5 / shell 防竞态簇(cfe23ad/69ed956/7539acd) / marketplace(99d3821 起 11)
- 上游 remote：`upstream-tta1i/main`，merge-base `9363632`
