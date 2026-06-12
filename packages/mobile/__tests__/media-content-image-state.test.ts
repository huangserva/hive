import { describe, expect, it } from 'vitest'

import { deriveMediaContentImageState } from '../src/lib/media-content-image-state'

describe('deriveMediaContentImageState（钟馗 blocking #2 决策表）', () => {
  it('首次 render（previousUri=null）→ render Image，不 reset', () => {
    const out = deriveMediaContentImageState({
      uri: 'http://192.168.1.44:4010/api/mobile/uploads/a.jpg',
      previousUri: null,
      imageFailed: false,
      isDownloading: false,
    })
    expect(out.shouldRenderImage).toBe(true)
    expect(out.shouldShowDownloadingPlaceholder).toBe(false)
    expect(out.shouldResetImageFailed).toBe(false)
  })

  it('URI 不变 + failed=true → fallback 文件卡，不 reset', () => {
    const out = deriveMediaContentImageState({
      uri: 'http://192.168.1.44:4010/api/mobile/uploads/a.jpg',
      previousUri: 'http://192.168.1.44:4010/api/mobile/uploads/a.jpg',
      imageFailed: true,
      isDownloading: false,
    })
    expect(out.shouldRenderImage).toBe(false)
    expect(out.shouldResetImageFailed).toBe(false)
  })

  it('钟馗 B2 命门：LAN onError 后 URI 切到 file:// → 必须 reset failed 并恢复 render Image', () => {
    const out = deriveMediaContentImageState({
      uri: 'file:///cache/hippoteam-media/abc.jpg', // relay 下完切到这条
      previousUri: 'http://192.168.1.44:4010/api/mobile/uploads/abc.jpg', // 旧 LAN URI
      imageFailed: true,
      isDownloading: false,
    })
    expect(out.shouldResetImageFailed).toBe(true)
    expect(out.shouldRenderImage).toBe(true)
    expect(out.shouldShowDownloadingPlaceholder).toBe(false)
  })

  it('URI 变化但之前 failed=false → 仍 render Image，无需 reset', () => {
    const out = deriveMediaContentImageState({
      uri: 'file:///cache/hippoteam-media/abc.jpg',
      previousUri: 'http://192.168.1.44:4010/api/mobile/uploads/abc.jpg',
      imageFailed: false,
      isDownloading: false,
    })
    expect(out.shouldRenderImage).toBe(true)
    expect(out.shouldResetImageFailed).toBe(false)
  })

  it('下载中（isDownloading=true）→ placeholder，不 render Image，即使 failed=true 也不必 reset', () => {
    const out = deriveMediaContentImageState({
      uri: 'http://192.168.1.44:4010/api/mobile/uploads/abc.jpg',
      previousUri: 'http://192.168.1.44:4010/api/mobile/uploads/abc.jpg',
      imageFailed: true,
      isDownloading: true,
    })
    expect(out.shouldShowDownloadingPlaceholder).toBe(true)
    expect(out.shouldRenderImage).toBe(false)
    // Render placeholder 时不显示 Image；reset 由 URI 变化分支负责
    expect(out.shouldResetImageFailed).toBe(false)
  })

  it('回归：LAN onError → relay cache 后成功 → 图片恢复显示（端到端时序模拟）', () => {
    // step 1: 首次 render，URI = LAN
    let previous: string | null = null
    let failed = false
    const lanUri = 'http://192.168.1.44:4010/api/mobile/uploads/photo.jpg'
    const step1 = deriveMediaContentImageState({
      uri: lanUri,
      previousUri: previous,
      imageFailed: failed,
      isDownloading: false,
    })
    expect(step1.shouldRenderImage).toBe(true)

    // step 2: LAN 网络不通，onError 触发 setImageFailed(true)；下次 render
    previous = lanUri
    failed = true
    const step2 = deriveMediaContentImageState({
      uri: lanUri,
      previousUri: previous,
      imageFailed: failed,
      isDownloading: false,
    })
    expect(step2.shouldRenderImage).toBe(false) // 该退 fallback

    // step 3: relay transport 探到、开始下载
    const step3 = deriveMediaContentImageState({
      uri: lanUri,
      previousUri: previous,
      imageFailed: failed,
      isDownloading: true,
    })
    expect(step3.shouldShowDownloadingPlaceholder).toBe(true)

    // step 4: 下完，uri 切到 file://
    const fileUri = 'file:///cache/hippoteam-media/photo.jpg'
    const step4 = deriveMediaContentImageState({
      uri: fileUri,
      previousUri: lanUri,
      imageFailed: failed,
      isDownloading: false,
    })
    expect(step4.shouldResetImageFailed).toBe(true)
    expect(step4.shouldRenderImage).toBe(true)
    expect(step4.shouldShowDownloadingPlaceholder).toBe(false)
  })
})
