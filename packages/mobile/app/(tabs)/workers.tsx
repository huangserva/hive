import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useCallback, useMemo, useState } from 'react'
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'

import type { MobileDashboardWorker } from '../../src/api/client'
import { useMobileRuntime } from '../../src/api/mobile-runtime-context'
import { Screen } from '../../src/components/Screen'
import { StatusBadge, statusColor } from '../../src/components/StatusBadge'
import { colors, radius, spacing } from '../../src/theme'

export default function StatusTab() {
  const { dashboard, error, refreshDashboard, restartWorker, state, stopWorker } =
    useMobileRuntime()
  const router = useRouter()
  const [expandedWorkerId, setExpandedWorkerId] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const activeWorkers = useMemo(
    () => dashboard?.workers.filter((worker) => worker.status !== 'stopped').length ?? 0,
    [dashboard]
  )

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await refreshDashboard()
    setRefreshing(false)
  }, [refreshDashboard])

  const confirmStop = (worker: MobileDashboardWorker) => {
    Alert.alert('Stop worker', `Stop ${worker.name}?`, [
      { style: 'cancel', text: 'Cancel' },
      {
        onPress: () => {
          void stopWorker(worker.id)
        },
        style: 'destructive',
        text: 'Stop',
      },
    ])
  }

  const confirmRestart = (worker: MobileDashboardWorker) => {
    Alert.alert('Restart worker', `Restart ${worker.name}?`, [
      { style: 'cancel', text: 'Cancel' },
      {
        onPress: () => {
          void restartWorker(worker.id)
        },
        text: 'Restart',
      },
    ])
  }

  if (!dashboard) {
    return (
      <Screen>
        <View style={styles.emptyWrap}>
          <View style={styles.emptyIcon}>
            <Ionicons color={colors.accent} name="pulse-outline" size={34} />
          </View>
          <Text style={styles.emptyTitle}>Status appears after pairing</Text>
          <Text style={styles.emptyBody}>
            Connect in Settings to see orchestrator state, worker health, plan progress, and pending
            questions.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/settings')}
            style={styles.primaryButton}
          >
            <Text style={styles.primaryButtonText}>Open Settings</Text>
          </Pressable>
          <Text style={styles.stateText}>State: {state}</Text>
        </View>
      </Screen>
    )
  }

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />
        }
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>Command status</Text>
            <Text style={styles.title}>{dashboard.workspace.name}</Text>
          </View>
          <View style={styles.connectedPill}>
            <View style={styles.connectedDot} />
            <Text style={styles.connectedText}>Live</Text>
          </View>
        </View>

        <View style={styles.overviewCard}>
          <View style={styles.overviewTop}>
            <View>
              <Text style={styles.cardLabel}>Current phase</Text>
              <Text style={styles.phase}>{dashboard.plan.current_phase ?? 'Unknown'}</Text>
            </View>
            <Text style={styles.generatedAt}>
              {new Date(dashboard.generated_at).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </Text>
          </View>
          <View style={styles.progressTrack}>
            <View
              style={[styles.progressFill, { width: `${Math.min(activeWorkers * 25, 100)}%` }]}
            />
          </View>
          <View style={styles.metricRow}>
            <Metric label="Active" value={activeWorkers} />
            <Metric label="Open Q" value={dashboard.cockpit.open_questions} />
            <Metric label="Tasks" value={dashboard.tasks.total_open} />
          </View>
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Workers</Text>
          <Text style={styles.sectionMeta}>{dashboard.workers.length} total</Text>
        </View>

        {dashboard.workers.length === 0 ? (
          <View style={styles.card}>
            <Text style={styles.body}>No workers in this workspace yet.</Text>
          </View>
        ) : null}

        {dashboard.workers.map((worker) => (
          <WorkerCard
            expanded={expandedWorkerId === worker.id}
            key={worker.id}
            onOpenAgent={() => router.push({ pathname: '/agent/[id]', params: { id: worker.id } })}
            onRestart={() => confirmRestart(worker)}
            onStop={() => confirmStop(worker)}
            onToggle={() =>
              setExpandedWorkerId((current) => (current === worker.id ? null : worker.id))
            }
            worker={worker}
          />
        ))}

        <View style={styles.footerCard}>
          <View style={styles.footerRow}>
            <Ionicons color={colors.accent} name="git-branch-outline" size={18} />
            <View style={styles.footerText}>
              <Text style={styles.footerTitle}>
                {dashboard.plan.active_milestone ?? 'No milestone'}
              </Text>
              <Text style={styles.footerMeta}>Active milestone</Text>
            </View>
          </View>
          <View style={styles.footerRow}>
            <Ionicons
              color={dashboard.cockpit.baseline_stale ? colors.warning : colors.success}
              name="shield-checkmark-outline"
              size={18}
            />
            <View style={styles.footerText}>
              <Text style={styles.footerTitle}>
                Baseline {dashboard.cockpit.baseline_stale ? 'stale' : 'fresh'}
              </Text>
              <Text style={styles.footerMeta}>
                {dashboard.cockpit.high_ai_actions} high-priority action
              </Text>
            </View>
          </View>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>
    </Screen>
  )
}

const Metric = ({ label, value }: { label: string; value: number }) => (
  <View style={styles.metric}>
    <Text style={styles.metricValue}>{value}</Text>
    <Text style={styles.metricLabel}>{label}</Text>
  </View>
)

const WorkerCard = ({
  expanded,
  onOpenAgent,
  onRestart,
  onStop,
  onToggle,
  worker,
}: {
  expanded: boolean
  onOpenAgent: () => void
  onRestart: () => void
  onStop: () => void
  onToggle: () => void
  worker: MobileDashboardWorker
}) => (
  <Pressable accessibilityRole="button" onPress={onToggle} style={styles.card}>
    <View style={styles.workerHeader}>
      <View style={styles.workerLeft}>
        <View style={[styles.workerAvatar, { borderColor: statusColor(worker.status) }]}>
          <Text style={styles.workerAvatarText}>{worker.name.slice(0, 1)}</Text>
        </View>
        <View style={styles.workerText}>
          <Text style={styles.workerName}>{worker.name}</Text>
          <Text style={styles.workerMeta}>
            {worker.role} · {worker.preset ?? 'no preset'}
          </Text>
        </View>
      </View>
      <StatusBadge status={worker.status} />
    </View>
    <Text style={styles.workerTask}>{currentTaskFor(worker)}</Text>
    {expanded ? (
      <View style={styles.expanded}>
        <View style={styles.dispatchPreview}>
          <Text style={styles.dispatchTitle}>Recent dispatch</Text>
          <Text style={styles.dispatchBody}>{dispatchPreviewFor(worker)}</Text>
        </View>
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            onPress={onOpenAgent}
            style={styles.secondaryButton}
          >
            <Text style={styles.secondaryButtonText}>Details</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={onRestart} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>Restart</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={worker.status === 'stopped'}
            onPress={onStop}
            style={[styles.dangerButton, worker.status === 'stopped' ? styles.disabled : null]}
          >
            <Text style={styles.dangerButtonText}>Stop</Text>
          </Pressable>
        </View>
      </View>
    ) : null}
  </Pressable>
)

const currentTaskFor = (worker: MobileDashboardWorker) => {
  if (worker.status === 'working') return 'Working on the latest assigned dispatch.'
  if (worker.status === 'idle') return 'Ready for a quick follow-up.'
  return 'Stopped. Restart when this role is needed.'
}

const dispatchPreviewFor = (worker: MobileDashboardWorker) => {
  if (worker.status === 'working') return 'Running verification and preparing a concise report.'
  if (worker.status === 'idle') return 'No open dispatch detected for this worker.'
  return 'Last run is stopped; transcript remains available in details.'
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  body: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22,
  },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.borderMuted,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  cardLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  connectedDot: {
    backgroundColor: colors.success,
    borderRadius: 999,
    height: 8,
    width: 8,
  },
  connectedPill: {
    alignItems: 'center',
    backgroundColor: colors.successSoft,
    borderColor: 'rgba(63, 185, 80, 0.34)',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 7,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  connectedText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '800',
  },
  dangerButton: {
    alignItems: 'center',
    backgroundColor: colors.error,
    borderRadius: radius.sm,
    flex: 1,
    paddingVertical: 10,
  },
  dangerButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
  },
  disabled: {
    opacity: 0.45,
  },
  dispatchBody: {
    color: colors.textSoft,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 3,
  },
  dispatchPreview: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderRadius: radius.sm,
    padding: spacing.sm,
  },
  dispatchTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '800',
  },
  emptyBody: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22,
    maxWidth: 330,
    textAlign: 'center',
  },
  emptyIcon: {
    alignItems: 'center',
    backgroundColor: colors.accentSoft,
    borderColor: 'rgba(88, 166, 255, 0.24)',
    borderRadius: 28,
    borderWidth: 1,
    height: 82,
    justifyContent: 'center',
    width: 82,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '800',
    textAlign: 'center',
  },
  emptyWrap: {
    alignItems: 'center',
    flex: 1,
    gap: spacing.md,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  error: {
    color: colors.error,
    fontSize: 14,
  },
  expanded: {
    borderTopColor: colors.borderMuted,
    borderTopWidth: 1,
    gap: spacing.sm,
    paddingTop: spacing.sm,
  },
  eyebrow: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  footerCard: {
    backgroundColor: colors.cardElevated,
    borderColor: colors.borderMuted,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  footerMeta: {
    color: colors.muted,
    fontSize: 12,
  },
  footerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  footerText: {
    flex: 1,
    gap: 2,
  },
  footerTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '800',
  },
  generatedAt: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  metric: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderRadius: radius.sm,
    flex: 1,
    padding: spacing.sm,
  },
  metricLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  metricRow: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  metricValue: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '900',
  },
  overviewCard: {
    backgroundColor: colors.cardElevated,
    borderColor: colors.borderMuted,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.md,
  },
  overviewTop: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  phase: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '900',
  },
  primaryButton: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingHorizontal: 20,
    paddingVertical: 13,
  },
  primaryButtonText: {
    color: colors.background,
    fontSize: 15,
    fontWeight: '900',
  },
  progressFill: {
    backgroundColor: colors.accent,
    borderRadius: 999,
    height: '100%',
  },
  progressTrack: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 999,
    height: 8,
    overflow: 'hidden',
  },
  scroll: {
    gap: spacing.sm,
    paddingBottom: spacing.lg,
  },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flex: 1,
    paddingVertical: 10,
  },
  secondaryButtonText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '800',
  },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  sectionMeta: {
    color: colors.muted,
    fontSize: 13,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
  },
  stateText: {
    color: colors.muted2,
    fontSize: 13,
  },
  title: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '900',
  },
  workerAvatar: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: radius.sm,
    borderWidth: 1,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  workerAvatarText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '900',
  },
  workerHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  workerLeft: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: spacing.sm,
  },
  workerMeta: {
    color: colors.muted,
    fontSize: 12,
  },
  workerName: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
  },
  workerTask: {
    color: colors.textSoft,
    fontSize: 14,
    lineHeight: 20,
  },
  workerText: {
    flex: 1,
    gap: 3,
  },
})
