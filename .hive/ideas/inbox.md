# Ideas Inbox

> 低承诺想法收集。user 或 AI 都可以加。AI 每开 session 扫一遍找成熟的 promote 到 plan / ADR。

## inbox（按加入时间倒序）

### 2026-05-31 错误账本（错误归类 + 复犯追踪 = 自我优化源）— user 提

- **idea-7 错误/教训账本**：把开发中的错误（user 指出的 + 团队自己发现的）系统化**储存 + 归类 + 追踪是否重复犯**，作为团队不停自我优化迭代的源泉。
  - user 原话：错误是我们进步的源泉，最好有个地方把这些错误存起来并归类，再看会不会重复犯同样的错误；慢慢看它怎么变成我们的 plan 和 task。
  - 现状基础（不是从零）：已有零散的 `.claude` memory `feedback_*.md`（如 verify_real_artifact / worker_reliability_systemic / review_and_device_verify_before_ship）+ `decisions/` ADR，但**没有"错误"专门视角的统一归类 + 复犯检测 + Cockpit 可见**。
  - promote 时想清楚：① 存哪（Cockpit 新「教训/错误」tab？/ `.hive/lessons/`？/ 复用 decisions？）② 归类维度（类型=误判/流程缺失/模型弱/沟通漏；谁发现=user vs 团队自己；严重度）③ **复犯检测**（新错跟历史错相似度比对，犯过的高亮"又来了"）④ 怎么自动从"错误"长成 plan/task。
  - 本 session 现成首批素材（可直接录入）：GMS 误判 QR（被 user 一句"相机扫能用"戳穿）、codex dedup 修 3 次没对（=模型弱→M31）、#21 跳过审查直接出包结果带 bug、删旧 APK 让已发链接失效、误称"张飞真机验"其实它没手机。

### 2026-05-24 paseo 调研产出 4 条候选借鉴

### 2026-05-25 张飞全 app 巡检发现

- **idea-5 已存在 worker 改 thinking_level** → **shipped M20**（`575e003`，5/26）
  - WorkerSettingsDialog 支持编辑 name / description / thinking_level / command_preset / sentinel interval

## promoted / shipped

- **idea-6 Cockpit 答 question 后自动 nudge orchestrator** → **shipped `a990f14`**（5/25）
  - answer route → store.notifyQuestionAnswered → writeQuestionAnsweredPrompt 注入 orch PTY；无 active run 优雅 no-op；真 PTY 集成测试。闭合了 user 体感的"答了没反应"半截循环。

- **idea-2 paseo skills playbook 系统借鉴** → **M17**（user 拍板 5/25）
  - handoff / advisor / committee / epic / loop 5 个 playbook，转译成 `.hive/templates/*` + ORCHESTRATOR_RULES + Cockpit ActionBar 建议
  - 独立可做、不依赖 mobile/voice 决策；直接增强当前 PM 体系。见 plan.md M17
- **idea-1 paseo expo-two-way-audio 模块借鉴**（语音方向）→ **M14**（Q5 folded 5/25）
  - 自研 iOS AVAudioEngine `.voiceChat` + Android AudioRecord/AudioTrack VOICE_COMMUNICATION，16kHz PCM + AEC + NoiseSuppressor + playback AEC 适应
  - mobile+voice 核心使能模块，随 M14 确认纳入 plan；M14 开工再拆集成

- **idea-3 paseo Provider catalog manifest 借鉴**（preset 方向）→ **M18**（Q8 user 答"同意" promote 5/25）
  - preset 加详细能力声明（mode / risk / unattended / feature），让 orch 派单时按能力路由，取代当前 4 preset 平铺枚举
  - 🟡 需先做 scoping spike：看现有 preset 设计有多少真痛点、orch 派单实际需要哪些能力维度，再决定实现范围。见 plan.md M18

- ~~**idea-4 paseo Timeline seq/epoch/gap 模型借鉴**（事件流方向）~~ → **M23**（user 拍板 2026-05-27，调研确认与现有架构互补不冲突）
