# 决策：M43 dispatch accept-gate + 显式 reviewer/verdict — 旁挂 review_status 字段（方案 B）

**日期**: 2026-06-13
**状态**: 已采纳（accepted，user 2026-06-13 拍板 + Phase 1 shipped `124c21b`，钟馗 3 轮审 0 blocking）
**关联**: plan.md → M43（idea-16 #2 accept gate + #3 显式 reviewer/verdict 合并 spike）；上游借鉴 `.hive/reports/2026-06-05-rive-vs-hive-serva.html` § 借鉴 #2/#3；设计 spike `.hive/reports/2026-06-13-accept-gate-reviewer-verdict-design.html`

## 背景

worker `team report` 后 dispatch 进 `reported / completed` 终态——是 worker 的"动作终态"。但"任务真完成"还需 reviewer 看 + PM 拍板：
- M34 当前用 `src/server/unreviewed-code-status.ts:82-105` 启发式时序配对（同 workspace + reviewer.createdAt ≥ coder.reportedAt 即视为已审），无精确 link、易误判
- Rive 协议把这一步硬化：worker reported 只进 `reviewable`，`done` 必须有 explicit accept event
- user 2026-06-13 拍板把 idea-16 #2（accept gate）+ #3（显式 reviewer/verdict）合并先做

设计 spike 8 个回答点见 HTML 报告；本 ADR 锁住核心架构选择。

## 决策

**采用方案 B：旁挂三字段 + 不动 8 态状态机**：

1. **`dispatches.review_status TEXT NULL`** — 取值 `NULL | pending | accepted | rejected | waived`；NULL 表示该 dispatch 不在 accept-gate 范围（gate 关 / 非 coder / report-only / 存量）
2. **`dispatches.reviews_dispatch_id TEXT NULL`** — 仅 reviewer-role dispatch 才有值，指向被审 coder dispatch.id；替代 M34 启发式（启发式降级为 backwards-compat fallback）
3. **`dispatches.accept_verdict TEXT NULL`** — JSON `{verdict, by_agent_id, at, reason, reviews_dispatch_id?}`，落在被审 coder dispatch 上

弃方案 A（加新态 `reviewable` 进 8 态机）：状态机契约破坏 + tasks.md/Cockpit/mobile 全要重判 + rollback 困难。

**Phase 1 MVP scope**：
- schema v33 migration（3 ALTER + 2 INDEX）
- team CLI `team report --reviews <id> --verdict accepted|rejected|waived --reason "..."`（reviewer 主路径）
- team CLI 新 subcommand `team accept <coder-dispatch-id> --reason "..."`（PM 旁路）
- `tasks.md` 时机：accepted/waived → `[x]`；pending/rejected → `[~]` 中间态（DISPATCH_LINE_PATTERN 已支持 `~`）
- `unreviewed-code-status.ts` 优先精确 link，启发式 fallback
- env flag `HIVE_ACCEPT_GATE=1` 开启；默认 0 兼容期
- scope 收窄：仅 **claude coder + 真改 src 的 dispatch**（复用 M34 `isClaudeCoder` + `isReportOnlyDispatch` 反向排除器）

## 理由

1. **零回归**：`isCompletedDispatchStatus/isOpenDispatchStatus` 仅 2 处使用点（`routes-team.ts:72` + `unreviewed-code-status.ts:93`），status 维度不动 → M34 兜底 / stalled-dispatch / sentinel / mobile dashboard 全部零波及
2. **tasks.md pattern 已支持 reviewable 占位**：`DISPATCH_LINE_PATTERN = - [ x~] ...`（`tasks-file.ts:105`）含 `~`，无需改正则；recordDispatchDone 看 review_status 决定 `[x]` 或 `[~]`
3. **语义分离更准**：worker 报告（status）和系统承认（review_status）是不同事件源（worker 主体 vs PM/reviewer 主体），分维度独立避免迁移规则挤
4. **rollback 简单**：flag=0 即恢复全旧行为；3 个新字段读端忽略不影响数据完整性
5. **复用 M34 边界**：`isReportOnlyDispatch` 已被钟馗审过 fp 边界（"调研后改了 src/foo.ts" 不漏报），Phase 1 scope 收窄直接借用
6. **守住 PM 自审反铁律**：`team accept` 强制要求 --reason 引用 reviewer dispatch_id，封住"PM 跳过 reviewer 直接 accept claude coder dispatch" 漏洞（对应 memory `feedback_no_self_review_claude_code`）

## 已知代价

- **PM 心智负担 +1 维**：要记得"reported ≠ done"；mitigation：Cockpit `[~]` 中间态显式标 + aiAction 高优红条
- **reviewer 忘带 --reviews flag**：Phase 1 启发式 fallback 兜住；Phase 2 UI 让 PM 派单时自动注入 reviews_dispatch_id
- **rejected → re-report 循环**：Phase 1 简单方案——worker re-report 清空 review_status 回 pending；触发自然重审
- **scope 误判风险**：复用 M34 `isReportOnlyDispatch` 边界；钟馗已审过的 fp 案例（"调研后改了 src/foo.ts" 不漏）继续覆盖
- **transition gap**：4010 重启前的 reported dispatch 不主动回填，续旧路径；接受这部分历史 dispatch 不进 gate
- **flag-gated 期间双行为**：相同 dispatch 类型在 flag 切换前后行为不同；mitigation 是 Phase 1 限 opt-in（默认关），等 PM 验稳再开

## 分期路线

| Phase | 范围 | 状态 |
|---|---|---|
| Phase 1 MVP | schema + reviewer 主路径 + PM 旁路 + Cockpit 精确 link + flag-gated | 待 user 拍板派实现 |
| Phase 2 | UI accept/reject 按钮 + reviewer 派单 UX 默认带 --reviews + mobile dashboard 加 review_status 维度 | 待 Phase 1 ship 验稳 |
| Phase 3 | scope 扩展 codex coder + isReportOnlyDispatch 自动 waived + reviewer meta-review | 看实际使用反馈 |
| Phase 4 | 联动 idea-16 #1 evidence bundle（typed artifacts）+ Work DAG MVP | 独立 milestone，本单不含 |

## 结果（后写）
（Phase 1 ship 后回填实际效果：M34 启发式 false positive/negative 是否真降；PM accept 旁路用得是否足；reviewer 主路径采纳率；mobile UI 是否需提前到 Phase 1.5）
