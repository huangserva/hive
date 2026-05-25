import { StyleSheet, Text } from 'react-native'

import { Screen } from '../../src/components/Screen'

export default function WorkersTab() {
  return (
    <Screen>
      <Text style={styles.title}>Workers</Text>
      <Text style={styles.body}>
        Read-only worker cards will be wired in M19a after endpoint audit.
      </Text>
    </Screen>
  )
}

const styles = StyleSheet.create({
  body: {
    color: '#8b949e',
    fontSize: 15,
    lineHeight: 22,
  },
  title: {
    color: '#e6edf3',
    fontSize: 26,
    fontWeight: '700',
  },
})
