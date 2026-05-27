import type { PropsWithChildren } from 'react'
import { StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { colors, spacing } from '../theme'

export const Screen = ({ children }: PropsWithChildren) => (
  <SafeAreaView style={styles.safeArea}>
    <View style={styles.content}>{children}</View>
  </SafeAreaView>
)

const styles = StyleSheet.create({
  content: {
    flex: 1,
    gap: spacing.md,
    padding: spacing.md,
  },
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
})
