# 决策：Codex worker 默认接入 Playwright MCP browser server

**日期**: 2026-05-24
**状态**: 已采纳
**关联**: plan.md -> M16

## 背景

Cockpit audit 暴露出仅靠静态 grep 和代码推断无法可靠判断 UI handler 是否真的可点、dialog 是否弹出、表单是否提交。user 要求 Codex worker 具备真实浏览器 E2E 能力，用于后续验证 Questions / Ideas / Decisions / ActionBar 等 Cockpit 交互。

## 决策

选择 `@playwright/mcp@0.0.75` 作为 Codex worker 的默认 browser MCP server。通过 Codex builtin preset 的启动 args 注入 MCP config：

```text
-c mcp_servers.playwright.command="npx"
-c mcp_servers.playwright.args=["-y","@playwright/mcp@0.0.75","--headless","--isolated","--viewport-size=1440x1000"]
-c mcp_servers.playwright.startup_timeout_sec=30
-c mcp_servers.playwright.tool_timeout_sec=60
```

## 理由

1. Playwright MCP 是 Playwright 官方维护路线，能力覆盖 navigation、click、fill/type、screenshot、keyboard/mouse、dialog、tabs、network/console/storage。
2. 本地 `npx` 启动，不需要 Browserbase API key，不默认消耗云端费用。
3. `--headless --isolated` 不继承用户真实浏览器 profile，适合 Hive 本地 workspace 工具的默认安全边界。
4. 复用现有 `yoloArgsTemplate` 可以避免本轮扩 preset schema 和 UI；schema v22 只刷新 builtin preset，blast radius 小。

## 已知代价

- Codex worker 启动参数变长，首次使用会触发 npm 下载/缓存 `@playwright/mcp@0.0.75`。
- MCP tool schemas 会增加 Codex 上下文负担；只适合需要真实 UI 交互的 audit / E2E dispatch。
- 目前是 Codex preset 级启用，不是每个 worker 可单独开关。若未来资源占用明显，需要扩 preset schema 加 `mcpServers` 字段和 UI 开关。
- 本轮未默认接入 Chrome DevTools MCP 的 performance trace 能力；如要查性能/Network 细节，可另开专项。

## 结果（后写）

已实施 builtin Codex preset + schema v22 migration + tests。`codex mcp list` 在临时 `CODEX_HOME` 下可识别 `playwright` server 为 enabled。完整真实浏览器点击 demo 需要重启/新建 Codex worker 后由 orchestrator 派发，因为当前 Hive worker 不允许启动 nested CLI subagent。
