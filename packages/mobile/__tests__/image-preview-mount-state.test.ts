import { describe, expect, it } from 'vitest'

import { deriveImagePreviewMountState } from '../src/lib/image-preview-mount-state'

describe('deriveImagePreviewMountState（全屏图片预览真修·决策表，b55c284 always-mount 已废）', () => {
  it('visible=false → 全关', () => {
    const out = deriveImagePreviewMountState({
      containerHeight: 0,
      containerWidth: 0,
      imageNaturalHeight: 0,
      imageNaturalWidth: 0,
      visible: false,
    })
    expect(out.shouldMountImage).toBe(false)
    expect(out.shouldShowImage).toBe(false)
    expect(out.shouldShowLoadingOverlay).toBe(false)
    expect(out.shouldShowLoadFailed).toBe(false)
    expect(out.shouldEnableGesture).toBe(false)
    expect(out.shouldShowCaption).toBe(false)
  })

  it('visible + 尺寸全 0（getSize 还没回）→ 不 mount Image，overlay 显示', () => {
    // 真修说明：b55c284 那版"无论有无尺寸都 mount Image"被 Android 0×0 不加载真因
    // 击穿——所以本次改回"有尺寸才 mount"。尺寸由 useEffect 的 getSize 提供，不再
    // 依赖 0×0 Image 自己的 onLoad。
    const out = deriveImagePreviewMountState({
      containerHeight: 0,
      containerWidth: 0,
      imageNaturalHeight: 0,
      imageNaturalWidth: 0,
      visible: true,
    })
    expect(out.shouldMountImage).toBe(false)
    expect(out.shouldShowImage).toBe(false)
    expect(out.shouldShowLoadingOverlay).toBe(true)
    expect(out.shouldShowLoadFailed).toBe(false)
    expect(out.shouldEnableGesture).toBe(false)
    expect(out.shouldShowCaption).toBe(false)
  })

  it('visible + 容器测到但 getSize 还没回 → 不 mount，overlay 显示', () => {
    const out = deriveImagePreviewMountState({
      containerHeight: 600,
      containerWidth: 360,
      imageNaturalHeight: 0,
      imageNaturalWidth: 0,
      visible: true,
    })
    expect(out.shouldMountImage).toBe(false)
    expect(out.shouldShowImage).toBe(false)
    expect(out.shouldShowLoadingOverlay).toBe(true)
    expect(out.shouldEnableGesture).toBe(false)
  })

  it('visible + getSize 已回但容器还没测到（极端时序）→ 不 mount，overlay 显示', () => {
    const out = deriveImagePreviewMountState({
      containerHeight: 0,
      containerWidth: 0,
      imageNaturalHeight: 1080,
      imageNaturalWidth: 1920,
      visible: true,
    })
    expect(out.shouldMountImage).toBe(false)
    expect(out.shouldShowImage).toBe(false)
    expect(out.shouldShowLoadingOverlay).toBe(true)
    expect(out.shouldEnableGesture).toBe(false)
  })

  it('visible + 图片尺寸 + 容器尺寸都到 → mount + 显示 + 手势启', () => {
    const out = deriveImagePreviewMountState({
      containerHeight: 600,
      containerWidth: 360,
      imageNaturalHeight: 1080,
      imageNaturalWidth: 1920,
      visible: true,
    })
    expect(out.shouldMountImage).toBe(true)
    expect(out.shouldShowImage).toBe(true)
    expect(out.shouldShowLoadingOverlay).toBe(false)
    expect(out.shouldShowLoadFailed).toBe(false)
    expect(out.shouldEnableGesture).toBe(true)
    expect(out.shouldShowCaption).toBe(true)
  })

  it('真修新分支：loadFailed=true → 显示加载失败提示，overlay/Image/手势 全关', () => {
    // 治第三类潜在卡死（uri 不可达 / 服务端 404）——之前 always-mount 版没这条 fallback，
    // getSize 不存在时只能默默永远 loading。本次显式 surface 出失败态。
    const out = deriveImagePreviewMountState({
      containerHeight: 600,
      containerWidth: 360,
      imageNaturalHeight: 0,
      imageNaturalWidth: 0,
      loadFailed: true,
      visible: true,
    })
    expect(out.shouldShowLoadFailed).toBe(true)
    expect(out.shouldShowLoadingOverlay).toBe(false)
    expect(out.shouldMountImage).toBe(false)
    expect(out.shouldShowImage).toBe(false)
    expect(out.shouldEnableGesture).toBe(false)
    expect(out.shouldShowCaption).toBe(false)
  })

  it('loadFailed=true 不被尺寸已就绪覆盖（即使 imageW/H 都到位也以 failed 为准）', () => {
    // 防御性：即使有人手贱把尺寸塞进去，loadFailed 也优先——避免"显示了但 broken"。
    const out = deriveImagePreviewMountState({
      containerHeight: 600,
      containerWidth: 360,
      imageNaturalHeight: 1080,
      imageNaturalWidth: 1920,
      loadFailed: true,
      visible: true,
    })
    expect(out.shouldShowLoadFailed).toBe(true)
    expect(out.shouldMountImage).toBe(false)
    expect(out.shouldShowImage).toBe(false)
  })

  it('!visible 优先于 loadFailed（关闭就全关，不留 failed 提示残影）', () => {
    const out = deriveImagePreviewMountState({
      containerHeight: 600,
      containerWidth: 360,
      imageNaturalHeight: 0,
      imageNaturalWidth: 0,
      loadFailed: true,
      visible: false,
    })
    expect(out.shouldShowLoadFailed).toBe(false)
    expect(out.shouldMountImage).toBe(false)
  })

  it('回归：端到端时序（open → layout → getSize → ready → close）', () => {
    // step 1: visible=true 但 Modal 刚 open，container/image 全 0；
    //         真修：本帧不 mount Image（getSize 在 useEffect 里独立跑），overlay 显示。
    const opened = deriveImagePreviewMountState({
      containerHeight: 0,
      containerWidth: 0,
      imageNaturalHeight: 0,
      imageNaturalWidth: 0,
      visible: true,
    })
    expect(opened.shouldMountImage).toBe(false)
    expect(opened.shouldShowLoadingOverlay).toBe(true)

    // step 2: RN onLayout 跑，container 拿到尺寸；getSize 还在路上
    const layoutMeasured = deriveImagePreviewMountState({
      containerHeight: 600,
      containerWidth: 360,
      imageNaturalHeight: 0,
      imageNaturalWidth: 0,
      visible: true,
    })
    expect(layoutMeasured.shouldMountImage).toBe(false)
    expect(layoutMeasured.shouldShowLoadingOverlay).toBe(true)

    // step 3: Image.getSize 回调 setImageSize
    const loaded = deriveImagePreviewMountState({
      containerHeight: 600,
      containerWidth: 360,
      imageNaturalHeight: 1080,
      imageNaturalWidth: 1920,
      visible: true,
    })
    expect(loaded.shouldMountImage).toBe(true)
    expect(loaded.shouldShowImage).toBe(true)
    expect(loaded.shouldShowLoadingOverlay).toBe(false)
    expect(loaded.shouldEnableGesture).toBe(true)

    // step 4: 关闭
    const closed = deriveImagePreviewMountState({
      containerHeight: 600,
      containerWidth: 360,
      imageNaturalHeight: 1080,
      imageNaturalWidth: 1920,
      visible: false,
    })
    expect(closed.shouldMountImage).toBe(false)
    expect(closed.shouldEnableGesture).toBe(false)
  })

  it('回归：getSize 失败端到端时序（open → layout → getSize 失败 → 显示失败 → 关闭）', () => {
    // open
    const opened = deriveImagePreviewMountState({
      containerHeight: 0,
      containerWidth: 0,
      imageNaturalHeight: 0,
      imageNaturalWidth: 0,
      visible: true,
    })
    expect(opened.shouldShowLoadingOverlay).toBe(true)

    // layout 测到
    const layoutOnly = deriveImagePreviewMountState({
      containerHeight: 600,
      containerWidth: 360,
      imageNaturalHeight: 0,
      imageNaturalWidth: 0,
      visible: true,
    })
    expect(layoutOnly.shouldShowLoadingOverlay).toBe(true)

    // getSize 失败
    const failed = deriveImagePreviewMountState({
      containerHeight: 600,
      containerWidth: 360,
      imageNaturalHeight: 0,
      imageNaturalWidth: 0,
      loadFailed: true,
      visible: true,
    })
    expect(failed.shouldShowLoadFailed).toBe(true)
    expect(failed.shouldShowLoadingOverlay).toBe(false)
    expect(failed.shouldMountImage).toBe(false)

    // 关闭——loadFailed 残留不该影响
    const closed = deriveImagePreviewMountState({
      containerHeight: 600,
      containerWidth: 360,
      imageNaturalHeight: 0,
      imageNaturalWidth: 0,
      loadFailed: true,
      visible: false,
    })
    expect(closed.shouldShowLoadFailed).toBe(false)
  })

  it('源切换兼容：file:// 和 http+headers 走同一决策路径（决策只看尺寸）', () => {
    const a = deriveImagePreviewMountState({
      containerHeight: 800,
      containerWidth: 480,
      imageNaturalHeight: 800,
      imageNaturalWidth: 600,
      visible: true,
    })
    const b = deriveImagePreviewMountState({
      containerHeight: 800,
      containerWidth: 480,
      imageNaturalHeight: 800,
      imageNaturalWidth: 600,
      visible: true,
    })
    expect(a).toEqual(b)
  })
})
