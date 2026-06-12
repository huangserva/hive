import * as FileSystem from 'expo-file-system/legacy'
import { useCallback, useEffect, useRef, useState } from 'react'

import { useMobileRuntime } from '../api/mobile-runtime-context'

import {
  buildRelayMediaCacheKey,
  ensureRelayMediaCached,
  type RelayMediaCacheFileSystem,
  type RelayMediaCacheProgress,
} from './relay-media-cache'

/**
 * relay 模式（4G/外网）下让 VideoView/Image 拿到本地 file:// URI；
 * LAN 模式保持上层传入的直连 URI（headers + authToken 路径）。
 *
 * progress 表示当前正在下载的进度（仅 relay 模式）；error 表示下载失败原因。
 */
export interface UseRelayMediaSourceInput {
  /** 上层（MediaContent）已经计算好的 LAN 直连/本地 URI。 */
  lanFallbackUri: string
  /** chat message 里的 url，例如 `/api/mobile/uploads/<basename>`。 */
  mediaUrl: string
  /** 期望文件总大小，可选（来自 chat message media.size），让缓存命中精确。 */
  totalSize?: number | null
}

export interface UseRelayMediaSourceResult {
  /** 当前给 VideoView/Image 用的 URI；relay 模式下载中可能仍是 LAN URI 作 placeholder。 */
  uri: string
  /** relay 模式下当前是否在下载分块。LAN 模式恒为 false。 */
  isDownloading: boolean
  /** 下载进度；仅 relay 模式。 */
  progress: RelayMediaCacheProgress | null
  /** 下载错误（不影响 LAN 模式）。 */
  error: string | null
  /** 是否走了 relay 缓存路径（成功后 uri 是 file://）。 */
  servingFromRelayCache: boolean
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

const isUploadsRelayUrl = (mediaUrl: string) => buildRelayMediaCacheKey(mediaUrl) !== null

export const useRelayMediaSource = ({
  lanFallbackUri,
  mediaUrl,
  totalSize = null,
}: UseRelayMediaSourceInput): UseRelayMediaSourceResult => {
  const { connectionMode, getActiveRelayTransport } = useMobileRuntime()
  const [uri, setUri] = useState<string>(lanFallbackUri)
  const [progress, setProgress] = useState<RelayMediaCacheProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isDownloading, setIsDownloading] = useState(false)
  const [servingFromRelayCache, setServingFromRelayCache] = useState(false)
  const downloadingForKeyRef = useRef<string | null>(null)
  const abortFlagRef = useRef<{ aborted: boolean }>({ aborted: false })

  const shouldUseRelay = connectionMode === 'relay' && isUploadsRelayUrl(mediaUrl)

  const startDownload = useCallback(async () => {
    if (!shouldUseRelay) {
      setUri(lanFallbackUri)
      setServingFromRelayCache(false)
      return
    }
    const cacheKey = buildRelayMediaCacheKey(mediaUrl)
    if (!cacheKey) return
    if (downloadingForKeyRef.current === cacheKey) return
    const transport = getActiveRelayTransport()
    if (!transport) {
      // relay 未就绪时不强行拉；保持 LAN URI 作 placeholder（即使 LAN 不通也至少不崩）
      setUri(lanFallbackUri)
      setServingFromRelayCache(false)
      return
    }
    downloadingForKeyRef.current = cacheKey
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
    } catch (downloadError) {
      const message = downloadError instanceof Error ? downloadError.message : String(downloadError)
      setError(message)
      // 失败保持 LAN URI 给 Image/VideoView 试一次（LAN 通时能用）
      setUri(lanFallbackUri)
      setServingFromRelayCache(false)
    } finally {
      if (downloadingForKeyRef.current === cacheKey) {
        downloadingForKeyRef.current = null
      }
      setIsDownloading(false)
    }
  }, [getActiveRelayTransport, lanFallbackUri, mediaUrl, shouldUseRelay, totalSize])

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
    servingFromRelayCache,
    uri,
  }
}
