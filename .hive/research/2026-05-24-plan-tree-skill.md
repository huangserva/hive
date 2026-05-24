# 调研：plan-tree skill 借鉴评估

**日期**: 2026-05-24
**触发**: user 让看 `~/development/plan-tree` (Anthropic Skill 格式 markdown 治理工具) 对 HippoTeam PM 体系的价值
**关联**: plan.md → M6 PM 体系扩展 + pm-master-plan-2026-05-24.html

## 问题

plan-tree 是个 markdown 规划文档治理 skill。对我们刚做完的 PM Phase A+B 有什么可借鉴？哪些概念该融合进我们的 PM 体系？

## 探索过程

派关羽完整 inventory plan-tree 源码 + 跟 HippoTeam PM 体系做映射对比：
1. 读 `~/development/plan-tree/SKILL.md`（含完整核心 workflow + intent routing + filesystem 约定）
2. 读 `~/development/plan-tree/agents/openai.yaml` + `references/*.md`
3. 列出 plan-tree 的 16 个核心概念
4. 每个概念跟 HippoTeam Phase A+B 已有的对比
5. 🟢🟡🔴 借鉴档评分 + top 推荐

## 结论

**一句话定位**：plan-tree 是跨项目 markdown 规划文档知识树治理 skill，价值在"文档角色 / intent routing / archive 与一致性规则"，**不适合整体迁移**进 HippoTeam。

**16 个核心概念分档**：

- 🟢 **4 条强推荐借鉴**（直接补 HippoTeam 空白）：
  - `open-questions.md` — AI 自己办不了的问题等 user 拍板（**最关键**，避免 orch 误派）
  - `ideas/inbox.md` + promote 规则
  - `baseline/` — 5 子文档稳定项目上下文
  - archive discipline — 主动 audit + 归档
- 🟡 5 条看情况：implementation-status field / plan audit/consistency repair / repo hygiene plan / decision index / retrieval headers
- 🔴 3 条跳过：整体迁移到 docs/plantree/ / 多 plan root / large-tree governance

**不替换 .hive/plan.md**：PM Phase B UI 已围绕这个文件工作，迁移破坏太大。

**Phase C 最小形态不需要 UI**：先加 3 类模板 + ORCHESTRATOR_RULES 维护规则；等使用中出现膨胀再补 PlanDrawer count/indicator。

## 影响

- 直接驱动 PM C-1 设计：4 个新文档类型（open-questions / ideas / baseline / archive）+ 6 节 ORCHESTRATOR_RULES 扩展
- 启发 master plan synthesis 重新 framing：人 CEO + AI COO + 完整工具箱 + Cockpit 控制台
- 拒绝整体迁移避免了破坏现有 PM Phase B UI 投资

## 参考

详细对比表 + 每条概念评分 + 推荐落地形态：`.hive/reports/plan-tree-evaluation-2026-05-24.html`
