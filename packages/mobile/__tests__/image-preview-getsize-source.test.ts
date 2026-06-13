import { describe, expect, it } from 'vitest'

import { planImagePreviewGetSize } from '../src/lib/image-preview-getsize-source'

describe('planImagePreviewGetSize（getSize 源→API 选择·真修死锁的解耦点）', () => {
  it('visible=false → skip：Modal 没开就不要发 getSize', () => {
    const plan = planImagePreviewGetSize({
      source: { uri: 'http://192.168.1.44:4010/api/mobile/uploads/a.jpg' },
      visible: false,
    })
    expect(plan).toEqual({ kind: 'skip' })
  })

  it('source 为 null → skip（防御性）', () => {
    expect(planImagePreviewGetSize({ source: null, visible: true })).toEqual({ kind: 'skip' })
    expect(planImagePreviewGetSize({ source: undefined, visible: true })).toEqual({ kind: 'skip' })
  })

  it('uri 为空 → skip', () => {
    expect(planImagePreviewGetSize({ source: { uri: '' }, visible: true })).toEqual({
      kind: 'skip',
    })
  })

  it('relay 模式（file:// + 无 headers）→ noHeaders 走 Image.getSize', () => {
    const plan = planImagePreviewGetSize({
      source: { uri: 'file:///cache/hippoteam-media/abc.jpg' },
      visible: true,
    })
    expect(plan).toEqual({ kind: 'noHeaders', uri: 'file:///cache/hippoteam-media/abc.jpg' })
  })

  it('LAN 模式（http + Bearer headers）→ withHeaders 走 Image.getSizeWithHeaders', () => {
    const plan = planImagePreviewGetSize({
      source: {
        headers: { Authorization: 'Bearer abc123' },
        uri: 'http://192.168.1.44:4010/api/mobile/uploads/a.jpg',
      },
      visible: true,
    })
    expect(plan).toEqual({
      headers: { Authorization: 'Bearer abc123' },
      kind: 'withHeaders',
      uri: 'http://192.168.1.44:4010/api/mobile/uploads/a.jpg',
    })
  })

  it('headers 是空对象 {} → 视为 noHeaders（某些 RN 版本对空 headers 直接 reject，避免无意义调用）', () => {
    const plan = planImagePreviewGetSize({
      source: { headers: {}, uri: 'http://10.0.0.1/a.jpg' },
      visible: true,
    })
    expect(plan).toEqual({ kind: 'noHeaders', uri: 'http://10.0.0.1/a.jpg' })
  })

  it('两种模式都不丢 uri：noHeaders 和 withHeaders 都把 source.uri 透传出去', () => {
    const fileUri = 'file:///cache/hippoteam-media/photo.jpg'
    const httpUri = 'http://192.168.1.44:4010/api/mobile/uploads/photo.jpg'

    const relay = planImagePreviewGetSize({ source: { uri: fileUri }, visible: true })
    const lan = planImagePreviewGetSize({
      source: { headers: { Authorization: 'Bearer t' }, uri: httpUri },
      visible: true,
    })

    expect(relay.kind).toBe('noHeaders')
    expect((relay as { uri: string }).uri).toBe(fileUri)
    expect(lan.kind).toBe('withHeaders')
    expect((lan as { uri: string }).uri).toBe(httpUri)
  })
})
