import { ScrollView, StyleSheet, Text, View } from 'react-native'

import { useMobileRuntime } from '../../src/api/mobile-runtime-context'
import { Screen } from '../../src/components/Screen'
import { StatusBadge } from '../../src/components/StatusBadge'

export default function WorkersTab() {
  const { dashboard, state } = useMobileRuntime()
  const workers = dashboard?.workers ?? []

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>Workers</Text>
        {!dashboard ? (
          <Text style={styles.body}>Connect in Settings first. State: {state}</Text>
        ) : null}
        {workers.length === 0 && dashboard ? (
          <Text style={styles.body}>No workers found.</Text>
        ) : null}
        {workers.map((worker) => (
          <View key={worker.id} style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.workerTitle}>
                <Text style={styles.name}>{worker.name}</Text>
                <Text style={styles.body}>{worker.role}</Text>
              </View>
              <StatusBadge status={worker.status} />
            </View>
            <Text style={styles.meta}>Preset: {worker.preset ?? 'none'}</Text>
          </View>
        ))}
      </ScrollView>
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
    gap: 12,
    padding: 16,
  },
  cardHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
  },
  meta: {
    color: '#8b949e',
    fontSize: 13,
  },
  name: {
    color: '#e6edf3',
    fontSize: 20,
    fontWeight: '700',
  },
  scroll: {
    gap: 14,
    paddingBottom: 24,
  },
  title: {
    color: '#e6edf3',
    fontSize: 26,
    fontWeight: '700',
  },
  workerTitle: {
    flex: 1,
    gap: 4,
  },
})
