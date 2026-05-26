import { useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'

import type { MobileWorkerTranscript, MobileWorkspaceTasks } from '../../src/api/client'
import { useMobileRuntime } from '../../src/api/mobile-runtime-context'
import { Screen } from '../../src/components/Screen'
import { StatusBadge } from '../../src/components/StatusBadge'

export default function AgentDetailScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>()
  const router = useRouter()
  const { dashboard, error, getWorkerTranscript, getWorkspaceTasks, selectedWorkspaceId, state } =
    useMobileRuntime()
  const workerId = typeof id === 'string' ? id : ''
  const worker = useMemo(
    () => dashboard?.workers.find((item) => item.id === workerId) ?? null,
    [dashboard, workerId]
  )
  const [transcript, setTranscript] = useState<MobileWorkerTranscript | null>(null)
  const [tasks, setTasks] = useState<MobileWorkspaceTasks | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    if (!workerId || !selectedWorkspaceId) return
    setRefreshing(true)
    try {
      const [nextTranscript, nextTasks] = await Promise.all([
        getWorkerTranscript(workerId),
        getWorkspaceTasks(),
      ])
      setTranscript(nextTranscript)
      setTasks(nextTasks)
    } finally {
      setRefreshing(false)
    }
  }, [getWorkerTranscript, getWorkspaceTasks, selectedWorkspaceId, workerId])

  useEffect(() => {
    void load()
  }, [load])

  const relevantDispatches =
    tasks?.dispatches.filter((dispatch) => !worker || dispatch.worker_name === worker.name) ?? []

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl onRefresh={load} refreshing={refreshing} />}
      >
        <View style={styles.header}>
          <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.back}>
            <Text style={styles.backText}>Back</Text>
          </Pressable>
          <View style={styles.headerText}>
            <Text style={styles.title}>{worker?.name ?? transcript?.worker_name ?? 'Agent'}</Text>
            <Text style={styles.meta}>Workspace: {selectedWorkspaceId ?? 'not selected'}</Text>
          </View>
          {worker ? <StatusBadge status={worker.status} /> : null}
        </View>

        {worker ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Worker</Text>
            <Text style={styles.body}>Role: {worker.role}</Text>
            <Text style={styles.body}>Preset: {worker.preset ?? 'none'}</Text>
          </View>
        ) : (
          <Text style={styles.body}>Connect in Settings first. State: {state}</Text>
        )}

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Terminal transcript</Text>
          {transcript?.truncated ? (
            <Text style={styles.meta}>Showing the latest 100 lines.</Text>
          ) : null}
          <ScrollView horizontal style={styles.terminalWrap}>
            <Text style={styles.terminalText}>
              {transcript?.lines.length ? transcript.lines.join('\n') : 'No terminal output yet.'}
            </Text>
          </ScrollView>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Recent dispatches</Text>
          {relevantDispatches.length === 0 ? (
            <Text style={styles.body}>No dispatches for this worker.</Text>
          ) : null}
          {relevantDispatches.map((dispatch) => (
            <View key={dispatch.id} style={styles.dispatchRow}>
              <View style={styles.dispatchHeader}>
                <Text style={styles.dispatchStatus}>{dispatch.status}</Text>
                <Text style={styles.meta}>{new Date(dispatch.created_at).toLocaleString()}</Text>
              </View>
              <Text style={styles.body}>{dispatch.task_summary}</Text>
            </View>
          ))}
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  back: {
    backgroundColor: '#30363d',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  backText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
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
    gap: 10,
    padding: 16,
  },
  dispatchHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
  },
  dispatchRow: {
    borderColor: '#30363d',
    borderRadius: 10,
    borderWidth: 1,
    gap: 6,
    padding: 12,
  },
  dispatchStatus: {
    color: '#e6edf3',
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  error: {
    color: '#ff7b72',
    fontSize: 14,
  },
  header: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 12,
  },
  headerText: {
    flex: 1,
    gap: 5,
  },
  meta: {
    color: '#8b949e',
    fontSize: 13,
  },
  scroll: {
    gap: 14,
    paddingBottom: 24,
  },
  sectionTitle: {
    color: '#e6edf3',
    fontSize: 18,
    fontWeight: '700',
  },
  terminalText: {
    color: '#c9d1d9',
    fontFamily: 'Courier',
    fontSize: 12,
    lineHeight: 18,
  },
  terminalWrap: {
    backgroundColor: '#0d1117',
    borderColor: '#30363d',
    borderRadius: 10,
    borderWidth: 1,
    maxHeight: 320,
    padding: 12,
  },
  title: {
    color: '#e6edf3',
    fontSize: 24,
    fontWeight: '700',
  },
})
