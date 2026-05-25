import { ScrollView, StyleSheet, Text, View } from 'react-native'

import { useMobileRuntime } from '../../src/api/mobile-runtime-context'
import { Screen } from '../../src/components/Screen'
import { StatusBadge } from '../../src/components/StatusBadge'

export default function DashboardTab() {
  const { dashboard, error, state } = useMobileRuntime()

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.eyebrow}>HippoTeam Mobile</Text>
        <Text style={styles.title}>Dashboard</Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {!dashboard ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Dashboard - connecting...</Text>
            <Text style={styles.body}>Open Settings, enter host + token, then connect.</Text>
            <Text style={styles.meta}>State: {state}</Text>
          </View>
        ) : (
          <>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>{dashboard.workspace.name}</Text>
              <Text style={styles.meta}>{dashboard.workspace.path}</Text>
              <Text style={styles.body}>Phase: {dashboard.plan.current_phase ?? 'unknown'}</Text>
              <Text style={styles.body}>
                Active milestone: {dashboard.plan.active_milestone ?? 'none'}
              </Text>
            </View>

            <View style={styles.grid}>
              <SummaryCard label="Open questions" value={dashboard.cockpit.open_questions} />
              <SummaryCard label="High actions" value={dashboard.cockpit.high_ai_actions} />
              <SummaryCard label="Open tasks" value={dashboard.tasks.total_open} />
              <SummaryCard label="Done tasks" value={dashboard.tasks.total_done} />
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Cockpit</Text>
              <Text style={styles.body}>
                Baseline: {dashboard.cockpit.baseline_stale ? 'stale' : 'fresh'}
              </Text>
              <Text style={styles.body}>AI actions: {dashboard.cockpit.ai_actions_count}</Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Workers</Text>
              {dashboard.workers.length === 0 ? <Text style={styles.meta}>No workers</Text> : null}
              {dashboard.workers.map((worker) => (
                <View key={worker.id} style={styles.row}>
                  <View style={styles.rowText}>
                    <Text style={styles.body}>{worker.name}</Text>
                    <Text style={styles.meta}>
                      {worker.role} · {worker.preset ?? 'no preset'}
                    </Text>
                  </View>
                  <StatusBadge status={worker.status} />
                </View>
              ))}
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Runs</Text>
              {dashboard.runs.length === 0 ? <Text style={styles.meta}>No active runs</Text> : null}
              {dashboard.runs.map((run) => (
                <View key={run.id} style={styles.row}>
                  <View style={styles.rowText}>
                    <Text style={styles.body}>{run.agent_name}</Text>
                    <Text style={styles.meta}>{run.started_at ?? 'started time unavailable'}</Text>
                  </View>
                  <StatusBadge status={run.status} />
                </View>
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </Screen>
  )
}

const SummaryCard = ({ label, value }: { label: string; value: number }) => (
  <View style={styles.summaryCard}>
    <Text style={styles.summaryValue}>{value}</Text>
    <Text style={styles.meta}>{label}</Text>
  </View>
)

const styles = StyleSheet.create({
  body: {
    color: '#c9d1d9',
    fontSize: 15,
    lineHeight: 22,
  },
  card: {
    backgroundColor: '#161b22',
    borderColor: '#30363d',
    borderRadius: 14,
    borderWidth: 1,
    gap: 10,
    padding: 16,
  },
  cardTitle: {
    color: '#e6edf3',
    fontSize: 18,
    fontWeight: '700',
  },
  eyebrow: {
    color: '#58a6ff',
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  error: {
    color: '#ff7b72',
    fontSize: 14,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  meta: {
    color: '#8b949e',
    fontSize: 13,
  },
  row: {
    alignItems: 'center',
    borderTopColor: '#30363d',
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    paddingTop: 10,
  },
  rowText: {
    flex: 1,
    gap: 4,
  },
  scroll: {
    gap: 16,
    paddingBottom: 24,
  },
  summaryCard: {
    backgroundColor: '#161b22',
    borderColor: '#30363d',
    borderRadius: 14,
    borderWidth: 1,
    flexBasis: '47%',
    gap: 6,
    padding: 14,
  },
  summaryValue: {
    color: '#e6edf3',
    fontSize: 28,
    fontWeight: '800',
  },
  title: {
    color: '#e6edf3',
    fontSize: 26,
    fontWeight: '700',
  },
})
