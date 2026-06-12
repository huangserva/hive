import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { platform, tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createRelayRpcHandler } from '../../src/server/relay-rpc-handler.js'

const tempDirs: string[] = []

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

type RelayHandlerDeps = Parameters<typeof createRelayRpcHandler>[0]
type RelayTestStore = RelayHandlerDeps['store']

const createStubStore = (): RelayTestStore =>
  ({
    addWorker: vi.fn(),
    approvalLedger: { get: vi.fn(), resolve: vi.fn() },
    configureAgentLaunch: vi.fn(),
    deleteWorker: vi.fn(),
    dispatchTask: vi.fn(),
    getActiveRunByAgentId: vi.fn(),
    getAgent: vi.fn(),
    getPtySnapshotForAgent: vi.fn(),
    getWorkspaceSnapshot: vi.fn(),
    getWorker: vi.fn(),
    insertMobileChatMessage: vi.fn(),
    listDispatches: vi.fn(() => []),
    listMobileChatMessages: vi.fn(() => []),
    listWorkers: vi.fn(() => []),
    listWorkspaces: vi.fn(() => []),
    notifyQuestionAnswered: vi.fn(),
    peekAgentLaunchConfig: vi.fn(),
    recordUserInput: vi.fn(),
    requireMobileCapability: vi.fn((device: unknown) => device),
    settings: { listCommandPresets: vi.fn(() => []) } as unknown as RelayTestStore['settings'],
    startAgent: vi.fn(),
    stopAgentRun: vi.fn(),
    updateMobilePushToken: vi.fn(),
  }) as unknown as RelayTestStore

const setup = () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'hive-media-get-'))
  tempDirs.push(dataDir)
  const uploadsDir = join(dataDir, 'uploads')
  mkdirSync(uploadsDir, { recursive: true })
  const store = createStubStore()
  const handler = createRelayRpcHandler({
    runtimeInfo: { dataDir, port: 4010 },
    store,
  })
  return { dataDir, handler, uploadsDir }
}

describe('relay-rpc media.get', () => {
  it('返回首段 chunk + total_size + eof=false（offset=0, 中段）', async () => {
    const { handler, uploadsDir } = setup()
    const fileId = '11111111-2222-3333-4444-555555555555'
    const totalSize = 750_000 // 约 256KB * 2.86
    writeFileSync(join(uploadsDir, `${fileId}.mp4`), Buffer.alloc(totalSize, 0xab))

    const response = (await handler(
      'media.get',
      { url: `/api/mobile/uploads/${fileId}.mp4`, offset: 0, length: 256 * 1024 },
      'device-1',
      ['read_dashboard']
    )) as {
      data: string
      eof: boolean
      length: number
      offset: number
      total_size: number
    }
    expect(response.offset).toBe(0)
    expect(response.total_size).toBe(totalSize)
    expect(response.length).toBe(256 * 1024)
    expect(response.eof).toBe(false)
    const decoded = Buffer.from(response.data, 'base64')
    expect(decoded.length).toBe(256 * 1024)
    // 内容确实是源字节，不是随机串
    expect(decoded[0]).toBe(0xab)
    expect(decoded[decoded.length - 1]).toBe(0xab)
  })

  it('末段 chunk eof=true + length 截断到剩余字节', async () => {
    const { handler, uploadsDir } = setup()
    const fileId = '22222222-3333-4444-5555-666666666666'
    const totalSize = 100 // 比 chunkBytes 小很多
    writeFileSync(join(uploadsDir, `${fileId}.mp4`), Buffer.alloc(totalSize, 0x42))
    const response = (await handler(
      'media.get',
      { url: `/api/mobile/uploads/${fileId}.mp4`, offset: 0 },
      'device-1',
      ['read_dashboard']
    )) as { length: number; eof: boolean; total_size: number }
    expect(response.length).toBe(100)
    expect(response.eof).toBe(true)
    expect(response.total_size).toBe(100)
  })

  it('分块重组：3 chunk 拼回原始字节', async () => {
    const { handler, uploadsDir } = setup()
    const fileId = '33333333-4444-5555-6666-777777777777'
    const chunkSize = 1024
    const originalBuf = Buffer.alloc(chunkSize * 2 + 500)
    for (let i = 0; i < originalBuf.length; i += 1) originalBuf[i] = (i * 7 + 3) % 256
    writeFileSync(join(uploadsDir, `${fileId}.mp4`), originalBuf)
    const reassembled = Buffer.alloc(originalBuf.length)
    let cursor = 0
    while (cursor < originalBuf.length) {
      const response = (await handler(
        'media.get',
        { url: `/api/mobile/uploads/${fileId}.mp4`, offset: cursor, length: chunkSize },
        'device-1',
        ['read_dashboard']
      )) as { data: string; length: number; eof: boolean; offset: number }
      expect(response.offset).toBe(cursor)
      const decoded = Buffer.from(response.data, 'base64')
      decoded.copy(reassembled, cursor)
      cursor += response.length
      if (response.eof) break
    }
    expect(cursor).toBe(originalBuf.length)
    expect(reassembled.equals(originalBuf)).toBe(true)
  })

  it('symlink 逃逸（uploads/<uuid>.mp4 → /etc/passwd 或 dataDir 外）→ 拒（钟馗 B3）', async () => {
    if (platform() === 'win32') {
      // Windows 创建 symlink 通常需要管理员；CI 上跳过此条而不假装通过。
      return
    }
    const { handler, uploadsDir, dataDir } = setup()
    // 在 dataDir 外建一个真"敏感"文件，模拟 /etc/passwd 角色。
    const sensitive = join(tmpdir(), `media-get-symlink-target-${process.pid}.txt`)
    writeFileSync(sensitive, 'SHOULD_NEVER_BE_READ_VIA_RELAY')
    try {
      const fileId = '99999999-aaaa-bbbb-cccc-dddddddddddd'
      symlinkSync(sensitive, join(uploadsDir, `${fileId}.mp4`))
      await expect(
        handler(
          'media.get',
          { url: `/api/mobile/uploads/${fileId}.mp4`, offset: 0, length: 16 },
          'device-1',
          ['read_dashboard']
        )
      ).rejects.toThrow(/symbolic link|escapes|invalid/i)
    } finally {
      rmSync(sensitive, { force: true })
      void dataDir
    }
  })

  it('symlink 即使指向 uploads 内合法文件也拒（硬规则：upload 写入路径不会产生 symlink）', async () => {
    if (platform() === 'win32') return
    const { handler, uploadsDir } = setup()
    const realFile = join(uploadsDir, '88888888-1111-2222-3333-444444444444.mp4')
    writeFileSync(realFile, Buffer.alloc(64, 0x11))
    const linkFile = join(uploadsDir, '88888888-1111-2222-3333-444444444445.mp4')
    symlinkSync(realFile, linkFile)
    await expect(
      handler(
        'media.get',
        { url: '/api/mobile/uploads/88888888-1111-2222-3333-444444444445.mp4', offset: 0 },
        'device-1',
        ['read_dashboard']
      )
    ).rejects.toThrow(/symbolic link/i)
  })

  it('path traversal `../etc/passwd` 拒绝', async () => {
    const { handler } = setup()
    await expect(
      handler(
        'media.get',
        { url: '/api/mobile/uploads/../../../etc/passwd', offset: 0 },
        'device-1',
        ['read_dashboard']
      )
    ).rejects.toThrow()
  })

  it('basename 含 / 拒绝', async () => {
    const { handler } = setup()
    await expect(
      handler('media.get', { url: '/api/mobile/uploads/nested/file.mp4' }, 'device-1', [
        'read_dashboard',
      ])
    ).rejects.toThrow()
  })

  it('错 url 前缀（非 /api/mobile/uploads/）拒绝', async () => {
    const { handler } = setup()
    await expect(
      handler('media.get', { url: '/some/other/path.mp4' }, 'device-1', ['read_dashboard'])
    ).rejects.toThrow()
  })

  it('文件不存在 → 抛错', async () => {
    const { handler } = setup()
    await expect(
      handler(
        'media.get',
        { url: '/api/mobile/uploads/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.mp4' },
        'device-1',
        ['read_dashboard']
      )
    ).rejects.toThrow(/not found/i)
  })

  it('offset 超出 total_size → 抛错', async () => {
    const { handler, uploadsDir } = setup()
    const fileId = '44444444-5555-6666-7777-888888888888'
    writeFileSync(join(uploadsDir, `${fileId}.mp4`), Buffer.alloc(100))
    await expect(
      handler('media.get', { url: `/api/mobile/uploads/${fileId}.mp4`, offset: 500 }, 'device-1', [
        'read_dashboard',
      ])
    ).rejects.toThrow(/offset/i)
  })

  it('鉴权：缺 read_dashboard capability → requireMobileCapability 报错', async () => {
    const fresh = setup()
    const fileId = '55555555-6666-7777-8888-999999999999'
    writeFileSync(join(fresh.uploadsDir, `${fileId}.mp4`), Buffer.alloc(10))
    // requireMobileCapability 的 stub 默认通过；这里覆盖成校验 cap 列表
    const stricterHandler = createRelayRpcHandler({
      runtimeInfo: { dataDir: fresh.dataDir, port: 4010 },
      store: {
        ...createStubStore(),
        requireMobileCapability: vi.fn((device: unknown, cap: string) => {
          const caps = (device as { capabilities?: string[] })?.capabilities ?? []
          if (!caps.includes(cap)) throw new Error(`missing ${cap}`)
          return device
        }),
      } as unknown as RelayTestStore,
    })
    await expect(
      stricterHandler(
        'media.get',
        { url: `/api/mobile/uploads/${fileId}.mp4` },
        'device-1',
        [] // no read_dashboard
      )
    ).rejects.toThrow(/missing read_dashboard/i)
  })

  it('length 超过上限钳到 1MB，低于 1KB 钳到 1KB', async () => {
    const { handler, uploadsDir } = setup()
    const fileId = '66666666-7777-8888-9999-aaaaaaaaaaaa'
    writeFileSync(join(uploadsDir, `${fileId}.mp4`), Buffer.alloc(4 * 1024 * 1024))
    const tooBig = (await handler(
      'media.get',
      { url: `/api/mobile/uploads/${fileId}.mp4`, length: 10 * 1024 * 1024 },
      'device-1',
      ['read_dashboard']
    )) as { length: number }
    expect(tooBig.length).toBe(1024 * 1024)
    const tooSmall = (await handler(
      'media.get',
      { url: `/api/mobile/uploads/${fileId}.mp4`, length: 32 },
      'device-1',
      ['read_dashboard']
    )) as { length: number }
    expect(tooSmall.length).toBe(1024)
  })
})
