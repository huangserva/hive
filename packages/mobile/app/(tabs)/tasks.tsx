import { StyleSheet, Text } from 'react-native'

import { Screen } from '../../src/components/Screen'

export default function TasksTab() {
  return (
    <Screen>
      <Text style={styles.title}>Tasks</Text>
      <Text style={styles.body}>
        Task and PM Cockpit summaries will use runtime WebSocket streams.
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
