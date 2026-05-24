# 调研：paseo 借鉴评估（三轮迭代 + 三方对照）

**日期**: 2026-05-24
**触发**: user 飞书要求查 paseo 这个 GitHub 开源项目，clone + 出报告
**关联**: plan.md → 未来 mobile + voice 扩张方向；feedback-research-no-current-state-lens

## 问题

paseo 是 user 提到"之前提过"的开源项目（hive-serva 仓库 grep 无历史命中）。它对 HippoTeam 有借鉴价值吗？跟 multica 和 hive 三方比，HippoTeam 站在哪、差距在哪？

## 探索过程

派关羽做了三轮：

1. **v1 (commit `d3062e2`)**：GitHub 搜 + 候选定位 + clone + 通读源码 + 出报告。锁定 `getpaseo/paseo` 6625 star（TS coding agents 工作台）。报告用"PM 系统匹配度"做滤镜，把 paseo 的 mobile + 语音控制 dismiss 成"飞书已覆盖 + 维护面过大"。

2. **v2 (commit `7d4b7a8`)**：user 纠正 framing：未来方向是【语音控制多 agent 开发】，HippoTeam 会扩张，不能用当前形态做滤镜。关羽重做 35K 报告：Section 1 纯客观写 paseo 核心亮点（含 packages/expo-two-way-audio iOS AVAudioEngine / Android AudioRecord / 16kHz PCM / AEC / VAD/STT/TTS 流水线 / OpenAI Realtime API），Section 2 分两栏（当前可借鉴 + 假设扩张后可借鉴）。

3. **v3 (dispatch `7ef6ff64`)**：user 说 v2 "对我没卵用"，他要的是【三方横向对照】（Paseo / Multica / HippoTeam），让他一眼看出 HippoTeam 站在哪。关羽出三方对比报告：总览表 + 10 维度逐项 PK + 我们的差距/领先清单 + 各家 top 1-2 借鉴。

## 结论

**一句话定位**：paseo 是 mobile-first + 语音控制 + 自研双向音频原生模块的 multi-agent runtime；与 HippoTeam（PM 体系 + 飞书远控 + Cockpit dashboard）+ multica（Tauri 桌面 + per-agent 串行队列）形成三种不同形态。

**关键技术亮点（paseo 独有）**：
- packages/expo-two-way-audio：iOS AVAudioEngine `.voiceChat` mode + Android AudioRecord/AudioTrack VOICE_COMMUNICATION，AEC + NoiseSuppressor + 16kHz PCM + playback AEC 适应
- packages/server：本地 ONNX + OpenAI Realtime API 双路径；VAD/STT/TTS 流水线 + 隐藏 voice agent + speak MCP tool
- packages/app：voice 状态机 + audio chunk 上传 + playback group ack + 断连恢复 resync + seq/replay/finalize
- skills playbook：handoff / advisor / committee / epic / loop 流程
- Provider catalog：详细 manifest（mode / risk / unattended / feature 能力声明）

**HippoTeam 相对位置**（待 v3 报告完成后补全 PK 表）：
- ⭐ 领先：PM 体系（plan/decisions/ideas/baseline/cockpit）、飞书远控、Cockpit dashboard、baseline staleness 检测
- 🔴 落后：语音控制、mobile native app、skills playbook、provider catalog 详细度
- 🟡 持平：多 agent 协作基础、状态机、SQLite 持久化

## 影响

- **重要 framing 反馈被 save 为 memory**：[feedback-research-no-current-state-lens](feedback-research-no-current-state-lens.md)——调研外部项目不要用"跟当前形态匹配度"做滤镜
- **paseo clone 已留在 `~/development/paseo/`**，未来需要时可直接看源码
- **多方对照成为新 framing**：未来评估借鉴项可用同样套路（横向 PK + 我们站在哪 + 各家 top borrow）

## 参考

- v1 报告：`.hive/reports/paseo-research-2026-05-24.html`（22K，老 framing，保留对照用）
- v2 报告：`.hive/reports/paseo-research-v2-2026-05-24.html`（35K，中性 framing + 当前/扩张两栏）
- v3 报告：`.hive/reports/paseo-multica-hive-compare-2026-05-24.html`（关羽 in-flight，三方对比）
- paseo 仓库：https://github.com/getpaseo/paseo
