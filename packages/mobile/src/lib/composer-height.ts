export const COMPOSER_INPUT_MIN_HEIGHT = 42
export const COMPOSER_INPUT_MAX_HEIGHT = 132

export const resolveComposerInputHeight = (contentHeight: number) =>
  Math.max(COMPOSER_INPUT_MIN_HEIGHT, Math.min(contentHeight, COMPOSER_INPUT_MAX_HEIGHT))
