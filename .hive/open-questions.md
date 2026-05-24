# Open Questions

> AI 自动维护此文件。每条 Q 是 AI 遇到"自己办不了、必须问 user"的事。user 在 Cockpit Questions tab 答复。

## 待 user 拍板（按优先级）

### 🔴 high — 阻塞 ongoing 工作

- [ ] **Q4** mobile + voice 是否纳入 plan.md 作为未来 milestone？（paseo 调研 user 明示"未来方向是语音控制多 agent 开发"，但没具体怎么做）
  - 候选 1：先放 ideas/inbox 观察，等 PM 体系稳定再 promote
  - 候选 2：直接开 M14 mobile-voice spike（关羽出 spike POC：把 paseo expo-two-way-audio 模块抠出来试集成）
  - 候选 3：分两步——先抠 paseo skills playbook（容易借鉴），mobile-voice 等 v2 hive 大版本
  - 涉及决策性：要不要走自建 mobile / 借第三方框架 / 飞书 + voice plugin 第三路径

### 🟠 medium — 影响下一步规划

（暂无）

### 🟢 low — 灰度区

- [ ] **Q2** Cockpit Reports tab 是否要做（列 `.hive/reports/*.html` + 一键打开）？跟 Tasks/Research tab 价值相比偏低，先观察用户是否需要再决定。

## 已答（archive 留追溯）

- [x] **Q1** PM 全套 i18n（Cockpit 8 tabs + ActionBar + drawer / PlanDrawer / WorkspaceSettings Feishu 段）→ **shipped `2b3e2ed`**：104 个新 i18n key（中英文各），22 个组件改完，CJK 扫描 0 命中。user 切顶栏中/英按钮，重启 4010 + 刷新后所有 PM 文案双语。
