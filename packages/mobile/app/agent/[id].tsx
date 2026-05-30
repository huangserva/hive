import { Ionicons } from '@expo/vector-icons'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Modal,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import type {
  MobileDashboardWorker,
  MobileWorkerTranscript,
  MobileWorkspaceTasks,
} from '../../src/api/client'
import { useMobileRuntime } from '../../src/api/mobile-runtime-context'
import { Screen } from '../../src/components/Screen'
import { StatusBadge, statusColor } from '../../src/components/StatusBadge'
import { useT } from '../../src/i18n'
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

const FEATURE_LABELS: Record<string, string> = {
  browser_e2e: 'Browser E2E',
  mcp: 'MCP',
  session_capture: 'Capture',
  session_resume: 'Resume',
  terminal_input_profile: 'Terminal',
  thinking_levels: 'Thinking',
}

const featureLabel = (feature: string) => FEATURE_LABELS[feature] ?? feature.replace(/_/g, ' ')

const riskColor = (risk: string) => {
  if (risk === 'high') return colors.error
  if (risk === 'moderate') return colors.warning
  return colors.muted
}

const unattendedLabel = (
  value: MobileDashboardWorker['capabilities'] extends infer C
    ? C extends { unattended?: infer U }
      ? U
      : never
    : never
) => {
  if (value === true) return 'Unattended'
  if (value === false) return 'Supervised'
  return null
}

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
  canDispatch = true,
  onDispatch,
  onRestart,
  onStop,
  status,
}: {
  canDispatch?: boolean
  onDispatch: () => void
  onRestart: () => void
  onStop: () => void
  status: string
}) => {
  const t = useT()
  const isWorking = status === 'working'
  const isStopped = status === 'stopped'
  return (
    <View style={styles.actionBtns}>
      {canDispatch && !isWorking && !isStopped ? (
        <ActionButton
          icon="send-outline"
          label={t('agent.action.dispatch')}
          onPress={onDispatch}
          tone="success"
        />
      ) : null}
      <ActionButton
        icon="refresh-outline"
        label={t('agent.action.restart')}
        onPress={onRestart}
        tone="accent"
      />
      {!isStopped ? (
        <ActionButton
          icon="stop-circle-outline"
          label={t('agent.action.stop')}
          onPress={onStop}
          tone="danger"
        />
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
}) => {
  const t = useT()
  return (
    <Modal animationType="fade" transparent visible={visible}>
      <View style={styles.modalBackdrop}>
        <View style={styles.dispatchModal}>
          <Text style={styles.modalTitle}>{t('agent.dispatch.title', { name: workerName })}</Text>
          <Text style={styles.modalHint}>{t('agent.dispatch.hint')}</Text>
          <TextInput
            autoFocus
            multiline
            onChangeText={onChangeText}
            placeholder={t('agent.dispatch.placeholder')}
            placeholderTextColor={colors.muted2}
            style={styles.dispatchInput}
            value={task}
          />
          <View style={styles.modalActions}>
            <Pressable accessibilityRole="button" onPress={onClose} style={styles.modalCancelBtn}>
              <Text style={styles.modalCancelText}>{t('agent.dispatch.cancel')}</Text>
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
              <Text style={styles.modalSubmitText}>
                {dispatching ? t('agent.dispatch.sending') : t('agent.dispatch.send')}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  )
}

export default function AgentDetailScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>()
  const router = useRouter()
  const t = useT()
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
    syncRevision,
  } = useMobileRuntime()
  const workerId = typeof id === 'string' ? id : ''
  const worker = useMemo(
    () => dashboard?.workers.find((item) => item.id === workerId) ?? null,
    [dashboard, workerId]
  )
  const isOrchestrator = useMemo(
    () =>
      workerId.endsWith(':orchestrator') ||
      (selectedWorkspaceId ? workerId === `${selectedWorkspaceId}:orchestrator` : false),
    [selectedWorkspaceId, workerId]
  )
  // Sentinel（哨兵，如周瑜）只巡检、不能被派单（后端 team-authz 禁止 send），
  // 所以详情页同样隐藏 Dispatch 入口和 Dispatch History，沿用 orchestrator 特判思路。
  const isSentinel = worker?.role === 'sentinel'
  const detailAgent = useMemo(() => {
    if (worker) {
      return {
        id: worker.id,
        name: worker.name,
        roleLabel: roleLabel(worker.role),
        status: worker.status,
        type: 'worker' as const,
      }
    }
    if (isOrchestrator) {
      const run = dashboard?.runs.find(
        (item) => item.agent_name.toLowerCase() === 'orchestrator' || item.id === workerId
      )
      return {
        id: workerId,
        name: 'Orchestrator',
        roleLabel: 'Project Manager / Orchestrator',
        status: run?.status === 'running' ? 'working' : (run?.status ?? 'working'),
        type: 'orchestrator' as const,
      }
    }
    return null
  }, [dashboard, isOrchestrator, worker, workerId])
  const [transcript, setTranscript] = useState<MobileWorkerTranscript | null>(null)
  const [tasks, setTasks] = useState<MobileWorkspaceTasks | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [autoScroll, setAutoScroll] = useState(true)
  const [dispatchText, setDispatchText] = useState('')
  const [dispatching, setDispatching] = useState(false)
  const [dispatchOpen, setDispatchOpen] = useState(false)
  const [terminalFullscreenOpen, setTerminalFullscreenOpen] = useState(false)
  const [fullscreenAutoScroll, setFullscreenAutoScroll] = useState(true)
  const terminalScrollRef = useRef<ScrollView>(null)
  const fullscreenTerminalScrollRef = useRef<ScrollView>(null)
  const terminalNearBottomRef = useRef(true)
  const fullscreenNearBottomRef = useRef(true)
  const terminalScrollFrameRef = useRef<number | null>(null)
  const terminalScrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fullscreenScrollFrameRef = useRef<number | null>(null)
  const fullscreenScrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async () => {
    void syncRevision
    if (!workerId || !selectedWorkspaceId) return
    setRefreshing(true)
    try {
      const tk = await getWorkspaceTasks()
      setTasks(tk)
      setTranscript(await getWorkerTranscript(workerId))
    } finally {
      setRefreshing(false)
    }
  }, [getWorkerTranscript, getWorkspaceTasks, selectedWorkspaceId, syncRevision, workerId])

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
    () =>
      dashboard?.runs.find((r) =>
        worker
          ? r.agent_name === worker.name
          : isOrchestrator && (r.agent_name.toLowerCase() === 'orchestrator' || r.id === workerId)
      ) ?? null,
    [dashboard, isOrchestrator, worker, workerId]
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
    !isOrchestrator && worker
      ? (tasks?.dispatches.filter((d) => d.worker_name === worker.name) ?? [])
      : []

  const confirmStop = () => {
    if (!worker) return
    Alert.alert(t('status.stopWorker'), t('status.stopWorkerBody', { name: worker.name }), [
      { style: 'cancel', text: t('common.cancel') },
      {
        onPress: () => void stopWorker(worker.id),
        style: 'destructive',
        text: t('agent.action.stop'),
      },
    ])
  }

  const confirmRestart = () => {
    if (!worker) return
    Alert.alert(t('status.restartWorker'), t('status.restartWorkerBody', { name: worker.name }), [
      { style: 'cancel', text: t('common.cancel') },
      { onPress: () => void restartWorker(worker.id), text: t('agent.action.restart') },
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
      Alert.alert(t('status.dispatchSent'), t('status.dispatchSentBody', { name: worker.name }))
      closeDispatch()
      return
    }
    Alert.alert(t('status.dispatchFailed'), error ?? t('common.unavailable'))
  }

  const copyId = () => {
    if (detailAgent) Alert.alert(t('common.copied'), detailAgent.id)
  }

  const openTerminalFullscreen = () => {
    fullscreenNearBottomRef.current = true
    setFullscreenAutoScroll(true)
    setTerminalFullscreenOpen(true)
    scheduleFullscreenTerminalScroll(false)
  }

  const scheduleTerminalScroll = useCallback((animated: boolean) => {
    if (terminalScrollFrameRef.current !== null) {
      cancelAnimationFrame(terminalScrollFrameRef.current)
    }
    if (terminalScrollTimeoutRef.current) {
      clearTimeout(terminalScrollTimeoutRef.current)
    }
    terminalScrollFrameRef.current = requestAnimationFrame(() => {
      terminalScrollFrameRef.current = null
      terminalScrollTimeoutRef.current = setTimeout(() => {
        terminalScrollTimeoutRef.current = null
        terminalScrollRef.current?.scrollToEnd({ animated })
      }, 50)
    })
  }, [])

  const scheduleFullscreenTerminalScroll = useCallback((animated: boolean) => {
    if (fullscreenScrollFrameRef.current !== null) {
      cancelAnimationFrame(fullscreenScrollFrameRef.current)
    }
    if (fullscreenScrollTimeoutRef.current) {
      clearTimeout(fullscreenScrollTimeoutRef.current)
    }
    fullscreenScrollFrameRef.current = requestAnimationFrame(() => {
      fullscreenScrollFrameRef.current = null
      fullscreenScrollTimeoutRef.current = setTimeout(() => {
        fullscreenScrollTimeoutRef.current = null
        fullscreenTerminalScrollRef.current?.scrollToEnd({ animated })
      }, 50)
    })
  }, [])

  const handleTerminalScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { nativeEvent } = event
    const distanceFromBottom =
      nativeEvent.contentSize.height -
      (nativeEvent.contentOffset.y + nativeEvent.layoutMeasurement.height)
    terminalNearBottomRef.current = distanceFromBottom <= 80
  }

  const handleFullscreenTerminalScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { nativeEvent } = event
    const distanceFromBottom =
      nativeEvent.contentSize.height -
      (nativeEvent.contentOffset.y + nativeEvent.layoutMeasurement.height)
    fullscreenNearBottomRef.current = distanceFromBottom <= 80
  }

  useEffect(
    () => () => {
      if (terminalScrollFrameRef.current !== null) {
        cancelAnimationFrame(terminalScrollFrameRef.current)
      }
      if (terminalScrollTimeoutRef.current) {
        clearTimeout(terminalScrollTimeoutRef.current)
      }
      if (fullscreenScrollFrameRef.current !== null) {
        cancelAnimationFrame(fullscreenScrollFrameRef.current)
      }
      if (fullscreenScrollTimeoutRef.current) {
        clearTimeout(fullscreenScrollTimeoutRef.current)
      }
    },
    []
  )

  const terminalLines = transcript?.lines ?? []
  const terminalLineItems = useMemo(() => {
    const seen = new Map<string, number>()
    return terminalLines.map((line) => {
      const count = seen.get(line) ?? 0
      seen.set(line, count + 1)
      return { key: `${line || 'blank'}-${count}`, line }
    })
  }, [terminalLines])

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
          <Text style={styles.navTitle}>{t('agent.detail.title')}</Text>
          <Pressable accessibilityRole="button" hitSlop={12}>
            <Ionicons color={colors.muted} name="ellipsis-horizontal" size={22} />
          </Pressable>
        </View>
        <Text style={styles.pullHint}>{t('status.pullRefresh')}</Text>

        {!detailAgent && state !== 'connected' ? (
          <View style={styles.card}>
            <Text style={styles.body}>{t('cockpit.connectFirst', { state })}</Text>
          </View>
        ) : null}
        {!detailAgent && state === 'connected' ? (
          <View style={styles.card}>
            <Text style={styles.body}>{t('agent.detail.notFound', { id: workerId })}</Text>
          </View>
        ) : null}

        {detailAgent ? (
          <>
            {/* Profile card */}
            <View style={styles.profileCard}>
              <View style={styles.avatarRow}>
                <View
                  style={[
                    styles.avatar,
                    {
                      backgroundColor: `${statusColor(detailAgent.status)}22`,
                      borderColor: statusColor(detailAgent.status),
                    },
                  ]}
                >
                  <Text style={styles.avatarText}>
                    {detailAgent.name.slice(0, 2).toUpperCase()}
                  </Text>
                </View>
                <View style={styles.profileInfo}>
                  <Text style={styles.workerName}>{detailAgent.name}</Text>
                  <Text style={styles.workerRole}>{detailAgent.roleLabel}</Text>
                  <Pressable onPress={copyId} style={styles.idRow}>
                    <Text style={styles.agentId}>
                      {t('agent.detail.agentId', { id: detailAgent.id })}
                    </Text>
                    <Ionicons color={colors.muted} name="copy-outline" size={13} />
                  </Pressable>
                </View>
              </View>
              {worker ? (
                <View style={styles.profileMetaGrid}>
                  <InfoPill label="CLI" value={cliLabel(worker.preset)} />
                  <InfoPill label={t('common.role')} value={worker.role} />
                </View>
              ) : null}
              {worker ? <CapabilityChips capabilities={worker.capabilities} /> : null}
              <View style={styles.badgeActionRow}>
                <View style={styles.statusRow}>
                  <StatusBadge status={detailAgent.status} />
                </View>
                {worker ? (
                  <WorkerActions
                    canDispatch={!isSentinel}
                    onDispatch={openDispatch}
                    onRestart={confirmRestart}
                    onStop={confirmStop}
                    status={worker.status}
                  />
                ) : null}
              </View>
              {isSentinel ? (
                <View style={styles.sentinelNote}>
                  <Ionicons color={colors.accent} name="shield-checkmark-outline" size={14} />
                  <Text style={styles.sentinelNoteText}>
                    Sentinel watcher — observes and patrols only, cannot be dispatched.
                  </Text>
                </View>
              ) : null}
            </View>

            {/* Stats row */}
            <View style={styles.statsCard}>
              <View style={styles.statItem}>
                <Text style={styles.statLabel}>{t('agent.detail.workspace')}</Text>
                <Text style={styles.statValue}>
                  {dashboard?.workspace.name ?? selectedWorkspaceId ?? '--'}
                </Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <Text style={styles.statLabel}>{t('agent.detail.uptime')}</Text>
                <Text style={styles.statValue}>{uptimeText}</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <Text style={styles.statLabel}>{t('agent.detail.started')}</Text>
                <Text style={styles.statValue}>{startedText}</Text>
              </View>
            </View>

            {/* Terminal */}
            <View style={styles.terminalCard}>
              <View style={styles.terminalHeader}>
                <View style={styles.terminalTitleRow}>
                  <View style={styles.liveDot} />
                  <Text style={styles.sectionTitle}>{t('agent.detail.terminal')}</Text>
                </View>
                <View style={styles.terminalHeaderActions}>
                  <View style={styles.autoScrollRow}>
                    <Text style={styles.autoScrollLabel}>{t('agent.detail.autoScroll')}</Text>
                    <Switch
                      onValueChange={setAutoScroll}
                      thumbColor="#fff"
                      trackColor={{ false: colors.border, true: colors.accent }}
                      value={autoScroll}
                    />
                  </View>
                  <Pressable
                    accessibilityLabel={t('agent.detail.expandTerminal')}
                    accessibilityRole="button"
                    hitSlop={8}
                    onPress={openTerminalFullscreen}
                    style={styles.expandButton}
                  >
                    <Ionicons color={colors.accent} name="expand-outline" size={18} />
                  </Pressable>
                </View>
              </View>
              <View style={styles.terminal}>
                <ScrollView
                  onContentSizeChange={() => {
                    if (autoScroll && terminalNearBottomRef.current) scheduleTerminalScroll(false)
                  }}
                  onScroll={handleTerminalScroll}
                  ref={terminalScrollRef}
                  scrollEventThrottle={16}
                  showsVerticalScrollIndicator={false}
                >
                  {terminalLineItems.length ? (
                    terminalLineItems.map(({ key, line }) => (
                      <Text key={key} style={[styles.termLine, termLineColor(line)]}>
                        {line}
                      </Text>
                    ))
                  ) : (
                    <Text style={styles.termLine}>{t('agent.detail.noTerminal')}</Text>
                  )}
                </ScrollView>
              </View>
            </View>

            {!isOrchestrator && !isSentinel ? (
              <View style={styles.card}>
                <Text style={styles.sectionTitle}>{t('agent.detail.dispatchHistory')}</Text>
                {relevantDispatches.length === 0 ? (
                  <Text style={styles.body}>{t('agent.detail.noDispatches')}</Text>
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
            ) : null}
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
      <Modal animationType="slide" visible={terminalFullscreenOpen}>
        <SafeAreaView style={styles.fullscreenSafeArea}>
          <View style={styles.fullscreenHeader}>
            <View style={styles.terminalTitleRow}>
              <View style={styles.liveDot} />
              <View>
                <Text style={styles.fullscreenTitle}>{t('agent.detail.terminal')}</Text>
                <Text style={styles.fullscreenSubtitle}>{detailAgent?.name ?? 'Agent'}</Text>
              </View>
            </View>
            <Pressable
              accessibilityLabel={t('agent.detail.closeTerminal')}
              accessibilityRole="button"
              hitSlop={10}
              onPress={() => setTerminalFullscreenOpen(false)}
              style={styles.closeButton}
            >
              <Ionicons color={colors.text} name="close" size={22} />
            </Pressable>
          </View>
          <View style={styles.fullscreenControls}>
            <Text style={styles.autoScrollLabel}>{t('agent.detail.autoScroll')}</Text>
            <Switch
              onValueChange={setFullscreenAutoScroll}
              thumbColor="#fff"
              trackColor={{ false: colors.border, true: colors.accent }}
              value={fullscreenAutoScroll}
            />
          </View>
          <ScrollView
            contentContainerStyle={styles.fullscreenTerminalContent}
            onContentSizeChange={() => {
              if (fullscreenAutoScroll && fullscreenNearBottomRef.current) {
                scheduleFullscreenTerminalScroll(false)
              }
            }}
            onScroll={handleFullscreenTerminalScroll}
            ref={fullscreenTerminalScrollRef}
            scrollEventThrottle={16}
            style={styles.fullscreenTerminal}
          >
            {terminalLineItems.length ? (
              terminalLineItems.map(({ key, line }) => (
                <Text key={key} style={[styles.fullscreenTermLine, termLineColor(line)]}>
                  {line}
                </Text>
              ))
            ) : (
              <Text style={styles.fullscreenTermLine}>{t('agent.detail.noTerminal')}</Text>
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>
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

const CapabilityChips = ({
  capabilities,
}: {
  capabilities?: MobileDashboardWorker['capabilities']
}) => {
  if (!capabilities) return null
  const features = capabilities.features.slice(0, 6)
  const hiddenCount = capabilities.features.length - features.length
  const unattended = unattendedLabel(capabilities.unattended)
  const showMode = capabilities.mode && capabilities.mode !== 'unknown'
  const showRisk = capabilities.risk_tier && capabilities.risk_tier !== 'unknown'

  if (!features.length && !hiddenCount && !unattended && !showMode && !showRisk) return null

  return (
    <View style={styles.capabilityRow}>
      {showMode ? <CapabilityChip label={capabilities.mode.replace(/_/g, ' ')} /> : null}
      {showRisk ? (
        <CapabilityChip
          color={riskColor(capabilities.risk_tier)}
          label={`${capabilities.risk_tier} risk`}
        />
      ) : null}
      {unattended ? <CapabilityChip color={colors.accent} label={unattended} /> : null}
      {features.map((feature) => (
        <CapabilityChip key={feature} label={featureLabel(feature)} />
      ))}
      {hiddenCount > 0 ? <CapabilityChip label={`+${hiddenCount}`} /> : null}
    </View>
  )
}

const CapabilityChip = ({ color = colors.textSoft, label }: { color?: string; label: string }) => (
  <View style={styles.capabilityChip}>
    <Text numberOfLines={1} style={[styles.capabilityChipText, { color }]}>
      {label}
    </Text>
  </View>
)

const styles = StyleSheet.create({
  actionBtns: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  actionBtn: {
    alignItems: 'center',
    borderColor: colors.borderMuted,
    borderRadius: radius.sm,
    borderWidth: 1,
    flex: 1,
    flexBasis: 96,
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
    gap: spacing.sm,
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
  capabilityChip: {
    backgroundColor: 'rgba(255, 255, 255, 0.045)',
    borderColor: colors.borderMuted,
    borderRadius: 999,
    borderWidth: 1,
    maxWidth: 140,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  capabilityChipText: {
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  capabilityRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
    marginTop: spacing.xs,
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
  closeButton: {
    alignItems: 'center',
    backgroundColor: colors.cardElevated,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    height: 40,
    justifyContent: 'center',
    width: 40,
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
  expandButton: {
    alignItems: 'center',
    backgroundColor: colors.accentSoft,
    borderColor: 'rgba(88, 166, 255, 0.35)',
    borderRadius: 999,
    borderWidth: 1,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  fullscreenControls: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'flex-end',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  fullscreenHeader: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  fullscreenSafeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  fullscreenSubtitle: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 2,
  },
  fullscreenTermLine: {
    color: colors.textSoft,
    fontFamily: 'Courier',
    fontSize: 14,
    lineHeight: 21,
  },
  fullscreenTerminal: {
    backgroundColor: '#010409',
    flex: 1,
  },
  fullscreenTerminalContent: {
    padding: spacing.md,
  },
  fullscreenTitle: {
    color: colors.text,
    fontSize: 18,
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
  statusRow: {
    alignItems: 'flex-start',
  },
  sentinelNote: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
    marginTop: spacing.sm,
  },
  sentinelNoteText: {
    color: colors.muted,
    flex: 1,
    fontSize: 12,
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
  terminalHeaderActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
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
