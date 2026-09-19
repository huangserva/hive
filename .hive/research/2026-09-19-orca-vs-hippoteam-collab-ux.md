# 调研：HippoTeam (hive-serva) vs Orca — 协作交互模型与使用体验

**日期**: 2026-09-19
**触发**: user 指出一个实测到的入口差异——hive 里 worker `team report` 会把汇报正文注入主管终端输入（老板打字被截），Orca 里 worker 消息只落 inbox、coordinator 主动拉、不碰终端输入。要求补齐"一个老板 + 一个 AI 主管 + 多个 AI worker"这一层的工作方式与 UX 差异。
**关联**: `.hive/reports/2026-09-19-orca-vs-hippoteam-collab-ux.html`（交付报告，给 user 看）；`.hive/decisions/draft-2026-09-19-worker-report-pull-not-push.md`（同方向的 draft ADR）

## 问题

前置两份审计（`orca-vs-hive-codeaudit-2026-09-14.md`、`2026-07-03-orca-vs-hippoteam-codeaudit.md`）已经把架构、调度、能力边界比过，结论采信不重审。缺的是：**两侧的"工作方式"是什么样、老板/主管/worker 三方各看到什么、UX 在哪里分叉。**

## 方法

纯静态阅读 + CLI 自检，未改任何产品代码、未 commit。

- 只读层：两份前置审计 + `decisions/draft-2026-09-19-worker-report-pull-not-push.md`
- Orca 侧：`/Users/huangzongning/development/orca-compare`（重点 `src/main/runtime/orchestration`、`src/renderer/src/components/sidebar`、`src/shared/orchestration-fleet-*`）+ `orca skills get orchestration --full`（794 行 agent 手册，本地副本 `/tmp/orca-orch-full.md`）+ `orca worktree ps`
- HippoTeam 侧：`/Users/huangzongning/development/hive-serva`（重点 `src/server/team-operations.ts`、`agent-stdin-dispatcher.ts`、`post-start-input-writer.ts`、`hive-team-guidance.ts`、`team-authz.ts`、`cockpit-doc.ts`、`web/src/cockpit`、`web/src/worker`）
- 六维度框架：① 派单 ② 汇报回流 ③ 老板可见性 ④ 完成信号 ⑤ 隔离与并行 ⑥ 治理。每维度问四个视角：怎么做 / 老板看到 / 主管看到 / worker 看到。

## 结论（净结论）

**差别不在功能多少，而在「主管的回合由谁发起」。**

- HippoTeam：主管的回合边界**外包给 worker**。worker `team report` → runtime 无条件把 `[Hive 系统消息：来自 @X 的汇报]` 正文粘贴进主管 PTY + 自动回车。主管没有"我先忙完再读"的权利。老板正在主管窗口里打字时，半句话会被顶走或被拼成畸形输入。
- Orca：主管的回合边界**留给主管自己**。worker 的 `worker_done` 只落 orchestration DB；主管阻塞在 `check --wait` 上主动拉，`--ack` 才推进游标，未 ack 会重放同批。

**必须纠正的一处记错**：Orca 并非"从不碰终端输入"。它有一条 PTY 指针通道（写 `You have N orchestration messages. Run orca orchestration check.` + 回车），但门禁极严：① 主管必须 `lastAgentStatus === 'idle'` 且观察到是活的，否则直接 return（`mailbox-pointer-delivery.ts:46-49`）——主管在 `check --wait` 里时一个字节都不写；② 有未过滤 waiter 时批为空（`mailbox-pointer-eligibility.ts:20-24,47-49`）；③ 被 waiter 认领的类型从指针批排除。**且 Orca 也没有"人在打字"检测**——它只是把触发窗口压窄了。

**三方体感**：
- 老板：HippoTeam = 结构化看板（Topbar 徽标 + Cockpit 12 tab + `open-questions.md`），内容持久可回溯但会被打扰；Orca = 实时仪表（侧边栏 agent row 主文案 = Task 标题、Dashboard 四桶、`orca worktree ps` 的 live/unread），一眼看清谁在忙但关掉终端就没了。
- 主管：HippoTeam 只有 `report/status`（worker 侧）和 `send/list/cancel/recover/abandon/accept`（主管侧），**没有阻塞等待动词**，回合被注入驱动；Orca 有完整拉取/阻塞/ack 语义，且 `worker-list` 每行带 `projection.attention` + 可执行 `nextAction`。
- worker：两边都是"发完就结束回合"，差别是 HippoTeam 的 worker 发完立刻触发主管动作，Orca 的 worker 发完静默。

**两侧各自的不可替代项**：
- HippoTeam 独有：反自审的**代码级**强制（accept 必须引用真 reported、时序在后、指向正确的 reviewer dispatch，同毫秒用 `sequence` tie-break）、未审代码看板兜底、文件化可浏览的治理状态、PM 文档共维护 + baseline/ADR 跨 session 知识连续。
- Orca 独有：worktree 一等公民的物理隔离、"Absence never authorizes stop/abandon/retry/release" 的纪律、`check --wait` 阻塞拉取 + ack 重放语义、`nextAction` 直接给 argv。

## 影响

- 是否要改 plan：pull 改造（汇报默认不注入）已由 draft ADR 立项，本次报告是它的 UX 论证 + 边界补充（必须同时保留 Cockpit 看板与 accept gate）。
- 是否要写 ADR：`draft-2026-09-19-worker-report-pull-not-push.md` 已在，本 note 作为其证据锚点。
- 建议的低成本动作：把 `team list` 的输出从 `status + pending_task_count + last_pty_line` 扩成带 attention 类别 + 建议动作（借 Orca 的 `worker-list` 形态），不动协议字段名。

## 参考

- 交付报告（self-contained HTML，含六维度总表 + 最该借鉴 3 件事 + 最不该丢 3 件事 + file:line 锚点表 + 盲区）：`.hive/reports/2026-09-19-orca-vs-hippoteam-collab-ux.html`
- 前置审计：`.hive/research/orca-vs-hive-codeaudit-2026-09-14.md`、`.hive/research/2026-07-03-orca-vs-hippoteam-codeaudit.md`
- Orca agent 手册（794 行，含 canonical supervised loop / completion accounting / messaging-and-gates）：`orca skills get orchestration --full`，本地副本 `/tmp/orca-orch-full.md`
- 关键源码锚点：HippoTeam `src/server/agent-stdin-dispatcher.ts:44-56,218-240`、`src/server/post-start-input-writer.ts:117,193-256`、`src/server/team-operations.ts:1202,1237,1420-1434,1490+`、`src/server/team-authz.ts:14-22`、`src/server/agent-runtime.ts:53-57`；Orca `src/main/runtime/orchestration/mailbox-pointer-delivery.ts:46-49`、`src/main/runtime/orchestration/mailbox-pointer-eligibility.ts:20-24,47-49`、`src/renderer/src/lib/agent-row-primary-text.ts:52-66`、`src/shared/orchestration-fleet-attention.ts:1-80`

## 盲区（下次接手者注意）

1. **Orca 没有"人在打字"检测**（`src/main` / `src/shared` grep `userTyping / isTyping / localInput` 无命中）。别把它当成已经解决打扰问题。
2. **Orca 的 human-facing GUI 未实测**：侧边栏 row 变化、Needs You 桶触发时机都只从代码推断。
3. **Orca `cloud/` 474 个文件仍未读**（沿用 09-14 审计的同一盲区）。若那边有老板侧任务/审批 UI，③ 的结论要修订。
4. **Orca decision gate 无 UI 是"grep 为空"级的证据**，`decision_gates` 只在 DB；但 gate 到底是不是设计给人类拍的，没有反证。手册倾向于它是主管自己的 DAG 决策记忆。
5. **HippoTeam 的注入打断未实机复现**：危害路径从 `post-start-input-writer.ts` 控制流推出（就绪只看 PTY 输出、随后无条件写 `\r`），没有做"老板打字中触发 report"的实机验证。
