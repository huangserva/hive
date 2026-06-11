import { Ionicons } from '@expo/vector-icons'
import { useVideoPlayer, type VideoSource, VideoView } from 'expo-video'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
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
  resolvePreviewDoubleTapTarget,
} from '../lib/image-preview-gesture'
import { colors, spacing } from '../theme'
import type { PreviewImageSource } from './ImagePreviewModal'

export interface VideoPreviewModalProps {
  label: string
  onClose: () => void
  source: PreviewImageSource
  visible: boolean
}

const DOUBLE_TAP_ZOOM_SCALE = 2.5

const toVideoSource = (source: PreviewImageSource): VideoSource =>
  source.headers ? { headers: source.headers, uri: source.uri } : source.uri

export function VideoPreviewModal({ label, onClose, source, visible }: VideoPreviewModalProps) {
  const t = useT()
  const [containerSize, setContainerSize] = useState({ height: 0, width: 0 })
  const player = useVideoPlayer(toVideoSource(source), (nextPlayer) => {
    nextPlayer.loop = false
  })

  const scale = useSharedValue(1)
  const translateX = useSharedValue(0)
  const translateY = useSharedValue(0)
  const pinchStartScale = useSharedValue(1)
  const panStartX = useSharedValue(0)
  const panStartY = useSharedValue(0)
  const stageWidth = useSharedValue(0)
  const stageHeight = useSharedValue(0)

  useEffect(() => {
    if (!visible) {
      player.pause()
      return
    }
    scale.value = 1
    translateX.value = 0
    translateY.value = 0
    player.play()
  }, [player, scale, translateX, translateY, visible])

  useEffect(() => {
    stageWidth.value = containerSize.width
    stageHeight.value = containerSize.height
  }, [containerSize.height, containerSize.width, stageHeight, stageWidth])

  const resetZoom = useCallback(() => {
    scale.value = withTiming(1)
    translateX.value = withTiming(0)
    translateY.value = withTiming(0)
  }, [scale, translateX, translateY])

  const snapToBounds = useCallback(() => {
    const clamped = clampPreviewTranslation(
      { x: translateX.value, y: translateY.value },
      {
        containerHeight: containerSize.height,
        containerWidth: containerSize.width,
        contentHeight: containerSize.height,
        contentWidth: containerSize.width,
        scale: scale.value,
      }
    )
    translateX.value = withSpring(clamped.x)
    translateY.value = withSpring(clamped.y)
  }, [containerSize.height, containerSize.width, scale, translateX, translateY])

  const pinchGesture = useMemo(
    () =>
      Gesture.Pinch()
        .onBegin(() => {
          pinchStartScale.value = scale.value
        })
        .onUpdate((event) => {
          const nextScale = clampPreviewScale(pinchStartScale.value * event.scale)
          scale.value = nextScale
          if (!stageWidth.value || !stageHeight.value) return
          const overflowX = Math.max(0, (stageWidth.value * nextScale - stageWidth.value) / 2)
          const overflowY = Math.max(0, (stageHeight.value * nextScale - stageHeight.value) / 2)
          translateX.value = Math.min(overflowX, Math.max(-overflowX, translateX.value))
          translateY.value = Math.min(overflowY, Math.max(-overflowY, translateY.value))
        })
        .onEnd(() => {
          if (scale.value <= 1) {
            resetZoom()
            return
          }
          snapToBounds()
        }),
    [
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
        .onBegin(() => {
          panStartX.value = translateX.value
          panStartY.value = translateY.value
        })
        .onUpdate((event) => {
          if (scale.value <= 1 || !stageWidth.value || !stageHeight.value) return
          const overflowX = Math.max(0, (stageWidth.value * scale.value - stageWidth.value) / 2)
          const overflowY = Math.max(0, (stageHeight.value * scale.value - stageHeight.value) / 2)
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
    [resetZoom, scale, snapToBounds]
  )

  const previewGesture = useMemo(
    () => Gesture.Simultaneous(pinchGesture, panGesture, doubleTapGesture),
    [doubleTapGesture, panGesture, pinchGesture]
  )

  const stageAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }, { translateY: translateY.value }],
  }))

  const videoAnimatedStyle = useAnimatedStyle(() => ({
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
          <View onLayout={(event) => setContainerSize(event.nativeEvent.layout)} style={s.frame}>
            <GestureDetector gesture={previewGesture}>
              <Animated.View style={[s.stage, stageAnimatedStyle]}>
                <Animated.View style={[s.videoWrap, videoAnimatedStyle]}>
                  <VideoView
                    allowsFullscreen
                    contentFit="contain"
                    nativeControls
                    player={player}
                    style={s.video}
                    surfaceType="textureView"
                  />
                </Animated.View>
              </Animated.View>
            </GestureDetector>
            <Text numberOfLines={2} style={s.caption}>
              {label}
            </Text>
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
  shell: {
    height: '100%',
    width: '100%',
  },
  stage: {
    alignItems: 'center',
    height: '100%',
    justifyContent: 'center',
    width: '100%',
  },
  video: {
    height: '100%',
    width: '100%',
  },
  videoWrap: {
    height: '100%',
    width: '100%',
  },
})
