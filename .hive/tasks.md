# Tasks

## In progress

- [ ] **关羽**: 修 worker status 卡 working 不恢复 idle 的 bug。Orchestrator 已定位根因（markAgentStopped 不清 pending + markAgentStarted 用残留 pending 推算 status，没有 dispatch cleanup 机制）。让关羽选 A/B/C 方案，写复现测试 + 修复 + 出新 patch `/tmp/hive-serva-pending-fix.patch`（不叠加 logger patch）。

## Done

- [x] hive-serva 工作树清理 → `747f492` Archive comparison report 到 `.hive/reports/`
- [x] hive 仓库 deploy → 3 个 local commit（`0fa1e5d` mode / `1806dc6` race fix / `9478a77` logger 套件）
- [x] 4010 runtime 重启验证 → logger 真活了，`runtime-4010.log` 有 `runtime started` 行
- [x] **关羽**: P0 logger + 5 个 event handler 防崩。hive-serva commits: b9e5081/a98dad7/a607d77/6062f10（等 user push 到 huangserva/hive）
- [x] **典韦**: 全仓 event handler 未 catch 扫描 → 3 🔴 + 9 🟡。3 🔴 已修，9 🟡 等证据再决定。
- [x] **关羽**: 调研 + 报告（日志、12 commit 拆解、hive vs hive-serva、npm 1.3.0）
