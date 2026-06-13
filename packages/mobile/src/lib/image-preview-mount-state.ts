/**
 * ImagePreviewModal 全屏图片预览：Image 是否 mount / 是否可见 / loading overlay /
 * gesture 是否启用 / 加载失败提示 是否显示——纯函数决策表，可单测。
 *
 * 历史教训（请勿走回头路）：
 *
 * 1) M28 上线（commit 654a4c8）原版用 `{hasImage ? <Image/> : <Loading/>}` 三元门，
 *    hasImage 又只由 <Image onLoad> 设——onLoad 跑不到就永远 hasImage=false。
 *    死锁第一类：mount 被 hasImage 自己门住。
 *
 * 2) 第一次修（commit b55c284）改成 always-mount + opacity，理论上让 onLoad 能跑。
 *    但真机仍卡死——Android RN Image 在 0×0 layout 下根本不触发图片加载，onLoad 不
 *    触发。死锁第二类：mount 了但 stage 0×0 让 Image 仍没机会加载。
 *
 * 真修（本次）：用 Image.getSize / Image.getSizeWithHeaders 在 useEffect 里独立取图片
 *    自然尺寸——getSize 不依赖 layout，与 0×0 stage 解耦。拿到尺寸后 baseW/H 才能算出
 *    stage 真实尺寸，Image 才能真正加载并可见。
 *
 *    本决策表的 mount 含义随之改：visible 且没失败时，只在 getSize 已返回（hasImage）的
 *    瞬间 mount——不再做"先 mount 个 0×0 占着"的无效操作（实测无用反而易迷惑后人）。
 *
 *    新增 `loadFailed` 分支：getSize 失败时不能永远 loading——必须 surface 出"加载失败"
 *    提示让用户能关闭，治第三类潜在卡死（uri 不可达 / 服务端 404 等）。
 *
 * 真机验证仍是 ground truth：本纯函数测试只能保证决策表逻辑自洽，无法证伪 Android
 * 0×0 不加载这类原生行为——上线必须真机走中继场景验。
 */

export interface ImagePreviewMountInput {
  /** 容器测量到的高度（onLayout）。 */
  containerHeight: number
  /** 容器测量到的宽度（onLayout）。 */
  containerWidth: number
  /** Image.getSize / onLoad 拿到的图片原生高度。 */
  imageNaturalHeight: number
  /** Image.getSize / onLoad 拿到的图片原生宽度。 */
  imageNaturalWidth: number
  /** getSize 是否最终失败（uri 不可达 / headers 错 / 服务端 404 等）。 */
  loadFailed?: boolean
  /** Modal 是否打开。 */
  visible: boolean
}

export interface ImagePreviewMountOutput {
  /** 手势 (pinch/pan/double-tap) 是否生效——仅 hasImage 时启。 */
  shouldEnableGesture: boolean
  /** Image 是否 mount——visible 且有尺寸时 true；失败时 false（无意义）。 */
  shouldMountImage: boolean
  /** caption（图片标题）是否显示——hasImage 时才显示，避免空白先闪一下文字。 */
  shouldShowCaption: boolean
  /** Image 是否可见（控 opacity，不控 mount）。 */
  shouldShowImage: boolean
  /** "加载失败"提示是否显示（loadFailed 才出）。 */
  shouldShowLoadFailed: boolean
  /** loading overlay 是否盖在上面（!hasImage && !loadFailed 时显示）。 */
  shouldShowLoadingOverlay: boolean
}

const HIDDEN: ImagePreviewMountOutput = {
  shouldEnableGesture: false,
  shouldMountImage: false,
  shouldShowCaption: false,
  shouldShowImage: false,
  shouldShowLoadFailed: false,
  shouldShowLoadingOverlay: false,
}

/**
 * 决策表（真修版，b55c284 那版的 always-mount 已废）：
 *
 * | visible | loadFailed | container | image | mount | show | overlay | failed | gesture |
 * |---------|------------|-----------|-------|-------|------|---------|--------|---------|
 * | false   | *          | *         | *     | F     | F    | F       | F      | F       |
 * | true    | true       | *         | *     | F     | F    | F       | **T**  | F       |
 * | true    | false      | 0         | 0     | F     | F    | T       | F      | F       |
 * | true    | false      | >0        | 0     | F     | F    | T       | F      | F       |
 * | true    | false      | 0         | >0    | F     | F    | T       | F      | F       |
 * | true    | false      | >0        | >0    | T     | T    | F       | F      | T       |
 *
 * 关键不变量：
 *   - `loadFailed=true` ⇒ `shouldShowLoadFailed=true` 且 overlay/Image 全关；
 *   - `shouldShowImage` 严格蕴含 `shouldMountImage`；
 *   - 任一为 0（容器或图片尺寸）⇒ 不 mount（getSize 还没到，mount 也只是 0×0 无效 Image）。
 */
export const deriveImagePreviewMountState = (
  input: ImagePreviewMountInput
): ImagePreviewMountOutput => {
  if (!input.visible) return HIDDEN
  if (input.loadFailed === true) {
    return { ...HIDDEN, shouldShowLoadFailed: true }
  }
  const hasImage =
    input.imageNaturalWidth > 0 &&
    input.imageNaturalHeight > 0 &&
    input.containerWidth > 0 &&
    input.containerHeight > 0
  return {
    shouldEnableGesture: hasImage,
    shouldMountImage: hasImage,
    shouldShowCaption: hasImage,
    shouldShowImage: hasImage,
    shouldShowLoadFailed: false,
    shouldShowLoadingOverlay: !hasImage,
  }
}
