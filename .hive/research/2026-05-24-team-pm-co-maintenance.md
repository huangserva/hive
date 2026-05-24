# Team PM Co-maintenance Governance

**日期**: 2026-05-24
**触发**: paseo 调研事故后，user 要求从 reactive audit 升级为整个团队共同维护 Cockpit / PM 文档体系。
**关联**: plan.md → M13

## 问题

Cockpit 和 `.hive/` PM 文档不能只靠 orchestrator 在 worker report 后补。worker 是实际执行者，最早知道是否产生了 research、decision、plan drift 或 open question；如果不在 dispatch 和提交路径前置约束，就会反复出现报告落地但 PM working memory 没同步的 drift。

## 探索过程

设计成 5 层：

1. dispatch prompt 自动注入 PM 文档共维护要求
2. WORKER_RULES 明确 worker 是 Cockpit 共同维护者
3. pre-commit hook 拦截 reports / research 双产出违规
4. 后续把 Cockpit snapshot 注入所有 PTY agent
5. orphan detector 作为 Cockpit aiActions 兜底

## 结论

本轮实施 Layer 1 + 2 + 3 + 5；Layer 4 涉及 PTY 启动和 dispatch 额外注入，留独立 sprint。核心原则是 pre-emptive first：先让 worker 在任务入口和 commit 前被约束，Cockpit audit 只做最后兜底。

## 影响

- worker dispatch payload 会多一段 PM_DISPATCH_REMINDER。
- `.husky/pre-commit` 会阻断 staged `reports/*.html` 缺同日 `research/*.md` 的 commit。
- Cockpit aiActions 会对 orphan report 产生 high priority audit。
- 调研类产物以后必须双产出，HTML 面向 user，research note 面向未来 PM / worker。

## 参考

- 设计 HTML：`.hive/reports/team-pm-co-maintenance-design-2026-05-24.html`
- 事故背景：`.hive/research/2026-05-24-paseo-research.md`
