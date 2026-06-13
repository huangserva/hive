/**
 * LAN 模式 + authed uploads 媒体的直下载：把 http+Bearer 的图字节通过 expo-file-system
 * 的系统级 downloadAsync 拉到本地 file:// 缓存，绕开"RN Android 原生 Image 加载器对
 * http+Authorization 不可靠"真因（详见 media-source-download-plan.ts 顶部注释）。
 *
 * **这里全部 I/O 走依赖注入**——fs / downloader / ensureCacheDir 都是参数。一来让
 * 单测能锁住"漏 Authorization header / 非 2xx 未删 / size mismatch 未删 / 成功后才
 * 切 file://"这类实现回归（钟馗 non-blocking #1：load-bearing 路径不能只测决策不测
 * I/O，这项目栽过"测试绿生产死"的老坑）。二来生产代码通过窄接口适配 expo-file-system，
 * 让 hook 文件只剩 React state + plan 派发。
 */

export interface AuthedDownloaderResult {
  /** HTTP 状态码，2xx 算成功。 */
  status: number
}

export interface AuthedDownloader {
  downloadAsync(
    uri: string,
    fileUri: string,
    options: { headers: Record<string, string> }
  ): Promise<AuthedDownloaderResult>
}

export interface AuthedDownloadFs {
  /** 拿目标文件大小（不存在返 { exists: false }）。 */
  getInfoAsync(uri: string): Promise<{ exists: boolean; size?: number }>
  /** 失败 / size 不符 / abort 兜底删；`idempotent` 不存在也不报错。 */
  deleteAsync(uri: string, options?: { idempotent?: boolean }): Promise<void>
}

export interface DownloadAuthedToCacheDeps {
  /** 调 downloadAsync 前确保 `<cacheDir>/hippoteam-media/` 目录存在。 */
  ensureCacheDir: () => Promise<unknown>
  /** 文件系统读写适配器（注入 expoFileSystemAdapter 或 in-memory mock）。 */
  fs: AuthedDownloadFs
  /** 下载器（注入 `{ downloadAsync: FileSystem.downloadAsync }` 或 mock）。 */
  downloader: AuthedDownloader
}

export interface DownloadAuthedToCacheArgs {
  /** 远端 LAN URL，例如 `http://192.168.x.x:4010/api/mobile/uploads/<id>`。 */
  lanUrl: string
  /** 本地目标 file:// 路径（由 resolveRelayMediaCachePath 算出）。 */
  cachePath: string
  /** user 鉴权 token；调用方已经保证非空。 */
  authToken: string
  /** 来自 chat message media.size 的期望字节数；null 表示未知。 */
  expectedSize: number | null
  /** 调用方通过翻 `signal.aborted=true` 让本函数知会"已取消"。 */
  signal: { aborted: boolean }
}

/**
 * **真主入口**（注入 fs/downloader 后可直接 unit test）：
 *
 * 1. ensure cache dir
 * 2. 若目标已存在 + size 一致（或未知 expectedSize）→ 复用缓存直接返回
 * 3. size 不一致 → 先删旧再下
 * 4. downloadAsync 带 Authorization: Bearer ...；reject 则 catch + 删 partial + 重抛
 * 5. status 非 2xx → 删 + throw
 * 6. expectedSize 已知但实际 size 不符 → 删 + throw
 * 7. abort 在 download 后置位：保留缓存（下次能用）但不要求调用方更新 state
 *
 * 失败语义：**抛 Error**；调用方负责 setError + fallback 到 LAN URI（让原生 Image 再
 * 试一次，header 通常仍失败但起码状态机不卡）。
 */
export const downloadAuthedToCache = async (
  args: DownloadAuthedToCacheArgs,
  deps: DownloadAuthedToCacheDeps
): Promise<void> => {
  const { lanUrl, cachePath, authToken, expectedSize, signal } = args
  const { ensureCacheDir, fs, downloader } = deps

  await ensureCacheDir()
  if (signal.aborted) throw new Error('LAN download aborted before start')

  const existing = await fs.getInfoAsync(cachePath)
  if (existing.exists && typeof existing.size === 'number') {
    // 同 basename 旧缓存：size 一致或未知 expectedSize 时直接复用（relay 路径同款短路）
    if (expectedSize === null || existing.size === expectedSize) return
    // size 不符先删再下，避免旧/截断文件被信
    await fs.deleteAsync(cachePath, { idempotent: true })
  }

  let result: AuthedDownloaderResult
  try {
    result = await downloader.downloadAsync(lanUrl, cachePath, {
      headers: { Authorization: `Bearer ${authToken}` },
    })
  } catch (downloadError) {
    // 钟馗 non-blocking #2 焊：原生 downloadAsync reject 后可能留 partial 文件，
    // 后续若 expectedSize===null 走 existing.exists 短路就会信错文件。统一兜底删。
    await fs.deleteAsync(cachePath, { idempotent: true })
    throw downloadError instanceof Error ? downloadError : new Error(String(downloadError))
  }

  if (signal.aborted) {
    // 下完才发现被 abort：保留缓存（下次能用），但不要求 caller 更新 React state
    return
  }
  if (typeof result.status !== 'number' || result.status < 200 || result.status >= 300) {
    await fs.deleteAsync(cachePath, { idempotent: true })
    throw new Error(`LAN authed media download HTTP ${result.status}`)
  }
  if (expectedSize !== null) {
    const written = await fs.getInfoAsync(cachePath)
    if (!written.exists || written.size !== expectedSize) {
      await fs.deleteAsync(cachePath, { idempotent: true })
      throw new Error(
        `LAN authed media size mismatch: expected=${expectedSize} actual=${written.size ?? '?'}`
      )
    }
  }
}
