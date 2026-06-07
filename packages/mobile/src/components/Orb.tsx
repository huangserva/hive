import type { ReactNode } from 'react'
import { useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated'
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg'

// Shared premium glowing orb extracted from talk.tsx (2026-06-05 redesign) so the
// talk page and the WebRTC call page render the exact same svg sphere + motion.
// Pure decoration — never touches any touch / logic layer. The render output is
// byte-identical to talk.tsx's previous inline OrbSphere/TalkOrb.

export type GlowOrbKind =
  | 'error'
  | 'heard'
  | 'idle'
  | 'listening'
  | 'processing'
  | 'responding'
  | 'speaking'

// Convert a #RRGGBB hex to an rgba() string for the animated state rings/halo.
export const hexToRgba = (hex: string, alpha: number) => {
  const value = hex.replace('#', '')
  const r = Number.parseInt(value.slice(0, 2), 16)
  const g = Number.parseInt(value.slice(2, 4), 16)
  const b = Number.parseInt(value.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

// One soft expanding ring. Faithful to the 2026-06-05 redesign `.pulse` /
// `.sonar` keyframes (scale + fade), run on the reanimated UI thread for smooth
// on-device motion. Decoration only.
function PulseRing({
  color,
  delay,
  duration,
  size,
  toScale,
}: {
  color: string
  delay: number
  duration: number
  size: number
  toScale: number
}) {
  const progress = useSharedValue(0)
  useEffect(() => {
    progress.value = withDelay(delay, withRepeat(withTiming(1, { duration }), -1, false))
    return () => cancelAnimation(progress)
  }, [delay, duration, progress])
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: 0.55 * (1 - progress.value),
    transform: [{ scale: 0.92 + progress.value * (toScale - 0.92) }],
  }))
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.orbRing,
        { borderColor: color, borderRadius: size / 2, height: size, width: size },
        animatedStyle,
      ]}
    />
  )
}

// Rotating arc shown while processing (redesign `.spin`).
function SpinArc({ color, size }: { color: string; size: number }) {
  const rotation = useSharedValue(0)
  useEffect(() => {
    rotation.value = withRepeat(
      withTiming(360, { duration: 1000, easing: Easing.linear }),
      -1,
      false
    )
    return () => cancelAnimation(rotation)
  }, [rotation])
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }))
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.orbSpin,
        {
          borderRadius: size / 2,
          borderRightColor: hexToRgba(color, 0.48),
          borderTopColor: hexToRgba(color, 0.95),
          height: size,
          width: size,
        },
        animatedStyle,
      ]}
    />
  )
}

// Pixel-faithful glowing sphere via react-native-svg RadialGradient — a 1:1
// translation of the 2026-06-05 redesign `.orb` CSS:
//   background: radial-gradient(circle at 35% 28%, #fff .9, #fff .28 16%,
//               state .35 42%, state .08 72%);  border: 1px state .38;
//   box-shadow: 0 0 48px state .28;  orb::before: inset 16 ring state .28.
// The outer glow is its own radial fade (state .28 → transparent). Decoration
// only — drawn behind the glyph, never touches the touch / logic layer.
export function OrbSphere({ accent, size }: { accent: string; size: number }) {
  const canvas = Math.round(size * 1.5)
  const c = canvas / 2
  const sphereR = size / 2
  const id = accent.replace('#', '')
  return (
    <Svg
      height={canvas}
      pointerEvents="none"
      style={{ left: (size - canvas) / 2, position: 'absolute', top: (size - canvas) / 2 }}
      width={canvas}
    >
      <Defs>
        <RadialGradient cx="50%" cy="50%" id={`glow-${id}`} r="50%">
          <Stop offset="0" stopColor={accent} stopOpacity={0.28} />
          <Stop offset="0.55" stopColor={accent} stopOpacity={0.12} />
          <Stop offset="1" stopColor={accent} stopOpacity={0} />
        </RadialGradient>
        <RadialGradient cx="35%" cy="28%" id={`sphere-${id}`} r="78%">
          <Stop offset="0" stopColor="#ffffff" stopOpacity={0.9} />
          <Stop offset="0.16" stopColor="#ffffff" stopOpacity={0.28} />
          <Stop offset="0.42" stopColor={accent} stopOpacity={0.35} />
          <Stop offset="0.72" stopColor={accent} stopOpacity={0.08} />
          <Stop offset="1" stopColor={accent} stopOpacity={0.08} />
        </RadialGradient>
      </Defs>
      {/* outer soft halo (box-shadow 0 0 48px state .28) */}
      <Circle cx={c} cy={c} fill={`url(#glow-${id})`} r={sphereR + 24} />
      {/* sphere body: radial white highlight → state colour */}
      <Circle
        cx={c}
        cy={c}
        fill={`url(#sphere-${id})`}
        r={sphereR}
        stroke={accent}
        strokeOpacity={0.38}
        strokeWidth={1}
      />
      {/* static inner concentric ring (orb::before inset 16) */}
      <Circle
        cx={c}
        cy={c}
        fill="none"
        r={sphereR - 16}
        stroke={accent}
        strokeOpacity={0.28}
        strokeWidth={1}
      />
    </Svg>
  )
}

// Animated orb: pixel-faithful SVG glowing sphere (OrbSphere) + per-state soft
// motion (breathing pulse / sonar / spin, all from the redesign spec) + center
// glyph. Decoration only; renders the supplied glyph children at the center and
// never touches the touch / logic layer.
export function GlowOrb({
  accent,
  size,
  kind,
  glyphSize = 76,
  children,
}: {
  accent: string
  size: number
  kind: GlowOrbKind
  glyphSize?: number
  children: ReactNode
}) {
  return (
    <View style={[styles.orb, { height: size, width: size }]}>
      <OrbSphere accent={accent} size={size} />
      {kind === 'listening' ? (
        <>
          <PulseRing
            color={hexToRgba(accent, 0.5)}
            delay={0}
            duration={2100}
            size={size}
            toScale={1.45}
          />
          <PulseRing
            color={hexToRgba(accent, 0.4)}
            delay={700}
            duration={2100}
            size={size}
            toScale={1.45}
          />
          <PulseRing
            color={hexToRgba(accent, 0.3)}
            delay={1400}
            duration={2100}
            size={size}
            toScale={1.45}
          />
        </>
      ) : null}
      {kind === 'heard' ? (
        <>
          <PulseRing
            color={hexToRgba(accent, 0.7)}
            delay={0}
            duration={680}
            size={size}
            toScale={1.48}
          />
          <PulseRing
            color={hexToRgba(accent, 0.48)}
            delay={260}
            duration={680}
            size={size}
            toScale={1.48}
          />
        </>
      ) : null}
      {kind === 'processing' ? (
        <>
          <SpinArc color={accent} size={size + 8} />
          <PulseRing
            color={hexToRgba(accent, 0.58)}
            delay={0}
            duration={520}
            size={size}
            toScale={1.24}
          />
        </>
      ) : null}
      {kind === 'responding' || kind === 'speaking' ? (
        <>
          <PulseRing
            color={hexToRgba(accent, 0.52)}
            delay={0}
            duration={1500}
            size={size}
            toScale={1.86}
          />
          <PulseRing
            color={hexToRgba(accent, 0.36)}
            delay={700}
            duration={1500}
            size={size}
            toScale={1.86}
          />
        </>
      ) : null}
      <View
        pointerEvents="none"
        style={[
          styles.orbGlyph,
          {
            backgroundColor: accent,
            borderRadius: glyphSize / 2,
            height: glyphSize,
            shadowColor: accent,
            width: glyphSize,
          },
        ]}
      >
        {children}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  orb: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  orbGlyph: {
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { height: 15, width: 0 },
    shadowOpacity: 0.36,
    shadowRadius: 20,
    zIndex: 2,
  },
  orbRing: {
    borderWidth: 2,
    position: 'absolute',
  },
  orbSpin: {
    borderColor: 'transparent',
    borderWidth: 4,
    position: 'absolute',
  },
})
