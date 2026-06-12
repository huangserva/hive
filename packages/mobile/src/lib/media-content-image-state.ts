/**
 * MediaContent 图片渲染状态机（纯函数，可单测）。
 *
 * 钟馗 blocking #2：relay 模式下首次 LAN URI 走 RN Image 立刻失败触发 onError，
 * 之后 relay 把 file:// 缓存切进 uri，但 `imageFailed` 没人 reset → image 永久挡。
 *
 * 这里把"是否渲染 Image、是否显示下载占位、是否需要 reset failed flag"3 个判断
 * 集中成纯函数，让 UI 层只负责执行返回的指令；同时给单测一个稳定 surface。
 */

export interface MediaContentImageStateInput {
  /** 当前 RN Image 用的 source URI（LAN 直连或 file://）。 */
  uri: string
  /** 上一次渲染时记录的 URI；首次给 null。 */
  previousUri: string | null
  /** 当前 imageFailed flag（来自 useState）。 */
  imageFailed: boolean
  /** relay 模式下是否在分块下载中（true 时不应渲染 Image，避免 LAN URI 闪红）。 */
  isDownloading: boolean
}

export interface MediaContentImageStateOutput {
  /** 是否渲染 Image（imageFailed=true 时退回 fallback 文件卡，下载中也不渲）。 */
  shouldRenderImage: boolean
  /** 是否显示"下载中"占位（替代 Image）。 */
  shouldShowDownloadingPlaceholder: boolean
  /** UI 是否要在本次 render 之前 setImageFailed(false)。 */
  shouldResetImageFailed: boolean
}

/**
 * 决策表（钟馗 B2 核心）：
 *
 * | uri vs previousUri | imageFailed | isDownloading | 输出                                  |
 * |--------------------|-------------|---------------|---------------------------------------|
 * | 相同                | false       | false         | render Image                          |
 * | 相同                | true        | false         | fallback（保持 failed）                |
 * | 变化                | *           | false         | reset failed → render Image           |
 * | *                   | *           | true          | downloading placeholder（不 render Image）|
 *
 * 切记：reset 不能等"下次 Image 报错才反应"——必须 uri 变化的那一刻就清，否则
 * 用户看到的就是"file:// URI 但 imageFailed=true → fallback"的鬼图。
 */
export const deriveMediaContentImageState = (
  input: MediaContentImageStateInput
): MediaContentImageStateOutput => {
  if (input.isDownloading) {
    return {
      shouldRenderImage: false,
      shouldShowDownloadingPlaceholder: true,
      shouldResetImageFailed: false,
    }
  }
  const uriChanged = input.previousUri !== null && input.previousUri !== input.uri
  const failed = input.imageFailed && !uriChanged
  return {
    shouldRenderImage: !failed,
    shouldShowDownloadingPlaceholder: false,
    shouldResetImageFailed: uriChanged && input.imageFailed,
  }
}
