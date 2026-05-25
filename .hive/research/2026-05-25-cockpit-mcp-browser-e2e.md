# Cockpit MCP Browser E2E · 2026-05-25

## 方法

- 工具：Playwright MCP browser（browser_navigate / browser_snapshot / browser_click / browser_type / browser_take_screenshot）。
- 目标 URL：`http://127.0.0.1:4010`。
- 目标：真实浏览器验证 Cockpit M15 wave1+2 wired handlers，不写测试文件。

## 结论

总体 PASS：8 个 Cockpit tab 均渲染真实数据；Questions answer flow 通过真实 UI 提交成功；Ideas promote dialog 可打开并取消；Decisions 无 draft，按要求跳过 confirm dialog。

## 发现

1. 原夹具 `Q-E2E` 未显示：当前 `pm-questions-doc` parser 只识别 `Q\d+`，因此 UI medium 段初始为 0。
2. 为继续验证 handler，临时追加等价数字 ID `Q6` 行，通过 UI 提交 `E2E browser smoke OK 2026-05-25`，Q6 成功移动到“已答历史”。`.hive/open-questions.md` 是本次操作副作用，不随报告提交。
3. Ideas parser 当前把 idea 的说明 bullet 也解析成独立 idea，所以 “idea-4” 标题行在 UI 中显示为 I5；本次点击该可见行的 Promote 并取消。
4. Console：0 errors，2 warnings（preload unsupported as、Radix Dialog missing Description）。

## 截图清单

- 01. 首屏加载: `cockpit-e2e-01-home.png`
- 02. Plan tab: `cockpit-e2e-02-tab-plan.png`
- 03. Tasks tab: `cockpit-e2e-03-tab-tasks.png`
- 04. Questions tab 初始状态: `cockpit-e2e-04-tab-questions.png`
- 05. Questions answer dialog: `cockpit-e2e-05-questions-answer-dialog.png`
- 06. Questions answer submitted: `cockpit-e2e-06-questions-answer-submitted.png`
- 07. Ideas tab: `cockpit-e2e-07-tab-ideas.png`
- 08. Ideas promote dialog: `cockpit-e2e-08-ideas-promote-dialog.png`
- 09. Decisions tab: `cockpit-e2e-09-tab-decisions.png`
- 10. Research tab: `cockpit-e2e-10-tab-research.png`
- 11. Baseline tab: `cockpit-e2e-11-tab-baseline.png`
- 12. Archive tab: `cockpit-e2e-12-tab-archive.png`

## HTML 报告

- `.hive/reports/cockpit-mcp-browser-e2e-2026-05-25.html`
