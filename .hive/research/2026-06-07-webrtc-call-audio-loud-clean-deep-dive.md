# WebRTC 通话音量小 / media 路由发劈深挖

- 日期：2026-06-07
- 对应 HTML：`.hive/reports/2026-06-07-webrtc-call-audio-loud-clean-deep-dive.html`
- dispatch：`fc3daa46-40b2-4257-8392-676ef9f991fd`
- 类型：调研 / 诊断，不改产品代码

## 一句话结论

对讲念回响且清，是因为它走 `expo-audio` 文件播放路径：服务端 TTS 生成 MP3/M4A，App 用 `useAudioPlayer` 播 data URI，并在播放前把 `allowsRecording:false`。WebRTC 通话下行是 `react-native-webrtc` remote audio track，由 WebRTC `JavaAudioDeviceModule` 实时播放；两者不是同一条 Android 音频流。`media` 路由能避开 InCallManager 的小声通话流，但仍不是 expo-audio 播放器，且会放大当前服务端 `edge-tts +40%` + `HIVE_WEBRTC_DOWNLINK_GAIN=3.0` 的削波/失真风险。

## 本地证据索引

- 对讲念回：
  - `packages/mobile/app/(tabs)/talk.tsx:394`：`useAudioPlayer(null, { updateInterval: 100 })`
  - `packages/mobile/app/(tabs)/talk.tsx:672-675`：录音段结束后 `setAudioModeAsync({ allowsRecording:false, playsInSilentMode:true })`
  - `packages/mobile/app/(tabs)/talk.tsx:1199-1206`：播放前保持 `allowsRecording:false`，然后 `player.replace({ uri: data:${mime};base64,... })`
- WebRTC 通话：
  - `packages/mobile/src/lib/webrtc-incall-manager.ts:22-29`：`extra.webRtcAudioRoute` / env 决定 `incall|media`
  - `packages/mobile/src/lib/webrtc-incall-manager.ts:51-55`：`media` 时打印 `[WEBRTCDBG] test_call_audio_route_media` 并跳过 InCallManager
  - `packages/mobile/src/lib/webrtc-incall-manager.ts:61-63`：默认 incall 调 InCallManager start + speakerphone
  - `packages/mobile/src/api/mobile-runtime-context.tsx:238-241`：runtime 从 `Constants.expoConfig.extra` 读 WebRTC extra
  - `packages/mobile/app.config.ts:127`：构建时写入 `extra.webRtcAudioRoute`
  - `packages/mobile/src/lib/webrtc-caller.ts:106-110`：getUserMedia 开 AGC/AEC/NS（主要影响上行）
- 服务端下行增益：
  - `src/server/local-tts.ts:59-60`：edge 默认晓晓，默认 `HIVE_TTS_EDGE_VOLUME` 等效 `+40%`
  - `src/server/local-tts.ts:133-135`：edge-tts 通过 `--volume` 应用音量
  - `src/server/webrtc-downlink-audio.ts:56`：默认 `HIVE_WEBRTC_DOWNLINK_GAIN=3.0`
  - `src/server/webrtc-downlink-audio.ts:139-145`：Int16 样本乘 gain 后 clamp，存在削波可能

## 外部资料

- Expo Audio docs：`setAudioModeAsync` 控制全局音频行为 / 路由 / 中断；`useAudioPlayer` 是原生播放 API。
- WebRTC JavaAudioDeviceModule docs：ADM 使用 `AudioRecord` 输入、`AudioTrack` 输出，并提供 AEC/NS 相关能力。
- 100ms RN audio mode docs：`MODE_IN_COMMUNICATION` 对应 in-call volume，`MODE_NORMAL` 对应 media volume。
- WebRTC Android `AudioTrack.setVolume`：仅是 0..10 gain，不是音频路由切换。

## media flag 生效判定

代码层已经具备生效路径：

1. 构建时 `EXPO_PUBLIC_WEBRTC_AUDIO_ROUTE=media` 或 `WEBRTC_AUDIO_ROUTE=media` 写入 `extra.webRtcAudioRoute`。
2. runtime 读取 `Constants.expoConfig.extra.webRtcAudioRoute`。
3. `resolveWebRtcAudioRoute` 只接受小写 `media`；大写 `MEDIA` 会回落 `incall`。
4. 真机日志必须出现 `[WEBRTCDBG] test_call_audio_route_media`，才可确认该次通话跳过 InCallManager。

建议下一步补日志：在 start call 时打印 `webRtcAudioRouteExtra` 与 `resolvedAudioRoute`，避免继续靠主观听感判断 flag 是否烤进包。

## 推荐方案

1. 先加诊断日志，不再盲试包：
   - 服务端：每条 WebRTC TTS 打 `HIVE_TTS_EDGE_VOLUME`、`HIVE_WEBRTC_DOWNLINK_GAIN`、gain 前后 RMS、peak、clipped sample ratio。
   - App：打 `extra.webRtcAudioRoute`、最终 route、`test_call_audio_route_media`、`_setVolume` applied/unsupported。
2. 如果 media 发劈伴随 clipping，先把 `HIVE_WEBRTC_DOWNLINK_GAIN` 降到 1.0-1.5，并确认 4010 重启后 `HIVE_TTS_EDGE_VOLUME` 的实际值。
3. 若 media 仍不干净，推荐混合下行：WebRTC 保留上行 / 流式 STT，AI TTS 下行回到现有 `voice_stream` + `expo-audio` 文件播放。这样才能真正复用“对讲响亮清晰”的播放路径。
4. 不建议短期 fork react-native-webrtc ADM 去改 Android AudioTrack usage/audio attributes；这是 native 设备敏感活，风险高于混合下行。

## 风险 / 未知

- 需要真机日志确认 `media` flag 在用户那版包是否实际生效。
- 当前没有服务端 peak / clipping ratio 日志，发劈根因仍需数据闭环。
- 混合下行会牺牲“所有媒体都在 WebRTC track 内”的纯度，但更贴近用户要的响亮清晰体验。
