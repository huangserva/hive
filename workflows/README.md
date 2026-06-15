# HippoTeam workflow scripts

`workflows/` 是 Opus 编排者维护的可复用工作流脚本库。每个 `*.mjs` 文件是一条固定控制流：把 fan-out、judge、synthesize 等步骤写死在脚本里，让 andy 这类 `claude-workflow` agent 在执行者模型上运行。

## 触发约定

PM 给 workflow agent 派单时可以写自然语言：

```text
跑工作流 code-review-3x，参数 file=src/server/routes-team.ts
```

workflow agent 应把它翻译成：

```js
Workflow({
  scriptPath: '<repoRoot>/workflows/code-review-3x.mjs',
  args: { file: 'src/server/routes-team.ts' },
})
```

也可以直接给 JSON 参数：

```text
跑工作流 code-review-3x，参数 {"file":"src/server/routes-team.ts"}
```

## 参数规范

Claude Code 的 `Workflow({ scriptPath, args })` 在 scriptPath 模式下会把 `args` 作为 JSON 字符串注入脚本。每个脚本开头都必须先 normalize：

```js
const wfArgs = typeof args === 'string' ? JSON.parse(args) : (args ?? {})
```

不要假设 `args` 已经是对象。新脚本沿用这个模式，避免参数在生产触发时失效。

## 现有脚本

### `code-review-3x.mjs`

参数：

- `file`：仓库相对路径。默认值仅用于无参调试。

流程：

1. `Review`：并行启动 3 个审查角度：正确性、安全、简化。
2. `Synthesize`：把 3 份结果去重、按严重度排序，合成给 PM 的优先级清单。

适用派单：

```text
跑工作流 code-review-3x，参数 file=web/src/worker/WorkersPane.tsx
```

## 新增脚本 checklist

1. 文件名用稳定短名：`<name>.mjs`，触发名就是 `<name>`。
2. 顶部导出 `meta`，写清 `name`、`description` 和 `phases`。
3. 第一段 normalize `args`，再读取具体参数。
4. 控制流写死在脚本中；叶子任务用 `agent()`、并发用 `parallel()`，阶段用 `phase()` 标记。
5. `return` 一个可序列化对象，便于 workflow agent 汇总进 `team report`。
