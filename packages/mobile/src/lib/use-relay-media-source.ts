import * as FileSystem from 'expo-file-system/legacy'
import { useCallback, useEffect, useRef, useState } from 'react'

import { useMobileRuntime } from '../api/mobile-runtime-context'

import {
  type AuthedDownloader,
  type DownloadAuthedToCacheDeps,
  downloadAuthedToCache,
} from './lan-authed-media-download'
import { type MediaSourceDownloadPlan, planMediaSourceDownload } from './media-source-download-plan'
import {
  ensureRelayMediaCacheDir,
  ensureRelayMediaCached,
  type RelayMediaCacheFileSystem,
  type RelayMediaCacheProgress,
  resolveRelayMediaCachePath,
} from './relay-media-cache'

/**
 * 给 MediaContent 提供"该用什么 URI 喂 Image/VideoView"。
 *
 * - **relay 模式 + uploads**：经 media.get 分块拉 → 本地 file:// 缓存（既有路径）
 * - **LAN 模式 + uploads + authToken**：JS 层 `FileSystem.downloadAsync` 带 Bearer
 *   header 下到 cacheDirectory → 本地 file://（**真修 2026-06-14 新增**：治
 *   "RN Android 原生 Image 加载器对 http+Authorization header 不可靠" 真因，详见
 *   `media-source-download-plan.ts` 顶部注释）
 * - 其他情况（非 uploads url / disconnected / LAN 无 token）：保持 `lanFallbackUri`
 *
 * 两条下载路径共用同一份缓存文件（resolveRelayMediaCachePath），同一份图 LAN/relay
 * 切换不会重下。
 */
export interface UseRelayMediaSourceInput {
  /** 上层（MediaContent）已经计算好的 LAN 直连/本地 URI。 */
  lanFallbackUri: string
  /** chat message 里的 url，例如 `/api/mobile/uploads/<basename>`。 */
  mediaUrl: string
  /** 期望文件总大小，可选（来自 chat message media.size）；用于缓存命中精确。 */
  totalSize?: number | null
  /** user 鉴权 token；LAN 直接下载分支必须传，缺失则降级。 */
  authToken?: string | null
}

export interface UseRelayMediaSourceResult {
  /** 当前给 VideoView/Image 用的 URI；下载中可能仍是 LAN URI 作 placeholder。 */
  uri: string
  /** 是否正在分块/直接下载。 */
  isDownloading: boolean
  /** 下载进度；relay 分块路径有逐块上报，LAN 直下路径只在结束时给 100%。 */
  progress: RelayMediaCacheProgress | null
  /** 下载错误（保留原行为：失败仍 fallback LAN URI 让 Image 试一次）。 */
  error: string | null
  /** 是否走了 relay 缓存路径（成功后 uri 是 file://）。 */
  servingFromRelayCache: boolean
  /** 是否走了 LAN authed 下载到 file:// 路径。 */
  servingFromLanCache: boolean
}

const expoFileSystemAdapter: RelayMediaCacheFileSystem = {
  cacheDirectory: FileSystem.cacheDirectory ?? '',
  async getInfoAsync(uri) {
    const info = await FileSystem.getInfoAsync(uri)
    return info.exists ? { exists: true, size: info.size } : { exists: false }
  },
  async writeAsStringAsync(uri, content, encoding) {
    await FileSystem.writeAsStringAsync(uri, content, {
      encoding:
        encoding === 'base64' ? FileSystem.EncodingType.Base64 : FileSystem.EncodingType.UTF8,
    })
  },
  async readAsStringAsync(uri) {
    return FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 })
  },
  async makeDirectoryAsync(uri, options) {
    await FileSystem.makeDirectoryAsync(uri, options)
  },
  async deleteAsync(uri, options) {
    await FileSystem.deleteAsync(uri, options)
  },
}

/**
 * 把生产 expo-file-system 适配成 LAN 直下用的 deps：downloader 是
 * `FileSystem.downloadAsync` 的瘦壳，fs 复用既有 expoFileSystemAdapter，
 * ensureCacheDir 复用 relay-media-cache 的子目录创建逻辑。
 *
 * 真正的 I/O + 重试/校验逻辑在 `lan-authed-media-download.ts`（已注入接口、可单测）。
 */
const lanAuthedDownloader: AuthedDownloader = {
  async downloadAsync(uri, fileUri, options) {
    const result = await FileSystem.downloadAsync(uri, fileUri, options)
    return { status: result.status }
  },
}

const lanAuthedDownloadDeps: DownloadAuthedToCacheDeps = {
  ensureCacheDir: () => ensureRelayMediaCacheDir(expoFileSystemAdapter),
  fs: expoFileSystemAdapter,
  downloader: lanAuthedDownloader,
}

export const useRelayMediaSource = ({
  lanFallbackUri,
  mediaUrl,
  totalSize = null,
  authToken = null,
}: UseRelayMediaSourceInput): UseRelayMediaSourceResult => {
  const { connectionMode, getActiveRelayTransport } = useMobileRuntime()
  const [uri, setUri] = useState<string>(lanFallbackUri)
  const [progress, setProgress] = useState<RelayMediaCacheProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isDownloading, setIsDownloading] = useState(false)
  const [servingFromRelayCache, setServingFromRelayCache] = useState(false)
  const [servingFromLanCache, setServingFromLanCache] = useState(false)
  const downloadingForKeyRef = useRef<string | null>(null)
  const abortFlagRef = useRef<{ aborted: boolean }>({ aborted: false })

  const runRelayChunks = useCallback(
    async (cacheKey: string) => {
      const transport = getActiveRelayTransport()
      if (!transport) {
        // relay 未就绪时不强行拉；保持 LAN URI 作 placeholder（即使 LAN 不通也至少不崩）
        setUri(lanFallbackUri)
        setServingFromRelayCache(false)
        setServingFromLanCache(false)
        return
      }
      downloadingForKeyRef.current = `relay:${cacheKey}`
      abortFlagRef.current = { aborted: false }
      setError(null)
      setIsDownloading(true)
      setProgress(
        typeof totalSize === 'number' && totalSize > 0
          ? { bytesDownloaded: 0, totalBytes: totalSize }
          : null
      )
      try {
        const cachePath = await ensureRelayMediaCached(mediaUrl, transport, expoFileSystemAdapter, {
          expectedTotalBytes: totalSize,
          onProgress: (next) => setProgress(next),
          signal: abortFlagRef.current,
        })
        if (abortFlagRef.current.aborted) return
        setUri(cachePath)
        setServingFromRelayCache(true)
        setServingFromLanCache(false)
      } catch (downloadError) {
        const message =
          downloadError instanceof Error ? downloadError.message : String(downloadError)
        setError(message)
        setUri(lanFallbackUri)
        setServingFromRelayCache(false)
        setServingFromLanCache(false)
      } finally {
        if (downloadingForKeyRef.current === `relay:${cacheKey}`) {
          downloadingForKeyRef.current = null
        }
        setIsDownloading(false)
      }
    },
    [getActiveRelayTransport, lanFallbackUri, mediaUrl, totalSize]
  )

  const runLanDownload = useCallback(
    async (cacheKey: string, token: string) => {
      const cachePath = resolveRelayMediaCachePath(expoFileSystemAdapter.cacheDirectory, mediaUrl)
      if (!cachePath) {
        // 理论上 plan === 'lan-download' 时 cacheKey 一定有，这里走防御
        setUri(lanFallbackUri)
        setServingFromLanCache(false)
        return
      }
      downloadingForKeyRef.current = `lan:${cacheKey}`
      abortFlagRef.current = { aborted: false }
      setError(null)
      setIsDownloading(true)
      setProgress(
        typeof totalSize === 'number' && totalSize > 0
          ? { bytesDownloaded: 0, totalBytes: totalSize }
          : null
      )
      try {
        await downloadAuthedToCache(
          {
            authToken: token,
            cachePath,
            expectedSize: typeof totalSize === 'number' && totalSize > 0 ? totalSize : null,
            lanUrl: lanFallbackUri,
            signal: abortFlagRef.current,
          },
          lanAuthedDownloadDeps
        )
        if (abortFlagRef.current.aborted) return
        setUri(cachePath)
        setServingFromLanCache(true)
        setServingFromRelayCache(false)
        if (typeof totalSize === 'number' && totalSize > 0) {
          setProgress({ bytesDownloaded: totalSize, totalBytes: totalSize })
        }
      } catch (downloadError) {
        const message =
          downloadError instanceof Error ? downloadError.message : String(downloadError)
        setError(message)
        // 失败保持 LAN URI 给 Image 试一次（authed header 通常仍失败但起码状态机不卡）
        setUri(lanFallbackUri)
        setServingFromLanCache(false)
        setServingFromRelayCache(false)
      } finally {
        if (downloadingForKeyRef.current === `lan:${cacheKey}`) {
          downloadingForKeyRef.current = null
        }
        setIsDownloading(false)
      }
    },
    [lanFallbackUri, mediaUrl, totalSize]
  )

  const startDownload = useCallback(async () => {
    const plan: MediaSourceDownloadPlan = planMediaSourceDownload({
      authToken,
      connectionMode,
      mediaUrl,
    })
    if (plan.kind === 'skip') {
      setUri(lanFallbackUri)
      setServingFromRelayCache(false)
      setServingFromLanCache(false)
      return
    }
    if (plan.kind === 'relay-chunks') {
      if (downloadingForKeyRef.current === `relay:${plan.cacheKey}`) return
      await runRelayChunks(plan.cacheKey)
      return
    }
    // lan-download
    if (downloadingForKeyRef.current === `lan:${plan.cacheKey}`) return
    if (!authToken) {
      // plan 已挡住空 token，这里只是 TS narrowing 保险
      setUri(lanFallbackUri)
      setServingFromLanCache(false)
      return
    }
    await runLanDownload(plan.cacheKey, authToken)
  }, [authToken, connectionMode, lanFallbackUri, mediaUrl, runLanDownload, runRelayChunks])

  useEffect(() => {
    void startDownload()
    const abortFlag = abortFlagRef.current
    return () => {
      abortFlag.aborted = true
    }
  }, [startDownload])

  return {
    error,
    isDownloading,
    progress,
    servingFromLanCache,
    servingFromRelayCache,
    uri,
  }
}
