# OpenPI “记忆”能力源码索引

日期：2026-09-19  
调查版本：`openpi-dev/openpi@f6b49ae`；补充调查 `nicobailon/pi-intercom@199279a`  
完整报告：[`../reports/2026-09-19-openpi-memory.html`](../reports/2026-09-19-openpi-memory.html)

## 问题

OpenPI 是否给 Pi worker 增加了跨 Session 的长期记忆？Tasks、Goal、Context Pivot、Session Browser、clear-context、pi-intercom 分别保存什么、保存在哪里、存活多久；装进 Hive 的 Pi worker 后，比裸 Pi 多记住什么，仍缺什么。

## 方法

- 静态审计 OpenPI 指定提交，重点读取 `extensions/tasks`、`extensions/goal`、`extensions/context-pivot`、`extensions/sessions`、`extensions/clear-context`、README“连续工作，而不是堆 Context”和 ADR 0002。
- 对独立可选项目 pi-intercom 补读 README、扩展写入路径、broker mailbox、pending ask 与 shutdown 路径。
- 区分三种概念：活跃模型上下文、Pi Session 历史持久化、跨 Session 可检索知识库。

## 净结论

**OpenPI 没有实现任何类似 memory 文件、向量库或知识库的跨 Session 长期记忆。**它的连续性本质是：把 Tasks、Goal 和阶段 brief 绑定到 Pi Session / branch 的持久历史，并提供恢复、压缩、浏览和切换这些生命周期工具。

- Tasks / Goal 通过 Pi custom entries 随 Session 文件保存；重启后 resume 同一 Session 可恢复，新 Session 没有。fork 继承分叉点历史，随后分流，不构成全局共享状态。
- Context Pivot 是同一 Session 内的主动压缩和阶段切换：brief 进入活跃上下文，旧 entries 仍在原始 Session 文件，但不会自动召回。
- Session Browser 预览旧 Session，并用 `switchSession(path)` 切过去；不会把旧 Session 合并或注入当前 Session。
- pi-intercom 是跨顶层 Pi Session 的消息通道。已送达消息留在各自 Session 历史；离线 mailbox 只在 broker 内存中，最多 256 条、断线保留 24 小时，broker 重启即失效。
- 对 Hive：恢复同一 Pi Session 时，OpenPI 多提供结构化任务、续跑目标、阶段简报和会话导航；每次新建 Session 时，它不会记住上一任务的偏好、经验或结论。
- 最省事的跨任务记忆接法是在 Hive worker 启动时执行一次 `memos search "<原始任务>" --format agent --detail simple`，结束时只把经验证且长期有用的信息用一次 `memos add` 写入。无需先改 OpenPI。

## 证据锚点

### 产品定位

- `README.md:373-384`：Tasks、Goal、Plan、Context Pivot、Sessions 的“连续工作”定位；文件/Git/测试/产物/用户反馈仍是事实来源。
- `README.md:627`：正常 Pi 使用原生 full history / compaction，不添加额外恢复提示。
- `docs/decisions/0002-native-skill-lifecycle.md:12-25`：Pi 负责 discovery、loading、persistence、compaction、reconstruction；OpenPI 不增加 body cache、provider projection、compaction reattachment 或 retention。
- `docs/decisions/0002-native-skill-lifecycle.md:40-44`：原生 skill 内容进入持久历史；compaction 可移出活跃上下文，底层 Session 历史仍在，但不保证自动重读或精确保留。

### Tasks

- `extensions/tasks/tasks.ts:1-25`：`session-tasks` entry 类型与 TaskSnapshot 字段。
- `extensions/tasks/index.ts:170-174`：从 `ctx.sessionManager.getBranch()` 恢复。
- `extensions/tasks/index.ts:210-217`：用 `pi.appendEntry` 持久化 snapshot。
- `extensions/tasks/index.ts:478-505`：`session_start` / `session_tree` 时恢复。
- `extensions/tasks/index.ts:507-529`：compaction 后把当前 active tasks 投影回下一轮上下文。
- `extensions/tasks/tasks.ts:249-328`：扫描 branch custom entries，选择最新有效 revision。
- `extensions/tasks/tasks.ts:454-467`：任务全部 done / dropped 后当前 batch 重置为空。

### Goal

- `extensions/goal/state.ts:3-12`、`22-38`：`session-goal` 类型、状态和完整 snapshot 字段。
- `extensions/goal/state.ts:237-307`：从 Session entries 恢复最新有效 snapshot。
- `extensions/goal/controller.ts:144-153`：按当前 branch 恢复并处理 defer。
- `extensions/goal/controller.ts:624-628`：`pi.appendEntry(GOAL_ENTRY_TYPE, checked)` 持久化。
- `extensions/goal/index.ts:407-447`：session start / fork / tree 的恢复和继续逻辑。
- `SETUP.md:88-92`：明确称 branch-scoped persistent objective；reload / resume 继续，fork / tree 继承但 defer。

### Context Pivot

- `extensions/context-pivot/index.ts:12`：最低 30K token 门槛。
- `extensions/context-pivot/index.ts:51-72`：用调用者 brief 构造 summary，并生成不存在的 kept entry id。
- `extensions/context-pivot/index.ts:112-125`：拦截 `session_before_compact`，设置 compaction summary 与 kept id。
- `extensions/context-pivot/index.ts:136-207`：工具语义、调用 `ctx.compact`、完成后继续下一阶段。
- `extensions/sessions/preview-loader.ts:829-843`：compaction preview 依赖 firstKeptEntryId；pivot 的不存在 id 会使普通预览不包含旧阶段消息。

### Session Browser / Clear Context

- `extensions/sessions/sessions.ts:3-12`：Session 元数据含 path / messageCount 等。
- `extensions/sessions/index.ts:460-490`、`526-537`：读取选中 Session 文件并用 `SessionManager.list(ctx.cwd)` 枚举。
- `extensions/sessions/index.ts:692-740`：异步加载 preview。
- `extensions/sessions/index.ts:1135-1164`：选中后调用 `ctx.switchSession(selection.path)`，不是注入/合并。
- `extensions/sessions/preview-loader.ts:716-827`：按 path 打开并解析活动 lineage。
- `extensions/clear-context/index.ts:43-49`、`72-80`：Ctrl+C 路由 Pi 原生 `/new`；Pi 继续负责持久化和 transcript 生命周期。

### pi-intercom（独立仓库）

- `README.md:25-27`：顶层 Session 连接本地 broker；incoming message 写入 Pi Session history。
- `README.md:51-70`：连接条件、runtime-only fallback identity、命名 alias 随 Session 持久化。
- `README.md:237-245`：ask 需要在线；断线 mailbox 是单 broker runtime 内的有界内存队列，不耐重启。
- `index.ts:1148-1154`、`1177-1201`、`2005-2028`：发送/接收消息通过 `appendEntry` / `sendMessage` 进入各自 Pi Session。
- `broker/broker.ts:26-45`：24h retention、256 mailbox 上限、1h delivery record TTL。
- `broker/broker.ts:202-208`、`978-1032`、`1113-1162`：sessions / disconnected / mailbox 是内存结构，负责排队和重连 flush。
- `broker/broker.ts:1688-1698`：broker shutdown 清空 maps 与 mailbox。
- `broker/broker.ts:1185-1228`、`broker/paths.ts:27-42`：pending ask 控制记录临时落盘到 `~/.pi/agent/intercom`；这不是消息知识库。
- OpenPI `README.md:552-560`、`SETUP.md:76-84`：intercom 是独立可选包，OpenPI 不检测、安装、配置或迁移；OpenPI child session 排除它。

## 盲区

- 这是指定提交的静态源码审计，未执行真实 Pi 的 resume、fork、pivot 和 broker restart 烟测。
- Pi Session 文件的物理目录由 Pi SessionManager 决定；OpenPI 源码只依赖 branch 和 path，因此报告不推断固定目录。
- “pivot 前历史可找回”是指原始 Session 文件尚存时可以人工取证；OpenPI 没有自动召回机制，普通 Session preview 也未必展示这些条目。
- pi-intercom 是独立项目，版本并不与 OpenPI 提交锁定；其后续实现可能变化。
