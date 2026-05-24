# 决策：baseline staleness 用 git log 比对，不用 LLM 自觉判断

**日期**: 2026-05-24
**状态**: 已采纳
**关联**: plan.md → L1 hardcoding candidate 2

## 背景

PM Phase C-1 baseline staleness 初版只看文件是否含 "待 AI 起草" 标记（isStub）。一旦 stub 填好就永远 fresh。

但项目代码持续变（schema-v* 更新 / 新文件加 / 模块重构），baseline 实际内容跟代码可能脱节，**isStub-only 检测无法捕获**。

讨论时 user 选定 "candidate 2: baseline 自动 staleness 检测" 跟 "candidate 1: tasks.md auto-sync" 并行做。

## 决策

用 **git log 检测**：
- 每个 baseline 子文件 mtime 作为基线时间点
- 维护 `BASELINE_COVERAGE_MAP` 映射 baseline 子文件 → "覆盖范围 code glob"
- 跑 `git log --since=<baseline mtime ISO> --name-only -- :(glob)<coverage>` 拿覆盖范围 changed file 列表
- changed file 数 > 0 → stale，记到 staleReason
- 顶级 staleHint 选 matching changes 最多的 child

具体 mapping：
- `module-map.md` ← `src/server/**`, `web/src/**`, `src/cli/**`, `src/shared/**`
- `runtime-flows.md` ← team-operations / feishu-*.ts / cockpit-*.ts / agent-runtime*.ts
- `state-storage.md` ← sqlite-schema*.ts / runtime-database.ts
- `test-gates.md` ← package.json / vitest.config.* / tests/**
- `risk-hotspots.md` ← src/server/**

## 理由

1. **isStub-only 不可靠**：填好后永远 fresh 是错的
2. **LLM 自觉判断不可靠**：LLM "感觉" baseline 该不该 audit 是主观的
3. **git log 是 deterministic**：客观，每个 baseline 文件跟它"应该 cover 的代码"的 commit 数量是个 hard fact
4. **跟 hive 设计哲学一致**：hook 驱动（不靠 stdout 正则），git log 是确定性外部信号
5. **coverage map 易维护**：5 个 baseline 子文件 → 几个 glob，简单 + 直接

## 已知代价

- 每次 `parseCockpit()` 跑 5 次 git log（每个 baseline 子文件 1 次），约 1-2 秒
- git log 只看 committed changes，working tree 未提交不算（设计如此）
- coverage map hardcoded，需要新增 baseline 子文件时手动加 entry
- git 不可用时 fallback to isStub-only（degraded 不崩）

## 结果

shipped commit `56d2d7f` 含 candidate 2：
- `pm-baseline-doc.ts` 加 BASELINE_COVERAGE_MAP + git log + degraded fallback
- BaselineFile 新字段 staleSince / staleReason
- ParsedBaseline.staleHint 顶级汇总

hive-serva 当前 spike：
- module-map.md: 27 matching changes since update
- runtime-flows.md: 1
- state-storage.md: 0
- test-gates.md: 3
- risk-hotspots.md: 4
- staleHint: "module-map.md last updated 0 days ago, 27 matching code changes since then"

Cockpit baseline tab 显示 "过期" badge + ActionBar 出 audit 提示。

后续：观察 staleness 误报率，必要时调 coverage map 精度。
