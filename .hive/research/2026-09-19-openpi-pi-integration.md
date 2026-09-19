---
title: OpenPI × Pi 配合方式评估
date: 2026-09-19
type: external-project-research
report: ../reports/2026-09-19-openpi-pi-integration.html
sources:
  - https://github.com/openpi-dev/openpi
  - https://github.com/earendil-works/pi
status: completed
---

# OpenPI × Pi 配合方式评估（索引）

## 净结论

OpenPI 是 Pi Coding Agent 的原生 package/扩展层，不是独立 Agent 服务。Pi 负责 Provider、模型、Session、原生工具、TUI、Trust 和 package loader；OpenPI 通过 Pi Extension API 注册按需能力，增加 Background Terminal、进程内 Pi Subagent、Dynamic Workflow、Tasks/Goal/Plan、Web Workbench 等。

本机已满足安装条件：Pi `0.85.1`、Node `25.5.0`；`pi list` 显示当前没有 package。OpenPI npm 最新版为 `0.8.1`，要求 Pi `>=0.85.1`、Node `>=22.19.0`。

推荐先安装 npm 稳定版并保持默认 `explicit` 能力发现，做普通 Pi、后台终端、子代理、Web 四项 smoke；暂不同时改 hive-serva。完整论证、安装命令、风险与 hive 分层建议见 [HTML 报告](../reports/2026-09-19-openpi-pi-integration.html)。

## 代码锚点

- `openpi/package.json`：`pi.extensions = ["./extensions"]`；Pi 三个包作为 peer dependencies。
- `extensions/capabilities/index.ts`：`before_agent_start` 根据明确意图加载能力组；默认 explicit，可 opt-in adaptive。
- `extensions/shared/child-session.ts`、`extensions/subagents/*`：通过 Pi SDK `createAgentSession()` 创建进程内独立 Session。
- `extensions/workflows/runner.ts`：Workflow 的 `agent()` 同样创建 Pi Session；控制脚本运行在受限 sandbox。
- `extensions/background-terminals/index.ts`：长期进程管理与结果回传。
- `extensions/web/index.ts`、`bin/openpi.js`：`/web` 启动独立本地 Web runtime；默认绑定 `127.0.0.1`。

## 推荐命令

```bash
pi install npm:@tt-a1i/openpi
pi list
# 进入 Pi
/reload
/openpi-setup
```

## 与 hive-serva 的分层

若将来增加 Pi worker preset：hive-serva 管顶层 worker、dispatch ledger、Cockpit、移动端和 reviewer/accept 闸门；OpenPI 只管单个 Pi worker 内部的子代理、Workflow 与后台进程。OpenPI child 不直接映射成 hive worker，OpenPI 自报完成也不替代 hive 的客观验收。

## 风险

- Pi 默认继承启动用户的系统权限，没有完整内建沙箱；worktree 不是安全沙箱。
- 当前 Pi 恰好等于 OpenPI 最低版本，升级后需重新 smoke。
- GitHub main 可能领先 npm；稳定使用选 npm，本地开发才绑定 checkout。
- `adaptive` 会扩大模型自主加载能力的范围，先保持 explicit。
