# Tasks

## In progress

- [ ] **关羽**: 实现 multica 调研 #1 + #2 → 每个 worker 可选 thinking_level + Picker UI（条件显示 + 孤儿值清除）。后端 schema v20 + 启动参数注入（Claude effort / Codex reasoning effort）；UI Add Worker dialog 加 Picker。无新依赖、不动状态机 / logger / PATH。

## Done

- [x] **关羽**: multica 二轮深度调研报告（8 条具体借鉴项 + 工作量估算 + 源/对接点 + 风险评级）→ `.hive/reports/multica-borrowing-2026-05-20.html`

## Done

- [x] **关羽**: 修 dev 模式 `team` 命令 PATH bug。bin/team 改 POSIX sh wrapper 双模式可用 + resolveHiveBinDir 简化。已 commit + push（`d848735`），4010 重启后 cwd 切到 hive-serva 直接生效。
- [x] hive 旧仓库 archive 到 `~/development/hive.archived-2026-05-20`

## Done

- [x] **关羽**: 修 worker 派单后 status 卡 working 的 bug。方案 B + stopped-only guard，2 文件 +15/-19。已 commit + push（hive-serva `386fd05`），patch 已 apply 到 hive 仓库（`5b3f369`），4010 重启验证生效。
- [x] hive-serva 4 commit 已 push 到 huangserva/hive（HTTPS 凭证改 SSH 后成功）
- [x] hive 仓库本地 4 commit（不 push tt-a1i 上游）
- [x] hive-serva 工作树清理 → comparison report 归档到 `.hive/reports/`
- [x] 4010 runtime 两次重启验证 → logger 落地 + pending bug 修复生效
- [x] **关羽**: P0 logger + 5 个 event handler 防崩
- [x] **典韦**: 全仓 event handler 未 catch 扫描 → 3 🔴 + 9 🟡
- [x] **关羽**: 调研报告（日志、12 commit、hive vs hive-serva、npm 1.3.0）
