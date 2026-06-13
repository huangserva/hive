import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'

import { afterEach, describe, expect, test, vi } from 'vitest'

import { FeishuTransport } from '../../src/server/feishu-transport.js'
import type { RuntimeStore } from '../../src/server/runtime-store.js'

// M44 飞书媒体收发测试 —— 在 Lark SDK 边界 mock（image.create / file.create / message.create /
// messageResource.get），不真打飞书；同时禁 mock PTY 那条铁律不适用于 Lark（它是外部 HTTP API）。
// 每条 assert 自问：产品写反这条能过吗？

const makeLogger = () => ({
  close: vi.fn().mockResolvedValue(undefined),
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
})

const makeStore = () =>
  ({
    approvalLedger: { cleanup: vi.fn(), resolve: vi.fn() },
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

const makeTransport = (logger = makeLogger(), store = makeStore()) => {
  return new FeishuTransport({
    credentials: { appId: 'app_1', appSecret: 'secret_1' },
    logger,
    store,
  })
}

type LarkClient = {
  im: {
    v1: {
      file: { create: ReturnType<typeof vi.fn> }
      image: { create: ReturnType<typeof vi.fn> }
      message: { create: ReturnType<typeof vi.fn> }
      messageReaction: { create: ReturnType<typeof vi.fn> }
      messageResource: { get: ReturnType<typeof vi.fn> }
    }
  }
}

const installClientStubs = (
  transport: FeishuTransport,
  overrides: Partial<{
    imageCreate: ReturnType<typeof vi.fn>
    fileCreate: ReturnType<typeof vi.fn>
    messageCreate: ReturnType<typeof vi.fn>
    messageResourceGet: ReturnType<typeof vi.fn>
    messageReactionCreate: ReturnType<typeof vi.fn>
  }> = {}
) => {
  const imageCreate = overrides.imageCreate ?? vi.fn().mockResolvedValue({ image_key: 'img_xyz' })
  const fileCreate = overrides.fileCreate ?? vi.fn().mockResolvedValue({ file_key: 'file_xyz' })
  const messageCreate =
    overrides.messageCreate ?? vi.fn().mockResolvedValue({ data: { message_id: 'om_out' } })
  const messageResourceGet = overrides.messageResourceGet ?? vi.fn()
  const messageReactionCreate =
    overrides.messageReactionCreate ??
    vi.fn().mockResolvedValue({ data: { reaction_id: 'rx_eye' } })
  const client = (transport as unknown as { client: LarkClient }).client
  client.im.v1.image.create = imageCreate
  client.im.v1.file.create = fileCreate
  client.im.v1.message.create = messageCreate
  client.im.v1.messageResource.get = messageResourceGet
  client.im.v1.messageReaction.create = messageReactionCreate
  return { fileCreate, imageCreate, messageCreate, messageReactionCreate, messageResourceGet }
}

const tempDirs: string[] = []
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
  vi.restoreAllMocks()
})

const writeFakeFile = (name: string, size = 256, fill = 0xab) => {
  const dir = mkdtempSync(join(tmpdir(), 'hive-feishu-media-'))
  tempDirs.push(dir)
  const path = join(dir, name)
  writeFileSync(path, Buffer.alloc(size, fill))
  return path
}

describe('FeishuTransport.sendMedia (M44 出站)', () => {
  test('图片走 image.create → msg_type=image，image_key 透传，caption=undefined 不发 text', async () => {
    const transport = makeTransport()
    const { imageCreate, fileCreate, messageCreate } = installClientStubs(transport)
    const path = writeFakeFile('photo.png', 1024)

    const result = await transport.sendMedia({ chatId: 'oc_1', filePath: path })

    expect(result.category).toBe('image')
    expect(result.imageKey).toBe('img_xyz')
    expect(result.fileKey).toBeNull()
    expect(result.fileName).toBe('photo.png')
    expect(result.sentCaption).toBe(false)
    expect(fileCreate).not.toHaveBeenCalled()
    // 真 image.create 调用一次，body 是 Buffer，长度 1024
    expect(imageCreate).toHaveBeenCalledTimes(1)
    const imagePayload = imageCreate.mock.calls[0]?.[0] as {
      data: { image: Buffer; image_type: string }
    }
    expect(imagePayload.data.image_type).toBe('message')
    expect(Buffer.isBuffer(imagePayload.data.image)).toBe(true)
    expect(imagePayload.data.image.length).toBe(1024)
    // message.create 用 msg_type=image，content 含 image_key
    expect(messageCreate).toHaveBeenCalledTimes(1)
    const messagePayload = messageCreate.mock.calls[0]?.[0] as {
      data: { content: string; msg_type: string; receive_id: string }
      params: { receive_id_type: string }
    }
    expect(messagePayload.data.msg_type).toBe('image')
    expect(JSON.parse(messagePayload.data.content)).toEqual({ image_key: 'img_xyz' })
    expect(messagePayload.data.receive_id).toBe('oc_1')
    expect(messagePayload.params.receive_id_type).toBe('chat_id')
  })

  test('视频 .mp4 走 file.create file_type=mp4 → msg_type=media，file_key 透传，caption 紧跟一条 text', async () => {
    const transport = makeTransport()
    const { fileCreate, imageCreate, messageCreate } = installClientStubs(transport, {
      fileCreate: vi.fn().mockResolvedValue({ file_key: 'file_video_1' }),
    })
    const path = writeFakeFile('demo.mp4', 2048)

    const result = await transport.sendMedia({
      caption: '主管发的视频，看一下',
      chatId: 'oc_1',
      filePath: path,
    })

    expect(result.category).toBe('media')
    expect(result.fileKey).toBe('file_video_1')
    expect(result.imageKey).toBeNull()
    expect(result.sentCaption).toBe(true)
    expect(imageCreate).not.toHaveBeenCalled()
    // file.create: file_type=mp4 + file_name=demo.mp4 + file 是 Buffer
    expect(fileCreate).toHaveBeenCalledTimes(1)
    const filePayload = fileCreate.mock.calls[0]?.[0] as {
      data: { file: Buffer; file_name: string; file_type: string }
    }
    expect(filePayload.data.file_type).toBe('mp4')
    expect(filePayload.data.file_name).toBe('demo.mp4')
    expect(filePayload.data.file.length).toBe(2048)
    // message.create 两次：先 msg_type=media（视频），再 msg_type=text（caption）
    expect(messageCreate).toHaveBeenCalledTimes(2)
    const first = messageCreate.mock.calls[0]?.[0] as {
      data: { content: string; msg_type: string }
    }
    expect(first.data.msg_type).toBe('media')
    expect(JSON.parse(first.data.content)).toEqual({ file_key: 'file_video_1' })
    const second = messageCreate.mock.calls[1]?.[0] as {
      data: { content: string; msg_type: string }
    }
    expect(second.data.msg_type).toBe('text')
    expect(JSON.parse(second.data.content).text).toContain('主管发的视频')
  })

  test('其它文件 .pdf 走 file.create file_type=pdf → msg_type=file', async () => {
    const transport = makeTransport()
    const { fileCreate, messageCreate } = installClientStubs(transport, {
      fileCreate: vi.fn().mockResolvedValue({ file_key: 'file_doc_1' }),
    })
    const path = writeFakeFile('handbook.pdf', 4096)

    const result = await transport.sendMedia({ chatId: 'oc_1', filePath: path })

    expect(result.category).toBe('file')
    expect(result.fileKey).toBe('file_doc_1')
    expect(fileCreate.mock.calls[0]?.[0]?.data?.file_type).toBe('pdf')
    const msgPayload = messageCreate.mock.calls[0]?.[0] as {
      data: { msg_type: string; content: string }
    }
    expect(msgPayload.data.msg_type).toBe('file')
    expect(JSON.parse(msgPayload.data.content)).toEqual({ file_key: 'file_doc_1' })
  })

  // 钟馗顺手 #1：非 mp4 视频别伪装 mp4。
  test('非 mp4 视频 .mov 走 file.create file_type=stream + msg_type=file（不伪装 mp4）', async () => {
    const transport = makeTransport()
    const { fileCreate, messageCreate } = installClientStubs(transport, {
      fileCreate: vi.fn().mockResolvedValue({ file_key: 'file_mov_1' }),
    })
    const path = writeFakeFile('clip.mov', 4096)

    const result = await transport.sendMedia({ chatId: 'oc_1', filePath: path })

    expect(result.category).toBe('file')
    expect(fileCreate.mock.calls[0]?.[0]?.data?.file_type).toBe('stream')
    const msgPayload = messageCreate.mock.calls[0]?.[0] as {
      data: { msg_type: string }
    }
    // msg_type 必须是 file，不是 media（飞书原生视频卡仅 .mp4 内容能真正播放）。
    expect(msgPayload.data.msg_type).toBe('file')
  })

  test('非 mp4 视频 .webm 同样走 file 路径', async () => {
    const transport = makeTransport()
    const { fileCreate, messageCreate } = installClientStubs(transport, {
      fileCreate: vi.fn().mockResolvedValue({ file_key: 'file_webm_1' }),
    })
    const path = writeFakeFile('clip.webm', 4096)
    const result = await transport.sendMedia({ chatId: 'oc_1', filePath: path })
    expect(result.category).toBe('file')
    expect(fileCreate.mock.calls[0]?.[0]?.data?.file_type).toBe('stream')
    const msgPayload = messageCreate.mock.calls[0]?.[0] as { data: { msg_type: string } }
    expect(msgPayload.data.msg_type).toBe('file')
  })

  test('未知扩展名 .bin 走 file.create file_type=stream', async () => {
    const transport = makeTransport()
    const { fileCreate } = installClientStubs(transport, {
      fileCreate: vi.fn().mockResolvedValue({ file_key: 'file_bin_1' }),
    })
    const path = writeFakeFile('payload.bin', 512)

    const result = await transport.sendMedia({ chatId: 'oc_1', filePath: path })
    expect(result.category).toBe('file')
    expect(fileCreate.mock.calls[0]?.[0]?.data?.file_type).toBe('stream')
  })

  test('图片超 10MB → 抛错前不调任何 SDK', async () => {
    const transport = makeTransport()
    const { imageCreate, messageCreate } = installClientStubs(transport)
    const path = writeFakeFile('huge.png', 11 * 1024 * 1024)
    await expect(transport.sendMedia({ chatId: 'oc_1', filePath: path })).rejects.toThrow(
      /image upload exceeds 10MB/i
    )
    expect(imageCreate).not.toHaveBeenCalled()
    expect(messageCreate).not.toHaveBeenCalled()
  })

  test('文件超 30MB → 抛错前不调任何 SDK', async () => {
    const transport = makeTransport()
    const { fileCreate, messageCreate } = installClientStubs(transport)
    const path = writeFakeFile('huge.mp4', 31 * 1024 * 1024)
    await expect(transport.sendMedia({ chatId: 'oc_1', filePath: path })).rejects.toThrow(
      /file upload exceeds 30MB/i
    )
    expect(fileCreate).not.toHaveBeenCalled()
    expect(messageCreate).not.toHaveBeenCalled()
  })

  test('源文件不存在 → 抛错前不调 SDK', async () => {
    const transport = makeTransport()
    const { imageCreate, fileCreate, messageCreate } = installClientStubs(transport)
    await expect(
      transport.sendMedia({ chatId: 'oc_1', filePath: '/tmp/m44-does-not-exist-xyz.mp4' })
    ).rejects.toThrow(/Source media file not found/)
    expect(imageCreate).not.toHaveBeenCalled()
    expect(fileCreate).not.toHaveBeenCalled()
    expect(messageCreate).not.toHaveBeenCalled()
  })

  // 钟馗顺手 #3：file.create 缺 file_key 抛错（与 image_key 对称）。
  test('file.create 返回缺 file_key → 抛错前不发 text', async () => {
    const transport = makeTransport()
    const { messageCreate } = installClientStubs(transport, {
      fileCreate: vi.fn().mockResolvedValue({}),
    })
    const path = writeFakeFile('clip.mp4', 256)
    await expect(transport.sendMedia({ chatId: 'oc_1', filePath: path })).rejects.toThrow(
      /file_key/i
    )
    expect(messageCreate).not.toHaveBeenCalled()
  })

  // 钟馗顺手 #3：0 字节文件本地预拒，不调任何 SDK。
  test('0 字节文件 → 本地预拒（不调 SDK，错误清晰）', async () => {
    const transport = makeTransport()
    const { imageCreate, fileCreate, messageCreate } = installClientStubs(transport)
    const path = writeFakeFile('empty.mp4', 0)
    await expect(transport.sendMedia({ chatId: 'oc_1', filePath: path })).rejects.toThrow(/empty/i)
    expect(imageCreate).not.toHaveBeenCalled()
    expect(fileCreate).not.toHaveBeenCalled()
    expect(messageCreate).not.toHaveBeenCalled()
  })

  test('image.create 返回缺 image_key → 抛错', async () => {
    const transport = makeTransport()
    installClientStubs(transport, { imageCreate: vi.fn().mockResolvedValue({}) })
    const path = writeFakeFile('photo.png', 256)
    await expect(transport.sendMedia({ chatId: 'oc_1', filePath: path })).rejects.toThrow(
      /image_key/i
    )
  })

  test('caption 为空白时不发 text', async () => {
    const transport = makeTransport()
    const { messageCreate } = installClientStubs(transport)
    const path = writeFakeFile('demo.mp4', 256)
    const result = await transport.sendMedia({ caption: '   ', chatId: 'oc_1', filePath: path })
    expect(result.sentCaption).toBe(false)
    expect(messageCreate).toHaveBeenCalledTimes(1)
  })
})

describe('FeishuTransport inbound video/file (M44 入站)', () => {
  const makeVideoEvent = () => ({
    message: {
      chat_id: 'oc_1',
      chat_type: 'p2p',
      content: JSON.stringify({ file_key: 'file_in_1', file_name: 'in.mp4' }),
      message_id: 'om_video_1',
      message_type: 'media',
    },
    sender: { sender_id: { user_id: 'ou_1' } },
  })

  const makeFileEvent = () => ({
    message: {
      chat_id: 'oc_1',
      chat_type: 'p2p',
      content: JSON.stringify({ file_key: 'file_in_2', file_name: 'spec.pdf' }),
      message_id: 'om_file_1',
      message_type: 'file',
    },
    sender: { sender_id: { user_id: 'ou_1' } },
  })

  test('msg_type=media → messageResource.get type=file，下载存盘到 uploads，surface media= 路径到 orch', async () => {
    const transport = makeTransport()
    const store = (transport as unknown as { store: RuntimeStore }).store
    const recordUserInput = vi.spyOn(store, 'recordUserInput')
    const buffer = Buffer.from('VIDEOBYTES')
    const messageResourceGet = vi.fn().mockResolvedValue({
      getReadableStream: () => Readable.from([buffer]),
    })
    installClientStubs(transport, { messageResourceGet })

    await (
      transport as unknown as {
        handleMessageReceive: (event: ReturnType<typeof makeVideoEvent>) => Promise<void>
      }
    ).handleMessageReceive(makeVideoEvent())

    expect(messageResourceGet).toHaveBeenCalledTimes(1)
    const callPayload = messageResourceGet.mock.calls[0]?.[0] as {
      params: { type: string }
      path: { file_key: string; message_id: string }
    }
    expect(callPayload.params.type).toBe('file')
    expect(callPayload.path.file_key).toBe('file_in_1')
    expect(callPayload.path.message_id).toBe('om_video_1')

    // 注入 orch 文本含 media= 路径 + 文件名 + 视频提示
    expect(recordUserInput).toHaveBeenCalledTimes(1)
    const args = recordUserInput.mock.calls[0]
    const orchText = args?.[2] ?? ''
    expect(orchText).toContain('[来自飞书视频]')
    expect(orchText).toMatch(/media=[^\s]+\.mp4/u)
    expect(orchText).toContain('file_name=in.mp4')

    // 真存盘到 uploads（提取路径后 readFileSync 验证字节一致）
    const match = orchText.match(/media=([^\s]+)/u)
    expect(match).not.toBeNull()
    const mediaPath = match?.[1] ?? ''
    expect(readFileSync(mediaPath).equals(buffer)).toBe(true)
    rmSync(mediaPath, { force: true })
  })

  test('msg_type=file 非图片扩展（.pdf）→ extractInboundFile → surface 到 orch with file 标签', async () => {
    const transport = makeTransport()
    const store = (transport as unknown as { store: RuntimeStore }).store
    const recordUserInput = vi.spyOn(store, 'recordUserInput')
    const buffer = Buffer.from('PDFBYTES')
    const messageResourceGet = vi.fn().mockResolvedValue({
      getReadableStream: () => Readable.from([buffer]),
    })
    installClientStubs(transport, { messageResourceGet })

    await (
      transport as unknown as {
        handleMessageReceive: (event: ReturnType<typeof makeFileEvent>) => Promise<void>
      }
    ).handleMessageReceive(makeFileEvent())

    expect(messageResourceGet).toHaveBeenCalledTimes(1)
    const callPayload = messageResourceGet.mock.calls[0]?.[0] as {
      params: { type: string }
      path: { file_key: string; message_id: string }
    }
    expect(callPayload.path.file_key).toBe('file_in_2')

    expect(recordUserInput).toHaveBeenCalledTimes(1)
    const args = recordUserInput.mock.calls[0]
    const orchText = args?.[2] ?? ''
    expect(orchText).toContain('[来自飞书文件]')
    expect(orchText).toMatch(/media=[^\s]+\.pdf/u)
    expect(orchText).toContain('file_name=spec.pdf')

    const match = orchText.match(/media=([^\s]+)/u)
    const mediaPath = match?.[1] ?? ''
    expect(readFileSync(mediaPath).equals(buffer)).toBe(true)
    rmSync(mediaPath, { force: true })
  })

  test('msg_type=file 图片扩展（.jpg）仍走旧 image 路径 → image= 标签（向后兼容）', async () => {
    const transport = makeTransport()
    const store = (transport as unknown as { store: RuntimeStore }).store
    const recordUserInput = vi.spyOn(store, 'recordUserInput')
    const buffer = Buffer.from('JPGBYTES')
    const messageResourceGet = vi.fn().mockResolvedValue({
      getReadableStream: () => Readable.from([buffer]),
    })
    installClientStubs(transport, { messageResourceGet })

    const evt = {
      message: {
        chat_id: 'oc_1',
        chat_type: 'p2p',
        content: JSON.stringify({ file_key: 'file_img_1', file_name: 'shot.jpg' }),
        message_id: 'om_img_file',
        message_type: 'file',
      },
      sender: { sender_id: { user_id: 'ou_1' } },
    }
    await (
      transport as unknown as {
        handleMessageReceive: (event: typeof evt) => Promise<void>
      }
    ).handleMessageReceive(evt)

    expect(recordUserInput).toHaveBeenCalledTimes(1)
    const orchText = recordUserInput.mock.calls[0]?.[2] ?? ''
    expect(orchText).toContain('[来自飞书')
    expect(orchText).toMatch(/image=[^\s]+\.jpg/u)
    const match = orchText.match(/image=([^\s\]]+)/u)
    if (match?.[1]) {
      const dir = match[1].slice(0, match[1].lastIndexOf('/'))
      void dir
      rmSync(match[1], { force: true })
    }
  })
})
