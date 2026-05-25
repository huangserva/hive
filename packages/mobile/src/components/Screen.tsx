import type { PropsWithChildren } from 'react'
import { StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

export const Screen = ({ children }: PropsWithChildren) => (
  <SafeAreaView style={styles.safeArea}>
    <View style={styles.content}>{children}</View>
  </SafeAreaView>
)

const styles = StyleSheet.create({
  content: {
    flex: 1,
    gap: 16,
    padding: 20,
  },
  safeArea: {
    backgroundColor: '#0d1117',
    flex: 1,
  },
})
