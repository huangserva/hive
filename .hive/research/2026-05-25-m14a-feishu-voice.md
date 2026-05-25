# M14a Feishu Voice Spike

**日期**: 2026-05-25
**触发**: user 拍板 M14 走飞书 voice command MVP，需要先确认语音事件、资源下载和 STT 能力。
**交付报告**: [.hive/reports/m14a-feishu-voice-spike-2026-05-25.html](../reports/m14a-feishu-voice-spike-2026-05-25.html)
**关联**: `.hive/decisions/2026-05-25-m14-voice-path.md`、plan.md M14

## 结论索引

- 飞书 SDK 的 `im.message.receive_v1` 可接收 audio 类型消息，核心 payload 是 `message.content` JSON 中的 `file_key`，常见附带 `duration`。
- `client.im.v1.messageResource.get({ type: "audio", message_id, file_key })` 可下载消息内音频资源，返回 readable stream。
- SDK 暴露 `client.speech_to_text.v1.speech.fileRecognize`，可做 60 秒以内语音文件 ASR；但需要语音识别权限，官方文档标注免费版不支持。
- 本次代码已实现 audio → resource download → 飞书内置 ASR → 复用现有 Feishu inbound 注入链路；失败时 log/drop，不接外部 ASR。

## 待验证

- 真实飞书 audio event content 是否完全等于 `{file_key,duration}`。
- 语音文件实际格式是否能以 `format: "opus"` 被 `fileRecognize` 接受。
- 当前租户/应用是否具备 message resource 下载权限和 speech_to_text 权限。
- 群聊 audio 消息没有文本 mention 前缀，后续 E2E 要确认是否会误收群内普通语音。

## User 决策点

见 open question Q10：STT provider 选飞书内置（权限/版本约束）还是外部 ASR（费用/数据出境）。
