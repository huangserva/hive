# Tasks

## In progress

- [ ] **关羽**: 修 `team` 命令 dev 模式 PATH bug。改 `agent-run-bootstrap.ts:resolveHiveBinDir` 让两种模式都解析到正确的 bin/；修 `bin/team` shim 让它 dev/prod 双模式可用（.js 存在 → import；否则 spawn tsx 跑 .ts）。新 patch `/tmp/hive-serva-team-path-fix.patch`，不叠加。

## Done

- [x] **关羽**: 修 worker 派单后 status 卡 working 的 bug。方案 B + stopped-only guard，2 文件 +15/-19。已 commit + push（hive-serva `386fd05`），patch 已 apply 到 hive 仓库（`5b3f369`），4010 重启验证生效。
- [x] hive-serva 4 commit 已 push 到 huangserva/hive（HTTPS 凭证改 SSH 后成功）
- [x] hive 仓库本地 4 commit（不 push tt-a1i 上游）
- [x] hive-serva 工作树清理 → comparison report 归档到 `.hive/reports/`
- [x] 4010 runtime 两次重启验证 → logger 落地 + pending bug 修复生效
- [x] **关羽**: P0 logger + 5 个 event handler 防崩
- [x] **典韦**: 全仓 event handler 未 catch 扫描 → 3 🔴 + 9 🟡
- [x] **关羽**: 调研报告（日志、12 commit、hive vs hive-serva、npm 1.3.0）
