import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useCallback, useMemo, useState } from 'react'
import {
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'

import type { MobileDashboardWorker } from '../../src/api/client'
import { useMobileRuntime } from '../../src/api/mobile-runtime-context'
import { OfflineScreen } from '../../src/components/OfflineScreen'
import { Screen } from '../../src/components/Screen'
import { StatusBadge, statusColor } from '../../src/components/StatusBadge'
import { colors, radius, spacing } from '../../src/theme'

const AVATAR_COLORS = ['#58a6ff', '#3fb950', '#d29922', '#f85149', '#bc8cff', '#39d2c0']

const avatarColor = (name: string) => {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length] ?? AVATAR_COLORS[0]
}

const CLI_LABELS: Record<string, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  gemini: 'Gemini',
  opencode: 'OpenCode',
}

const cliLabel = (preset: string | null) => (preset ? (CLI_LABELS[preset] ?? preset) : '—')

const WORKER_ROLES: Record<string, string> = {
  coder: 'Software Engineer',
  designer: 'UI Designer',
  reviewer: 'Code Reviewer',
  sentinel: 'Sentinel Watcher',
  tester: 'QA Engineer',
}

const roleLabel = (role: string) => WORKER_ROLES[role] ?? role

export default function StatusTab() {
  const {
    connect,
    connectionMode,
    dashboard,
    dispatchTask,
    error,
    host,
    refreshDashboard,
    restartWorker,
    selectedWorkspaceId,
    stopWorker,
    token,
  } = useMobileRuntime()
  const router = useRouter()
  const [overviewExpanded, setOverviewExpanded] = useState(false)
  const [phaseExpanded, setPhaseExpanded] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [dispatchWorker, setDispatchWorker] = useState<MobileDashboardWorker | null>(null)
  const [dispatchText, setDispatchText] = useState('')
  const [dispatching, setDispatching] = useState(false)
  const activeWorkers = useMemo(
    () => dashboard?.workers.filter((w) => w.status !== 'stopped').length ?? 0,
    [dashboard]
  )
  const totalTasks = useMemo(
    () => (dashboard ? dashboard.tasks.total_open + dashboard.tasks.total_done : 0),
    [dashboard]
  )
  const progressPct = useMemo(
    () =>
      totalTasks > 0 ? Math.round(((dashboard?.tasks.total_done ?? 0) / totalTasks) * 100) : 0,
    [dashboard, totalTasks]
  )

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await refreshDashboard()
    setRefreshing(false)
  }, [refreshDashboard])

  const confirmStop = (worker: MobileDashboardWorker) => {
    Alert.alert('Stop worker', `Stop ${worker.name}?`, [
      { style: 'cancel', text: 'Cancel' },
      { onPress: () => void stopWorker(worker.id), style: 'destructive', text: 'Stop' },
    ])
  }

  const confirmRestart = (worker: MobileDashboardWorker) => {
    Alert.alert('Restart worker', `Restart ${worker.name}?`, [
      { style: 'cancel', text: 'Cancel' },
      { onPress: () => void restartWorker(worker.id), text: 'Restart' },
    ])
  }

  const openDispatch = (worker: MobileDashboardWorker) => {
    setDispatchWorker(worker)
    setDispatchText('')
  }

  const closeDispatch = () => {
    if (dispatching) return
    setDispatchWorker(null)
    setDispatchText('')
  }

  const submitDispatch = async () => {
    const task = dispatchText.trim()
    if (!dispatchWorker || !task) return
    setDispatching(true)
    const result = await dispatchTask(dispatchWorker.id, task)
    setDispatching(false)
    if (result) {
      Alert.alert('Dispatch sent', `Task sent to ${dispatchWorker.name}.`)
      closeDispatch()
      return
    }
    Alert.alert('Dispatch failed', error ?? 'Unable to send this task.')
  }

  if (!dashboard) {
    return (
      <Screen>
        <OfflineScreen
          connectionMode={connectionMode}
          error={error}
          host={host}
          onOpenSettings={() => router.push('/settings')}
          onRetry={() => void connect(host, token)}
        />
      </Screen>
    )
  }

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl onRefresh={onRefresh} refreshing={refreshing} tintColor={colors.accent} />
        }
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Text style={styles.title}>Status</Text>
          <View style={styles.onlinePill}>
            <View style={styles.onlineDot} />
            <Text style={styles.onlineText}>Orchestrator Online</Text>
          </View>
        </View>
        <Text style={styles.pullHint}>Pull down to refresh</Text>

        <View style={styles.overviewCard}>
          <Pressable
            accessibilityRole="button"
            onPress={() => setOverviewExpanded((value) => !value)}
            style={styles.overviewHeader}
          >
            <View style={styles.overviewHeaderLeft}>
              <Ionicons color={colors.accent} name="grid-outline" size={16} />
              <Text style={styles.cardLabel}>Workspace Overview</Text>
            </View>
            <Ionicons
              color={colors.muted}
              name={overviewExpanded ? 'chevron-up' : 'chevron-down'}
              size={18}
            />
          </Pressable>

          {overviewExpanded ? (
            <>
              <View style={styles.twoCol}>
                <View style={styles.colItem}>
                  <Text style={styles.colLabel}>Current Phase</Text>
                  <Text
                    ellipsizeMode="tail"
                    numberOfLines={phaseExpanded ? undefined : 2}
                    style={styles.colValue}
                  >
                    {dashboard.plan.current_phase ?? 'Unknown'}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    hitSlop={8}
                    onPress={() => setPhaseExpanded((value) => !value)}
                    style={styles.inlineToggle}
                  >
                    <Text style={styles.inlineToggleText}>
                      {phaseExpanded ? 'Show less' : 'Show more'}
                    </Text>
                  </Pressable>
                </View>
                <View style={styles.colDivider} />
                <View style={styles.colItem}>
                  <Text style={styles.colLabel}>Active Milestone</Text>
                  <Text ellipsizeMode="tail" numberOfLines={2} style={styles.colValue}>
                    {dashboard.plan.active_milestone ?? 'No active milestone'}
                  </Text>
                </View>
              </View>

              <View style={styles.progressSection}>
                <Text style={styles.progressTitle}>Plan Progress</Text>
                <View style={styles.progressWrap}>
                  <View style={styles.progressTrack}>
                    <View style={[styles.progressFill, { width: `${progressPct}%` }]} />
                  </View>
                  <Text style={styles.progressPct}>{progressPct}%</Text>
                </View>
                <Text style={styles.progressMeta}>
                  {dashboard.tasks.total_done} of {totalTasks} tasks completed
                </Text>
              </View>

              <View style={styles.statGrid}>
                <StatItem icon="people-outline" label="Active Workers" value={activeWorkers} />
                <StatItem
                  icon="help-circle-outline"
                  label="Open Questions"
                  value={dashboard.cockpit.open_questions}
                />
                <StatItem
                  icon="flash-outline"
                  label="Tasks In Progress"
                  value={dashboard.tasks.total_open}
                />
              </View>
            </>
          ) : (
            <Text ellipsizeMode="tail" numberOfLines={1} style={styles.overviewSummary}>
              {dashboard.plan.active_milestone ??
                dashboard.plan.current_phase ??
                'No active milestone'}
            </Text>
          )}
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Workers</Text>
          <Pressable accessibilityRole="button" hitSlop={8} onPress={() => router.push('/workers')}>
            <View style={styles.sectionLink}>
              <Text style={styles.sectionLinkText}>{activeWorkers} active</Text>
              <Ionicons color={colors.muted} name="chevron-forward" size={16} />
            </View>
          </Pressable>
        </View>

        {/* Orchestrator 终端入口 */}
        {selectedWorkspaceId ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push(`/agent/${selectedWorkspaceId}:orchestrator`)}
            style={styles.orchCard}
          >
            <View style={styles.orchLeft}>
              <View style={styles.orchAvatar}>
                <Ionicons color={colors.accent} name="terminal-outline" size={18} />
              </View>
              <View style={styles.orchInfo}>
                <Text style={styles.orchName}>Orchestrator</Text>
                <Text style={styles.orchHint}>View orchestrator terminal</Text>
              </View>
            </View>
            <Ionicons color={colors.muted} name="chevron-forward" size={18} />
          </Pressable>
        ) : null}

        {dashboard.workers.map((worker) => (
          <WorkerCard
            key={worker.id}
            onDispatch={() => openDispatch(worker)}
            onOpenDetail={() => router.push(`/agent/${worker.id}`)}
            onRestart={() => confirmRestart(worker)}
            onStop={() => confirmStop(worker)}
            worker={worker}
          />
        ))}

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>
      <DispatchModal
        dispatching={dispatching}
        onChangeText={setDispatchText}
        onClose={closeDispatch}
        onSubmit={submitDispatch}
        task={dispatchText}
        worker={dispatchWorker}
      />
    </Screen>
  )
}

const StatItem = ({
  icon,
  label,
  value,
}: {
  icon: keyof typeof Ionicons.glyphMap
  label: string
  value: number
}) => (
  <View style={styles.statItem}>
    <Ionicons color={colors.accent} name={icon} size={16} />
    <Text style={styles.statValue}>{value}</Text>
    <Text style={styles.statLabel}>{label}</Text>
  </View>
)

const WorkerCard = ({
  onDispatch,
  onOpenDetail,
  onRestart,
  onStop,
  worker,
}: {
  onDispatch: () => void
  onOpenDetail: () => void
  onRestart: () => void
  onStop: () => void
  worker: MobileDashboardWorker
}) => {
  const bgColor = avatarColor(worker.name)
  const accent = statusColor(worker.status)

  return (
    <Pressable accessibilityRole="button" onPress={onOpenDetail} style={styles.card}>
      <View style={styles.workerHeader}>
        <View style={styles.workerLeft}>
          <View style={[styles.workerAvatar, { backgroundColor: bgColor }]}>
            <Text style={styles.workerAvatarText}>{worker.name.slice(0, 1)}</Text>
            <View style={[styles.workerStatusDot, { backgroundColor: accent }]} />
          </View>
          <View style={styles.workerInfo}>
            <Text style={styles.workerName}>{worker.name}</Text>
            <Text style={styles.workerTask}>
              {roleLabel(worker.role)} · CLI: {cliLabel(worker.preset)}
            </Text>
          </View>
        </View>
        <View style={styles.workerRight}>
          <StatusBadge status={worker.status} />
          <Ionicons color={colors.muted} name="chevron-forward" size={18} />
        </View>
      </View>

      <View style={styles.workerMetaGrid}>
        <MetaChip label="Role" value={worker.role} />
        <MetaChip label="Status" value={statusTextFor(worker)} />
      </View>
      <WorkerActions
        onDispatch={onDispatch}
        onRestart={onRestart}
        onStop={onStop}
        status={worker.status}
      />
    </Pressable>
  )
}

const MetaChip = ({ label, value }: { label: string; value: string }) => (
  <View style={styles.metaChip}>
    <Text style={styles.metaLabel}>{label}</Text>
    <Text numberOfLines={1} style={styles.metaValue}>
      {value}
    </Text>
  </View>
)

const WorkerActions = ({
  onDispatch,
  onRestart,
  onStop,
  status,
}: {
  onDispatch: () => void
  onRestart: () => void
  onStop: () => void
  status: MobileDashboardWorker['status']
}) => {
  const isWorking = status === 'working'
  const isStopped = status === 'stopped'
  return (
    <View style={styles.quickActions}>
      {!isWorking && !isStopped ? (
        <ActionButton icon="send-outline" label="Dispatch" onPress={onDispatch} tone="success" />
      ) : null}
      <ActionButton icon="refresh-outline" label="Restart" onPress={onRestart} tone="accent" />
      {!isStopped ? (
        <ActionButton icon="stop-circle-outline" label="Stop" onPress={onStop} tone="danger" />
      ) : null}
    </View>
  )
}

const ActionButton = ({
  icon,
  label,
  onPress,
  tone,
}: {
  icon: keyof typeof Ionicons.glyphMap
  label: string
  onPress: () => void
  tone: 'accent' | 'danger' | 'success'
}) => {
  const toneColor =
    tone === 'danger' ? colors.error : tone === 'success' ? colors.success : colors.accent
  const toneBackground =
    tone === 'danger'
      ? colors.errorSoft
      : tone === 'success'
        ? colors.successSoft
        : colors.accentSoft
  return (
    <Pressable
      accessibilityRole="button"
      onPress={(event) => {
        event.stopPropagation()
        onPress()
      }}
      style={[styles.actionBtn, { backgroundColor: toneBackground }]}
    >
      <Ionicons color={toneColor} name={icon} size={14} />
      <Text style={[styles.actionBtnText, { color: toneColor }]}>{label}</Text>
    </Pressable>
  )
}

const DispatchModal = ({
  dispatching,
  onChangeText,
  onClose,
  onSubmit,
  task,
  worker,
}: {
  dispatching: boolean
  onChangeText: (value: string) => void
  onClose: () => void
  onSubmit: () => void
  task: string
  worker: MobileDashboardWorker | null
}) => (
  <Modal animationType="fade" transparent visible={worker !== null}>
    <View style={styles.modalBackdrop}>
      <View style={styles.dispatchModal}>
        <Text style={styles.modalTitle}>Dispatch to {worker?.name ?? 'worker'}</Text>
        <Text style={styles.modalHint}>Send a task directly to this worker.</Text>
        <TextInput
          autoFocus
          multiline
          onChangeText={onChangeText}
          placeholder="Describe the task..."
          placeholderTextColor={colors.muted2}
          style={styles.dispatchInput}
          value={task}
        />
        <View style={styles.modalActions}>
          <Pressable accessibilityRole="button" onPress={onClose} style={styles.modalCancelBtn}>
            <Text style={styles.modalCancelText}>Cancel</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={dispatching || task.trim().length === 0}
            onPress={onSubmit}
            style={[
              styles.modalSubmitBtn,
              (dispatching || task.trim().length === 0) && styles.btnDisabled,
            ]}
          >
            <Text style={styles.modalSubmitText}>{dispatching ? 'Sending...' : 'Send Task'}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  </Modal>
)

const statusTextFor = (worker: MobileDashboardWorker) => {
  if (worker.status === 'working') return 'Working'
  if (worker.status === 'idle') return 'Idle'
  if (worker.status === 'stopped') return 'Stopped'
  return worker.status
}

const styles = StyleSheet.create({
  actionBtn: {
    alignItems: 'center',
    borderColor: colors.borderMuted,
    borderRadius: radius.sm,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    gap: 5,
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: 8,
  },
  actionBtnText: {
    fontSize: 12,
    fontWeight: '800',
  },
  btnDisabled: {
    opacity: 0.45,
  },
  card: {
    backgroundColor: 'rgba(22, 27, 34, 0.9)',
    borderColor: colors.borderMuted,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  cardLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  orchAvatar: {
    alignItems: 'center',
    backgroundColor: colors.accentSoft,
    borderRadius: 999,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  orchCard: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.accent,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: spacing.md,
  },
  orchHint: {
    color: colors.muted,
    fontSize: 13,
  },
  orchInfo: {
    gap: 2,
  },
  orchLeft: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  orchName: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '800',
  },
  colDivider: {
    backgroundColor: colors.borderMuted,
    width: 1,
  },
  colItem: {
    flex: 1,
    gap: 3,
  },
  colLabel: {
    color: colors.muted2,
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  colValue: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  error: {
    color: colors.error,
    fontSize: 14,
  },
  dispatchInput: {
    backgroundColor: colors.cardElevated,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.text,
    fontSize: 15,
    minHeight: 120,
    padding: spacing.md,
    textAlignVertical: 'top',
  },
  dispatchModal: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
    width: '100%',
  },
  expanded: {
    borderTopColor: colors.borderMuted,
    borderTopWidth: 1,
    gap: spacing.sm,
    paddingTop: spacing.sm,
  },
  expandedActions: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  expandedBtn: {
    alignItems: 'center',
    borderColor: colors.borderMuted,
    borderWidth: 1,
    minHeight: 44,
    borderRadius: radius.sm,
    flex: 1,
    flexDirection: 'row',
    gap: 5,
    justifyContent: 'center',
    paddingVertical: 9,
  },
  expandedBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },
  detailLink: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    flexDirection: 'row',
    gap: 2,
    minHeight: 36,
  },
  detailLinkText: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: '800',
  },
  expandedSectionTitle: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  expandedTaskName: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  onlineDot: {
    backgroundColor: colors.success,
    borderRadius: 999,
    height: 7,
    width: 7,
  },
  onlinePill: {
    alignItems: 'center',
    backgroundColor: colors.successSoft,
    borderColor: 'rgba(63, 185, 80, 0.34)',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  onlineText: {
    color: colors.success,
    fontSize: 11,
    fontWeight: '800',
  },
  overviewCard: {
    backgroundColor: colors.cardElevated,
    borderColor: colors.borderMuted,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.md,
  },
  overviewHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 44,
  },
  overviewHeaderLeft: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  overviewSummary: {
    color: colors.textSoft,
    fontSize: 13,
    lineHeight: 19,
  },
  inlineToggle: {
    alignSelf: 'flex-start',
    minHeight: 28,
    justifyContent: 'center',
  },
  inlineToggleText: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: '800',
  },
  metaChip: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderColor: colors.borderMuted,
    borderRadius: radius.sm,
    borderWidth: 1,
    flex: 1,
    gap: 3,
    minWidth: 88,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
  },
  metaLabel: {
    color: colors.muted2,
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  metaValue: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '800',
  },
  modalActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'flex-end',
  },
  modalBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.68)',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  modalCancelBtn: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 42,
    paddingHorizontal: spacing.md,
  },
  modalCancelText: {
    color: colors.textSoft,
    fontSize: 14,
    fontWeight: '800',
  },
  modalHint: {
    color: colors.muted,
    fontSize: 13,
  },
  modalSubmitBtn: {
    alignItems: 'center',
    backgroundColor: colors.accent,
    borderRadius: radius.sm,
    justifyContent: 'center',
    minHeight: 42,
    paddingHorizontal: spacing.md,
  },
  modalSubmitText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '900',
  },
  modalTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '900',
  },
  progressBullets: {
    gap: 4,
  },
  progressFill: {
    backgroundColor: colors.accent,
    borderRadius: 999,
    height: '100%',
  },
  progressMeta: {
    color: colors.muted,
    fontSize: 12,
  },
  progressPct: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '800',
    width: 38,
  },
  progressSection: {
    gap: 6,
  },
  progressTitle: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  progressTrack: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 999,
    flex: 1,
    height: 6,
    overflow: 'hidden',
  },
  progressWrap: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  quickActions: {
    borderTopColor: colors.borderMuted,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingTop: spacing.sm,
  },
  pullHint: {
    color: colors.muted2,
    fontSize: 12,
    textAlign: 'center',
  },
  scroll: {
    gap: spacing.sm,
    paddingBottom: spacing.lg,
  },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  sectionLink: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 2,
  },
  sectionLinkText: {
    color: colors.muted,
    fontSize: 14,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
  },
  statGrid: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  statItem: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderRadius: radius.sm,
    flex: 1,
    gap: 2,
    paddingVertical: spacing.sm,
  },
  statLabel: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: '600',
  },
  statValue: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '900',
  },
  title: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '900',
  },
  twoCol: {
    flexDirection: 'row',
  },
  workerAvatar: {
    alignItems: 'center',
    borderRadius: 999,
    height: 40,
    justifyContent: 'center',
    position: 'relative',
    width: 40,
  },
  workerAvatarText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '900',
  },
  workerHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  workerInfo: {
    flex: 1,
    gap: 2,
  },
  workerMetaGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  workerLeft: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: spacing.sm,
  },
  workerName: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '800',
  },
  workerRight: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  workerTask: {
    color: colors.textSoft,
    fontSize: 13,
    lineHeight: 19,
  },
  workerProgressFill: {
    borderRadius: 999,
    height: '100%',
  },
  workerProgressTrack: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 999,
    height: 5,
    overflow: 'hidden',
  },
  workerStatusDot: {
    borderColor: colors.card,
    borderRadius: 999,
    borderWidth: 2,
    bottom: -1,
    height: 12,
    position: 'absolute',
    right: -1,
    width: 12,
  },
})
