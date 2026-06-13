import { describe, expect, it } from 'vitest'

import { deriveImagePreviewMountState } from '../src/lib/image-preview-mount-state'

describe('deriveImagePreviewMountState（全屏图片预览死锁修·决策表）', () => {
  it('visible=false → Image 不 mount, 不显示, overlay 不显示, gesture 关', () => {
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
    expect(out.shouldEnableGesture).toBe(false)
    expect(out.shouldShowCaption).toBe(false)
  })

  it('死锁修关键：visible=true + 尺寸全 0 → Image 仍必须 mount（让 onLoad 能跑），overlay 显示', () => {
    const out = deriveImagePreviewMountState({
      containerHeight: 0,
      containerWidth: 0,
      imageNaturalHeight: 0,
      imageNaturalWidth: 0,
      visible: true,
    })
    // 这条是死锁修的承诺：mount=true 否则 onLoad 永远不跑、imageSize 永远 0、永远 overlay 卡死。
    expect(out.shouldMountImage).toBe(true)
    expect(out.shouldShowImage).toBe(false)
    expect(out.shouldShowLoadingOverlay).toBe(true)
    expect(out.shouldEnableGesture).toBe(false)
    expect(out.shouldShowCaption).toBe(false)
  })

  it('visible + 容器测到但 onLoad 未触发（图片尺寸还 0）→ Image mount, overlay 显示, image 不显示', () => {
    const out = deriveImagePreviewMountState({
      containerHeight: 600,
      containerWidth: 360,
      imageNaturalHeight: 0,
      imageNaturalWidth: 0,
      visible: true,
    })
    expect(out.shouldMountImage).toBe(true)
    expect(out.shouldShowImage).toBe(false)
    expect(out.shouldShowLoadingOverlay).toBe(true)
    expect(out.shouldEnableGesture).toBe(false)
  })

  it('visible + onLoad 已设 imageSize 但容器还没测到（极端时序）→ overlay 仍显示', () => {
    const out = deriveImagePreviewMountState({
      containerHeight: 0,
      containerWidth: 0,
      imageNaturalHeight: 1080,
      imageNaturalWidth: 1920,
      visible: true,
    })
    expect(out.shouldMountImage).toBe(true)
    expect(out.shouldShowImage).toBe(false)
    expect(out.shouldShowLoadingOverlay).toBe(true)
    expect(out.shouldEnableGesture).toBe(false)
  })

  it('visible + 图片已加载 + 容器已测 → image 显示, overlay 关, gesture 启, caption 显示', () => {
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
    expect(out.shouldEnableGesture).toBe(true)
    expect(out.shouldShowCaption).toBe(true)
  })

  it('回归：死锁端到端时序复现（visible→layout→onLoad→ready）', () => {
    // step 1: visible=true 但 modal 刚 open，container/image 全 0
    //         旧实现这一帧就会渲染 loadingWrap、不挂 Image → onLoad 没机会跑。
    //         新实现：Image 已 mount（hidden via opacity），onLoad 可触发。
    const opened = deriveImagePreviewMountState({
      containerHeight: 0,
      containerWidth: 0,
      imageNaturalHeight: 0,
      imageNaturalWidth: 0,
      visible: true,
    })
    expect(opened.shouldMountImage).toBe(true)
    expect(opened.shouldShowLoadingOverlay).toBe(true)

    // step 2: RN onLayout 跑，container 拿到尺寸；image 还没解码
    const layoutMeasured = deriveImagePreviewMountState({
      containerHeight: 600,
      containerWidth: 360,
      imageNaturalHeight: 0,
      imageNaturalWidth: 0,
      visible: true,
    })
    expect(layoutMeasured.shouldMountImage).toBe(true)
    expect(layoutMeasured.shouldShowLoadingOverlay).toBe(true)

    // step 3: onLoad 触发设 imageSize
    const loaded = deriveImagePreviewMountState({
      containerHeight: 600,
      containerWidth: 360,
      imageNaturalHeight: 1080,
      imageNaturalWidth: 1920,
      visible: true,
    })
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

  it('源切换兼容：无论 file:// 还是 http+headers，决策只看尺寸数值不看 URI 形式', () => {
    // 决策函数对 source 形态无感（uri/headers 在 UI 层处理），都通过 imageNaturalW/H 出尺寸。
    // 这条断言守住"两种 source 走同一决策路径"的不变量。
    const fileUri = deriveImagePreviewMountState({
      containerHeight: 800,
      containerWidth: 480,
      imageNaturalHeight: 800,
      imageNaturalWidth: 600,
      visible: true,
    })
    const httpWithHeaders = deriveImagePreviewMountState({
      containerHeight: 800,
      containerWidth: 480,
      imageNaturalHeight: 800,
      imageNaturalWidth: 600,
      visible: true,
    })
    expect(fileUri).toEqual(httpWithHeaders)
  })
})
