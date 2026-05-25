import { StyleSheet, Text } from 'react-native'

import { Screen } from '../../src/components/Screen'

export default function DashboardTab() {
  return (
    <Screen>
      <Text style={styles.eyebrow}>HippoTeam Mobile</Text>
      <Text style={styles.title}>Dashboard - connecting...</Text>
      <Text style={styles.body}>
        LAN runtime wiring lands first. Cockpit, workers, and task data will connect after the
        protocol audit settles the read-only endpoints.
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
  eyebrow: {
    color: '#58a6ff',
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  title: {
    color: '#e6edf3',
    fontSize: 26,
    fontWeight: '700',
  },
})
