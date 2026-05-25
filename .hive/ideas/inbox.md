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

### 2026-05-25 张飞全 app 巡检发现

- **idea-5 已存在 worker 改 thinking_level**（preset / UX 方向）
  - 现状：thinking_level 只在 Add Worker 创建时可设，已存在 worker 无 endpoint / UI 可改；且 agent 启动时才生效
  - 要做需：update launch-config endpoint + worker 卡片/detail UI 入口 + "改完 restart 才生效"语义
  - 成熟度：🟡 中，有 workaround（删了重建 worker），不急；user 真需要再 promote

### 2026-05-25 user 发现"答了没反应"的半截循环

- **idea-6 Cockpit 答 question 后自动 nudge orchestrator**（PM 闭环方向）
  - 现状：Cockpit Questions 答复只走 `answerQuestionInFile`（纯文件写 L1：翻 `[ ]`→`[x]` + 挪进已答 + 追加答复文本）。**不叫醒 orchestrator**。PM 只在下次 user prompt / 读文件时才看到并行动 → user 体感"答了没反应"。
  - 对比：worker `team report` 有回灌（注入 orch stdin 叫醒 PM），Questions 答复没有这条线 → 问答循环只接了一半。
  - 要做：runtime 在 POST answer route 成功后，往 orch PTY 注入一条系统消息（"Q7 已答：<答复>，重读 open-questions.md 并行动"）。类比 team report 注入路径，L1 硬接线。
  - 边界考虑：只在有 orch session 在线时注入；多条快速答复要 debounce / 合并；注入文案要让 PM 知道是"被 user 答题唤醒"而非新 dispatch。
  - 成熟度：🟢→🟡，价值高（闭合 human-in-the-loop），实现量中等。user 体感痛点直接命中，建议优先 promote。

## promoted

- **idea-2 paseo skills playbook 系统借鉴** → **M17**（user 拍板 5/25）
  - handoff / advisor / committee / epic / loop 5 个 playbook，转译成 `.hive/templates/*` + ORCHESTRATOR_RULES + Cockpit ActionBar 建议
  - 独立可做、不依赖 mobile/voice 决策；直接增强当前 PM 体系。见 plan.md M17
- **idea-1 paseo expo-two-way-audio 模块借鉴**（语音方向）→ **M14**（Q5 folded 5/25）
  - 自研 iOS AVAudioEngine `.voiceChat` + Android AudioRecord/AudioTrack VOICE_COMMUNICATION，16kHz PCM + AEC + NoiseSuppressor + playback AEC 适应
  - mobile+voice 核心使能模块，随 M14 确认纳入 plan；M14 开工再拆集成
