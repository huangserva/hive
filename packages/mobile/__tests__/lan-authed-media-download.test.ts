import { describe, expect, it } from 'vitest'

import {
  type AuthedDownloader,
  type AuthedDownloaderResult,
  type DownloadAuthedToCacheDeps,
  downloadAuthedToCache,
} from '../src/lib/lan-authed-media-download'

const CACHE_PATH = 'file:///cache/hippoteam-media/abc.png'
const LAN_URL = 'http://192.168.1.44:4010/api/mobile/uploads/abc.png'

interface FakeFs {
  /** size 表中存在即视为文件存在；不存在则 getInfoAsync 返 { exists:false }。 */
  files: Map<string, number>
  /** 删除调用日志（顺序、参数）。 */
  deletes: Array<{ uri: string; options?: { idempotent?: boolean } }>
}

interface FakeDownloader {
  /** downloadAsync 调用日志（顺序 + 完整参数，断言 header）。 */
  calls: Array<{
    uri: string
    fileUri: string
    options: { headers: Record<string, string> }
  }>
  result: AuthedDownloaderResult | Promise<AuthedDownloaderResult>
  /** 触发 reject（断言 catch 路径删 partial）。 */
  reject?: Error
  /** 下载完后写入的真 size（模拟实际写盘）；undefined 表示不更新 files。 */
  writeSize?: number
}

const createDeps = (
  fakeFs: FakeFs,
  fakeDownloader: FakeDownloader
): DownloadAuthedToCacheDeps & { fakeFs: FakeFs; fakeDownloader: FakeDownloader } => {
  let ensureCalls = 0
  const downloader: AuthedDownloader = {
    async downloadAsync(uri, fileUri, options) {
      fakeDownloader.calls.push({ fileUri, options, uri })
      if (fakeDownloader.reject) {
        throw fakeDownloader.reject
      }
      // 模拟下载成功后写入文件
      if (typeof fakeDownloader.writeSize === 'number') {
        fakeFs.files.set(fileUri, fakeDownloader.writeSize)
      }
      return fakeDownloader.result
    },
  }
  return {
    fakeFs,
    fakeDownloader,
    ensureCacheDir: async () => {
      ensureCalls += 1
      return ensureCalls
    },
    fs: {
      async getInfoAsync(uri) {
        const size = fakeFs.files.get(uri)
        return size === undefined ? { exists: false } : { exists: true, size }
      },
      async deleteAsync(uri, options) {
        fakeFs.deletes.push({ options, uri })
        fakeFs.files.delete(uri)
      },
    },
    downloader,
  }
}

const newSignal = () => ({ aborted: false })

describe('downloadAuthedToCache（LAN authed I/O 主路径·直测）', () => {
  it('钟馗 #1：调 downloadAsync 时 headers 真带 `Authorization: Bearer <token>`（漏 header 必红）', async () => {
    const fakeFs: FakeFs = { deletes: [], files: new Map() }
    const fakeDownloader: FakeDownloader = {
      calls: [],
      result: { status: 200 },
      writeSize: 1024,
    }
    const deps = createDeps(fakeFs, fakeDownloader)
    await downloadAuthedToCache(
      {
        authToken: 'tok-abc',
        cachePath: CACHE_PATH,
        expectedSize: 1024,
        lanUrl: LAN_URL,
        signal: newSignal(),
      },
      deps
    )
    expect(fakeDownloader.calls).toHaveLength(1)
    const call = fakeDownloader.calls[0]
    if (!call) throw new Error('expected downloadAsync to be called')
    expect(call.uri).toBe(LAN_URL)
    expect(call.fileUri).toBe(CACHE_PATH)
    expect(call.options.headers).toEqual({ Authorization: 'Bearer tok-abc' })
  })

  it('钟馗 #2：返回非 2xx → 删 cachePath + throw（不信坏缓存）', async () => {
    const fakeFs: FakeFs = { deletes: [], files: new Map() }
    const fakeDownloader: FakeDownloader = {
      calls: [],
      result: { status: 404 },
      writeSize: 0, // 模拟原生下载即使 404 也写了占位文件
    }
    const deps = createDeps(fakeFs, fakeDownloader)
    await expect(
      downloadAuthedToCache(
        {
          authToken: 'tok',
          cachePath: CACHE_PATH,
          expectedSize: 1024,
          lanUrl: LAN_URL,
          signal: newSignal(),
        },
        deps
      )
    ).rejects.toThrow(/HTTP 404/u)
    expect(fakeFs.deletes).toContainEqual({ options: { idempotent: true }, uri: CACHE_PATH })
    expect(fakeFs.files.has(CACHE_PATH)).toBe(false)
  })

  it('钟馗 #3：status 2xx 但 size 与 expectedSize 不符 → 删 cachePath + throw', async () => {
    const fakeFs: FakeFs = { deletes: [], files: new Map() }
    const fakeDownloader: FakeDownloader = {
      calls: [],
      result: { status: 200 },
      writeSize: 512, // 实际只写了 512，但 expectedSize=1024
    }
    const deps = createDeps(fakeFs, fakeDownloader)
    await expect(
      downloadAuthedToCache(
        {
          authToken: 'tok',
          cachePath: CACHE_PATH,
          expectedSize: 1024,
          lanUrl: LAN_URL,
          signal: newSignal(),
        },
        deps
      )
    ).rejects.toThrow(/size mismatch/u)
    expect(fakeFs.deletes).toContainEqual({ options: { idempotent: true }, uri: CACHE_PATH })
    expect(fakeFs.files.has(CACHE_PATH)).toBe(false)
  })

  it('钟馗 #4：成功（2xx + size 对）→ 不抛、不删，files 中保留', async () => {
    const fakeFs: FakeFs = { deletes: [], files: new Map() }
    const fakeDownloader: FakeDownloader = {
      calls: [],
      result: { status: 200 },
      writeSize: 1024,
    }
    const deps = createDeps(fakeFs, fakeDownloader)
    await downloadAuthedToCache(
      {
        authToken: 'tok',
        cachePath: CACHE_PATH,
        expectedSize: 1024,
        lanUrl: LAN_URL,
        signal: newSignal(),
      },
      deps
    )
    expect(fakeFs.deletes).toHaveLength(0)
    expect(fakeFs.files.get(CACHE_PATH)).toBe(1024)
  })

  it('钟馗 non-blocking #2：downloadAsync 自身 reject → catch 兜底删 cachePath + 重抛', async () => {
    // 关键：起手 fs 里没有 CACHE_PATH（避免 existing 短路），模拟首次下载且 downloadAsync
    // 异常中断（可能留 partial 文件，原生 downloadAsync 不保证清理）。catch 路径应
    // 调一次 deleteAsync({idempotent:true}) 兜底。
    const fakeFs: FakeFs = { deletes: [], files: new Map() }
    const fakeDownloader: FakeDownloader = {
      calls: [],
      result: { status: 200 },
      reject: new Error('Network unreachable'),
    }
    const deps = createDeps(fakeFs, fakeDownloader)
    await expect(
      downloadAuthedToCache(
        {
          authToken: 'tok',
          cachePath: CACHE_PATH,
          // expectedSize=null 验"未来 existing.exists 短路被信任"的最坏情况——
          // 兜底删 partial 后下次必走全新下载，不会被坏文件污染。
          expectedSize: null,
          lanUrl: LAN_URL,
          signal: newSignal(),
        },
        deps
      )
    ).rejects.toThrow(/Network unreachable/u)
    expect(fakeFs.deletes).toContainEqual({ options: { idempotent: true }, uri: CACHE_PATH })
  })

  it('existing cache 命中（size 一致）→ 直接复用，不发起 downloadAsync', async () => {
    const fakeFs: FakeFs = { deletes: [], files: new Map([[CACHE_PATH, 1024]]) }
    const fakeDownloader: FakeDownloader = {
      calls: [],
      result: { status: 200 },
    }
    const deps = createDeps(fakeFs, fakeDownloader)
    await downloadAuthedToCache(
      {
        authToken: 'tok',
        cachePath: CACHE_PATH,
        expectedSize: 1024,
        lanUrl: LAN_URL,
        signal: newSignal(),
      },
      deps
    )
    expect(fakeDownloader.calls).toHaveLength(0)
    expect(fakeFs.deletes).toHaveLength(0)
  })

  it('existing cache size 不符 expectedSize → 先删旧再下', async () => {
    const fakeFs: FakeFs = { deletes: [], files: new Map([[CACHE_PATH, 512]]) }
    const fakeDownloader: FakeDownloader = {
      calls: [],
      result: { status: 200 },
      writeSize: 1024,
    }
    const deps = createDeps(fakeFs, fakeDownloader)
    await downloadAuthedToCache(
      {
        authToken: 'tok',
        cachePath: CACHE_PATH,
        expectedSize: 1024,
        lanUrl: LAN_URL,
        signal: newSignal(),
      },
      deps
    )
    expect(fakeFs.deletes[0]).toEqual({ options: { idempotent: true }, uri: CACHE_PATH })
    expect(fakeDownloader.calls).toHaveLength(1)
    expect(fakeFs.files.get(CACHE_PATH)).toBe(1024)
  })

  it('signal 在 ensureCacheDir 后就置位 → 立刻 throw，不发起 downloadAsync', async () => {
    const fakeFs: FakeFs = { deletes: [], files: new Map() }
    const fakeDownloader: FakeDownloader = { calls: [], result: { status: 200 } }
    const deps = createDeps(fakeFs, fakeDownloader)
    const signal = { aborted: true }
    await expect(
      downloadAuthedToCache(
        {
          authToken: 'tok',
          cachePath: CACHE_PATH,
          expectedSize: 1024,
          lanUrl: LAN_URL,
          signal,
        },
        deps
      )
    ).rejects.toThrow(/aborted before start/u)
    expect(fakeDownloader.calls).toHaveLength(0)
  })

  it('signal 在 downloadAsync 之后置位 → 不抛、不删，缓存保留供下次复用', async () => {
    const fakeFs: FakeFs = { deletes: [], files: new Map() }
    const signal = { aborted: false }
    // 自定义 downloader：在 downloadAsync 真正返回前才翻 abort，模拟"下完才发现被
    // 取消"——caller 通常这种时候已经 unmount。期望：函数静默 return，不动 cache。
    const customDownloader: AuthedDownloader = {
      async downloadAsync(_uri, fileUri, _options) {
        fakeFs.files.set(fileUri, 1024)
        signal.aborted = true
        return { status: 200 }
      },
    }
    let ensureCalls = 0
    const customDeps: DownloadAuthedToCacheDeps = {
      ensureCacheDir: async () => {
        ensureCalls += 1
      },
      fs: {
        async getInfoAsync(path) {
          const size = fakeFs.files.get(path)
          return size === undefined ? { exists: false } : { exists: true, size }
        },
        async deleteAsync(path, options) {
          fakeFs.deletes.push({ options, uri: path })
          fakeFs.files.delete(path)
        },
      },
      downloader: customDownloader,
    }
    await downloadAuthedToCache(
      {
        authToken: 'tok',
        cachePath: CACHE_PATH,
        expectedSize: 1024,
        lanUrl: LAN_URL,
        signal,
      },
      customDeps
    )
    expect(ensureCalls).toBe(1)
    // abort 在 download 后置位 → 静默 return，不删（缓存留给下次复用）
    expect(fakeFs.deletes).toHaveLength(0)
    expect(fakeFs.files.get(CACHE_PATH)).toBe(1024)
  })
})
