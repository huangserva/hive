# M40 Phase 2 文件分段播放下行设计

- 日期：2026-06-07
- HTML 报告：`.hive/reports/2026-06-07-m40-phase2-segmented-file-downlink-design.html`
- dispatch：`829c6413-bcd1-413a-8dbf-61355a70b58e`
- 类型：设计 spike，不改产品代码

## 背景

承接：

- `.hive/reports/2026-06-07-webrtc-call-audio-loud-clean-deep-dive.html`
- `.hive/decisions/2026-06-06-speculative-voice-front-pm-handoff.md` 末尾“下行架构决定”

user 已拍板：WebRTC 保留上行；下行默认改走对讲同款文件播放路径，WebRTC remote track 下行保留 flag-gated fallback。

## 核心设计

### 1. 下行模式

新增模式开关：

```text
HIVE_WEBRTC_DOWNLINK_MODE=file_segments | webrtc_track | dual_shadow
EXPO_PUBLIC_WEBRTC_DOWNLINK_MODE=file_segments | webrtc_track | dual_shadow
```

- `file_segments`：默认。AI 回复通过 relay E2E data 推音频段，App 用 `expo-audio` 播文件。
- `webrtc_track`：保留当前 `createWebRtcDownlinkAudio` remote track 能力。
- `dual_shadow`：诊断用，不作为日常默认。

### 2. 协议

建议新增帧族 `voice_downlink_segment`，不复用旧请求式 `voice_stream` 语义。

关键字段：

- `call_id`
- `turn_id`
- `segment_id`
- `generation`
- `op: segment_open | segment_chunk | segment_ready | retract | turn_close | error`
- `text`
- `audio` / `mime` / `format`
- `is_final`
- `retract_from_segment_id`

### 3. App 队列

新增 `SegmentedDownlinkQueue`：

- 收到段后 hold，不立即播。
- 播放触发复用现有“用户停说话/让出话权”节点。
- 只播当前 turn 最新 generation。
- 撤回时丢弃未播的 `segment_id >= N`；正在播和已播不动。
- 每段仍用 `expo-audio` data URI 播放，复用对讲响亮干净路径。

### 4. 服务端

新增 `SegmentedFileDownlinkSession`：

- 挂在 WebRTC call 生命周期下。
- 监听 orch_reply / speculative reply。
- 将文本切成短句段，逐段 TTS，发送 segment frames。
- generation superseded 时 abort 旧 GLM/TTS，发 retract，新 generation 从纠正点重发。

## 分阶段路线

1. **2a 通话回复走文件播放**
   - 目标：验证响度/清晰度。
   - 不做分段撤回，不接投机。
   - 改动：`src/cli/hive.ts`、新增服务端 file downlink、mobile runtime/call 页面接收并播放。

2. **2b 短句分段协议**
   - 目标：每条回复拆成独立音频段串行播放。
   - 加协议、reassembler、App 队列单测。

3. **2c 撤回协议**
   - 目标：未播可撤，在播不撤，旧 generation 不抢播。

4. **2d 投机生成接入**
   - 目标：接 Phase 1 `VoiceIntentSession` verdict。
   - likely_complete 先算段，用户停说话后播最新 generation。
   - PM handoff 仍只在 complete+escalate+confidence>=0.75 上触发。

## 关键文件

- Mobile:
  - `packages/mobile/src/api/voice-stream-protocol.ts`
  - `packages/mobile/src/api/relay-transport.ts`
  - `packages/mobile/src/api/mobile-runtime-context.tsx`
  - `packages/mobile/app/call.tsx`
  - 可新增 `packages/mobile/src/lib/segmented-file-downlink-player.ts`
- Server:
  - `src/server/relay-connector.ts`
  - `src/server/webrtc-callee.ts`
  - `src/server/webrtc-upstream-audio.ts`
  - `src/server/voice-intent-front.ts`
  - 可新增 `src/server/webrtc-segmented-file-downlink.ts`
  - `src/cli/hive.ts`

## 风险

- 文件段播放下行不是纯 WebRTC 媒体通道，但更符合用户“响且清”和“可撤段”的目标。
- 段太短会有播放 gap，段太长会降低撤回精度。建议默认 6-18 中文字/段，真机调。
- 播放前 `allowsRecording:false` 可能影响 barge-in，需要 2a 先验响度，后续单独调 barge-in。
- relay data 帧音频流量会上升，需要 chunk/reassembler 和队列清理做扎实。

## 推荐

下一单先做 2a：通话 AI 回复默认走文件播放路，WebRTC remote track 下行保留 `webrtc_track` flag。2a 真机响度和清晰度过关后，再做 2b/2c/2d。
