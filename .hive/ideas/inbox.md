# Ideas Inbox

> 低承诺想法收集。user 或 AI 都可以加。AI 每开 session 扫一遍找成熟的 promote 到 plan / ADR。

## inbox（按加入时间倒序）

### 2026-05-24 paseo 调研产出 4 条候选借鉴

- **idea-3 paseo Provider catalog manifest 借鉴**（preset 方向）
  - 详细能力声明（mode / risk / unattended / feature），让 worker 派单时按能力路由
  - 价值：HippoTeam 当前 4 preset 是平铺枚举，加 manifest 后能 dispatch 更精准
  - 成熟度：🟡 中，需要先看 HippoTeam 现有 preset 设计有多少痛点再决定
- **idea-4 paseo Timeline seq/epoch/gap 模型借鉴**（事件流方向）
  - 给 Cockpit / TaskLog / agent run history 加可恢复事件流（断线重连 / replay / finalize）
  - 价值：未来如果做 mobile/voice 需要、现在做 web Cockpit 也可加
  - 成熟度：🟡 中，依赖具体用例

## promoted

- **idea-2 paseo skills playbook 系统借鉴** → **M17**（user 拍板 5/25）
  - handoff / advisor / committee / epic / loop 5 个 playbook，转译成 `.hive/templates/*` + ORCHESTRATOR_RULES + Cockpit ActionBar 建议
  - 独立可做、不依赖 mobile/voice 决策；直接增强当前 PM 体系。见 plan.md M17
- **idea-1 paseo expo-two-way-audio 模块借鉴**（语音方向）→ **M14**（Q5 folded 5/25）
  - 自研 iOS AVAudioEngine `.voiceChat` + Android AudioRecord/AudioTrack VOICE_COMMUNICATION，16kHz PCM + AEC + NoiseSuppressor + playback AEC 适应
  - mobile+voice 核心使能模块，随 M14 确认纳入 plan；M14 开工再拆集成
