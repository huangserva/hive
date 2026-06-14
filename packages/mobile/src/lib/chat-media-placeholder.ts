/**
 * 给媒体的"加载中占位 / 下载中占位 / onError 的 fileCard fallback"提供一个跟
 * 最终媒体一样的稳定尺寸——治"图片加载完成那一刻列表顶动"残留抖动 bug
 * （2026-06-14 真机 PM 指认）。
 *
 * 根因：MediaContent 的 `mediaStyles.image` 固定 170×230（compact 104×104），但
 * 加载/下载/fallback 走 `mediaStyles.fileCard`(变高)。placeholder→真图切换时
 * 列表项整体高度变 → FlatList 顶动 → user 看到"图加载抖一下"。
 *
 * 修法：isImage 时让 placeholder 套同款 170×230 框，最终 Image mount 进来高度不变。
 *
 * 视频/普通文件不做：当前 inline UI 视频永远显示 fileCard（无 inline VideoView），
 * placeholder 跟最终都是 fileCard，本身不抖。如果未来引入 inline 视频播放器，需在
 * 这里扩展 'video' 分支。
 */

/** Outbound/inbound 全屏图卡固定高度，与 `mediaStyles.image.height` 一致。 */
export const MEDIA_IMAGE_FULL_HEIGHT = 170
/** Outbound/inbound 全屏图卡固定宽度，与 `mediaStyles.image.width` 一致。 */
export const MEDIA_IMAGE_FULL_WIDTH = 230
/** Compact 多图模式高度（多图气泡里的小卡），与 `mediaStyles.imageCompact.height` 一致。 */
export const MEDIA_IMAGE_COMPACT_HEIGHT = 104
/** Compact 多图模式宽度，与 `mediaStyles.imageCompact.width` 一致。 */
export const MEDIA_IMAGE_COMPACT_WIDTH = 104

export interface MediaPlaceholderSizeInput {
  /** 媒体大类（决定要不要给稳定尺寸；只有 image 给）。 */
  kind: 'image' | 'video' | 'other'
  /** 多图气泡用紧凑尺寸。 */
  compact: boolean
}

export interface MediaPlaceholderSize {
  height: number
  width: number
}

/**
 * 决策表：
 *
 * | kind   | compact | 输出                                         |
 * |--------|---------|---------------------------------------------|
 * | image  | false   | { height: 170, width: 230 }                 |
 * | image  | true    | { height: 104, width: 104 }                 |
 * | video  | *       | null（当前 inline 仍是 fileCard，不需占位） |
 * | other  | *       | null                                        |
 *
 * 调用方拿到 size 后：在 placeholder/fallback 的最外层 View 上加 `{ width, height }`
 * 样式，强制占位与最终 Image 同尺寸。返回 null 时维持原行为（fileCard 自然布局）。
 */
export const resolveMediaPlaceholderSize = (
  input: MediaPlaceholderSizeInput
): MediaPlaceholderSize | null => {
  if (input.kind !== 'image') return null
  return input.compact
    ? { height: MEDIA_IMAGE_COMPACT_HEIGHT, width: MEDIA_IMAGE_COMPACT_WIDTH }
    : { height: MEDIA_IMAGE_FULL_HEIGHT, width: MEDIA_IMAGE_FULL_WIDTH }
}
