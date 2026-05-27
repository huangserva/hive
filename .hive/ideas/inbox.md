# Ideas Inbox

> 低承诺想法收集。user 或 AI 都可以加。AI 每开 session 扫一遍找成熟的 promote 到 plan / ADR。

## inbox（按加入时间倒序）

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
