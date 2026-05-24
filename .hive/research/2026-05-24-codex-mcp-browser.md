# 调研：Codex worker MCP browser E2E 能力

**日期**: 2026-05-24
**触发**: user 要求 Codex worker 具备真实浏览器点击 / 填表 / 截图能力，避免 Cockpit audit 只能静态 grep。
**关联**: plan.md -> M16 / decisions/2026-05-24-codex-mcp-browser.md

## 问题

Hive 的 Codex worker 如何以最低风险接入 browser MCP server，让 worker 启动后天然拥有 UI E2E 能力，同时不引入云端付费依赖、不扩大 preset schema 和 UI 范围？

## 探索过程

对比了 3 类候选：

1. `@playwright/mcp` - Microsoft/Playwright 官方 MCP server。官方文档说明它用结构化 accessibility snapshot 驱动页面，支持 navigation、click/type/fill、screenshot、keyboard/mouse、dialog、tabs、network/console/storage 等能力，并支持标准 MCP config。npm 当前 latest 为 `0.0.75`。
2. `chrome-devtools-mcp` - Chrome DevTools 官方路线。能力偏调试和性能 trace，官方文档给 Codex 安装命令 `codex mcp add chrome-devtools -- npx chrome-devtools-mcp@latest`，但要求稳定 Chrome，且连接已有浏览器时会暴露用户已登录 session。
3. Browserbase MCP - 云端浏览器。能力完整，但官方配置要求 Browserbase API key，默认 hosted endpoint 走 Browserbase infrastructure，不适合作为本地 Hive worker 默认能力。

Codex 0.133.0 支持 `-c key=value` 覆盖 `~/.codex/config.toml`，也支持 `codex mcp list` 查看外部 MCP server。实测用临时 `CODEX_HOME` 和以下 args 可被 Codex 解析为 enabled MCP server：

```text
-c mcp_servers.playwright.command="npx"
-c mcp_servers.playwright.args=["-y","@playwright/mcp@0.0.75","--headless","--isolated","--viewport-size=1440x1000"]
-c mcp_servers.playwright.startup_timeout_sec=30
-c mcp_servers.playwright.tool_timeout_sec=60
```

Hive preset 系统没有 MCP 字段。最小实现是复用 builtin Codex preset 的 `yoloArgsTemplate`，让 Codex worker 每次启动自动带上上述 MCP config。已有 DB 需要 schema migration 刷新 builtin preset。

## 结论

选择 `@playwright/mcp@0.0.75`，通过 Codex preset args 注入。它本地运行、无需 API key、能力覆盖 Cockpit UI E2E 所需的点击 / 填写 / 截图 / wait / dialog。Browserbase 暂不默认启用；Chrome DevTools MCP 适合后续性能/DevTools 专项。

## 影响

- Codex worker preset 会多 8 个启动 args，启动时 Codex 可发现 `playwright` MCP server。
- 首次使用会经 `npx -y @playwright/mcp@0.0.75` 下载/缓存 server 包；后续由 npm cache 复用。
- 使用 `--headless --isolated`，降低本地资源和隐私风险，不继承用户真实浏览器登录态。
- 本轮没有启动嵌套 Codex agent 做完整截图 demo，因为 Hive worker 边界禁止 nested CLI subagents；已用 `codex mcp list` 验证配置可解析。

## 参考

- HTML 报告：`.hive/reports/codex-mcp-browser-spike-2026-05-24.html`
- Playwright MCP docs: https://playwright.dev/docs/getting-started-mcp
- Chrome DevTools for agents: https://developer.chrome.com/docs/devtools/agents/get-started
- Browserbase MCP setup: https://docs.browserbase.com/integrations/mcp/setup
