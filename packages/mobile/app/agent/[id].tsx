import { Ionicons } from '@expo/vector-icons'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native'

import type { MobileWorkerTranscript, MobileWorkspaceTasks } from '../../src/api/client'
import { useMobileRuntime } from '../../src/api/mobile-runtime-context'
import { Screen } from '../../src/components/Screen'
import { StatusBadge, statusColor } from '../../src/components/StatusBadge'
import { colors, radius, spacing } from '../../src/theme'

const WORKER_ROLES: Record<string, string> = {
  coder: 'Software Engineer',
  designer: 'UI Designer',
  reviewer: 'Code Reviewer',
  sentinel: 'Sentinel Watcher',
  tester: 'QA Engineer',
}

const roleLabel = (role: string) => WORKER_ROLES[role] ?? role

const CLI_LABELS: Record<string, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  gemini: 'Gemini',
  opencode: 'OpenCode',
}

const cliLabel = (preset: string | null) => (preset ? (CLI_LABELS[preset] ?? preset) : '—')

const dispatchStatusLabel = (status: string) => {
  if (status === 'done') return 'Completed'
  if (status === 'cancelled') return 'Cancelled'
  return 'In Progress'
}

const dispatchStatusColor = (status: string) => {
  if (status === 'done') return colors.success
  if (status === 'cancelled') return colors.muted
  return colors.accent
}

const dispatchIcon = (status: string): keyof typeof Ionicons.glyphMap => {
  if (status === 'done') return 'checkmark-circle'
  if (status === 'cancelled') return 'close-circle'
  return 'time-outline'
}

const WorkerActions = ({
  onDispatch,
  onRestart,
  onStop,
  status,
}: {
  onDispatch: () => void
  onRestart: () => void
  onStop: () => void
  status: string
}) => {
  const isWorking = status === 'working'
  const isStopped = status === 'stopped'
  return (
    <View style={styles.actionBtns}>
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
      onPress={onPress}
      style={[styles.actionBtn, { backgroundColor: toneBackground }]}
    >
      <Ionicons color={toneColor} name={icon} size={13} />
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
  visible,
  workerName,
}: {
  dispatching: boolean
  onChangeText: (value: string) => void
  onClose: () => void
  onSubmit: () => void
  task: string
  visible: boolean
  workerName: string
}) => (
  <Modal animationType="fade" transparent visible={visible}>
    <View style={styles.modalBackdrop}>
      <View style={styles.dispatchModal}>
        <Text style={styles.modalTitle}>Dispatch to {workerName}</Text>
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

export default function AgentDetailScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>()
  const router = useRouter()
  const {
    dashboard,
    dispatchTask,
    error,
    getWorkerTranscript,
    getWorkspaceTasks,
    restartWorker,
    selectedWorkspaceId,
    state,
    stopWorker,
  } = useMobileRuntime()
  const workerId = typeof id === 'string' ? id : ''
  const worker = useMemo(
    () => dashboard?.workers.find((item) => item.id === workerId) ?? null,
    [dashboard, workerId]
  )
  const [transcript, setTranscript] = useState<MobileWorkerTranscript | null>(null)
  const [tasks, setTasks] = useState<MobileWorkspaceTasks | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [autoScroll, setAutoScroll] = useState(true)
  const [dispatchText, setDispatchText] = useState('')
  const [dispatching, setDispatching] = useState(false)
  const [dispatchOpen, setDispatchOpen] = useState(false)

  const load = useCallback(async () => {
    if (!workerId || !selectedWorkspaceId) return
    setRefreshing(true)
    try {
      const [t, tk] = await Promise.all([getWorkerTranscript(workerId), getWorkspaceTasks()])
      setTranscript(t)
      setTasks(tk)
    } finally {
      setRefreshing(false)
    }
  }, [getWorkerTranscript, getWorkspaceTasks, selectedWorkspaceId, workerId])

  useEffect(() => {
    void load()
  }, [load])

  // 每 3 秒轮询终端输出
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  useEffect(() => {
    if (!workerId || !selectedWorkspaceId) return
    pollRef.current = setInterval(async () => {
      try {
        const t = await getWorkerTranscript(workerId)
        if (t) setTranscript(t)
      } catch {}
    }, 3000)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [getWorkerTranscript, selectedWorkspaceId, workerId])

  const workerRun = useMemo(
    () => dashboard?.runs.find((r) => worker && r.agent_name === worker.name) ?? null,
    [dashboard, worker]
  )

  const uptimeText = useMemo(() => {
    if (!workerRun?.started_at) return '--'
    const ms = Date.now() - new Date(workerRun.started_at).getTime()
    const mins = Math.floor(ms / 60000)
    if (mins < 60) return `${mins}m`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h ${mins % 60}m`
    return `${Math.floor(hrs / 24)}d ${hrs % 24}h`
  }, [workerRun])

  const startedText = useMemo(() => {
    if (!workerRun?.started_at) return '--'
    return new Date(workerRun.started_at).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    })
  }, [workerRun])

  const relevantDispatches =
    tasks?.dispatches.filter((d) => !worker || d.worker_name === worker.name) ?? []

  const confirmStop = () => {
    if (!worker) return
    Alert.alert('Stop worker', `Stop ${worker.name}?`, [
      { style: 'cancel', text: 'Cancel' },
      { onPress: () => void stopWorker(worker.id), style: 'destructive', text: 'Stop' },
    ])
  }

  const confirmRestart = () => {
    if (!worker) return
    Alert.alert('Restart worker', `Restart ${worker.name}?`, [
      { style: 'cancel', text: 'Cancel' },
      { onPress: () => void restartWorker(worker.id), text: 'Restart' },
    ])
  }

  const openDispatch = () => {
    setDispatchText('')
    setDispatchOpen(true)
  }

  const closeDispatch = () => {
    if (dispatching) return
    setDispatchOpen(false)
    setDispatchText('')
  }

  const submitDispatch = async () => {
    const task = dispatchText.trim()
    if (!worker || !task) return
    setDispatching(true)
    const result = await dispatchTask(worker.id, task)
    setDispatching(false)
    if (result) {
      Alert.alert(
        'Dispatch sent',
        `Sent to ${worker.name}. The orchestrator will track it; watch Chat and Status for updates.`
      )
      closeDispatch()
      return
    }
    Alert.alert('Dispatch failed', error ?? 'Unable to send this task. Please try again.')
  }

  const copyId = () => {
    if (worker) Alert.alert('Copied', worker.id)
  }

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl onRefresh={load} refreshing={refreshing} tintColor={colors.accent} />
        }
      >
        <View style={styles.navBar}>
          <Pressable accessibilityRole="button" hitSlop={12} onPress={() => router.back()}>
            <Ionicons color={colors.accent} name="arrow-back" size={22} />
          </Pressable>
          <Text style={styles.navTitle}>Worker Detail</Text>
          <Pressable accessibilityRole="button" hitSlop={12}>
            <Ionicons color={colors.muted} name="ellipsis-horizontal" size={22} />
          </Pressable>
        </View>
        <Text style={styles.pullHint}>Pull down to refresh</Text>

        {!worker && state !== 'connected' ? (
          <View style={styles.card}>
            <Text style={styles.body}>Connect in Settings first. State: {state}</Text>
          </View>
        ) : null}

        {worker ? (
          <>
            {/* Profile card */}
            <View style={styles.profileCard}>
              <View style={styles.avatarRow}>
                <View
                  style={[
                    styles.avatar,
                    {
                      backgroundColor: `${statusColor(worker.status)}22`,
                      borderColor: statusColor(worker.status),
                    },
                  ]}
                >
                  <Text style={styles.avatarText}>{worker.name.slice(0, 2).toUpperCase()}</Text>
                </View>
                <View style={styles.profileInfo}>
                  <Text style={styles.workerName}>{worker.name}</Text>
                  <Text style={styles.workerRole}>{roleLabel(worker.role)}</Text>
                  <Pressable onPress={copyId} style={styles.idRow}>
                    <Text style={styles.agentId}>Agent ID: {worker.id}</Text>
                    <Ionicons color={colors.muted} name="copy-outline" size={13} />
                  </Pressable>
                </View>
              </View>
              <View style={styles.profileMetaGrid}>
                <InfoPill label="CLI" value={cliLabel(worker.preset)} />
                <InfoPill label="Role" value={worker.role} />
              </View>
              <View style={styles.badgeActionRow}>
                <StatusBadge status={worker.status} />
                <WorkerActions
                  onDispatch={openDispatch}
                  onRestart={confirmRestart}
                  onStop={confirmStop}
                  status={worker.status}
                />
              </View>
            </View>

            {/* Stats row */}
            <View style={styles.statsCard}>
              <View style={styles.statItem}>
                <Text style={styles.statLabel}>Workspace</Text>
                <Text style={styles.statValue}>
                  {dashboard?.workspace.name ?? selectedWorkspaceId ?? '--'}
                </Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <Text style={styles.statLabel}>Uptime</Text>
                <Text style={styles.statValue}>{uptimeText}</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <Text style={styles.statLabel}>Started</Text>
                <Text style={styles.statValue}>{startedText}</Text>
              </View>
            </View>

            {/* Terminal */}
            <View style={styles.terminalCard}>
              <View style={styles.terminalHeader}>
                <View style={styles.terminalTitleRow}>
                  <View style={styles.liveDot} />
                  <Text style={styles.sectionTitle}>Terminal (Live)</Text>
                </View>
                <View style={styles.autoScrollRow}>
                  <Text style={styles.autoScrollLabel}>Auto-scroll</Text>
                  <Switch
                    onValueChange={setAutoScroll}
                    thumbColor="#fff"
                    trackColor={{ false: colors.border, true: colors.accent }}
                    value={autoScroll}
                  />
                </View>
              </View>
              <View style={styles.terminal}>
                <ScrollView showsVerticalScrollIndicator={false}>
                  {transcript?.lines.length ? (
                    transcript.lines.map((line) => (
                      <Text key={line} style={[styles.termLine, termLineColor(line)]}>
                        {line}
                      </Text>
                    ))
                  ) : (
                    <Text style={styles.termLine}>No terminal output yet.</Text>
                  )}
                </ScrollView>
              </View>
            </View>

            {/* Dispatch History */}
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Dispatch History</Text>
              {relevantDispatches.length === 0 ? (
                <Text style={styles.body}>No dispatches for this worker.</Text>
              ) : null}
              {relevantDispatches.map((d) => (
                <View key={d.id} style={styles.dispatchItem}>
                  <Ionicons
                    color={dispatchStatusColor(d.status)}
                    name={dispatchIcon(d.status)}
                    size={20}
                  />
                  <View style={styles.dispatchContent}>
                    <Text style={styles.dispatchTitle}>{d.task_summary}</Text>
                    <Text style={styles.dispatchMeta}>
                      {new Date(d.created_at).toLocaleDateString()}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.dispatchBadge,
                      { backgroundColor: `${dispatchStatusColor(d.status)}22` },
                    ]}
                  >
                    <Text
                      style={[styles.dispatchBadgeText, { color: dispatchStatusColor(d.status) }]}
                    >
                      {dispatchStatusLabel(d.status)}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          </>
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>
      <DispatchModal
        dispatching={dispatching}
        onChangeText={setDispatchText}
        onClose={closeDispatch}
        onSubmit={submitDispatch}
        task={dispatchText}
        visible={dispatchOpen}
        workerName={worker?.name ?? 'worker'}
      />
    </Screen>
  )
}

const termLineColor = (line: string) => {
  if (line.startsWith('$') || line.startsWith('>')) return { color: colors.success }
  if (/error|fail|ERR/i.test(line)) return { color: colors.error }
  return {}
}

const InfoPill = ({ label, value }: { label: string; value: string }) => (
  <View style={styles.infoPill}>
    <Text style={styles.infoLabel}>{label}</Text>
    <Text numberOfLines={1} style={styles.infoValue}>
      {value}
    </Text>
  </View>
)

const styles = StyleSheet.create({
  actionBtns: {
    flex: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'flex-end',
  },
  actionBtn: {
    alignItems: 'center',
    borderColor: colors.borderMuted,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 5,
    justifyContent: 'center',
    minHeight: 36,
    paddingHorizontal: 10,
  },
  actionBtnText: {
    fontSize: 12,
    fontWeight: '800',
  },
  agentId: {
    color: colors.muted2,
    fontSize: 12,
  },
  autoScrollLabel: {
    color: colors.muted,
    fontSize: 12,
  },
  autoScrollRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  avatar: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: 999,
    borderWidth: 3,
    height: 56,
    justifyContent: 'center',
    width: 56,
  },
  avatarRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  avatarText: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
  },
  badgeActionRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  body: {
    color: colors.muted,
    fontSize: 14,
  },
  btnDisabled: {
    opacity: 0.4,
  },
  btnLabel: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  dispatchBadge: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  dispatchBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  dispatchContent: {
    flex: 1,
    gap: 2,
  },
  dispatchItem: {
    alignItems: 'center',
    borderTopColor: colors.borderMuted,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 12,
  },
  dispatchMeta: {
    color: colors.muted2,
    fontSize: 12,
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
  dispatchTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
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
  error: {
    color: colors.error,
    fontSize: 14,
  },
  idRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 5,
    marginTop: 2,
  },
  infoLabel: {
    color: colors.muted2,
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  infoPill: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderColor: colors.borderMuted,
    borderRadius: radius.sm,
    borderWidth: 1,
    flex: 1,
    gap: 3,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  infoValue: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '800',
  },
  liveDot: {
    backgroundColor: colors.success,
    borderRadius: 999,
    height: 8,
    width: 8,
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
  navBar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  navTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
  },
  profileCard: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.md,
  },
  profileInfo: {
    flex: 1,
    gap: 1,
  },
  profileMetaGrid: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  pullHint: {
    color: colors.muted2,
    fontSize: 12,
    textAlign: 'center',
  },
  restartBtn: {
    alignItems: 'center',
    backgroundColor: colors.accent,
    borderRadius: radius.sm,
    flexDirection: 'row',
    gap: 5,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  scroll: {
    gap: 14,
    paddingBottom: 32,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  statDivider: {
    backgroundColor: colors.border,
    height: '100%',
    width: 1,
  },
  statItem: {
    flex: 1,
    gap: 4,
    paddingHorizontal: 8,
  },
  statLabel: {
    color: colors.muted2,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  statValue: {
    color: colors.textSoft,
    fontSize: 14,
    fontWeight: '600',
  },
  statsCard: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    padding: spacing.md,
  },
  stopBtn: {
    alignItems: 'center',
    backgroundColor: colors.error,
    borderRadius: radius.sm,
    flexDirection: 'row',
    gap: 5,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  terminal: {
    backgroundColor: '#010409',
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    maxHeight: 260,
    minHeight: 120,
    padding: spacing.sm,
  },
  terminalCard: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  terminalHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  terminalTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  termLine: {
    color: colors.textSoft,
    fontFamily: 'Courier',
    fontSize: 12,
    lineHeight: 18,
  },
  workerName: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '800',
  },
  workerRole: {
    color: colors.muted,
    fontSize: 14,
  },
})
