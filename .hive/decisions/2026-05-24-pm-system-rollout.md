# 决策：PM 体系分 phase 渐进 ship，A4-A6 active trigger 暂不做

**日期**: 2026-05-24
**状态**: 已采纳
**关联**: plan.md → M6 PM 体系 + M6.1 + M6.2 + M6.3 + M6.4

## 背景

user 提议 orchestrator 升级为项目主管（PM）：负责文档管理 / 进度跟踪 / 全局对照详细规划。

设计 master plan（`.hive/reports/pm-master-plan-2026-05-24.html`）含：
- 6 类核心文档（plan / open-questions / ideas / baseline / decisions / archive）
- Cockpit 统一 UI（6+ tabs + 底部 ActionBar）
- 6 个 AI 主动行为 A1-A6（session-start review / 自动 ADR / promote ideas / milestone baseline 体检 / 月度 archive audit / cross-workspace drift）

需要决定一次性 ship 还是渐进。

## 决策

**分 5 个 sub-phase 渐进 ship**，A4-A6 主动 trigger 暂不做：

- **Phase A**：5 个文档模板 + ensurePmDocs seed + ORCHESTRATOR_RULES PM 段（不动 UI）
- **Phase B**：plan.md drawer UI + WebSocket 推送（独立 Plan tab）
- **Phase C-1**：4 个新文档类型（open-questions / ideas / baseline / decisions / research / archive）+ ORCHESTRATOR_RULES 6 节扩展
- **Phase C-3a**：session-start review runtime nudge（仅 A1）
- **Phase C-2**：Cockpit dashboard（6-8 tabs 取代独立 Plan/Todo 按钮）

**留空**：
- **Phase C-3b** (A4-A6 active triggers)：milestone 完成自动 baseline 体检 / 月度 archive cron / cross-workspace drift。**先观察 1-2 周 LLM 在 C-1 RULES 引导下 A2-A6 自觉性是否足够**，靠不住再加 runtime trigger

## 理由

1. **渐进可控**：每 phase 后 user 都能 review + 决定是否继续，一次 ship 全部风险大
2. **避免 over-engineering**：A4-A6 真做了 trigger 加 cron / file watcher 会增 runtime 复杂度，先看 prompt 引导是否够
3. **观察期**：LLM 自觉性是个 empirical question，先跑 1 周观察 drift 实际频率再决定
4. **C-3a 必做**：session-start review 是核心，LLM 看 system prompt 不会主动跑（user 一开口问别的事 orch 就忘了），runtime nudge 强制触发

## 已知代价

- 多个 dispatch round 串行较多 sequencing
- C-3b 留空意味着 A2-A6 现在靠 LLM 自觉，可能 drift（已观察到一次 today: ADR / research / archive 都没主动起草）

## 结果

shipped commits:
- M6 Phase A: `82fc5a2`
- M6.1 Phase B: `588a9c9`
- M6.2 Phase C-1: `82fc5a2` + `64c7236`
- M6.3 Phase C-3a: `be1d633` + `9d1467b`
- M6.4 Phase C-2: `7d7ba26` + `b5898c6` + `34f7c0d`

加上 M9 完整性补全 + M10 i18n + L1 硬编码 candidate 1+2，总计 1048 tests。

C-3b 留观察期：实际观察期内 A2 (ADR draft) 没主动做（本 ADR 是 user 提示后 retroactive 补的），需要补 trigger 或加 RULES 强度。
