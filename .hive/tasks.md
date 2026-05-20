# Tasks

## In progress

(空)

## Done

- [x] **关羽**: 修 5 个未 catch event handler（3 🔴 pty.onData/onError/onExit + 2 🟡 server.on('upgrade')）。分段 try/catch + logHandlerError/logUpgradeError，叠加进同一个 `/tmp/hive-serva-logger.patch`（1275 行，apply-check 通过）。pnpm check / test 全过（115 files / 553 tests，新增 1 个 pty.onExit cleanup throw 回归测试）。
- [x] **典韦**: 全仓扫 socket/PTY/event handler 未 catch throw 路径。3 🔴 + 9 🟡 + 11 ⚪；3 🔴 全在 agent-manager-support.ts。
- [x] **关羽**: P0 logger + uncaught 钩子 + worker error_tail 落盘。无新依赖、不动三态。patch 已验证可干净 apply 到 hive 仓库。
- [x] **关羽**: Hive runtime 日志调查 → 无内建日志、无 uncaughtException 钩子；DB 有 5 条静默 error run，error_tail 全空。当前 4010 实例 cwd 是 `~/development/hive`（非 hive-serva）。
- [x] **关羽**: 12 commit 逐条分析 HTML 报告（4/7/1 = 功能撤除·协议补回 / 品牌文案 / devops）。
- [x] **关羽**: hive vs hive-serva + 1.3.0 调查。hive-serva 是 hive 的祖先快照（hive 在 9363632 后又走 12 个 commit）；npm `@tt-a1i/hive@1.3.0` 从 tt-a1i/hive-private 私有仓库构建。

## Open（user 回来决定）

- 是否 `git -C ~/development/hive apply /tmp/hive-serva-logger.patch` 把改动 deploy 到 user 实际跑的实例
- 是否重启 4010 runtime（会杀所有 worker，包括 Orchestrator 自己的会话）
- 是否 commit `hive-vs-hive-serva-report.html`（一次性调研产物，体积 40KB）
- 9 个 🟡 中风险 hit 是否要补修（socket.on('close')、setTimeout/setInterval 回调）
