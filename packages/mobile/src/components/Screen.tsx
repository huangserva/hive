import type { PropsWithChildren } from 'react'
import { StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { colors, spacing } from '../theme'
import { ConnectionModeBanner } from './ConnectionModeBanner'

export const Screen = ({ children }: PropsWithChildren) => (
  <SafeAreaView style={styles.safeArea}>
    <View style={styles.content}>
      <ConnectionModeBanner />
      <View style={styles.body}>{children}</View>
    </View>
  </SafeAreaView>
)

const styles = StyleSheet.create({
  body: {
    flex: 1,
    gap: spacing.sm,
  },
  content: {
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
    paddingBottom: 0,
  },
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
})
