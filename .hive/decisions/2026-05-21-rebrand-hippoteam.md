# 决策：Rebrand Hive → HippoTeam，不发 npm

**日期**: 2026-05-21
**状态**: 已采纳
**关联**: plan.md → M3 Rebrand

## 背景

从 `tt-a1i/hive` fork 后，huangserva 自用为主的项目想有独立 brand。同时上游 npm update badge 不停弹 "v1.0.0 → v1.3.0 npm update -g @tt-a1i/hive" 干扰。

## 决策

- Topbar 显示 / favicon / HTML title / package.json name 改为 HippoTeam / @huangserva/hippoteam
- 自定义圆圈 H logo（关羽手画 SVG path）取代原 lucide hexagon
- 移除 Topbar 的 upstream npm update badge
- package.json name 改 `@huangserva/hippoteam` 但不发 npm（fork 自用）
- README 改 brand 描述，保留 fork 上游引用
- i18n 16 处 + 后续 PM-wide i18n 总计 104 keys × 2 locale

**不改**：
- bin command name `hive`（避免破 user PATH 习惯）
- `HIVE_*` env vars（破 runtime 协议成本太大）
- `~/.config/hive` 数据目录（破存储兼容）
- `.hive/` workspace 元数据目录（破现有 PROTOCOL 协议）

## 理由

1. **upstream 分叉已深**：到 5/21 已有飞书桥 + 大量 stability fix，回灌 upstream 1.3.0 没价值
2. **不发 npm**：自用 fork 不走 npm registry，省掉发布流水线 + trusted publishing 等麻烦
3. **保留底层名字**：bin/env/dir 改名破坏面太大，brand 改 visible 部分就够

## 已知代价

- 23 个 web 文件 i18n 化（PM C-2 + i18n 收尾时一起做）
- README 改后跟 upstream README 内容差距越来越大，合并难度上升

## 结果

shipped commit `539266f` Rebrand 完整 + commit `2b3e2ed` PM 全套 i18n 104 keys。

CJK scan 0 命中（PM 范围内无硬编码中文）。user 切顶栏 中/英 按钮所有 PM 文案双语同步。

后续：M3 不再演进，brand 已定调。
