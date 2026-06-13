import { decodeBase64, encodeBase64 } from '@huangserva/hippoteam-relay-crypto'

/**
 * Relay 模式下媒体（图片/视频）的分块下载 + 本地文件缓存。
 *
 * 背景：4G/外网下 app 不能直连 4010 的 `/api/mobile/uploads/...` 取媒体字节；
 * 必须经 relay JSON-RPC `media.get(url, offset, length)` 分块拉。重组后写到
 * Expo FileSystem 本地缓存，给 VideoView / Image 一个 `file://` URI 让原生
 * 解码器播放（VideoView 不支持 base64 inline 大视频）。
 *
 * **base64 处理走 `@huangserva/hippoteam-relay-crypto` 的 `decodeBase64 / encodeBase64`**，
 * 它们用 RN Hermes/Node 全局都有的 `atob/btoa` + `Uint8Array`，绝不依赖 Node 的 `Buffer`
 * （Hermes 真机没有 global Buffer，钟馗 blocking #1：之前的 `Buffer.from/concat` 在 RN
 * 上 ReferenceError 必崩）。
 *
 * 这里只做"分块协议 + 缓存"纯逻辑，I/O 全部走依赖注入（fileSystem / transport），
 * 让单测可以无 mock 跑出确定结果。
 */

export interface RelayMediaCacheTransport {
  call<T>(method: string, params?: unknown): Promise<T>
}

export interface RelayMediaGetResponse {
  data: string
  eof: boolean
  length: number
  offset: number
  total_size: number
}

export interface RelayMediaCacheFileSystem {
  /** Expo `cacheDirectory` 等同；以 file:// 开头。 */
  cacheDirectory: string
  /** 读元信息；不存在时返回 `{ exists: false }`。 */
  getInfoAsync(uri: string): Promise<{ exists: boolean; size?: number }>
  /** 写整段 base64 内容到 uri。 */
  writeAsStringAsync(uri: string, content: string, encoding: 'base64' | 'utf8'): Promise<void>
  /** 读 base64 内容（用于 incremental append）。 */
  readAsStringAsync(uri: string, encoding: 'base64'): Promise<string>
  /** 确保目录存在。 */
  makeDirectoryAsync(uri: string, options?: { intermediates?: boolean }): Promise<void>
  /** 删除文件（不存在不报错）。 */
  deleteAsync(uri: string, options?: { idempotent?: boolean }): Promise<void>
}

export interface RelayMediaCacheProgress {
  bytesDownloaded: number
  totalBytes: number
}

export interface RelayMediaCacheOptions {
  /** chunk 大小（字节）；默认 256KB，服务端硬上限 1MB。 */
  chunkBytes?: number
  /** 已知文件总大小；用于把下载进度归一化（避免拉首 chunk 才知道）。 */
  expectedTotalBytes?: number | null
  /** 每收一个 chunk 回调一次（用于进度条）。 */
  onProgress?: (progress: RelayMediaCacheProgress) => void
  /** 单测注入；生产用 Date.now。 */
  now?: () => number
  /** AbortSignal：组件卸载时调用方主动 abort。 */
  signal?: { aborted: boolean; addEventListener?: (type: 'abort', cb: () => void) => void }
}

const DEFAULT_CHUNK_BYTES = 256 * 1024
const RELAY_UPLOADS_URL_PREFIX = '/api/mobile/uploads/'
const SAFE_BASENAME = /^[A-Za-z0-9_.-]+$/u
const DOT_SEGMENT_BASENAME = /^\.\.?$/u
const HAS_ALPHA_OR_DIGIT = /[A-Za-z0-9]/u

/**
 * 把 chat-message 里的 `/api/mobile/uploads/<basename>` 映射成稳定 cache key。
 * 同一文件复用同一 key，重复点不重复下；不同 url（不同 basename）有独立 key。
 *
 * **path-traversal 焊死（钟馗 blocking 2026-06-14）**：SAFE_BASENAME 只挡含斜杠
 * 的 `../etc/passwd`，但精确 `.` 和 `..`（无斜杠）原本被放行——一旦走进
 * `resolveRelayMediaCachePath` 就拼成 `<cacheDir>/hippoteam-media/..` 或 `/.`
 * 父目录/当前目录语义；LAN download 分支随后把它喂给
 * `downloadAsync` / `getInfoAsync` / `deleteAsync` 就可能污染或删 cache 外层。
 * 这里加两道闸：
 *   ① 显式拒绝 dot-segment（`.` 或 `..`）
 *   ② 同时要求 basename 含至少一个字母/数字（防 `...` `--` 这类纯符号变体）
 * 任一不满足就返回 null，调用链一路收敛到 plan=skip / cache path=null。
 */
export const buildRelayMediaCacheKey = (url: string): string | null => {
  if (!url.startsWith(RELAY_UPLOADS_URL_PREFIX)) return null
  const basename = url.slice(RELAY_UPLOADS_URL_PREFIX.length)
  if (!basename || !SAFE_BASENAME.test(basename)) return null
  if (DOT_SEGMENT_BASENAME.test(basename)) return null
  if (!HAS_ALPHA_OR_DIGIT.test(basename)) return null
  return basename
}

const joinCachePath = (cacheDir: string, basename: string) => {
  const trimmed = cacheDir.endsWith('/') ? cacheDir.slice(0, -1) : cacheDir
  return `${trimmed}/hippoteam-media/${basename}`
}

const ensureCacheSubdir = async (fileSystem: RelayMediaCacheFileSystem, cacheDir: string) => {
  const trimmed = cacheDir.endsWith('/') ? cacheDir.slice(0, -1) : cacheDir
  const subdir = `${trimmed}/hippoteam-media`
  const info = await fileSystem.getInfoAsync(subdir)
  if (!info.exists) {
    await fileSystem.makeDirectoryAsync(subdir, { intermediates: true })
  }
  return subdir
}

/**
 * 把 mediaUrl 映射成 `<cacheDir>/hippoteam-media/<basename>` 目标路径；
 * mediaUrl 不在 /api/mobile/uploads/<safe-basename> 形态时返回 null。
 *
 * 让 use-relay-media-source 的 LAN 直接下载分支跟 relay media.get 分块下载共用同一
 * 缓存文件——同一份图既 LAN 又 relay 命中后不会重下，basename(UUID) 不变就复用。
 */
export const resolveRelayMediaCachePath = (cacheDir: string, mediaUrl: string): string | null => {
  const basename = buildRelayMediaCacheKey(mediaUrl)
  if (!basename) return null
  return joinCachePath(cacheDir, basename)
}

/**
 * 确保 `<cacheDirectory>/hippoteam-media/` 目录存在；返回该目录的绝对 file://。
 * use-relay-media-source 的 LAN download 分支在 FileSystem.downloadAsync 前要调一次。
 */
export const ensureRelayMediaCacheDir = (fileSystem: RelayMediaCacheFileSystem): Promise<string> =>
  ensureCacheSubdir(fileSystem, fileSystem.cacheDirectory)

/**
 * 真 decode 每个 chunk 到 Uint8Array — 不再按字符串长度估算（钟馗 blocking #4：
 * 旧 `decodeBase64ToByteLength` 只看字符串长度，恶意 `'!!!!'` 长度 4 但 atob 会
 * 抛 / 真字节数与 header `length` 不一致都骗不出来）。decode 失败直接 throw。
 */
const decodeChunkBytes = (base64: string): Uint8Array => {
  if (!base64) return new Uint8Array(0)
  try {
    return decodeBase64(base64)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Relay media.get chunk base64 decode failed: ${message}`)
  }
}

const concatChunks = (parts: Uint8Array[]): Uint8Array => {
  let total = 0
  for (const part of parts) total += part.length
  const out = new Uint8Array(total)
  let cursor = 0
  for (const part of parts) {
    out.set(part, cursor)
    cursor += part.length
  }
  return out
}

/**
 * 真主入口：保证 `url` 对应的文件本地存在；返回本地 `file://...` URI。
 * 已存在且 size 完整 → 直接返回（不重复下）。
 * 不存在或部分 → 经 relay 分块拉取重组 → 写本地 → 返回。
 */
export const ensureRelayMediaCached = async (
  url: string,
  transport: RelayMediaCacheTransport,
  fileSystem: RelayMediaCacheFileSystem,
  options: RelayMediaCacheOptions = {}
): Promise<string> => {
  const basename = buildRelayMediaCacheKey(url)
  if (!basename) {
    throw new Error(`Relay media URL not in /api/mobile/uploads/: ${url}`)
  }
  await ensureCacheSubdir(fileSystem, fileSystem.cacheDirectory)
  const cachePath = joinCachePath(fileSystem.cacheDirectory, basename)
  const chunkBytes = Math.max(
    1024,
    Math.min(1024 * 1024, options.chunkBytes ?? DEFAULT_CHUNK_BYTES)
  )

  // Phase 1：已缓存且 size 与期望一致 → 跳过下载。
  const existing = await fileSystem.getInfoAsync(cachePath)
  const expected = options.expectedTotalBytes ?? null
  if (existing.exists && typeof existing.size === 'number') {
    if (expected !== null && existing.size === expected) {
      options.onProgress?.({ bytesDownloaded: existing.size, totalBytes: existing.size })
      return cachePath
    }
    // 不知期望 size，但已有缓存：先信任本地；下次播放不阻塞用户。
    // （如果服务端文件真的变了，basename 是 UUID，不会复用，所以这种情形极小。）
    if (expected === null) {
      options.onProgress?.({ bytesDownloaded: existing.size, totalBytes: existing.size })
      return cachePath
    }
  }

  // Phase 2：抓首 chunk，知 total_size 后决定 round-trip 次数。
  // 逐 chunk 真 decode 成 Uint8Array：(a) 校验 base64 合法性（恶意 '!!!!' 会抛），
  // (b) header `length` 必须等于真 decode 出来的字节数（不再字符串估算）。
  const decodedChunks: Uint8Array[] = []
  let offset = 0
  let totalBytes = 0
  let bytesDownloaded = 0
  let sawFirstResponse = false

  while (true) {
    if (options.signal?.aborted) {
      throw new Error('Relay media download aborted')
    }
    const response = await transport.call<RelayMediaGetResponse>('media.get', {
      length: chunkBytes,
      offset,
      url,
    })
    if (typeof response.total_size !== 'number' || response.total_size < 0) {
      throw new Error('Relay media.get returned invalid total_size')
    }
    if (!sawFirstResponse) {
      totalBytes = response.total_size
      sawFirstResponse = true
    } else if (totalBytes !== response.total_size) {
      throw new Error('Relay media.get total_size shifted mid-download')
    }
    if (response.offset !== offset) {
      throw new Error(
        `Relay media.get offset mismatch: expected=${offset} received=${response.offset}`
      )
    }
    const decoded = decodeChunkBytes(response.data)
    if (response.length !== decoded.length) {
      throw new Error(
        `Relay media.get length mismatch: header=${response.length} base64_decoded=${decoded.length}`
      )
    }
    decodedChunks.push(decoded)
    offset += decoded.length
    bytesDownloaded += decoded.length
    options.onProgress?.({ bytesDownloaded, totalBytes })
    if (response.eof || offset >= totalBytes) break
    if (decoded.length === 0) {
      // 防卡死：服务端返 0 长度但 !eof 是协议异常。
      throw new Error('Relay media.get returned empty chunk without EOF')
    }
  }

  if (bytesDownloaded !== totalBytes) {
    throw new Error(`Relay media incomplete: downloaded=${bytesDownloaded} expected=${totalBytes}`)
  }

  // concat Uint8Array 不依赖 Node Buffer；最终 encodeBase64 一次性把全文件回成
  // base64 字符串写到 Expo FileSystem（writeAsStringAsync base64 模式要的就是这个）。
  const combined = concatChunks(decodedChunks)
  await fileSystem.writeAsStringAsync(cachePath, encodeBase64(combined), 'base64')
  return cachePath
}

/**
 * 把多段 base64 chunk 重组成一整段 base64。
 *
 * **不能**直接 `chunks.join('')`：每段 chunk 都是独立 base64 编码，末尾不一定 3
 * 字节对齐（例如 256*1024 = 262144 mod 3 = 1），段间拼接会产生非法 base64。
 *
 * 实现走 RN-safe `decodeBase64 / encodeBase64`（`atob/btoa` 全局，Hermes 标配）；
 * 绝不依赖 Node `Buffer`（Hermes 真机无 global Buffer，会 ReferenceError 必崩）。
 */
export const combineBase64Chunks = (chunks: string[]): string => {
  if (chunks.length === 0) return ''
  if (chunks.length === 1) {
    const sole = chunks[0]
    if (typeof sole === 'string') return sole
  }
  const decoded = chunks.map((chunk) => decodeChunkBytes(chunk))
  return encodeBase64(concatChunks(decoded))
}
