# 调研：飞书桥设计（Plan B 实现路径）

**日期**: 2026-05-21
**触发**: user 想出门时从飞书远控 hive，且要 Hermes 风格的审批弹窗
**关联**: decisions/2026-05-21-feishu-bridge-plan-b.md + decisions/2026-05-21-feishu-approval-middle.md + plan.md → M4

## 问题

1. 飞书 SDK 怎么接？长轮询 vs WebHook？
2. inbound 消息怎么路由到指定 workspace 的 orchestrator？
3. outbound 怎么走？orch 用什么命令回飞书？
4. 高风险动作怎么 safeguard？卡片交互 payload 长啥样？

## 探索过程

- 调研 `@larksuiteoapi/node-sdk` v1.45+ API：lark.WSClient long-polling（不需要公网 IP）、EventDispatcher、Client.im.v1.message.create
- 读 Ceeon/claude-channel-feishu plugin 源码（30 行 WS 封装）作为 reference
- 设计 5 phase 实施 plan（Phase 0-4 含完整 ASCII 数据流图）
- 设计审批卡片 JSON schema（含 priority color / Allow Deny 按钮 / approval_id payload）
- 决定异步模型（team approve 立即返回 + 飞书回调注入 stdin）

## 结论

技术栈：
- **SDK**: `@larksuiteoapi/node-sdk@^1.45.0`（实际 resolved 1.64.0）
- **入站**: `lark.WSClient` 长轮询 + `EventDispatcher.register("im.message.receive_v1")` + `card.action.trigger`
- **出站**: `lark.Client.im.v1.message.create` 直接调
- **路由**: `feishu_bindings` SQLite 表 (workspace_id ↔ chat_id mapping)
- **审批**: in-memory ApprovalLedger + interactive card 5 min cleanup
- **长消息**: 30KB 阈值切片 25KB chunks + "(N/M)" 前缀

5 phase 设计 + 实施 plan 全部在交付 HTML：

## 影响

- 直接驱动 M4 Feishu Bridge 5 phase 实施（5/21 全 ship，16 commits）
- 启发后续 PM 体系的 "渐进 phase + 设计 HTML 先 user review" 工作流
- 验证 hive runtime 加 transport 的 viable pattern（飞书是第一个，未来可加 wechat / dingtalk / slack）

## 参考

详细设计：`.hive/reports/feishu-bridge-plan-2026-05-21.html`（含 5 phase 细化 + 完整 ASCII 数据流 + 凭证管理 + 错误处理 + 测试策略）
