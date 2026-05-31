import { Ionicons } from '@expo/vector-icons'
import { useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'

import { useT } from '../i18n'
import { colors, radius, spacing } from '../theme'
import {
  clampPreviewScale,
  clampPreviewTranslation,
  resolvePreviewContainSize,
  resolvePreviewDoubleTapTarget,
} from '../lib/image-preview-gesture'

export type PreviewImageSource = {
  headers?: Record<string, string>
  uri: string
}

export interface ImagePreviewModalProps {
  label: string
  onClose: () => void
  source: PreviewImageSource
  visible: boolean
}

const DOUBLE_TAP_ZOOM_SCALE = 2.5

export function ImagePreviewModal({ label, onClose, source, visible }: ImagePreviewModalProps) {
  const t = useT()
  const [containerSize, setContainerSize] = useState({ height: 0, width: 0 })
  const [imageSize, setImageSize] = useState({ height: 0, width: 0 })

  const scale = useSharedValue(1)
  const translateX = useSharedValue(0)
  const translateY = useSharedValue(0)
  const pinchStartScale = useSharedValue(1)
  const panStartX = useSharedValue(0)
  const panStartY = useSharedValue(0)
  const stageWidth = useSharedValue(0)
  const stageHeight = useSharedValue(0)
  const naturalWidth = useSharedValue(0)
  const naturalHeight = useSharedValue(0)
  const baseWidth = useSharedValue(0)
  const baseHeight = useSharedValue(0)

  useEffect(() => {
    if (!visible) return
    setContainerSize({ height: 0, width: 0 })
    setImageSize({ height: 0, width: 0 })
    scale.value = 1
    translateX.value = 0
    translateY.value = 0
    baseWidth.value = 0
    baseHeight.value = 0
    stageWidth.value = 0
    stageHeight.value = 0
    naturalWidth.value = 0
    naturalHeight.value = 0
  }, [baseHeight, baseWidth, naturalHeight, naturalWidth, scale, stageHeight, stageWidth, translateX, translateY, visible])

  useEffect(() => {
    stageWidth.value = containerSize.width
    stageHeight.value = containerSize.height
  }, [containerSize.height, containerSize.width, stageHeight, stageWidth])

  useEffect(() => {
    naturalWidth.value = imageSize.width
    naturalHeight.value = imageSize.height
  }, [imageSize.height, imageSize.width, naturalHeight, naturalWidth])

  useEffect(() => {
    if (!containerSize.width || !containerSize.height || !imageSize.width || !imageSize.height) {
      baseWidth.value = 0
      baseHeight.value = 0
      return
    }
    const nextBase = resolvePreviewContainSize({
      contentHeight: imageSize.height,
      contentWidth: imageSize.width,
      maxHeight: containerSize.height,
      maxWidth: containerSize.width,
    })
    baseWidth.value = nextBase.width
    baseHeight.value = nextBase.height
    const clamped = clampPreviewTranslation(
      { x: translateX.value, y: translateY.value },
      {
        containerHeight: containerSize.height,
        containerWidth: containerSize.width,
        contentHeight: nextBase.height,
        contentWidth: nextBase.width,
        scale: scale.value,
      }
    )
    translateX.value = clamped.x
    translateY.value = clamped.y
  }, [
    baseHeight,
    baseWidth,
    containerSize.height,
    containerSize.width,
    imageSize.height,
    imageSize.width,
    scale,
    translateX,
    translateY,
  ])

  const hasImage = imageSize.width > 0 && imageSize.height > 0 && containerSize.width > 0

  const resetZoom = () => {
    scale.value = withTiming(1)
    translateX.value = withTiming(0)
    translateY.value = withTiming(0)
  }

  const snapToBounds = () => {
    const nextBase =
      containerSize.width > 0 && containerSize.height > 0 && imageSize.width > 0 && imageSize.height > 0
        ? resolvePreviewContainSize({
            contentHeight: imageSize.height,
            contentWidth: imageSize.width,
            maxHeight: containerSize.height,
            maxWidth: containerSize.width,
          })
        : { height: 0, width: 0 }
    const clamped = clampPreviewTranslation(
      { x: translateX.value, y: translateY.value },
      {
        containerHeight: containerSize.height,
        containerWidth: containerSize.width,
        contentHeight: nextBase.height,
        contentWidth: nextBase.width,
        scale: scale.value,
      }
    )
    translateX.value = withSpring(clamped.x)
    translateY.value = withSpring(clamped.y)
  }

  const pinchGesture = useMemo(
    () =>
      Gesture.Pinch()
        .onBegin(() => {
          pinchStartScale.value = scale.value
        })
        .onUpdate((event) => {
          const nextScale = clampPreviewScale(pinchStartScale.value * event.scale)
          scale.value = nextScale
          if (!baseWidth.value || !baseHeight.value || !stageWidth.value || !stageHeight.value) {
            return
          }
          const overflowX = Math.max(0, (baseWidth.value * nextScale - stageWidth.value) / 2)
          const overflowY = Math.max(0, (baseHeight.value * nextScale - stageHeight.value) / 2)
          const nextX = Math.min(overflowX, Math.max(-overflowX, translateX.value))
          const nextY = Math.min(overflowY, Math.max(-overflowY, translateY.value))
          translateX.value = nextX
          translateY.value = nextY
        })
        .onEnd(() => {
          if (scale.value <= 1) {
            resetZoom()
            return
          }
          snapToBounds()
        }),
    [
      baseHeight,
      baseWidth,
      pinchStartScale,
      scale,
      stageHeight,
      stageWidth,
      translateX,
      translateY,
    ]
  )

  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .onBegin(() => {
          panStartX.value = translateX.value
          panStartY.value = translateY.value
        })
        .onUpdate((event) => {
          if (scale.value <= 1 || !baseWidth.value || !baseHeight.value || !stageWidth.value || !stageHeight.value) {
            return
          }
          const overflowX = Math.max(0, (baseWidth.value * scale.value - stageWidth.value) / 2)
          const overflowY = Math.max(0, (baseHeight.value * scale.value - stageHeight.value) / 2)
          translateX.value = Math.min(
            overflowX,
            Math.max(-overflowX, panStartX.value + event.translationX)
          )
          translateY.value = Math.min(
            overflowY,
            Math.max(-overflowY, panStartY.value + event.translationY)
          )
        })
        .onEnd(() => {
          if (scale.value <= 1) {
            resetZoom()
            return
          }
          snapToBounds()
        }),
    [
      baseHeight,
      baseWidth,
      panStartX,
      panStartY,
      scale,
      stageHeight,
      stageWidth,
      translateX,
      translateY,
    ]
  )

  const doubleTapGesture = useMemo(
    () =>
      Gesture.Tap()
        .numberOfTaps(2)
        .onEnd(() => {
          const nextScale = resolvePreviewDoubleTapTarget(scale.value, 1, DOUBLE_TAP_ZOOM_SCALE, 4)
          if (nextScale === 1) {
            resetZoom()
            return
          }
          scale.value = withSpring(nextScale)
          snapToBounds()
        }),
    [scale]
  )

  const previewGesture = useMemo(
    () => Gesture.Simultaneous(pinchGesture, panGesture, doubleTapGesture),
    [doubleTapGesture, panGesture, pinchGesture]
  )

  const stageAnimatedStyle = useAnimatedStyle(() => ({
    height: baseHeight.value,
    transform: [{ translateX: translateX.value }, { translateY: translateY.value }],
    width: baseWidth.value,
  }))

  const imageAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }))

  return (
    <Modal animationType="fade" transparent visible={visible} onRequestClose={onClose}>
      <View style={s.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={s.shell} pointerEvents="box-none">
          <Pressable
            accessibilityLabel={t('common.close')}
            accessibilityRole="button"
            onPress={onClose}
            style={s.close}
          >
            <Ionicons color={colors.text} name="close" size={22} />
          </Pressable>
          <View
            onLayout={(event) => setContainerSize(event.nativeEvent.layout)}
            style={s.frame}
          >
            {hasImage ? (
              <>
                <GestureDetector gesture={previewGesture}>
                  <Animated.View style={[s.stage, stageAnimatedStyle]}>
                    <Animated.Image
                      accessibilityLabel={label}
                      onLoad={(event) => {
                        const nextSize = event.nativeEvent.source
                        if (!nextSize?.width || !nextSize?.height) return
                        setImageSize({ height: nextSize.height, width: nextSize.width })
                      }}
                      resizeMode="contain"
                      source={source}
                      style={[s.image, imageAnimatedStyle]}
                    />
                  </Animated.View>
                </GestureDetector>
                <Text numberOfLines={2} style={s.caption}>
                  {label}
                </Text>
              </>
            ) : (
              <View style={s.loadingWrap}>
                <ActivityIndicator color={colors.accent} size="small" />
                <Text style={s.loadingText}>{t('common.loading')}</Text>
              </View>
            )}
          </View>
        </View>
      </View>
    </Modal>
  )
}

const s = StyleSheet.create({
  backdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.94)',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  caption: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  close: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: 999,
    height: 40,
    justifyContent: 'center',
    position: 'absolute',
    right: spacing.lg,
    top: 44,
    width: 40,
    zIndex: 2,
  },
  frame: {
    alignItems: 'center',
    gap: spacing.sm,
    height: '100%',
    justifyContent: 'center',
    maxHeight: '88%',
    maxWidth: '100%',
    width: '100%',
  },
  image: {
    height: '100%',
    width: '100%',
  },
  loadingText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '700',
  },
  loadingWrap: {
    alignItems: 'center',
    gap: spacing.sm,
  },
  shell: {
    height: '100%',
    width: '100%',
  },
  stage: {
    alignItems: 'center',
    justifyContent: 'center',
  },
})
