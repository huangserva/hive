/**
 * 测试 fixture 严守 RN-safe 路径：不直接用 Node `Buffer`（vitest 在 Node 上跑
 * 会有全局 Buffer，但模块本身不能依赖；测试也走 atob/btoa + Uint8Array 同款
 * RN 路径，避免"测试拿 Buffer 喂数据掩盖生产代码 RN 崩"）。
 */
import { decodeBase64, encodeBase64 } from '@huangserva/hippoteam-relay-crypto'
import { describe, expect, it } from 'vitest'

import {
  buildRelayMediaCacheKey,
  combineBase64Chunks,
  ensureRelayMediaCached,
  type RelayMediaCacheFileSystem,
  type RelayMediaCacheTransport,
  type RelayMediaGetResponse,
} from '../src/lib/relay-media-cache'

const bytesEqual = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false
  }
  return true
}

const buildPattern = (length: number, fn: (i: number) => number): Uint8Array => {
  const out = new Uint8Array(length)
  for (let i = 0; i < length; i += 1) out[i] = fn(i) % 256
  return out
}

const createInMemoryFs = (
  cacheDirectory = 'file:///cache'
): RelayMediaCacheFileSystem & {
  files: Map<string, string>
  dirs: Set<string>
} => {
  const files = new Map<string, string>()
  const dirs = new Set<string>()
  return {
    files,
    dirs,
    cacheDirectory,
    async getInfoAsync(uri) {
      if (dirs.has(uri)) return { exists: true }
      const content = files.get(uri)
      if (content === undefined) return { exists: false }
      // 用 RN-safe decodeBase64 取真字节数；不走 Buffer。
      return { exists: true, size: decodeBase64(content).length }
    },
    async writeAsStringAsync(uri, content, encoding) {
      if (encoding !== 'base64') throw new Error('test fs only supports base64')
      files.set(uri, content)
    },
    async readAsStringAsync(uri) {
      const content = files.get(uri)
      if (content === undefined) throw new Error(`No such file: ${uri}`)
      return content
    },
    async makeDirectoryAsync(uri) {
      dirs.add(uri)
    },
    async deleteAsync(uri) {
      files.delete(uri)
    },
  }
}

const makeChunkedTransport = (
  source: Uint8Array,
  chunkBytes = 256 * 1024
): RelayMediaCacheTransport & { callLog: Array<{ method: string; params: unknown }> } => {
  const callLog: Array<{ method: string; params: unknown }> = []
  return {
    callLog,
    async call<T>(method: string, params?: unknown): Promise<T> {
      callLog.push({ method, params: params ?? null })
      if (method !== 'media.get') throw new Error(`unexpected method ${method}`)
      const requested = params as { offset?: number; length?: number }
      const offset = requested?.offset ?? 0
      const length = Math.min(chunkBytes, requested?.length ?? chunkBytes)
      const slice = source.subarray(offset, offset + length)
      const response: RelayMediaGetResponse = {
        data: encodeBase64(slice),
        eof: offset + slice.length >= source.length,
        length: slice.length,
        offset,
        total_size: source.length,
      }
      return response as T
    },
  }
}

describe('relay-media-cache', () => {
  it('buildRelayMediaCacheKey: 接受合法 basename，拒绝 traversal/空字段', () => {
    expect(buildRelayMediaCacheKey('/api/mobile/uploads/abc.mp4')).toBe('abc.mp4')
    expect(buildRelayMediaCacheKey('/api/mobile/uploads/')).toBeNull()
    expect(buildRelayMediaCacheKey('/api/mobile/uploads/../etc/passwd')).toBeNull()
    expect(buildRelayMediaCacheKey('/api/mobile/uploads/nested/a.mp4')).toBeNull()
    expect(buildRelayMediaCacheKey('/other/path.mp4')).toBeNull()
  })

  it('钟馗 blocking 焊死: dot-segment basename `.` / `..`（无斜杠原本被现有正则放行）必须挡', () => {
    // 触发场景：mediaUrl='/api/mobile/uploads/..' → 旧实现拼成 <cacheDir>/hippoteam-media/..
    // = 父目录语义，LAN download 喂给 downloadAsync/getInfoAsync/deleteAsync 最坏污染 cache 外层。
    expect(buildRelayMediaCacheKey('/api/mobile/uploads/.')).toBeNull()
    expect(buildRelayMediaCacheKey('/api/mobile/uploads/..')).toBeNull()
  })

  it('钟馗 blocking 焊死: 纯符号 basename（`...` / `--` / `_-`）也挡——要求至少一个字母/数字', () => {
    // 防 `...` `....` 这类 dot-segment 变体（POSIX/部分 fs 解析成当前/父目录）
    // 以及纯连字符/下划线“占位名”——真实媒体 basename 永远含字母数字。
    expect(buildRelayMediaCacheKey('/api/mobile/uploads/...')).toBeNull()
    expect(buildRelayMediaCacheKey('/api/mobile/uploads/....')).toBeNull()
    expect(buildRelayMediaCacheKey('/api/mobile/uploads/--')).toBeNull()
    expect(buildRelayMediaCacheKey('/api/mobile/uploads/_-')).toBeNull()
  })

  it('combineBase64Chunks 单段直接返回；多段 256KB 边界 RN-safe 重组等于原 base64', () => {
    expect(combineBase64Chunks([])).toBe('')
    expect(combineBase64Chunks(['QUJD'])).toBe('QUJD')
    const source = buildPattern(256 * 1024 * 3 + 100, (i) => i * 13 + 5)
    const chunkSize = 256 * 1024
    const chunks: string[] = []
    for (let offset = 0; offset < source.length; offset += chunkSize) {
      chunks.push(encodeBase64(source.subarray(offset, offset + chunkSize)))
    }
    const combined = combineBase64Chunks(chunks)
    expect(combined).toBe(encodeBase64(source))
  })

  it('ensureRelayMediaCached: 真分块拉回，重组后字节完全等于源文件', async () => {
    const source = buildPattern(700 * 1024, (i) => i * 7 + 11)
    const transport = makeChunkedTransport(source)
    const fs = createInMemoryFs()
    const progress: Array<{ bytesDownloaded: number; totalBytes: number }> = []
    const cachePath = await ensureRelayMediaCached('/api/mobile/uploads/big.mp4', transport, fs, {
      chunkBytes: 256 * 1024,
      expectedTotalBytes: source.length,
      onProgress: (next) => progress.push(next),
    })
    expect(cachePath).toBe('file:///cache/hippoteam-media/big.mp4')
    expect(fs.dirs.has('file:///cache/hippoteam-media')).toBe(true)
    const stored = fs.files.get(cachePath)
    if (!stored) throw new Error('cache file missing')
    const decoded = decodeBase64(stored)
    expect(bytesEqual(decoded, source)).toBe(true)
    expect(progress.length).toBeGreaterThanOrEqual(3)
    expect(progress[progress.length - 1]?.bytesDownloaded).toBe(source.length)
    expect(progress[progress.length - 1]?.totalBytes).toBe(source.length)
    expect(transport.callLog.length).toBe(3)
  })

  it('已缓存且 size 一致 → 不发起任何 media.get 调用（节流）', async () => {
    const transport = makeChunkedTransport(new Uint8Array(0))
    const fs = createInMemoryFs()
    fs.dirs.add('file:///cache/hippoteam-media')
    const cachePath = 'file:///cache/hippoteam-media/abc.mp4'
    const cachedBytes = new TextEncoder().encode('hello world')
    fs.files.set(cachePath, encodeBase64(cachedBytes))
    const result = await ensureRelayMediaCached('/api/mobile/uploads/abc.mp4', transport, fs, {
      expectedTotalBytes: cachedBytes.length,
    })
    expect(result).toBe(cachePath)
    expect(transport.callLog.length).toBe(0)
  })

  it('URL 不在 /api/mobile/uploads/ 下 → 抛错', async () => {
    const transport = makeChunkedTransport(new Uint8Array(10))
    const fs = createInMemoryFs()
    await expect(ensureRelayMediaCached('/something/else.mp4', transport, fs)).rejects.toThrow(
      /uploads/
    )
  })

  it('服务端返 0 长度但 eof=false → 协议异常抛错防卡死', async () => {
    const fs = createInMemoryFs()
    const transport: RelayMediaCacheTransport = {
      async call<T>(_method: string, _params?: unknown): Promise<T> {
        return { data: '', eof: false, length: 0, offset: 0, total_size: 1000 } as unknown as T
      },
    }
    await expect(
      ensureRelayMediaCached('/api/mobile/uploads/x.mp4', transport, fs)
    ).rejects.toThrow(/empty chunk/i)
  })

  it('chunk offset 错位 → 抛错（防服务端响应被错配）', async () => {
    const fs = createInMemoryFs()
    const transport: RelayMediaCacheTransport = {
      async call<T>(_method: string, params?: unknown): Promise<T> {
        const requested = params as { offset: number; length: number }
        return {
          data: 'AAAA',
          eof: false,
          length: 3,
          offset: requested.offset + 99,
          total_size: 1000,
        } as unknown as T
      },
    }
    await expect(
      ensureRelayMediaCached('/api/mobile/uploads/x.mp4', transport, fs)
    ).rejects.toThrow(/offset mismatch/i)
  })

  it('signal.aborted → 抛 aborted 错误，停止后续 round-trip', async () => {
    const source = buildPattern(700 * 1024, (i) => i)
    const transport = makeChunkedTransport(source)
    const fs = createInMemoryFs()
    const signal = { aborted: false }
    let callCount = 0
    const wrappedTransport: RelayMediaCacheTransport = {
      async call<T>(method: string, params?: unknown): Promise<T> {
        callCount += 1
        if (callCount === 2) signal.aborted = true
        return transport.call(method, params)
      },
    }
    await expect(
      ensureRelayMediaCached('/api/mobile/uploads/abort.mp4', wrappedTransport, fs, {
        chunkBytes: 256 * 1024,
        expectedTotalBytes: source.length,
        signal,
      })
    ).rejects.toThrow(/aborted/i)
    expect(callCount).toBeLessThanOrEqual(2)
  })

  it('总 size 在中途变化（服务端文件改了）→ 抛错', async () => {
    const fs = createInMemoryFs()
    let firstCall = true
    const totalSecond = 2 * 1024 - 1
    const transport: RelayMediaCacheTransport = {
      async call<T>(_method: string, params?: unknown): Promise<T> {
        const requested = params as { offset: number; length: number }
        const total = firstCall ? 3 * 1024 : totalSecond
        firstCall = false
        const length = Math.min(requested.length, 1024)
        return {
          data: encodeBase64(new Uint8Array(length)),
          eof: false,
          length,
          offset: requested.offset,
          total_size: total,
        } as unknown as T
      },
    }
    await expect(
      ensureRelayMediaCached('/api/mobile/uploads/shift.mp4', transport, fs, {
        chunkBytes: 1024,
        expectedTotalBytes: 3 * 1024,
      })
    ).rejects.toThrow(/total_size shifted/)
  })

  // ↓↓↓ 钟馗 blocking #4 红绿：真 decode 必须能识破"长度头骗局"。

  it('非法 base64（header length=3 但 data="!!!!" decode 抛错）→ 拒，不写缓存', async () => {
    const fs = createInMemoryFs()
    const transport: RelayMediaCacheTransport = {
      async call<T>(_method: string, params?: unknown): Promise<T> {
        const requested = params as { offset: number }
        return {
          data: '!!!!', // 4 字符但全是非 base64 字母 → atob 抛
          eof: true,
          length: 3,
          offset: requested.offset,
          total_size: 3,
        } as unknown as T
      },
    }
    await expect(
      ensureRelayMediaCached('/api/mobile/uploads/bad.mp4', transport, fs)
    ).rejects.toThrow(/base64 decode/i)
    expect(fs.files.size).toBe(0)
  })

  it('header length 与真 decode 字节数不符 → 拒（4 字节真 decode, 但 header 说 5）', async () => {
    const fs = createInMemoryFs()
    const transport: RelayMediaCacheTransport = {
      async call<T>(_method: string, params?: unknown): Promise<T> {
        const requested = params as { offset: number }
        // base64 'AAAAAA==' decode 真是 4 字节，但 header 谎称 5
        return {
          data: 'AAAAAA==',
          eof: true,
          length: 5,
          offset: requested.offset,
          total_size: 5,
        } as unknown as T
      },
    }
    await expect(
      ensureRelayMediaCached('/api/mobile/uploads/lie.mp4', transport, fs)
    ).rejects.toThrow(/length mismatch/i)
    expect(fs.files.size).toBe(0)
  })

  it('生产代码不引用全局 Buffer：模块体 source 不含 `Buffer` 标识符（注释/字符串字面量除外）', async () => {
    // 这条不是替代 RN 真机回归，但是 cheap 静态护栏：防未来有人重新引入
    // 全局 Buffer 又掩盖测试。读模块源文件 grep 字面量。
    const { readFile } = await import('node:fs/promises')
    const { fileURLToPath } = await import('node:url')
    const url = new URL('../src/lib/relay-media-cache.ts', import.meta.url)
    const source = await readFile(fileURLToPath(url), 'utf8')
    // 移除所有 // 单行注释 + /* */ 块注释 + 字符串字面量，再 grep Buffer 标识符。
    const stripped = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')
      .replace(/`(?:\\.|[^`])*`/g, "''")
      .replace(/'(?:\\.|[^'])*'/g, "''")
      .replace(/"(?:\\.|[^"])*"/g, '""')
    expect(stripped).not.toMatch(/\bBuffer\b/)
  })
})
