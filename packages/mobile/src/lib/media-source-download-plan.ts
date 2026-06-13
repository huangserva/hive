/**
 * MediaContent 决策："这个 chat 媒体 URL 在当前 connection 模式下，要不要在 JS 层
 * 下载到本地 file:// 缓存再喂 RN Image / VideoView？"
 *
 * 真因背景（2026-06-14 真机 adb 实测）：
 *   - 服务端 `/api/mobile/uploads/<id>` 吐图字节正常（Mac curl 带 token 200 + 真 PNG）
 *   - 手机 LAN 可达 + Clash 没跑 + cleartext 放行
 *   - dashboard 走 JS fetch 带 Bearer header 一切正常（活着）
 *   - 但 RN Android 原生 `Image` 加载器对 `http + Authorization` header 支持不可靠：
 *     取图失败 → onError → imageFailed=true → 退到 fileCard fallback
 *     → 你点不动 → 全屏预览（你刚修的 getSize 死锁）也根本验不到
 *
 * 修法（把 relay 模式已有的"JS 下载到 file:// 再喂 Image"扩到 LAN 的 authed 图）：
 *   - relay 模式：保持原 media.get 分块路径（'relay-chunks'）
 *   - LAN 模式 + uploads + 有 authToken：JS 层 `FileSystem.downloadAsync` 走
 *     Bearer header 下到 cacheDirectory（'lan-download'）；JS 层 header 已被 dashboard
 *     验过可靠，本地 file:// 不需要 header，绕开原生加载器
 *   - LAN 模式 + uploads + 无 authToken：'skip'，让上层退原行为（http URL 直交 Image
 *     会失败，但起码不崩）
 *   - 非 uploads url / disconnected：'skip'
 *
 * 这个文件只是纯函数决策；实际 I/O 由 use-relay-media-source.ts 消费。
 */

import { buildRelayMediaCacheKey } from './relay-media-cache'

export type MobileConnectionMode = 'disconnected' | 'lan' | 'relay'

export interface MediaSourceDownloadPlanInput {
  /** 当前 runtime context 的 connectionMode。 */
  connectionMode: MobileConnectionMode
  /** chat message 里的 media url；例如 `/api/mobile/uploads/<basename>`。 */
  mediaUrl: string
  /** user 鉴权 token；为空时无法做 LAN authed 下载。 */
  authToken: string | null | undefined
}

export type MediaSourceDownloadPlan =
  | { kind: 'skip' }
  | { kind: 'relay-chunks'; cacheKey: string }
  | { kind: 'lan-download'; cacheKey: string }

/**
 * 决策表：
 *
 * | connectionMode | mediaUrl 是 uploads | authToken | plan          |
 * |----------------|---------------------|-----------|---------------|
 * | *              | 否（非 /api/...）   | *         | skip          |
 * | disconnected   | 是                  | *         | skip          |
 * | relay          | 是                  | *         | relay-chunks  |
 * | lan            | 是                  | 有        | lan-download  |
 * | lan            | 是                  | 空        | skip（降级）  |
 *
 * 注意：mediaUrl 是 uploads 但 basename 不安全（含 `..` / 特殊字符）→ skip。这条
 * 由 `buildRelayMediaCacheKey` 保证（已有 SAFE_BASENAME 正则）。
 */
export const planMediaSourceDownload = (
  input: MediaSourceDownloadPlanInput
): MediaSourceDownloadPlan => {
  const cacheKey = buildRelayMediaCacheKey(input.mediaUrl)
  if (!cacheKey) return { kind: 'skip' }
  if (input.connectionMode === 'disconnected') return { kind: 'skip' }
  if (input.connectionMode === 'relay') return { cacheKey, kind: 'relay-chunks' }
  // connectionMode === 'lan'
  if (!input.authToken) return { kind: 'skip' }
  return { cacheKey, kind: 'lan-download' }
}
