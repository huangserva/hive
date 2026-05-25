# 调研：M14 voice / mobile 路线选择

**日期**: 2026-05-25
**触发**: plan.md → M14 confirmed；user 北极星方向是“语音控制多 agent 开发”
**配对报告**: `.hive/reports/m14-voice-mobile-path-eval-2026-05-25.html`
**ADR draft**: `.hive/decisions/2026-05-25-m14-voice-path.md`

## 问题

M14 开工前需要选第一条进入路径：自建 mobile app、借第三方 voice agent framework、还是复用既有 Feishu bridge 加 voice plugin。关键不是“哪个技术最酷”，而是“哪条路最快验证语音控制多 agent 开发，同时不封死未来 realtime/mobile 扩张”。

## 路线摘要

### 1. 自建 mobile app

- 参考源：
  - `~/development/paseo/public-docs/voice.md`
  - `~/development/paseo/packages/expo-two-way-audio/README.md`
  - `~/development/paseo/packages/expo-two-way-audio/ios/AudioEngine.swift`
  - `~/development/paseo/packages/expo-two-way-audio/android/src/main/java/expo/modules/twowayaudio/AudioEngine.kt`
  - Expo Audio docs: https://docs.expo.dev/versions/v54.0.0/sdk/audio/
  - Apple AVAudioSession voiceChat docs: https://developer.apple.com/documentation/avfaudio/avaudiosession/mode-swift.struct/voicechat
  - OpenAI Realtime WebRTC docs: https://platform.openai.com/docs/guides/realtime-webrtc
- 要点：
  - paseo 的 voice 设计是 local-first：本地 STT/TTS 可选 OpenAI；voice LLM orchestration 复用已安装 agent provider；MCP stdio bridge 做 voice tools。
  - expo-two-way-audio 提供 16kHz mono 16-bit PCM、AEC、输入/输出 volume；iOS 用 `.voiceChat` + `setVoiceProcessingEnabled(true)`；Android 用 `VOICE_COMMUNICATION` + AcousticEchoCanceler/NoiseSuppressor。
  - README 明确 AEC/noise reduction/iOS mic modes 需要真机测试，模拟器不够。
- 判断：
  - 长期上限最高，但第一阶段会被 mobile app、auth、distribution、real-device audio 调试拖住。

### 2. 第三方 voice agent framework

- 参考源：
  - LiveKit Agents: https://docs.livekit.io/agents/
  - Pipecat: https://github.com/pipecat-ai/pipecat
  - Vapi pricing: https://vapi.ai/pricing
  - OpenAI Realtime WebRTC/WebSocket docs: https://platform.openai.com/docs/guides/realtime-webrtc
- 要点：
  - LiveKit Agents 提供 WebRTC/mobile frontend/telephony、turn detection、interruptions、agent server/job lifecycle，Apache-2.0。
  - Pipecat 是 Python open-source realtime voice/multimodal conversational AI framework，BSD-2-Clause；GitHub 页面显示 12.5k stars、latest v1.2.1 May 15 2026。
  - Vapi 是托管 voice AI 平台；公开价显示 hosting $0.05/min、模型成本另计、ZDR/HIPAA 另付费。
- 判断：
  - 如果 M14 立即做 realtime conversation，LiveKit 是首选候选；但它会引入 room / agent server / job 第二套 runtime，需要避免跟 HippoTeam orchestrator+PTY 模型打架。
  - Vapi 需 user 明确拍板预算与数据策略，不应默认采用。

### 3. Feishu + voice plugin

- 参考源：
  - 现有设计：`.hive/research/2026-05-21-feishu-bridge-design.md`
  - 现有 ADR：`.hive/decisions/2026-05-21-feishu-bridge-plan-b.md`
  - 现有代码：`src/server/feishu-transport.ts`, `src/server/feishu-inbound-handler.ts`, `src/server/routes-feishu.ts`
  - Feishu voice message help: https://www.feishu.cn/hc/en-US/articles/360039394633-send-voice-messages
  - Feishu/Lark message API: https://open.feishu.cn/document/server-docs/im-v1/message/create
- 要点：
  - HippoTeam 已有 M4 Feishu bridge：WS inbound、chat binding、outbound reply、approval card、local credentials、runtime logging。
  - Feishu 移动端已天然解决“手机上讲话给 bot”的入口问题；用户熟悉远控链路。
  - 最小实现是 voice-to-text command，不是 realtime voice conversation：transcript 注入 existing inbound prompt，orch 后续照常 `team send` / `team approve` / `team feishu reply`。
- 判断：
  - 第一阶段 ROI 最高；最大不确定性是 Feishu bot event 对 audio/transcript 的具体 payload 和下载权限，需要 M14a 用真 Feishu E2E 验证。

## 决策依据

1. “语音控制多 agent 开发”的首个可验证价值是命令入口，而不是低延迟语音伴侣。
2. Feishu route 复用现有安全与 PM 闭环：workspace binding、approval card、Cockpit/tasks、orchestrator stdin 注入。
3. 自建 mobile 与 LiveKit/OpenAI Realtime 都是未来上限，但第一步直接做它们会把产品验证变成移动/媒体工程。
4. 设计不能只按当前 fit 过滤：所以 ADR 保留 Phase 2/3 的 realtime/native 出口，并设置升级触发条件。

## 推荐

**采用 progressive strategy**：

- M14a：Feishu voice command MVP。语音/语音+文字 → transcript → existing Feishu inbound → orchestrator/team protocol。
- M14b：可选 TTS/audio bubble reply。
- M14c：当用户需要连续对话/打断/低延迟时，再做 LiveKit vs OpenAI Realtime vs self-built mobile spike。
- M14d：当 Feishu UX 限制产品形态时，再启动自建 mobile client。

## 待后续验证

- Feishu bot 是否能稳定收到 voice/audio event，以及 event 是否包含官方转写文本。
- 如果无转写，下载音频资源所需权限、文件格式、ASR 成本与延迟。
- `team feishu reply --voice` 是否值得做，还是 text reply 足够完成 M14a。
