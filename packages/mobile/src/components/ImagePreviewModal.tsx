import { Ionicons } from '@expo/vector-icons'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated'

import { useT } from '../i18n'
import {
  clampPreviewScale,
  clampPreviewTranslation,
  resolvePreviewContainSize,
  resolvePreviewDoubleTapTarget,
} from '../lib/image-preview-gesture'
import { planImagePreviewGetSize } from '../lib/image-preview-getsize-source'
import { deriveImagePreviewMountState } from '../lib/image-preview-mount-state'
import { colors, spacing } from '../theme'

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
  // 真修死锁：getSize 失败时 surface 出来，避免无限 loading。详见
  // ../lib/image-preview-mount-state.ts 的历史教训注释。
  const [loadFailed, setLoadFailed] = useState(false)

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
    setLoadFailed(false)
    scale.value = 1
    translateX.value = 0
    translateY.value = 0
    baseWidth.value = 0
    baseHeight.value = 0
    stageWidth.value = 0
    stageHeight.value = 0
    naturalWidth.value = 0
    naturalHeight.value = 0
  }, [
    baseHeight,
    baseWidth,
    naturalHeight,
    naturalWidth,
    scale,
    stageHeight,
    stageWidth,
    translateX,
    translateY,
    visible,
  ])

  // 真修核心：用 Image.getSize / Image.getSizeWithHeaders 在 useEffect 里独立取图片
  // 自然尺寸，与 0×0 stage 解耦——治 Android RN Image 在 0×0 layout 下根本不触发
  // 加载导致 onLoad 永不触发的死锁（b55c284 always-mount 修法击穿点）。
  // source→API 选择走纯函数 planImagePreviewGetSize（已单测），这里只负责调 RN API
  // + 处理 success/error + cancel。
  useEffect(() => {
    const plan = planImagePreviewGetSize({ source, visible })
    if (plan.kind === 'skip') return

    let cancelled = false
    const onSuccess = (width: number, height: number) => {
      if (cancelled) return
      if (!width || !height) {
        setLoadFailed(true)
        return
      }
      setImageSize({ height, width })
    }
    const onError = () => {
      if (cancelled) return
      // 别永远 loading——显式 surface 失败让 user 能关掉重来。
      setLoadFailed(true)
    }

    if (plan.kind === 'withHeaders') {
      Image.getSizeWithHeaders(plan.uri, plan.headers, onSuccess, onError)
    } else {
      Image.getSize(plan.uri, onSuccess, onError)
    }

    return () => {
      cancelled = true
    }
  }, [source, visible])

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

  // 真修：mount/show/overlay/failed 决策由 getSize 拿到的 imageSize + onLayout 拿到的
  // containerSize + loadFailed 三态共同决定。详见 ../lib/image-preview-mount-state.ts
  // 的历史教训注释与同名测试。
  const mountState = deriveImagePreviewMountState({
    containerHeight: containerSize.height,
    containerWidth: containerSize.width,
    imageNaturalHeight: imageSize.height,
    imageNaturalWidth: imageSize.width,
    loadFailed,
    visible,
  })

  // 钟馗 biome 收口：useCallback 稳定引用，否则塞进 gesture useMemo deps 会让每渲染都
  // 重建手势实例，重建时手势中态丢失（缩放 / 拖动正进行中突然 reset）。
  const resetZoom = useCallback(() => {
    scale.value = withTiming(1)
    translateX.value = withTiming(0)
    translateY.value = withTiming(0)
  }, [scale, translateX, translateY])

  const snapToBounds = useCallback(() => {
    const nextBase =
      containerSize.width > 0 &&
      containerSize.height > 0 &&
      imageSize.width > 0 &&
      imageSize.height > 0
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
  }, [
    containerSize.height,
    containerSize.width,
    imageSize.height,
    imageSize.width,
    scale,
    translateX,
    translateY,
  ])

  const pinchGesture = useMemo(
    () =>
      Gesture.Pinch()
        .enabled(mountState.shouldEnableGesture)
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
      mountState.shouldEnableGesture,
      pinchStartScale,
      resetZoom,
      scale,
      snapToBounds,
      stageHeight,
      stageWidth,
      translateX,
      translateY,
    ]
  )

  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(mountState.shouldEnableGesture)
        .onBegin(() => {
          panStartX.value = translateX.value
          panStartY.value = translateY.value
        })
        .onUpdate((event) => {
          if (
            scale.value <= 1 ||
            !baseWidth.value ||
            !baseHeight.value ||
            !stageWidth.value ||
            !stageHeight.value
          ) {
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
      mountState.shouldEnableGesture,
      panStartX,
      panStartY,
      resetZoom,
      scale,
      snapToBounds,
      stageHeight,
      stageWidth,
      translateX,
      translateY,
    ]
  )

  const doubleTapGesture = useMemo(
    () =>
      Gesture.Tap()
        .enabled(mountState.shouldEnableGesture)
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
    [mountState.shouldEnableGesture, resetZoom, scale, snapToBounds]
  )

  // 钟馗顺手收：shouldEnableGesture 由每个原子手势 `.enabled()` 消费——loading / Modal
  // 关闭期间 pinch/pan/doubleTap 整体禁用，空 stage 上不会触发。纯函数已测过决策边界
  // (image-preview-mount-state.test.ts)，组件这里消费一致。
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

  // 真修后此处 mount 只在 hasImage 时为真，opacity 作 belt-and-suspenders——
  // shouldMountImage 严格蕴含 shouldShowImage 时 opacity=1；否则不渲染该分支。
  const stageVisibilityStyle = { opacity: mountState.shouldShowImage ? 1 : 0 }

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
          <View onLayout={(event) => setContainerSize(event.nativeEvent.layout)} style={s.frame}>
            {mountState.shouldMountImage ? (
              <GestureDetector gesture={previewGesture}>
                <Animated.View style={[s.stage, stageAnimatedStyle, stageVisibilityStyle]}>
                  <Animated.Image
                    accessibilityLabel={label}
                    onError={() => setLoadFailed(true)}
                    onLoad={(event) => {
                      // 辅助路径：getSize 是主路径，onLoad 仅在尺寸更准时 refine。
                      // 不再作为唯一尺寸来源（治 0×0 Image 不触发加载的 Android 行为）。
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
            ) : null}
            {mountState.shouldShowCaption ? (
              <Text numberOfLines={2} style={s.caption}>
                {label}
              </Text>
            ) : null}
            {mountState.shouldShowLoadingOverlay ? (
              <View pointerEvents="none" style={s.loadingOverlay}>
                <ActivityIndicator color={colors.accent} size="small" />
                <Text style={s.loadingText}>{t('common.loading')}</Text>
              </View>
            ) : null}
            {mountState.shouldShowLoadFailed ? (
              <View pointerEvents="none" style={s.loadingOverlay}>
                <Ionicons color={colors.muted} name="image-outline" size={32} />
                <Text style={s.loadingText}>{t('imagePreview.loadFailed')}</Text>
              </View>
            ) : null}
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
  loadingOverlay: {
    alignItems: 'center',
    bottom: 0,
    gap: spacing.sm,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  loadingText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '700',
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
