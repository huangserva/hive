/**
 * ImagePreviewModal 全屏图片预览：Image 是否 mount / 是否可见 / loading overlay / gesture
 * 是否启用的决策表（纯函数，可单测）。
 *
 * 死锁根因：原实现把 hasImage=imageSize>0 && container>0 当 `{hasImage ? <Image/> : <Loading/>}`
 * 三元渲染门——但 imageSize 又只由 <Image onLoad> 设置。`hasImage=false` 时 Image 根本没渲染,
 * onLoad 永远跑不到, hasImage 永远 false → 转圈死锁。M28 654a4c8 pinch 上线即埋。
 *
 * 修法：visible=true 时永远 mount Image（让 onLoad 能跑），hasImage 决定的是
 * 「是否显示 / 手势是否启用 / loading overlay 是否盖在上面」，而不是 mount 与否。
 */

export interface ImagePreviewMountInput {
  /** 容器测量到的高度（onLayout）。 */
  containerHeight: number
  /** 容器测量到的宽度（onLayout）。 */
  containerWidth: number
  /** RN Image onLoad 拿到的图片原生高度。 */
  imageNaturalHeight: number
  /** RN Image onLoad 拿到的图片原生宽度。 */
  imageNaturalWidth: number
  /** Modal 是否打开。 */
  visible: boolean
}

export interface ImagePreviewMountOutput {
  /** 手势 (pinch/pan/double-tap) 是否生效——仅 hasImage 时启。 */
  shouldEnableGesture: boolean
  /** Image 是否 mount——visible 时永远 true，治死锁。 */
  shouldMountImage: boolean
  /** caption（图片标题）是否显示——hasImage 时才显示，避免空白先闪一下文字。 */
  shouldShowCaption: boolean
  /** Image 是否可见（控 opacity，不控 mount）。 */
  shouldShowImage: boolean
  /** loading overlay 是否盖在上面（!hasImage 时显示，用 absolute fill 浮层）。 */
  shouldShowLoadingOverlay: boolean
}

/**
 * 决策表：
 *
 * | visible | containerW | imageW & H | shouldMountImage | shouldShowImage | overlay | gesture |
 * |---------|------------|------------|------------------|-----------------|---------|---------|
 * | false   | *          | *          | false            | false           | false   | false   |
 * | true    | 0          | 0          | true (修死锁)    | false           | true    | false   |
 * | true    | >0         | 0          | true             | false           | true    | false   |
 * | true    | 0          | >0         | true             | false           | true    | false   |
 * | true    | >0         | >0         | true             | true            | false   | true    |
 *
 * 关键不变量：`visible=true` ⇒ `shouldMountImage=true`（无论尺寸已知否）。
 * 这是死锁修的承诺：Image 必 mount，onLoad 才能跑，imageSize 才能被设上去。
 */
export const deriveImagePreviewMountState = (
  input: ImagePreviewMountInput
): ImagePreviewMountOutput => {
  if (!input.visible) {
    return {
      shouldEnableGesture: false,
      shouldMountImage: false,
      shouldShowCaption: false,
      shouldShowImage: false,
      shouldShowLoadingOverlay: false,
    }
  }
  const hasImage =
    input.imageNaturalWidth > 0 && input.imageNaturalHeight > 0 && input.containerWidth > 0
  return {
    shouldEnableGesture: hasImage,
    shouldMountImage: true,
    shouldShowCaption: hasImage,
    shouldShowImage: hasImage,
    shouldShowLoadingOverlay: !hasImage,
  }
}
