import { existsSync, readFileSync, rmSync } from 'node:fs'
import { Readable } from 'node:stream'
import { describe, expect, test, vi } from 'vitest'

import { FeishuTransport } from '../../src/server/feishu-transport.js'
import type { RuntimeStore } from '../../src/server/runtime-store.js'

const makeLogger = () => ({
  close: vi.fn().mockResolvedValue(undefined),
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
})

const makeStore = () =>
  ({
    approvalLedger: {
      cleanup: vi.fn(),
      markResolved: vi.fn(),
      resolve: vi.fn(),
    },
    findFeishuBindingByChatId: vi.fn().mockReturnValue({
      chatId: 'oc_1',
      chatName: null,
      createdAt: 1,
      enabled: true,
      id: 'binding-1',
      workspaceId: 'ws-1',
    }),
    getActiveRunByAgentId: vi.fn().mockReturnValue({ runId: 'run-1' }),
    getWorkspaceSnapshot: vi.fn().mockReturnValue({ summary: { id: 'ws-1' } }),
    recordUserInput: vi.fn(),
  }) as unknown as RuntimeStore

const getFirstInjectedText = (store: RuntimeStore) => {
  const call = (store.recordUserInput as ReturnType<typeof vi.fn>).mock.calls[0]
  if (!call) throw new Error('expected recordUserInput to be called')
  return call[2] as string
}

const makeMessageEvent = () => ({
  message: {
    chat_id: 'oc_1',
    chat_type: 'p2p',
    content: JSON.stringify({ text: 'hello from feishu' }),
    message_id: 'om_1',
    message_type: 'text',
  },
  sender: {
    sender_id: {
      user_id: 'ou_1',
    },
  },
})

const makeAudioMessageEvent = () => ({
  message: {
    chat_id: 'oc_1',
    chat_type: 'p2p',
    content: JSON.stringify({ duration: 1800, file_key: 'audio_file_1' }),
    message_id: 'om_audio_1',
    message_type: 'audio',
  },
  sender: {
    sender_id: {
      user_id: 'ou_1',
    },
  },
})

const makeApprovalActionEvent = () => ({
  action: {
    value: {
      approval_id: 'approval-1',
      decision: 'allow',
    },
  },
  context: {
    open_message_id: 'om_card',
  },
  operator: {
    open_id: 'ou_approver',
  },
})

const makeImageMessageEvent = () => ({
  message: {
    chat_id: 'oc_1',
    chat_type: 'p2p',
    content: JSON.stringify({ image_key: 'img_key_1' }),
    message_id: 'om_image_1',
    message_type: 'image',
  },
  sender: {
    sender_id: {
      user_id: 'ou_1',
    },
  },
})

const makeImageFileMessageEvent = () => ({
  message: {
    chat_id: 'oc_1',
    chat_type: 'p2p',
    content: JSON.stringify({ file_key: 'file_key_1', file_name: 'screenshot.jpg' }),
    message_id: 'om_file_1',
    message_type: 'file',
  },
  sender: {
    sender_id: {
      user_id: 'ou_1',
    },
  },
})

describe('FeishuTransport reactions', () => {
  test('does not acknowledge approval when card update fails before orch injection', async () => {
    const logger = makeLogger()
    const store = makeStore()
    const resolved = {
      action: 'delete production data',
      approvalId: 'approval-1',
      chatId: 'oc_1',
      createdAt: 1,
      decision: 'allow',
      messageId: 'om_card',
      operator: 'ou_approver',
      orchAgentId: 'ws-1:orchestrator',
      resolvedAt: 2,
      risk: 'high',
      target: null,
      workspaceId: 'ws-1',
    } as const
    vi.mocked(store.approvalLedger.resolve).mockReturnValue(resolved)
    const transport = new FeishuTransport({
      credentials: { appId: 'app_1', appSecret: 'secret_1' },
      logger,
      store,
    })
    vi.spyOn(
      transport as unknown as { updateApprovalCard: FeishuTransport['updateApprovalCard'] },
      'updateApprovalCard'
    ).mockRejectedValue(new Error('lark unavailable'))

    const response = await (
      transport as unknown as {
        handleCardAction: (event: ReturnType<typeof makeApprovalActionEvent>) => Promise<{
          toast: { content: string; type: string }
        }>
      }
    ).handleCardAction(makeApprovalActionEvent())

    expect(response.toast.type).toBe('warning')
    expect(response.toast.content).toContain('失败')
    expect(store.recordUserInput).not.toHaveBeenCalled()
    expect(store.approvalLedger.markResolved).not.toHaveBeenCalled()
  })

  test('keeps approval retryable when orch injection fails', async () => {
    const logger = makeLogger()
    const store = makeStore()
    const resolved = {
      action: 'restart service',
      approvalId: 'approval-1',
      chatId: 'oc_1',
      createdAt: 1,
      decision: 'allow',
      messageId: 'om_card',
      operator: 'ou_approver',
      orchAgentId: 'ws-1:orchestrator',
      resolvedAt: 2,
      risk: 'high',
      target: null,
      workspaceId: 'ws-1',
    } as const
    vi.mocked(store.approvalLedger.resolve).mockReturnValue(resolved)
    vi.mocked(store.recordUserInput).mockImplementation(() => {
      throw new Error('orch stdin closed')
    })
    const transport = new FeishuTransport({
      credentials: { appId: 'app_1', appSecret: 'secret_1' },
      logger,
      store,
    })
    vi.spyOn(
      transport as unknown as { updateApprovalCard: FeishuTransport['updateApprovalCard'] },
      'updateApprovalCard'
    ).mockResolvedValue()

    const response = await (
      transport as unknown as {
        handleCardAction: (event: ReturnType<typeof makeApprovalActionEvent>) => Promise<{
          toast: { content: string; type: string }
        }>
      }
    ).handleCardAction(makeApprovalActionEvent())

    expect(response.toast.type).toBe('warning')
    expect(response.toast.content).toContain('失败')
    expect(store.approvalLedger.markResolved).not.toHaveBeenCalled()
    expect(store.approvalLedger.resolve).toHaveBeenCalledWith('approval-1', 'allow', 'ou_approver')
  })

  test('adds GLANCE reaction for routed inbound text messages and injects message_id', async () => {
    const logger = makeLogger()
    const store = makeStore()
    const transport = new FeishuTransport({
      credentials: { appId: 'app_1', appSecret: 'secret_1' },
      logger,
      store,
    })
    const createReaction = vi.fn().mockResolvedValue({ data: { reaction_id: 'rx_eye' } })
    ;(
      transport as unknown as {
        client: { im: { v1: { messageReaction: { create: typeof createReaction } } } }
      }
    ).client.im.v1.messageReaction.create = createReaction

    await (
      transport as unknown as {
        handleMessageReceive: (event: ReturnType<typeof makeMessageEvent>) => Promise<void>
      }
    ).handleMessageReceive(makeMessageEvent())

    expect(createReaction).toHaveBeenCalledWith({
      data: { reaction_type: { emoji_type: 'GLANCE' } },
      path: { message_id: 'om_1' },
    })
    expect(store.recordUserInput).toHaveBeenCalledWith(
      'ws-1',
      'ws-1:orchestrator',
      expect.stringContaining('message_id=om_1')
    )
  })

  test('logs Feishu reaction response details when SDK create fails', async () => {
    const logger = makeLogger()
    const store = makeStore()
    const transport = new FeishuTransport({
      credentials: { appId: 'app_1', appSecret: 'secret_1' },
      logger,
      store,
    })
    const createReaction = vi.fn().mockRejectedValue({
      response: {
        body: { code: 231001, msg: 'reaction type is invalid' },
        code: 231001,
        msg: 'reaction type is invalid',
      },
    })
    ;(
      transport as unknown as {
        client: { im: { v1: { messageReaction: { create: typeof createReaction } } } }
      }
    ).client.im.v1.messageReaction.create = createReaction

    await (
      transport as unknown as {
        handleMessageReceive: (event: ReturnType<typeof makeMessageEvent>) => Promise<void>
      }
    ).handleMessageReceive(makeMessageEvent())

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('emoji=GLANCE'),
      expect.stringContaining('"code":231001')
    )
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('emoji=GLANCE'),
      expect.stringContaining('reaction type is invalid')
    )
  })

  test('downloads and transcribes inbound audio before injecting the shared Feishu prompt', async () => {
    const logger = makeLogger()
    const store = makeStore()
    const localSttProvider = {
      detect: vi.fn(),
      transcribeAudioFile: vi.fn().mockResolvedValue({
        provider: 'whisper',
        text: '本地语音转写内容',
      }),
    }
    const transport = new FeishuTransport({
      credentials: { appId: 'app_1', appSecret: 'secret_1' },
      logger,
      localSttProvider,
      store,
    })
    const createReaction = vi.fn().mockResolvedValue({ data: { reaction_id: 'rx_eye' } })
    const getResource = vi.fn().mockResolvedValue({
      getReadableStream: () => Readable.from([Buffer.from('audio bytes')]),
    })
    const fileRecognize = vi.fn().mockResolvedValue({
      data: { recognition_text: '语音转写内容' },
    })
    ;(
      transport as unknown as {
        client: {
          im: {
            v1: {
              messageReaction: { create: typeof createReaction }
              messageResource: { get: typeof getResource }
            }
          }
          speech_to_text: {
            v1: { speech: { fileRecognize: typeof fileRecognize } }
          }
        }
      }
    ).client.im.v1.messageReaction.create = createReaction
    ;(
      transport as unknown as {
        client: {
          im: { v1: { messageResource: { get: typeof getResource } } }
          speech_to_text: { v1: { speech: { fileRecognize: typeof fileRecognize } } }
        }
      }
    ).client.im.v1.messageResource.get = getResource
    ;(
      transport as unknown as {
        client: { speech_to_text: { v1: { speech: { fileRecognize: typeof fileRecognize } } } }
      }
    ).client.speech_to_text.v1.speech.fileRecognize = fileRecognize

    await (
      transport as unknown as {
        handleMessageReceive: (event: ReturnType<typeof makeAudioMessageEvent>) => Promise<void>
      }
    ).handleMessageReceive(makeAudioMessageEvent())

    expect(getResource).toHaveBeenCalledWith({
      params: { type: 'audio' },
      path: { file_key: 'audio_file_1', message_id: 'om_audio_1' },
    })
    expect(localSttProvider.transcribeAudioFile).toHaveBeenCalledWith(expect.any(String))
    expect(fileRecognize).not.toHaveBeenCalled()
    expect(store.recordUserInput).toHaveBeenCalledWith(
      'ws-1',
      'ws-1:orchestrator',
      expect.stringContaining('[来自飞书语音]')
    )
    expect(store.recordUserInput).toHaveBeenCalledWith(
      'ws-1',
      'ws-1:orchestrator',
      expect.stringContaining('本地语音转写内容')
    )
  })

  test('downloads inbound image and injects a local file path for orchestrator reading', async () => {
    const logger = makeLogger()
    const store = makeStore()
    const transport = new FeishuTransport({
      credentials: { appId: 'app_1', appSecret: 'secret_1' },
      logger,
      store,
    })
    const createReaction = vi.fn().mockResolvedValue({ data: { reaction_id: 'rx_eye' } })
    const imageBytes = Buffer.from('fake png bytes')
    const getResource = vi.fn().mockResolvedValue({
      getReadableStream: () => Readable.from([imageBytes]),
    })
    ;(
      transport as unknown as {
        client: {
          im: {
            v1: {
              messageReaction: { create: typeof createReaction }
              messageResource: { get: typeof getResource }
            }
          }
        }
      }
    ).client.im.v1.messageReaction.create = createReaction
    ;(
      transport as unknown as {
        client: { im: { v1: { messageResource: { get: typeof getResource } } } }
      }
    ).client.im.v1.messageResource.get = getResource

    await (
      transport as unknown as {
        handleMessageReceive: (event: ReturnType<typeof makeImageMessageEvent>) => Promise<void>
      }
    ).handleMessageReceive(makeImageMessageEvent())

    expect(getResource).toHaveBeenCalledWith({
      params: { type: 'image' },
      path: { file_key: 'img_key_1', message_id: 'om_image_1' },
    })
    expect(store.recordUserInput).toHaveBeenCalledWith(
      'ws-1',
      'ws-1:orchestrator',
      expect.stringContaining(
        '[来自飞书 chat=oc_1，sender=ou_1 user_id=ou_1 message_id=om_image_1 image='
      )
    )
    const injected = getFirstInjectedText(store)
    const imagePath = /image=([^\]\n]+)/u.exec(injected)?.[1]
    expect(imagePath).toBeTruthy()
    if (!imagePath) return
    try {
      expect(existsSync(imagePath)).toBe(true)
      expect(readFileSync(imagePath)).toEqual(imageBytes)
      expect(injected).toContain('请用 team feishu reply 回复（Phase 2 接通后生效）。')
      expect(injected).toContain('收到一张来自飞书的图片')
    } finally {
      rmSync(imagePath, { force: true })
    }
  })

  test('injects a graceful failure prompt when inbound image download fails', async () => {
    const logger = makeLogger()
    const store = makeStore()
    const transport = new FeishuTransport({
      credentials: { appId: 'app_1', appSecret: 'secret_1' },
      logger,
      store,
    })
    const createReaction = vi.fn().mockResolvedValue({ data: { reaction_id: 'rx_eye' } })
    const getResource = vi.fn().mockRejectedValue(new Error('resource unavailable'))
    ;(
      transport as unknown as {
        client: {
          im: {
            v1: {
              messageReaction: { create: typeof createReaction }
              messageResource: { get: typeof getResource }
            }
          }
        }
      }
    ).client.im.v1.messageReaction.create = createReaction
    ;(
      transport as unknown as {
        client: { im: { v1: { messageResource: { get: typeof getResource } } } }
      }
    ).client.im.v1.messageResource.get = getResource

    await (
      transport as unknown as {
        handleMessageReceive: (event: ReturnType<typeof makeImageMessageEvent>) => Promise<void>
      }
    ).handleMessageReceive(makeImageMessageEvent())

    expect(store.recordUserInput).toHaveBeenCalledWith(
      'ws-1',
      'ws-1:orchestrator',
      expect.stringContaining('收到图片但处理失败')
    )
    const injected = getFirstInjectedText(store)
    expect(injected).not.toContain('image=')
  })

  test('downloads inbound image file attachments and injects a local file path', async () => {
    const logger = makeLogger()
    const store = makeStore()
    const transport = new FeishuTransport({
      credentials: { appId: 'app_1', appSecret: 'secret_1' },
      logger,
      store,
    })
    const createReaction = vi.fn().mockResolvedValue({ data: { reaction_id: 'rx_eye' } })
    const imageBytes = Buffer.from('jpeg bytes')
    const getResource = vi.fn().mockResolvedValue({
      getReadableStream: () => Readable.from([imageBytes]),
    })
    ;(
      transport as unknown as {
        client: {
          im: {
            v1: {
              messageReaction: { create: typeof createReaction }
              messageResource: { get: typeof getResource }
            }
          }
        }
      }
    ).client.im.v1.messageReaction.create = createReaction
    ;(
      transport as unknown as {
        client: { im: { v1: { messageResource: { get: typeof getResource } } } }
      }
    ).client.im.v1.messageResource.get = getResource

    await (
      transport as unknown as {
        handleMessageReceive: (event: ReturnType<typeof makeImageFileMessageEvent>) => Promise<void>
      }
    ).handleMessageReceive(makeImageFileMessageEvent())

    expect(getResource).toHaveBeenCalledWith({
      params: { type: 'file' },
      path: { file_key: 'file_key_1', message_id: 'om_file_1' },
    })
    const injected = getFirstInjectedText(store)
    const imagePath = /image=([^\]\n]+)/u.exec(injected)?.[1]
    expect(imagePath).toBeTruthy()
    if (!imagePath) return
    try {
      expect(imagePath.endsWith('.jpg')).toBe(true)
      expect(readFileSync(imagePath)).toEqual(imageBytes)
    } finally {
      rmSync(imagePath, { force: true })
    }
  })

  test('falls back to Feishu speech recognition when local STT is unavailable', async () => {
    const logger = makeLogger()
    const store = makeStore()
    const localSttProvider = {
      detect: vi.fn(),
      transcribeAudioFile: vi.fn().mockResolvedValue(null),
    }
    const transport = new FeishuTransport({
      credentials: { appId: 'app_1', appSecret: 'secret_1' },
      logger,
      localSttProvider,
      store,
    })
    const createReaction = vi.fn().mockResolvedValue({ data: { reaction_id: 'rx_eye' } })
    const getResource = vi.fn().mockResolvedValue({
      getReadableStream: () => Readable.from([Buffer.from('audio bytes')]),
    })
    const fileRecognize = vi.fn().mockResolvedValue({
      data: { recognition_text: '飞书兜底转写内容' },
    })
    ;(
      transport as unknown as {
        client: {
          im: {
            v1: {
              messageReaction: { create: typeof createReaction }
              messageResource: { get: typeof getResource }
            }
          }
          speech_to_text: {
            v1: { speech: { fileRecognize: typeof fileRecognize } }
          }
        }
      }
    ).client.im.v1.messageReaction.create = createReaction
    ;(
      transport as unknown as {
        client: {
          im: { v1: { messageResource: { get: typeof getResource } } }
          speech_to_text: { v1: { speech: { fileRecognize: typeof fileRecognize } } }
        }
      }
    ).client.im.v1.messageResource.get = getResource
    ;(
      transport as unknown as {
        client: { speech_to_text: { v1: { speech: { fileRecognize: typeof fileRecognize } } } }
      }
    ).client.speech_to_text.v1.speech.fileRecognize = fileRecognize

    await (
      transport as unknown as {
        handleMessageReceive: (event: ReturnType<typeof makeAudioMessageEvent>) => Promise<void>
      }
    ).handleMessageReceive(makeAudioMessageEvent())

    expect(localSttProvider.transcribeAudioFile).toHaveBeenCalledWith(expect.any(String))
    expect(fileRecognize).toHaveBeenCalledWith({
      data: {
        config: {
          engine_type: '16k_auto',
          file_id: 'audio_file_1',
          format: 'opus',
        },
        speech: { speech: Buffer.from('audio bytes').toString('base64') },
      },
    })
    expect(store.recordUserInput).toHaveBeenCalledWith(
      'ws-1',
      'ws-1:orchestrator',
      expect.stringContaining('飞书兜底转写内容')
    )
  })
})
