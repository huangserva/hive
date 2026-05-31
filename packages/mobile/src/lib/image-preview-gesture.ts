export const PREVIEW_IMAGE_MIN_SCALE = 1
export const PREVIEW_IMAGE_MAX_SCALE = 4
export const PREVIEW_IMAGE_DOUBLE_TAP_SCALE = 2.5

export interface PreviewContainSizeInput {
  contentHeight: number
  contentWidth: number
  maxHeight: number
  maxWidth: number
}

export interface PreviewPanBoundsInput {
  containerHeight: number
  containerWidth: number
  contentHeight: number
  contentWidth: number
  scale: number
}

export interface PreviewTranslation {
  x: number
  y: number
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export const clampPreviewScale = (
  scale: number,
  min = PREVIEW_IMAGE_MIN_SCALE,
  max = PREVIEW_IMAGE_MAX_SCALE
) => clamp(scale, min, max)

export const resolvePreviewDoubleTapTarget = (
  currentScale: number,
  min = PREVIEW_IMAGE_MIN_SCALE,
  zoomScale = PREVIEW_IMAGE_DOUBLE_TAP_SCALE,
  max = PREVIEW_IMAGE_MAX_SCALE
) => (currentScale > min + 0.15 ? min : clampPreviewScale(zoomScale, min, max))

export const resolvePreviewContainSize = ({
  contentHeight,
  contentWidth,
  maxHeight,
  maxWidth,
}: PreviewContainSizeInput) => {
  if (contentWidth <= 0 || contentHeight <= 0 || maxWidth <= 0 || maxHeight <= 0) {
    return { height: 0, width: 0 }
  }
  const scale = Math.min(maxWidth / contentWidth, maxHeight / contentHeight)
  return {
    height: contentHeight * scale,
    width: contentWidth * scale,
  }
}

export const resolvePreviewPanBounds = ({
  containerHeight,
  containerWidth,
  contentHeight,
  contentWidth,
  scale,
}: PreviewPanBoundsInput) => {
  const scaledWidth = contentWidth * scale
  const scaledHeight = contentHeight * scale
  const overflowX = Math.max(0, (scaledWidth - containerWidth) / 2)
  const overflowY = Math.max(0, (scaledHeight - containerHeight) / 2)
  return {
    maxX: overflowX,
    maxY: overflowY,
    minX: -overflowX || 0,
    minY: -overflowY || 0,
  }
}

export const clampPreviewTranslation = (
  translation: PreviewTranslation,
  bounds: PreviewPanBoundsInput
) => {
  const limit = resolvePreviewPanBounds(bounds)
  return {
    x: clamp(translation.x, limit.minX, limit.maxX),
    y: clamp(translation.y, limit.minY, limit.maxY),
  }
}
