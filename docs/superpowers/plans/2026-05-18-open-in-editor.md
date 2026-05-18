# Open Workspace in Editor — Implementation Plan

**Status**: Draft（等评估）
**Target release**: v1.1.6（patch；待用户拍板是否走 minor）
**Scope**: 私有仓库 only（公有同步另议）

## 1. 目标

在 Hive 顶栏加一个 "Open" split button，让用户把当前选中的 workspace 路径用外部编辑器 / 文件管理器 / 终端打开。直接对标 `/Users/admin/code/agent-kanban/kanban` 的 `OpenWorkspaceButton` 体验。

**支持目标**（12 个，按平台过滤）：

| Target | mac | windows | linux |
|---|---|---|---|
| VS Code | ✓ | ✓ | ✓ |
| VS Code Insiders | ✓ | ✓ | ✓ |
| Cursor | ✓ | ✓ | ✓ |
| Windsurf | ✓ | ✓ | ✓ |
| Finder / File Explorer / File Manager | ✓ | ✓ | ✓ |
| Terminal | ✓ | — | — |
| iTerm2 | ✓ | — | — |
| Ghostty | ✓ | — | — |
| Warp | ✓ | — | — |
| Xcode | ✓ | — | — |
| IntelliJ IDEA | ✓ | — | — |
| Zed | ✓ | ✓ | ✓ |

### 非目标

- 自定义编辑器（用户填任意 app 名）— 留后续
- "Open in Hive terminal" — 语义重复，Hive 本身是终端 UI
- 应用可用性探测 — 探测开销 ≥ 偶尔失败的代价
- 顶栏显示 workspace path — scope creep，单独议
- 公有仓库同步 — 本 PR 只发私有

## 2. 关键设计决策

### 2.1 后端按白名单 + `execFile`，**不走 shell**

Hive 现有命令执行全部用 `execFile(command, args[], options)`（`src/server/fs-pick-folder.ts`、`fs-browse.ts`、`agent-manager-support.ts`），无一处用 `spawn(cmd, { shell: true })`。继续这个范式：

- 前端只传 `{ targetId }`，**绝不传 command 字符串**
- 后端按白名单决定 `{ command: string, args: string[] }`
- 因为不走 shell，**完全不需要 quoting**（kanban 的 `quoteShellArgument` 整段省掉）
- 路径直接当 `args` 元素传，OS 内核自动按 argv 边界处理空格 / 特殊字符

mac 例子：`execFile('open', ['-a', 'Visual Studio Code', '/path/with spaces/and"quotes'])` — 安全。

### 2.2 注入式可测：照抄 `fs-pick-folder.ts`

`src/server/fs-pick-folder.ts` 导出 `RunPickCommand` 函数类型作为依赖注入参数，生产代码用真 `execFile`，单元测试 (`tests/server/fs-pick-folder.test.ts`) 注入 fake。新功能完全照抄这个 pattern。

### 2.3 Hand-rolled popover，不引 `@radix-ui/react-popover`

Hive 当前只装了 `@radix-ui/react-dialog/slot/tooltip`，没装 popover/dropdown。`NotificationSettingsButton.tsx:147-170` 自己用 `useState + useRef + pointerdown/Escape` 实现了 popover 模式。为了：

1. 视觉/交互一致性
2. 不为单一组件引依赖

→ 照搬这个手卷 pattern 做下拉。代价约 20-30 行额外代码，收益是 dep 树干净 + UX 风格统一。

### 2.4 沿用 inline localStorage + try/catch

Hive 现有偏好持久化都是 `window.localStorage` inline + try/catch（`usePaneSplit.ts`、`i18n.tsx`、`useFirstRunFlag.ts`），**没有共享 helper、没有 key 枚举**。本功能跟随这个模式，不另立 helper。

- key：`hive.openTarget.preferred`
- value：`OpenTargetId` 字符串
- 读取时 normalize（兼容拼写错误，对标 kanban 的 `ghostie` → `ghostty`）

### 2.5 Button 无共享组件，inline

`web/src/ui/` 无 `Button` primitive。Hive 现有按钮都是 inline className（`LanguageToggle.tsx:14-25` 是 canonical example：`flex h-7 items-center gap-1 rounded border px-2 text-xs font-medium ...`）。Open 主按钮 + chevron 都沿用此样式 + 自定义 split 边角处理。

### 2.6 API 设计

新增 1 个 REST route，照搬 `routes-workspaces.ts` 的模板：

```
POST /api/workspaces/:workspaceId/open
Body: { "targetId": "vscode" | "cursor" | ... }
200:  { "exitCode": 0, "durationMs": 123 }
4xx:  { "error": "...", "stderr": "..." }
```

- workspace lookup：`store.getWorkspaceSnapshot(workspaceId).summary.path`（找不到自动抛 404）
- targetId 白名单校验：未识别 → 400
- 平台不支持的 target（如 windows 上选 iterm2）→ 400
- 命令失败（exit ≠ 0）→ 返回 stderr 给前端做 toast

### 2.7 顶栏插槽

`Topbar.tsx` 当前只接 `{ hideActions, version, versionInfo }`，需要新增 `activeWorkspace?: WorkspaceSummary` prop。`MainLayout.tsx:26` 把 `app.tsx` 里的 `eff.effectiveActiveWorkspace` 透传下来。

按钮放右侧 cluster（LanguageToggle 前），`hideActions` 时同步隐藏。无 workspace 选中时按钮 disabled。

## 3. 文件改动清单

### 新增

| 路径 | 用途 |
|---|---|
| `web/src/workspace/openTargets.ts` | target 列表、平台白名单、preferred 持久化、normalize |
| `web/src/workspace/OpenWorkspaceButton.tsx` | 顶栏 split button 组件 |
| `web/src/workspace/useOpenWorkspace.ts` | 调 API + toast + state |
| `web/src/assets/open-targets/*.svg` | 12 个图标（直接从 kanban 拷贝） |
| `src/server/open-target-commands.ts` | 后端 `buildOpenCommand(targetId, path, platform) → { command, args }` + `RunOpenCommand` 注入类型 |
| `src/server/routes-open-workspace.ts` | `POST /api/workspaces/:id/open` route handler |
| `tests/unit/open-target-commands.test.ts` | 平台白名单 + 命令构造 + normalize 单元测试 |
| `tests/web/open-workspace-button.test.tsx` | 渲染 + 选 target + localStorage + 点 Open → fetch |
| `tests/server/open-workspace-route.test.ts` | 真 server + fake `RunOpenCommand` 集成测试 |

### 修改

| 路径 | 改动 |
|---|---|
| `web/src/api.ts` | 新增 `openWorkspaceInEditor(workspaceId, targetId)` |
| `web/src/layout/Topbar.tsx` | 接收 `activeWorkspace` prop + 渲染 OpenWorkspaceButton |
| `web/src/layout/MainLayout.tsx` | 传 `activeWorkspace` 到 Topbar |
| `web/src/app.tsx` | 把 `eff.effectiveActiveWorkspace` 传到 MainLayout |
| `src/server/routes.ts` | 注册新 route |
| `src/shared/types.ts` 或 `src/server/route-types.ts` | `OpenTargetId` 类型 + request/response types |
| `CHANGELOG.md` | 新增 v1.1.6 条目 |
| `package.json` | `version: 1.1.6` |

## 4. 测试策略

按 Hive 三层：

### Unit（`tests/unit/open-target-commands.test.ts`）

纯函数测：
- 每个平台 × 每个 target 的 `buildOpenCommand` 返回 `{ command, args }` 是否符合预期
- 不支持的 target 在不支持平台返回 fallback（VS Code 或 file manager）
- `normalizeOpenTargetId` 对历史拼写错误的修正（`ghostie` / `intellij_idea`）
- finder label 在 windows 是 "File Explorer"、linux 是 "File Manager"

照抄 `tests/unit/agent-command-resolver.test.ts` 的范式：mkdtemp + 真函数调用 + 断言。

### Web（`tests/web/open-workspace-button.test.tsx`）

`// @vitest-environment jsdom`，照抄 `tests/web/workspace-picker.test.tsx`：
- `vi.stubGlobal('fetch', ...)` 拦截 `/api/workspaces/:id/open`
- 渲染按钮 → 点 chevron → 选 Cursor → 断言 localStorage 写入 + 按钮图标更新
- 点 Open → 断言 fetch 调用 payload `{ targetId: 'cursor' }`
- mock 服务返回 exit code ≠ 0 → 断言 toast 出现

### Server 集成（`tests/server/open-workspace-route.test.ts`）

照抄 `tests/server/fs-pick-folder.test.ts` 的注入测试 + `tests/helpers/test-server.ts` 的真 server：
- `startTestServer({ runOpenCommand: fakeRunner })` 注入 fake
- 真 fetch `POST /api/workspaces/:id/open`
- happy path：fake 返回 exit 0 → 断言 200 + 收到正确的 `{ command, args, cwd }`
- 不存在的 workspace → 404
- 不合法 targetId → 400
- 不支持平台的 target → 400
- fake 抛错 → 500 with stderr

**严格遵守 AGENTS.md TDD 红线**：每条断言都做"产品反写还能过吗"的反例 self-check；server 测不 mock node-pty（本来就不用）；不写 `not.toThrow()` 这种恒真断言。

## 5. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 用户机器没装某个 app（如 Cursor），点 Open 失败 | `execFile` 自然失败 → toast 显示 stderr 首行（如 "Unable to find application named 'Cursor'"），UX 可接受 |
| Linux/Windows 用户群体较小，命令未充分测试 | CI 三平台都跑，单元测试覆盖每平台 × 每 target 的命令构造 |
| 跨平台多名兜底（IntelliJ CE / Ghostty 拼写 Ghostie） | 后端 `runOpenCommand` 支持 fallback 数组，主名失败试 alias（**不走 shell `\|\|` 而是显式 retry 一次**） |
| `execFile` 找不到可执行（linux `code` 不在 PATH） | 同上：execFile 失败 → toast |
| 用户在多 workspace 间切换时偏好串味 | 偏好是 **per-target（全局）**，不是 per-workspace；这与 kanban 一致，符合直觉 |
| 顶栏新增 prop 链路（app.tsx → MainLayout → Topbar）改动面 | 最小侵入；MainLayout 已经在做类似的 prop pass through |
| Radix popover 缺失，自卷 popover 可能有 a11y 缺陷 | 照抄 `NotificationSettingsButton` 已有的实现（escape / pointerdown outside / focus），不创新 |

## 6. 不做（明确排除）

- 不引入 `@radix-ui/react-popover`
- 不引入 localStorage 抽象 helper
- 不引入 Button primitive 组件（项目级 refactor 留给将来）
- 不做 path 显示在顶栏（看截图 kanban 顶栏有 path，但 Hive 已经在 sidebar 显示，重复了）
- 不做 i18n（**待评估**：Hive 看起来有 i18n 系统，标签 "Open" / 错误消息可能需要走 i18n；评估子代理请关注这一点）
- 不做 app 可用性探测
- 不发到公有仓库

## 7. 发版

走当前 1.1.x patch 节奏：

```bash
# 1. 在 release-1.1.0 分支
cd /Users/admin/code/hive-private-release
# 2. commit 所有改动
git commit ...
# 3. bump 版本
# 编辑 package.json → 1.1.6，CHANGELOG.md 加条目
git commit -m "Release 1.1.6"
# 4. 本地全绿
pnpm release:dry
# 5. tag
git tag v1.1.6
# 6. 私有仓临时切 public
gh repo edit tt-a1i/hive-private --visibility public --accept-visibility-change-consequences
git push private HEAD:main
git push private v1.1.6
# 7. 等 CI publish 成功
# 8. 切回 private
gh repo edit tt-a1i/hive-private --visibility private --accept-visibility-change-consequences
# 9. 本机验证
npm view @tt-a1i/hive@1.1.6 version
hive --version
```

## 8. 不确定点 / 给评估者的问题

1. **i18n**：Hive 有 i18n（`i18n.tsx`、`uiLanguage.ts`、`LanguageToggle`），但 NotificationSettingsButton 看起来标签是英文字面量。新组件该走 i18n 还是英文字面量？请查证。
2. **顶栏位置**：放 LanguageToggle 前 vs 后 vs 跟 LanguageToggle / Bell 之间。哪个视觉权重更合理？
3. **patch vs minor**：semver 严格说新功能是 minor（1.2.0），但 1.1.x 节奏一直 patch。倾向跟 1.1.x 节奏，但请评审权衡。
4. **多名 fallback**：iTerm2 在 `open -a 'iTerm'` 失败时要不要自动试 `open -a 'iTerm2'`？kanban 用 `||` shell 串。我们不走 shell，要不要后端显式 retry？还是直接报错让用户知道 app 名？
5. **disabled vs hidden**：无 workspace 选中时按钮 disabled 还是 hide？
6. **路径换 workspace 时偏好是否重置**：建议不重置（per-target 偏好是全局的），但请评审。
