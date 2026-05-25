import { StyleSheet, Text, View } from 'react-native'

import { useMobileRuntime } from '../../src/api/mobile-runtime-context'
import { Screen } from '../../src/components/Screen'

export default function TasksTab() {
  const { dashboard, state } = useMobileRuntime()

  return (
    <Screen>
      <Text style={styles.title}>Tasks</Text>
      {!dashboard ? (
        <Text style={styles.body}>Connect in Settings first. State: {state}</Text>
      ) : null}
      {dashboard ? (
        <View style={styles.grid}>
          <View style={styles.card}>
            <Text style={styles.count}>{dashboard.tasks.total_open}</Text>
            <Text style={styles.body}>Open</Text>
          </View>
          <View style={styles.card}>
            <Text style={styles.count}>{dashboard.tasks.total_done}</Text>
            <Text style={styles.body}>Done</Text>
          </View>
        </View>
      ) : null}
    </Screen>
  )
}

const styles = StyleSheet.create({
  body: {
    color: '#8b949e',
    fontSize: 15,
    lineHeight: 22,
  },
  card: {
    backgroundColor: '#161b22',
    borderColor: '#30363d',
    borderRadius: 14,
    borderWidth: 1,
    flex: 1,
    gap: 8,
    padding: 18,
  },
  count: {
    color: '#e6edf3',
    fontSize: 42,
    fontWeight: '800',
  },
  grid: {
    flexDirection: 'row',
    gap: 14,
  },
  title: {
    color: '#e6edf3',
    fontSize: 26,
    fontWeight: '700',
  },
})
