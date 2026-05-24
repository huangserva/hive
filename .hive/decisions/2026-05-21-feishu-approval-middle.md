# 决策：飞书审批选中版（team approve + interactive card + 异步注入）

**日期**: 2026-05-21
**状态**: 已采纳
**关联**: plan.md → M4 Feishu Bridge Phase 5

## 背景

user 提到 "Hermes 那种审批弹窗让我放心好多"，飞书远控时高风险动作（rm / git push / drop / 不可逆操作）需要审批 safeguard。三个方案深浅：

- **浅版**: 关键词拦截白名单（rm / push / drop / 等），命中弹飞书审批卡片
- **中版**: 扩 `team` 协议加 `team approve` subcommand，orch 自觉调用，飞书发卡片，user 点 Allow/Deny 后注入回 orch stdin
- **深版**: 关 YOLO，给飞书发起的派单挂权限拦截 hook，worker 高危命令强制审批

## 决策

走**中版** — 新增 `team approve "<action>" --risk high|medium` CLI + `POST /internal/feishu/approval-request` HTTP endpoint + `FeishuTransport.sendApprovalCard` + `ApprovalLedger`（in-memory）+ `card.action.trigger` 事件订阅。

异步模型：`team approve` 立即返回 approval_id，orch 等飞书系统消息回灌（与 `team send/report` 同源思维）。

## 理由

1. **可解释 + 可审计**：orch 显式调 `team approve` → 审批轨迹自然出现在 task log，回看清晰
2. **跟 hive 现有协议同源**：跟 `team send` / `team report` / `team cancel` 一致风格，orch 看一眼 prompt 就知道怎么用
3. **不破 YOLO 默认**：user 日常 web UI 操作仍流畅；YOLO 跟审批是分层（execution 级 vs decision 级）正交
4. **避开浅版陷阱**：关键词白名单总不全（drop table 容易拼成 'truncate'），LLM 在 prompt 引导下能识别真意图
5. **避开深版风险**：fork hive 权限模型破坏 4 preset 平等性，工程量也大

无 ACL（群里第一个点的算数）：单 user 场景为主，避免权限模型膨胀。In-memory ledger（runtime 重启 pending 失效，飞书卡片显示"已过期"）：MVP 简化，Phase 5+ 可加 SQLite 持久化。

## 已知代价

- 多 1 天工程量（vs 浅版的几小时）
- 依赖 orch system prompt 自觉调 `team approve`（如果 LLM 偷懒会绕过）
- in-memory ledger 不持久化，runtime 重启卡片失效

## 结果

shipped commit `e601c38` 含 ApprovalLedger + sendApprovalCard + card.action.trigger 订阅 + 双语 system prompt + 5 min cleanup interval。31 + 32 个新测试覆盖。

未做真飞书 e2e 验证（等 user 配 `~/.config/hive/feishu.json` 凭证）。详见 `.hive/reports/feishu-bridge-plan-2026-05-21.html` 第 5 节。
