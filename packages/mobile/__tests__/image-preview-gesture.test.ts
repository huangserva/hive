import { describe, expect, test } from 'vitest'

import {
  clampPreviewScale,
  clampPreviewTranslation,
  resolvePreviewDoubleTapTarget,
  resolvePreviewPanBounds,
} from '../src/lib/image-preview-gesture'

describe('image preview gesture helpers', () => {
  test('clamps zoom scale into the supported range', () => {
    expect(clampPreviewScale(0.4)).toBe(1)
    expect(clampPreviewScale(2.25)).toBe(2.25)
    expect(clampPreviewScale(9)).toBe(4)
  })

  test('double tap zooms in from rest and resets when already zoomed', () => {
    expect(resolvePreviewDoubleTapTarget(1)).toBe(2.5)
    expect(resolvePreviewDoubleTapTarget(3.25)).toBe(1)
  })

  test('clamps panning to the visible image bounds at the current zoom', () => {
    const bounds = resolvePreviewPanBounds({
      contentHeight: 200,
      contentWidth: 300,
      containerHeight: 500,
      containerWidth: 300,
      scale: 2,
    })

    expect(bounds).toEqual({ maxX: 150, maxY: 0, minX: -150, minY: 0 })

    expect(
      clampPreviewTranslation(
        { x: 260, y: -40 },
        {
          contentHeight: 200,
          contentWidth: 300,
          containerHeight: 500,
          containerWidth: 300,
          scale: 2,
        }
      )
    ).toEqual({ x: 150, y: 0 })
  })
})
