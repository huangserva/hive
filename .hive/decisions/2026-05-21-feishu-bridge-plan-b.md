# 决策：飞书桥选 Plan B（自建 runtime 桥）

**日期**: 2026-05-21
**状态**: 已采纳
**关联**: plan.md → M4 Feishu Bridge

## 背景

user 想出门时从飞书远控 hive workspace。技术上两条路：
- **Plan A**: 接现成 `Ceeon/claude-channel-feishu` plugin
- **Plan B**: 在 hive runtime 层自建飞书 transport

需要决定走哪条。

## 决策

走 **Plan B** — 在 `src/server/feishu-transport.ts` 自建 WS 客户端 + 路由 + handler，复用 hive 已有 `recordUserInput` 注入路径。

## 理由

1. **覆盖面**：Plan A 绑 Claude Code 私有 `claude/channel` 协议，只服务 Claude orchestrator。hive 是 4 preset 平等（claude / codex / opencode / gemini），Plan B 全通吃
2. **拓扑**：Plan A 是 1 bot ↔ 1 Claude CLI session，要做"飞书路由到任意 workspace orchestrator"需要 runtime 层路由器，plugin 帮不上忙
3. **YOLO 冲突**：Plan A 的卖点之一是"权限卡片转发飞书 Allow/Deny"，但 hive 默认 YOLO 跳过 CLI 权限确认，这个卖点直接作废
4. **稳定性**：Plan A 依赖 cc 的 `--dangerously-load-development-channels` 非公开 flag，cc 任何升级都可能 break
5. **可借鉴**：lark.WSClient 长轮询封装 + 飞书卡片交互 payload 格式 可以从 plugin 的 server.ts 直接抄 30 行，借鉴 ≠ 重写

## 已知代价

- 比 Plan A 多 1-1.5 天工程量
- 飞书 SDK 接入要自己写（但 lark.WSClient 封装是 SDK 调用模板，照抄 30 行）
- 后续 lark SDK 升级 hive 自己要 follow

## 结果

shipped 16 commit / 132 个 feishu 测试 / 5 phase 全部完成：
- Phase 0 schema + credentials loader (`6d7bba2`)
- Phase 1 inbound transport (`d595f6f`)
- Phase 2 outbound `team feishu reply` (`10815af`)
- Phase 3 UI bindings panel (`fd0db8e`)
- Phase 4 testability refactor + bug fix
- Phase 5 审批卡片 Hermes 风格 (`e601c38`)

无重大返工。详细设计见 `.hive/reports/feishu-bridge-plan-2026-05-21.html`。
