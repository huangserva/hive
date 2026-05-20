# Handoff（user 出门期间 Orchestrator 自主完成）

时间：2026-05-20 下午

## 已完成（已 commit）

| commit | 内容 |
|---|---|
| `b9e5081` | Guard terminal IO socket against dead-PTY writes（race fix） |
| `a98dad7` | Add runtime file logger and guard event handlers against uncaught throws |
| `<本 commit>` | Add Hive workspace tracking files（.hive/ 三件套） |

a98dad7 内容速览：
- 新文件：`src/server/logger.ts`、`src/server/sqlite-schema-v19.ts`、`tests/unit/logger.test.ts`
- 全局 `uncaughtException` / `unhandledRejection` 钩子注册在 `src/cli/hive.ts`
- 日志落点：`~/.config/hive/logs/runtime-<port>.log`（`HIVE_LOG=0` 可禁）
- `agent_runs.error_tail` TEXT 列：PTY 非零退出落最后 ~200 行
- **5 个未 catch handler 全部加 try/catch + logger**：
  - `agent-manager-support.ts`：pty.onData / onError / onExit（分段 try，cleanup 不会被一处抛中断）
  - `terminal-ws-server.ts` / `tasks-websocket-server.ts`：server.on('upgrade') 顶层 catch
- 测试：pnpm check + 115 files / 553 tests pass

## 关羽产出的 patch（你 deploy 用）

```bash
git -C ~/development/hive apply /tmp/hive-serva-logger.patch
```

- 1275 行，包含上面 a98dad7 的全部改动（**不含** terminal-stream-hub.ts 那条 race fix —— 那个是从 hive 同步过来的，hive 自己已有）
- `git -C ~/development/hive apply --check` 已验证可干净 apply

## 你回来要做的关键决策（**我没做**）

### 1. Deploy patch 到 user 实际跑的 hive 实例

当前 4010 端口 runtime 的 cwd 是 `~/development/hive` 而非 hive-serva，**只 deploy 到 hive 才会生效**：

```bash
git -C ~/development/hive apply /tmp/hive-serva-logger.patch
# 然后重启 4010 让 logger / 钩子生效
```

### 2. 重启 4010 ⚠️ 破坏性

重启会**杀掉所有 workspace 的 worker PTY**（不只是 hive-serva 这边），包括 Orchestrator 自己（即当前会话）。重启前确认：
- 所有 worker 的活都干完了
- 你想保留的终端 scrollback 已经截图/记下来
- 重启后所有 agent run 会被新 runtime sweep 成 error 状态（再加 5 条到 DB）

### 3. `hive-vs-hive-serva-report.html` 是否 commit

40KB 一次性调研产物，**没有** commit，留在 working tree。建议 `mv` 到 `.hive/reports/` 或者直接删。

### 4. 9 个 🟡 中风险 hit 是否补修

典韦扫出的 socket.on('close')、setTimeout/setInterval 回调等中风险路径**没修**（按你的指示只修高风险 + 顶层 upgrade handler）。优先级低，可以等下次崩溃 logger 抓到证据再针对性补。

## 验证 logger 工作（部署后）

```bash
ls -la ~/.config/hive/logs/                    # 看 runtime-4010.log 是否生成
tail -f ~/.config/hive/logs/runtime-4010.log   # 跟踪新日志
sqlite3 ~/.config/hive/runtime.sqlite \
  "SELECT substr(run_id,1,8), status, error_tail FROM agent_runs WHERE status='error' ORDER BY started_at DESC LIMIT 5;"
# 新 error run 的 error_tail 应有 PTY 输出内容
```

## 顺手提醒

- `team` 命令在 PTY 注入的 PATH (`hive/dist/bin`) 里找不到，因为 `dist/bin` 不存在；当前所有 worker 都得用 `npx tsx src/cli/team.ts` 绕过。这是 bug 不是 feature，单独修。
- 我（Orchestrator）这条会话所在的 PTY 是 `c5638c71`（DB 里目前 running 状态），重启 4010 后会被 sweep 成 error。
