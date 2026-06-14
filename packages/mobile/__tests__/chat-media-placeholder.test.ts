import { describe, expect, it } from 'vitest'

import {
  MEDIA_IMAGE_COMPACT_HEIGHT,
  MEDIA_IMAGE_COMPACT_WIDTH,
  MEDIA_IMAGE_FULL_HEIGHT,
  MEDIA_IMAGE_FULL_WIDTH,
  resolveMediaPlaceholderSize,
} from '../src/lib/chat-media-placeholder'

describe('resolveMediaPlaceholderSize（媒体加载占位稳定尺寸·治"图加载抖一下"）', () => {
  it('image + 非 compact → 全屏图卡尺寸（170×230，对齐 mediaStyles.image）', () => {
    expect(resolveMediaPlaceholderSize({ kind: 'image', compact: false })).toEqual({
      height: MEDIA_IMAGE_FULL_HEIGHT,
      width: MEDIA_IMAGE_FULL_WIDTH,
    })
  })

  it('image + compact（多图气泡）→ compact 尺寸（104×104，对齐 mediaStyles.imageCompact）', () => {
    expect(resolveMediaPlaceholderSize({ kind: 'image', compact: true })).toEqual({
      height: MEDIA_IMAGE_COMPACT_HEIGHT,
      width: MEDIA_IMAGE_COMPACT_WIDTH,
    })
  })

  it('video → null（当前 inline 永远 fileCard，placeholder/最终同尺寸，不需占位）', () => {
    expect(resolveMediaPlaceholderSize({ kind: 'video', compact: false })).toBeNull()
    expect(resolveMediaPlaceholderSize({ kind: 'video', compact: true })).toBeNull()
  })

  it('other（非媒体文件）→ null（无尺寸切换，fileCard 自己布局）', () => {
    expect(resolveMediaPlaceholderSize({ kind: 'other', compact: false })).toBeNull()
    expect(resolveMediaPlaceholderSize({ kind: 'other', compact: true })).toBeNull()
  })

  it('常量值与 mediaStyles 锁定（变这些常量就要同步改 mediaStyles）', () => {
    // 这条把"占位 = mediaStyles.image 的同款尺寸"作为不变量钉死。如果以后改了
    // mediaStyles.image 的 170×230 但忘了同步这里，本测红 → 强制 caller 同步。
    expect(MEDIA_IMAGE_FULL_HEIGHT).toBe(170)
    expect(MEDIA_IMAGE_FULL_WIDTH).toBe(230)
    expect(MEDIA_IMAGE_COMPACT_HEIGHT).toBe(104)
    expect(MEDIA_IMAGE_COMPACT_WIDTH).toBe(104)
  })

  it('回归：image compact / image 非 compact 输出维度对应（compact 一定 ≤ 非 compact）', () => {
    const full = resolveMediaPlaceholderSize({ kind: 'image', compact: false })
    const compact = resolveMediaPlaceholderSize({ kind: 'image', compact: true })
    if (!full || !compact) throw new Error('image 输出不应为 null')
    expect(compact.height).toBeLessThanOrEqual(full.height)
    expect(compact.width).toBeLessThanOrEqual(full.width)
  })
})
