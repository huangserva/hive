# Tasks

## In progress

**飞书桥 Plan B 实施中**（设计：`.hive/reports/feishu-bridge-plan-2026-05-21.html`）

- 🟡 **关羽** dispatch `989f943e` — Review Phase 0 src/server/ + src/cli/hive.ts，改进、修 bug，不动 tests/
- 🟡 **典韦** dispatch `6adf6f13` — 扩 Phase 0 单元测试（schema v21 迁移幂等性 + bindings store edge cases + credentials BOM/权限/类型 + 可选 runtime-store 集成测试），不动 src/

Phase 0 我已写完一版基础代码（schema v21 / feishu-credentials / feishu-bindings-store / runtime-store 接线 / hive.ts startup log），18 tests 已绿 + typecheck 通过。两个 worker 并行做 review + 测试扩展。

后续节奏（user 出门，orchestrator 自主决定）：
- worker report 后 → review → commit → push
- Phase 1 派 关羽 实现 feishu-transport + route-resolver + inbound-handler
- Phase 1 实现完 → 派 典韦 加测试
- Phase 2 → Phase 3 → Phase 4 同样节奏
- 阻塞点：Phase 0/1 实现可以无飞书凭证完成，但 e2e 验证需要 user 提供凭证

## Done

- [x] **关羽**: multica #3 — 后端错误消息透传 UI。12 个 endpoint 走 `readErrorMessage`。`c223f31` 已 push。116 files / 564 tests 全过。
- [x] **关羽**: multica #1 + #2 — per-worker thinking_level 选择器 + Add Worker picker。Schema v20 + Claude `--effort` / Codex `-c model_reasoning_effort=...` 注入。`8a2295c` + `d4b64b5` 已 push。
- [x] **关羽**: multica 二轮深度调研 → 8 条具体借鉴项报告
- [x] **关羽**: 修 dev 模式 `team` 命令 PATH bug（POSIX sh wrapper 双模式 + bin dir resolve 简化）
- [x] **关羽**: 修 worker stop/restart 卡 working 的 pending bug（方案 B + stopped-only guard）
- [x] hive 旧仓库 archive 到 `~/development/hive.archived-2026-05-20`
- [x] hive-serva 全部改动 push 到 huangserva/hive（remote 改成 SSH）
- [x] **关羽**: P0 logger + 5 个 event handler 防崩
- [x] **典韦**: 全仓 event handler 未 catch 扫描 → 3 🔴 + 9 🟡
- [x] **关羽**: 调研报告（日志、12 commit、hive vs hive-serva、npm 1.3.0）

## Open（user 回来决定）

- 重启 4010 让今天所有改动生效（破坏性，杀所有 worker）
- multica #4 #5 #6 #7 #8 中优先级（UX 偏好性强，应由 user 看 demo 决定）
- 9 个 🟡 中风险 event handler 是否补修（等 logger 抓到证据）
