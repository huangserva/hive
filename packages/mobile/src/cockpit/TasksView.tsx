import { Ionicons } from '@expo/vector-icons'
import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

import type { MobileDashboard, MobileWorkspaceTask } from '../api/client'
import { useMobileRuntime } from '../api/mobile-runtime-context'
import { colors, radius, spacing } from '../theme'

const AVATAR_COLORS = ['#58a6ff', '#3fb950', '#d29922', '#f85149', '#bc8cff']
const avatarColor = (name: string) => {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length] ?? AVATAR_COLORS[0]
}

const statusColor = (status: string) => {
  if (status === 'done') return colors.success
  if (status === 'cancelled') return colors.muted
  return colors.accent
}

const newestFirst = (a: MobileWorkspaceTask, b: MobileWorkspaceTask) =>
  new Date(b.created_at).getTime() - new Date(a.created_at).getTime()

export function TasksView({ dashboard }: { dashboard: MobileDashboard }) {
  const { getWorkspaceTasks } = useMobileRuntime()
  const [dispatches, setDispatches] = useState<MobileWorkspaceTask[]>([])
  const [loading, setLoading] = useState(true)
  const [showDone, setShowDone] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const data = await getWorkspaceTasks()
    setDispatches([...(data?.dispatches ?? [])].sort(newestFirst))
    setLoading(false)
  }, [getWorkspaceTasks])

  useEffect(() => {
    void load()
  }, [load])

  const inProgress = dispatches.filter((d) => d.status === 'pending')
  const done = dispatches.filter((d) => d.status === 'done')
  const cancelled = dispatches.filter((d) => d.status === 'cancelled')
  const totalTasks = dashboard.tasks.total_open + dashboard.tasks.total_done
  const pct = totalTasks > 0 ? Math.round((dashboard.tasks.total_done / totalTasks) * 100) : 0

  if (loading) {
    return (
      <View style={s.loadingWrap}>
        <ActivityIndicator color={colors.accent} />
      </View>
    )
  }

  return (
    <ScrollView contentContainerStyle={s.container} showsVerticalScrollIndicator={false}>
      <View style={s.sprintCard}>
        <Text style={s.sprintLabel}>Sprint Narrative</Text>
        <View style={s.progressRow}>
          <View style={s.progressTrack}>
            <View style={[s.progressFill, { width: `${pct}%` }]} />
          </View>
          <Text style={s.pctText}>{pct}%</Text>
        </View>
      </View>

      <View style={s.timelineHeader}>
        <Text style={s.timelineTitle}>Dispatch Timeline</Text>
        <View style={s.filterBtn}>
          <Ionicons color={colors.muted} name="filter-outline" size={14} />
          <Text style={s.filterText}>Filter</Text>
        </View>
      </View>

      {inProgress.length > 0 && (
        <>
          <Text style={s.groupLabel}>In Progress</Text>
          {inProgress.map((d) => (
            <DispatchItem key={d.id} dispatch={d} />
          ))}
        </>
      )}

      {inProgress.length === 0 && (
        <View style={s.emptyOpenCard}>
          <Text style={s.emptyOpenText}>No open dispatches</Text>
        </View>
      )}

      <Pressable onPress={() => setShowDone(!showDone)} style={s.toggleRow}>
        <Text style={s.toggleText}>
          {showDone ? 'Hide' : 'Show'} {done.length} Done
        </Text>
        <Ionicons color={colors.muted} name={showDone ? 'chevron-up' : 'chevron-down'} size={14} />
      </Pressable>

      {showDone && done.map((d) => <DispatchItem key={d.id} dispatch={d} />)}

      {cancelled.length > 0 && (
        <>
          <Text style={s.groupLabelMuted}>Cancelled</Text>
          {cancelled.map((d) => (
            <DispatchItem key={d.id} dispatch={d} />
          ))}
        </>
      )}
    </ScrollView>
  )
}

const DispatchItem = ({ dispatch }: { dispatch: MobileWorkspaceTask }) => {
  const dotColor = statusColor(dispatch.status)
  return (
    <View style={s.dispatchCard}>
      <View style={s.dispatchHeader}>
        <View style={s.dispatchLeft}>
          <View style={[s.avatar, { borderColor: dotColor }]}>
            <Text style={[s.avatarText, { color: avatarColor(dispatch.worker_name) }]}>
              {dispatch.worker_name.slice(0, 1)}
            </Text>
          </View>
          <View style={s.dispatchInfo}>
            <Text style={s.dispatchTitle}>{dispatch.task_summary}</Text>
            <Text style={s.dispatchMeta}>
              {dispatch.worker_name} · {new Date(dispatch.created_at).toLocaleDateString()}
            </Text>
          </View>
        </View>
        <View style={[s.statusDot, { backgroundColor: dotColor }]} />
      </View>
    </View>
  )
}

const s = StyleSheet.create({
  avatar: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 999,
    borderWidth: 2,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  avatarText: { fontSize: 12, fontWeight: '900' },
  container: { gap: spacing.sm, paddingBottom: 40 },
  dispatchCard: {
    backgroundColor: colors.card,
    borderColor: colors.borderMuted,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: 6,
    padding: spacing.sm,
  },
  dispatchHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  dispatchInfo: { flex: 1, gap: 2 },
  dispatchLeft: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: spacing.sm },
  dispatchMeta: { color: colors.muted, fontSize: 11 },
  dispatchTitle: { color: colors.text, fontSize: 14, fontWeight: '700' },
  emptyOpenCard: {
    backgroundColor: colors.card,
    borderColor: colors.borderMuted,
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.md,
  },
  emptyOpenText: { color: colors.muted, fontSize: 13 },
  filterBtn: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderColor: colors.borderMuted,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  filterText: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  groupLabel: { color: colors.accent, fontSize: 12, fontWeight: '800', textTransform: 'uppercase' },
  groupLabelMuted: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  loadingWrap: { alignItems: 'center', flex: 1, justifyContent: 'center', paddingTop: 60 },
  pctText: { color: colors.text, fontSize: 13, fontWeight: '800', width: 36 },
  progressFill: { backgroundColor: colors.accent, borderRadius: 999, height: '100%' },
  progressRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs },
  progressTrack: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 999,
    flex: 1,
    height: 6,
    overflow: 'hidden',
  },
  sprintCard: {
    backgroundColor: colors.cardElevated,
    borderColor: colors.borderMuted,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.xs,
    padding: spacing.md,
  },
  sprintLabel: { color: colors.muted, fontSize: 11, fontWeight: '800', textTransform: 'uppercase' },
  statusDot: { borderRadius: 999, height: 8, width: 8 },
  timelineHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  timelineTitle: { color: colors.text, fontSize: 16, fontWeight: '800' },
  toggleRow: { alignItems: 'center', flexDirection: 'row', gap: 4 },
  toggleText: { color: colors.muted, fontSize: 13, fontWeight: '700' },
})
