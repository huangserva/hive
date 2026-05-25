# Open Questions

> AI 自动维护此文件。每条 Q 是 AI 遇到"自己办不了、必须问 user"的事。user 在 Cockpit Questions tab 答复。

## 待 user 拍板（按优先级）

### 🔴 high — 阻塞 ongoing 工作

（暂无）

### 🟠 medium — 影响下一步规划

（暂无）

### 🟢 low — 灰度区

（暂无）

## 已答（archive 留追溯）

- [x] **Q5** 是否将 idea-1 paseo expo-two-way-audio（双向音频模块）提升为 question？→ **folded into M14**（5/25）：idea-1 是 mobile+voice 的核心使能模块，已随 M14 确认纳入 plan（见 M14 候选 idea）；具体集成等 M14 开工再拆，不单独立 question。
- [x] **Q4** mobile + voice 是否纳入 plan.md 作为未来 milestone？→ **要**（user 拍板 5/25，覆盖 5/24 的"介于 plan 跟想法之间"）。M14 从 proposed(待 Q4) 升为 confirmed。排序：skills playbook（M17，独立不依赖移动端）先做，mobile + voice 作为后续大版本方向，开工时起 ADR 选自建 mobile / 第三方框架 / 飞书 + voice plugin。
- [x] **Q2** Cockpit Reports tab 是否要做（列 `.hive/reports/*.html` + 一键打开）？→ **要做**（user 拍板 5/25）。M12 从 open(low) 升为 queued 正常队列。
- [x] **Q1** PM 全套 i18n（Cockpit 8 tabs + ActionBar + drawer / PlanDrawer / WorkspaceSettings Feishu 段）→ **shipped `2b3e2ed`**：104 个新 i18n key（中英文各），22 个组件改完，CJK 扫描 0 命中。user 切顶栏中/英按钮，重启 4010 + 刷新后所有 PM 文案双语。

- [x] **Q7** 确认归档 M17 handoff ADR（`.hive/decisions/2026-05-25-m17-handoff-playbook.md`，现 status=draft）？它记录的设计裁决——playbook 作为 PM 文档制品（不另造 runtime）/ 先模板后自动化 / ActionBar 只建议不自动执行 / handoff first——会作为后续 4 个 playbook（loop/advisor/committee/epic）的实现基调。你确认就把 status 改 accepted 归档。 → **answered 2026-05-25**：可以的

- [x] **Q8** 是否将 idea 提升为 question：**idea-3 paseo Provider catalog manifest 借鉴**（preset 方向） → **answered 2026-05-25**：同意
- [x] **Q9** M14 语音路线确认（推荐飞书 voice command MVP）→ **answered 2026-05-25（飞书）**：干！→ M14a 路线锁定，ADR 转正归档（2026-05-25-m14-voice-path.md 已采纳），派关羽 Phase 1（4109bb4b）
