/**
 * ImagePreviewModal 全屏图片预览：根据 source 决定该用 Image.getSize 还是
 * Image.getSizeWithHeaders 来"解耦"图片自然尺寸——不再依赖 0×0 stage 里 Animated.Image
 * 的 onLoad（Android RN 在 0×0 layout 下根本不触发图片加载，导致 onLoad 永不触发，
 * imageSize 永远 0，baseW/H 永远 0，stage 永远 0×0——这就是 b55c284 always-mount
 * 修法仍然真机卡死的真因）。
 *
 * 决策只看 source 自身（有无 headers + uri 是否非空 + visible 是否为 true），与
 * UI / 副作用无关，纯函数。getSize 的具体调用、回调、cancel、错误处理由组件层负责，
 * 这里只回答"该调哪个 API + 用什么 uri / headers"。
 *
 * 真机验证仍是 ground truth——纯函数测不出"0×0 Image 不加载"这条 Android 原生行为，
 * 测试只能保证 source→API 选择不出错，不能保证 getSize 真的拿到了尺寸。
 */

export interface ImageGetSizeSource {
  /** 仅 LAN 模式下带 Authorization Bearer 等 headers；relay 模式 file:// 没有 headers。 */
  headers?: Record<string, string>
  /** file:// 或 http(s):// 的图片 URI。 */
  uri: string
}

export interface ImageGetSizePlanInput {
  /** Modal 是否打开；false 时直接 skip，不发起 getSize。 */
  visible: boolean
  /** 当前 <Animated.Image> 的 source；null/undefined 视为 skip。 */
  source: ImageGetSizeSource | null | undefined
}

/**
 * 决策表：
 *
 * | visible | source        | headers 是否非空 | kind          |
 * |---------|---------------|------------------|---------------|
 * | false   | *             | *                | skip          |
 * | true    | null/no uri   | *                | skip          |
 * | true    | uri           | 无 / 空对象      | noHeaders     |
 * | true    | uri           | 有 ≥1 个 entry   | withHeaders   |
 *
 * 关键：`headers` 为 `{}`（空对象）时仍走 noHeaders 路径——避免无意义的 getSizeWithHeaders
 * 调用（实测某些 RN 版本对空 headers 直接 reject）。
 */
export type ImageGetSizePlan =
  | { kind: 'skip' }
  | { kind: 'noHeaders'; uri: string }
  | { kind: 'withHeaders'; uri: string; headers: Record<string, string> }

export const planImagePreviewGetSize = ({
  visible,
  source,
}: ImageGetSizePlanInput): ImageGetSizePlan => {
  if (!visible) return { kind: 'skip' }
  if (!source?.uri) return { kind: 'skip' }
  const headers = source.headers
  if (headers && Object.keys(headers).length > 0) {
    return { kind: 'withHeaders', uri: source.uri, headers }
  }
  return { kind: 'noHeaders', uri: source.uri }
}
