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
import {
  countActiveDispatches,
  formatActiveMilestoneLabel,
  selectLatestActiveMilestone,
} from '../../src/cockpit/status-overview'
import { useRefreshableData } from '../../src/cockpit/useRefreshableCockpit'
import { AddWorkerModal } from '../../src/components/AddWorkerModal'
import { ConnectionModeBadge } from '../../src/components/ConnectionModeBanner'
import { Screen } from '../../src/components/Screen'
import { StatusBadge, statusColor } from '../../src/components/StatusBadge'
import { type AppLanguage, useLanguage, useT } from '../../src/i18n'
import { stripInlineMarkdown } from '../../src/lib/strip-markdown'
import { colors, radius, spacing } from '../../src/theme'

const AVATAR_COLORS = ['#58a6ff', '#3fb950', '#d29922', '#f85149', '#bc8cff', '#39d2c0']

const avatarColor = (name: string) => {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length] ?? AVATAR_COLORS[0]
}

const WORKER_LABELS: Record<
  AppLanguage,
  {
    cliPrefix: string
    cli: Record<string, string>
    features: Record<string, string>
    mode: Record<string, string>
    roles: Record<string, string>
    risk: Record<string, string>
    unattended: Record<'false' | 'true', string>
  }
> = {
  en: {
    cliPrefix: 'CLI:',
    cli: {
      claude: 'Claude Code',
      codex: 'Codex',
      gemini: 'Gemini',
      opencode: 'OpenCode',
    },
    features: {
      browser_e2e: 'Browser E2E',
      mcp: 'MCP',
      session_capture: 'Capture',
      session_resume: 'Resume',
      terminal_input_profile: 'Terminal',
      thinking_levels: 'Thinking',
    },
    mode: {
      cli_agent: 'CLI Agent',
    },
    roles: {
      coder: 'Software Engineer',
      designer: 'UI Designer',
      reviewer: 'Code Reviewer',
      sentinel: 'Sentinel Watcher',
      tester: 'QA Engineer',
    },
    risk: {
      high: 'High risk',
      moderate: 'Moderate risk',
    },
    unattended: {
      false: 'Supervised',
      true: 'Unattended',
    },
  },
  zh: {
    cliPrefix: 'CLI：',
    cli: {
      claude: 'Claude Code',
      codex: 'Codex',
      gemini: 'Gemini',
      opencode: 'OpenCode',
    },
    features: {
      browser_e2e: '浏览器 E2E',
      mcp: 'MCP',
      session_capture: '录制',
      session_resume: '恢复',
      terminal_input_profile: '终端',
      thinking_levels: '思考',
    },
    mode: {
      cli_agent: 'CLI 代理',
    },
    roles: {
      coder: '软件工程师',
      designer: 'UI 设计师',
      reviewer: '代码审查员',
      sentinel: '哨兵巡检员',
      tester: '测试工程师',
    },
    risk: {
      high: '高风险',
      moderate: '中风险',
    },
    unattended: {
      false: '人工监管',
      true: '无人值守',
    },
  },
}

const riskColor = (risk: string) => {
  if (risk === 'high') return colors.error
  if (risk === 'moderate') return colors.warning
  return colors.muted
}

const cliLabel = (language: AppLanguage, preset: string | null) =>
  preset ? (WORKER_LABELS[language].cli[preset] ?? preset) : '—'

const featureLabel = (language: AppLanguage, feature: string) =>
  WORKER_LABELS[language].features[feature] ?? feature.replace(/_/g, ' ')

const modeLabel = (language: AppLanguage, mode: string) =>
  WORKER_LABELS[language].mode[mode] ?? mode.replace(/_/g, ' ')

const riskLabel = (language: AppLanguage, risk: string) =>
  WORKER_LABELS[language].risk[risk] ?? risk

const unattendedLabel = (
  language: AppLanguage,
  value: MobileDashboardWorker['capabilities'] extends infer C
    ? C extends { unattended?: infer U }
      ? U
      : never
    : never
) => {
  if (value === true) return WORKER_LABELS[language].unattended.true
  if (value === false) return WORKER_LABELS[language].unattended.false
  return null
}

const roleLabel = (language: AppLanguage, role: string) =>
  WORKER_LABELS[language].roles[role] ?? role

// Worker 列表按状态排序：working 最上 → idle → stopped 最下，跟 PC/web 端一致。
// 同状态内保持原始顺序（Array.prototype.sort 在 Hermes/V8 上稳定，相等项不重排）。
const STATUS_RANK: Record<string, number> = {
  working: 0,
  idle: 1,
  stopped: 2,
}

const statusRank = (status: string) => STATUS_RANK[status] ?? 99

export default function StatusTab() {
  const {
    connect,
    createWorker,
    dashboard,
    dispatchTask,
    error,
    host,
    getCockpit,
    getWorkspaceTasks,
    listCommandPresets,
    refreshDashboard,
    restartWorker,
    selectedWorkspaceId,
    state,
    stopWorker,
    token,
  } = useMobileRuntime()
  const { language } = useLanguage()
  const t = useT()
  const router = useRouter()
  const [addWorkerVisible, setAddWorkerVisible] = useState(false)
  const [overviewExpanded, setOverviewExpanded] = useState(false)
  const [phaseExpanded, setPhaseExpanded] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [dispatchWorker, setDispatchWorker] = useState<MobileDashboardWorker | null>(null)
  const [dispatchText, setDispatchText] = useState('')
  const [dispatching, setDispatching] = useState(false)
  const [expandedWorkerId, setExpandedWorkerId] = useState<string | null>(null)
  const { data: cockpit, onRefresh: refreshCockpit } = useRefreshableData(getCockpit)
  const { data: workspaceTasks, onRefresh: refreshWorkspaceTasks } =
    useRefreshableData(getWorkspaceTasks)
  const activeWorkers = useMemo(
    () => dashboard?.workers.filter((w) => w.status !== 'stopped').length ?? 0,
    [dashboard]
  )
  // Sentinel（哨兵 worker，如周瑜）单独拎出来，不当普通 worker，也不参与下面的状态排序。
  const sentinelWorkers = useMemo(
    () => dashboard?.workers.filter((w) => w.role === 'sentinel') ?? [],
    [dashboard]
  )
  // 普通 worker：按 working → idle → stopped 排序，同状态保持原始顺序。
  const sortedWorkers = useMemo(
    () =>
      (dashboard?.workers.filter((w) => w.role !== 'sentinel') ?? [])
        .slice()
        .sort((a, b) => statusRank(a.status) - statusRank(b.status)),
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
  const activeMilestone = useMemo(
    () => selectLatestActiveMilestone(cockpit?.plan.milestones ?? []),
    [cockpit]
  )
  const activeMilestoneLabel = useMemo(
    () =>
      activeMilestone
        ? formatActiveMilestoneLabel(activeMilestone)
        : stripInlineMarkdown(dashboard?.plan.active_milestone ?? null) ||
          t('status.noActiveMilestone'),
    [activeMilestone, dashboard?.plan.active_milestone, t]
  )
  const inProgressDispatchCount = useMemo(
    () => countActiveDispatches(workspaceTasks?.dispatches ?? []),
    [workspaceTasks]
  )

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await Promise.all([refreshDashboard(), refreshCockpit(), refreshWorkspaceTasks()])
    setRefreshing(false)
  }, [refreshCockpit, refreshDashboard, refreshWorkspaceTasks])

  const confirmStop = (worker: MobileDashboardWorker) => {
    Alert.alert(t('status.stopWorker'), t('status.stopWorkerBody', { name: worker.name }), [
      { style: 'cancel', text: t('common.cancel') },
      {
        onPress: () => void stopWorker(worker.id),
        style: 'destructive',
        text: t('agent.action.stop'),
      },
    ])
  }

  const confirmRestart = (worker: MobileDashboardWorker) => {
    Alert.alert(t('status.restartWorker'), t('status.restartWorkerBody', { name: worker.name }), [
      { style: 'cancel', text: t('common.cancel') },
      { onPress: () => void restartWorker(worker.id), text: t('agent.action.restart') },
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
      Alert.alert(
        t('status.dispatchSent'),
        t('status.dispatchSentBody', { name: dispatchWorker.name })
      )
      closeDispatch()
      return
    }
    if (state !== 'connected') {
      Alert.alert(t('outbox.queuedTitle'), t('outbox.queued'))
      closeDispatch()
      return
    }
    Alert.alert(t('status.dispatchFailed'), error ?? t('common.unavailable'))
  }

  if (!dashboard) {
    return (
      <Screen showConnectionModeBanner={false}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          refreshControl={
            <RefreshControl
              onRefresh={onRefresh}
              refreshing={refreshing}
              tintColor={colors.accent}
            />
          }
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.offlineCard}>
            <View style={styles.offlineHeader}>
              <View style={styles.offlineHeaderRow}>
                <ConnectionModeBadge />
                <View style={styles.offlinePill}>
                  <View style={styles.offlineDot} />
                  <Text style={styles.offlinePillText}>{t('offline.disconnected')}</Text>
                </View>
              </View>
              <Text style={styles.offlineTitle}>{t('offline.subtitle')}</Text>
            </View>
            <Text style={styles.offlineBody}>{t('offline.copy')}</Text>
            <View style={styles.offlineActions}>
              <Pressable
                accessibilityRole="button"
                onPress={() => void connect(host, token)}
                style={styles.offlinePrimary}
              >
                <Text style={styles.offlinePrimaryText}>{t('offline.retry')}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push('/settings')}
                style={styles.offlineSecondary}
              >
                <Text style={styles.offlineSecondaryText}>{t('offline.openSettings')}</Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </Screen>
    )
  }

  return (
    <Screen showConnectionModeBanner={false}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl onRefresh={onRefresh} refreshing={refreshing} tintColor={colors.accent} />
        }
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Text numberOfLines={1} style={styles.title}>
            {t('status.title')}
          </Text>
          <View style={styles.headerStatus}>
            <ConnectionModeBadge />
            <View style={styles.onlinePill}>
              <View style={styles.onlineDot} />
              <Text style={styles.onlineText}>{t('status.orchestratorOnline')}</Text>
            </View>
          </View>
        </View>
        <Text style={styles.pullHint}>{t('status.pullRefresh')}</Text>

        <View style={styles.overviewCard}>
          <Pressable
            accessibilityRole="button"
            onPress={() => setOverviewExpanded((value) => !value)}
            style={styles.overviewHeader}
          >
            <View style={styles.overviewHeaderLeft}>
              <Ionicons color={colors.accent} name="grid-outline" size={16} />
              <Text style={styles.cardLabel}>{t('status.workspaceOverview')}</Text>
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
                  <Text style={styles.colLabel}>{t('status.currentPhase')}</Text>
                  <Text
                    ellipsizeMode="tail"
                    numberOfLines={phaseExpanded ? undefined : 2}
                    style={styles.colValue}
                  >
                    {stripInlineMarkdown(dashboard.plan.current_phase) || t('common.unknown')}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    hitSlop={8}
                    onPress={() => setPhaseExpanded((value) => !value)}
                    style={styles.inlineToggle}
                  >
                    <Text style={styles.inlineToggleText}>
                      {phaseExpanded ? t('status.showLess') : t('status.showMore')}
                    </Text>
                  </Pressable>
                </View>
                <View style={styles.colDivider} />
                <View style={styles.colItem}>
                  <Text style={styles.colLabel}>{t('status.activeMilestone')}</Text>
                  <Text ellipsizeMode="tail" numberOfLines={2} style={styles.colValue}>
                    {activeMilestoneLabel}
                  </Text>
                </View>
              </View>

              <View style={styles.progressSection}>
                <Text style={styles.progressTitle}>{t('cockpit.plan.overall')}</Text>
                <View style={styles.progressWrap}>
                  <View style={styles.progressTrack}>
                    <View style={[styles.progressFill, { width: `${progressPct}%` }]} />
                  </View>
                  <Text style={styles.progressPct}>{progressPct}%</Text>
                </View>
                <Text style={styles.progressMeta}>
                  {t('cockpit.plan.tasksCompleted', {
                    done: dashboard.tasks.total_done,
                    total: totalTasks,
                  })}
                </Text>
              </View>

              <View style={styles.statGrid}>
                <StatItem
                  icon="people-outline"
                  label={t('status.activeWorkers')}
                  value={activeWorkers}
                  onPress={() => router.push('/workers')}
                />
                <StatItem
                  icon="help-circle-outline"
                  label={t('cockpit.answer.title')}
                  value={dashboard.cockpit.open_questions}
                  onPress={() =>
                    router.push({ pathname: '/cockpit', params: { tab: 'questions' } })
                  }
                />
                <StatItem
                  icon="flash-outline"
                  label={t('status.tasksInProgress')}
                  value={inProgressDispatchCount}
                  onPress={() => router.push({ pathname: '/cockpit', params: { tab: 'tasks' } })}
                />
              </View>
            </>
          ) : (
            <Text ellipsizeMode="tail" numberOfLines={1} style={styles.overviewSummary}>
              {stripInlineMarkdown(dashboard.plan.active_milestone) ||
                stripInlineMarkdown(dashboard.plan.current_phase) ||
                t('status.noActiveMilestone')}
            </Text>
          )}
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{t('status.workers')}</Text>
          <View style={styles.sectionHeaderRight}>
            <Pressable
              accessibilityLabel={t('addWorker.title')}
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => setAddWorkerVisible(true)}
              style={styles.addWorkerBtn}
            >
              <Ionicons color={colors.accent} name="add" size={18} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => router.push('/workers')}
            >
              <View style={styles.sectionLink}>
                <Text style={styles.sectionLinkText}>
                  {t('status.activeCount', { count: activeWorkers })}
                </Text>
                <Ionicons color={colors.muted} name="chevron-forward" size={16} />
              </View>
            </Pressable>
          </View>
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
                <Text style={styles.orchName}>{t('status.orchestratorLabel')}</Text>
                <Text style={styles.orchHint}>{t('status.viewOrchestratorTerminal')}</Text>
              </View>
            </View>
            <Ionicons color={colors.muted} name="chevron-forward" size={18} />
          </Pressable>
        ) : null}

        {/* Sentinel 哨兵专属区块：固定在普通 worker 之上、Orchestrator 之下，独立呈现 */}
        {sentinelWorkers.length > 0 ? (
          <View style={styles.sentinelSection}>
            <Text style={styles.sentinelLabel}>{t('status.sentinelLabel')}</Text>
            {sentinelWorkers.map((worker) => (
              <SentinelCard
                key={worker.id}
                expanded={expandedWorkerId === worker.id}
                onOpenDetail={() => router.push(`/agent/${worker.id}`)}
                onToggle={() =>
                  setExpandedWorkerId((current) => (current === worker.id ? null : worker.id))
                }
                language={language}
                worker={worker}
              />
            ))}
          </View>
        ) : null}

        {sortedWorkers.map((worker) => (
          <WorkerCard
            key={worker.id}
            expanded={expandedWorkerId === worker.id}
            onDispatch={() => openDispatch(worker)}
            onOpenDetail={() => router.push(`/agent/${worker.id}`)}
            onRestart={() => confirmRestart(worker)}
            onStop={() => confirmStop(worker)}
            onToggle={() =>
              setExpandedWorkerId((current) => (current === worker.id ? null : worker.id))
            }
            language={language}
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
      <AddWorkerModal
        listCommandPresets={listCommandPresets}
        onClose={() => setAddWorkerVisible(false)}
        onCreate={createWorker}
        visible={addWorkerVisible}
      />
    </Screen>
  )
}

const StatItem = ({
  icon,
  label,
  onPress,
  value,
}: {
  icon: keyof typeof Ionicons.glyphMap
  label: string
  onPress?: () => void
  value: number
}) =>
  onPress ? (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.statItem}>
      <Ionicons color={colors.accent} name={icon} size={16} />
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </Pressable>
  ) : (
    <View style={styles.statItem}>
      <Ionicons color={colors.accent} name={icon} size={16} />
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  )

const WorkerCard = ({
  expanded,
  onDispatch,
  onOpenDetail,
  onRestart,
  onStop,
  onToggle,
  language,
  worker,
}: {
  expanded: boolean
  onDispatch: () => void
  onOpenDetail: () => void
  onRestart: () => void
  onStop: () => void
  onToggle: () => void
  language: AppLanguage
  worker: MobileDashboardWorker
}) => {
  const t = useT()
  const bgColor = avatarColor(worker.name)
  const accent = statusColor(worker.status)

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      onPress={onToggle}
      style={styles.card}
    >
      <View style={styles.workerHeader}>
        <View style={styles.workerLeft}>
          <View style={[styles.workerAvatar, { backgroundColor: bgColor }]}>
            <Text style={styles.workerAvatarText}>{worker.name.slice(0, 1)}</Text>
            <View style={[styles.workerStatusDot, { backgroundColor: accent }]} />
          </View>
          <View style={styles.workerInfo}>
            <Text numberOfLines={1} style={styles.workerName}>
              {worker.name}
            </Text>
            <Text ellipsizeMode="tail" numberOfLines={1} style={styles.workerTask}>
              {roleLabel(language, worker.role)} · {WORKER_LABELS[language].cliPrefix}{' '}
              {cliLabel(language, worker.preset)}
            </Text>
          </View>
        </View>
        <View style={styles.workerRight}>
          <StatusBadge status={worker.status} />
          <Ionicons
            color={colors.muted}
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={18}
          />
        </View>
      </View>

      {expanded ? (
        <View style={styles.expanded}>
          <View style={styles.workerMetaGrid}>
            <MetaChip label={t('common.role')} value={roleLabel(language, worker.role)} />
            <MetaChip label={t('common.status')} value={statusTextFor(worker, t)} />
          </View>
          <CapabilityChips capabilities={worker.capabilities} language={language} />
          <WorkerActions
            onDispatch={onDispatch}
            onRestart={onRestart}
            onStop={onStop}
            status={worker.status}
          />
          <Pressable
            accessibilityRole="button"
            onPress={(event) => {
              event.stopPropagation()
              onOpenDetail()
            }}
            style={styles.detailLink}
          >
            <Ionicons color={colors.accent} name="terminal-outline" size={15} />
            <Text style={styles.detailLinkText}>{t('status.openTerminal')}</Text>
            <Ionicons color={colors.accent} name="chevron-forward" size={14} />
          </Pressable>
        </View>
      ) : null}
    </Pressable>
  )
}

// Sentinel 哨兵卡片：哨兵只做巡检、不接派单，默认收起成普通 worker 同款 header；
// 展开后只给巡检说明、能力标签和终端入口。
const SentinelCard = ({
  expanded,
  onOpenDetail,
  onToggle,
  language,
  worker,
}: {
  expanded: boolean
  onOpenDetail: () => void
  onToggle: () => void
  language: AppLanguage
  worker: MobileDashboardWorker
}) => {
  const t = useT()
  const accent = statusColor(worker.status)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      onPress={onToggle}
      style={styles.sentinelCard}
    >
      <View style={styles.workerHeader}>
        <View style={styles.workerLeft}>
          <View style={styles.sentinelAvatar}>
            <Ionicons color={colors.accent} name="shield-checkmark-outline" size={18} />
            <View style={[styles.workerStatusDot, { backgroundColor: accent }]} />
          </View>
          <View style={styles.workerInfo}>
            <Text numberOfLines={1} style={styles.workerName}>
              {worker.name}
            </Text>
            <Text ellipsizeMode="tail" numberOfLines={1} style={styles.workerTask}>
              {roleLabel(language, worker.role)} · {WORKER_LABELS[language].cliPrefix}{' '}
              {cliLabel(language, worker.preset)}
            </Text>
          </View>
        </View>
        <View style={styles.workerRight}>
          <StatusBadge status={worker.status} />
          <Ionicons
            color={colors.muted}
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={18}
          />
        </View>
      </View>
      {expanded ? (
        <View style={styles.expanded}>
          <CapabilityChips capabilities={worker.capabilities} language={language} />
          <Text style={styles.sentinelNote}>{t('status.sentinelObservesOnly')}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={(event) => {
              event.stopPropagation()
              onOpenDetail()
            }}
            style={styles.detailLink}
          >
            <Ionicons color={colors.accent} name="terminal-outline" size={15} />
            <Text style={styles.detailLinkText}>{t('status.openTerminal')}</Text>
            <Ionicons color={colors.accent} name="chevron-forward" size={14} />
          </Pressable>
        </View>
      ) : null}
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

const CapabilityChips = ({
  capabilities,
  language,
}: {
  capabilities?: MobileDashboardWorker['capabilities']
  language: AppLanguage
}) => {
  if (!capabilities) return null
  const features = capabilities.features.slice(0, 4)
  const hiddenCount = capabilities.features.length - features.length
  const unattended = unattendedLabel(language, capabilities.unattended)
  const showMode = capabilities.mode && capabilities.mode !== 'unknown'
  const showRisk = capabilities.risk_tier && capabilities.risk_tier !== 'unknown'

  if (!features.length && !hiddenCount && !unattended && !showMode && !showRisk) return null

  return (
    <View style={styles.capabilityRow}>
      {showMode ? <CapabilityChip label={modeLabel(language, capabilities.mode)} /> : null}
      {showRisk ? (
        <CapabilityChip
          color={riskColor(capabilities.risk_tier)}
          label={riskLabel(language, capabilities.risk_tier)}
        />
      ) : null}
      {unattended ? <CapabilityChip color={colors.accent} label={unattended} /> : null}
      {features.map((feature) => (
        <CapabilityChip key={feature} label={featureLabel(language, feature)} />
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
  const t = useT()
  const isWorking = status === 'working'
  const isStopped = status === 'stopped'
  return (
    <View style={styles.quickActions}>
      {!isWorking && !isStopped ? (
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
}) => {
  const t = useT()
  return (
    <Modal animationType="fade" transparent visible={worker !== null}>
      <View style={styles.modalBackdrop}>
        <View style={styles.dispatchModal}>
          <Text style={styles.modalTitle}>
            {t('agent.dispatch.title', { name: worker?.name ?? t('common.worker') })}
          </Text>
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

const statusTextFor = (worker: MobileDashboardWorker, t: ReturnType<typeof useT>) => {
  if (worker.status === 'working') return t('status.workerState.working')
  if (worker.status === 'idle') return t('status.workerState.idle')
  if (worker.status === 'stopped') return t('status.workerState.stopped')
  return t('common.unknown')
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
  addWorkerBtn: {
    alignItems: 'center',
    backgroundColor: colors.accentSoft,
    borderRadius: 999,
    height: 30,
    justifyContent: 'center',
    width: 30,
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
  capabilityChip: {
    backgroundColor: 'rgba(255, 255, 255, 0.045)',
    borderColor: colors.borderMuted,
    borderRadius: 999,
    borderWidth: 1,
    maxWidth: 132,
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
  offlineActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  offlineBody: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
  },
  offlineCard: {
    backgroundColor: colors.card,
    borderColor: colors.borderMuted,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.md,
    marginBottom: spacing.sm,
    padding: spacing.md,
  },
  offlineDot: {
    backgroundColor: colors.error,
    borderRadius: 999,
    height: 8,
    width: 8,
  },
  offlineHeader: {
    gap: 10,
  },
  offlineHeaderRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'nowrap',
    gap: 6,
  },
  offlinePill: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: colors.cardElevated,
    borderColor: colors.borderMuted,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  offlinePillText: {
    color: colors.error,
    fontSize: 11,
    fontWeight: '800',
  },
  offlinePrimary: {
    alignItems: 'center',
    backgroundColor: colors.accent,
    borderRadius: radius.sm,
    flex: 1,
    justifyContent: 'center',
    minHeight: 40,
  },
  offlinePrimaryText: {
    color: colors.background,
    fontSize: 13,
    fontWeight: '800',
  },
  offlineSecondary: {
    alignItems: 'center',
    backgroundColor: colors.cardElevated,
    borderColor: colors.borderMuted,
    borderRadius: radius.sm,
    borderWidth: 1,
    flex: 1,
    justifyContent: 'center',
    minHeight: 40,
  },
  offlineSecondaryText: {
    color: colors.textSoft,
    fontSize: 13,
    fontWeight: '700',
  },
  offlineTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '800',
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
  headerStatus: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'nowrap',
    minWidth: 0,
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
  sectionHeaderRight: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
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
  sentinelAvatar: {
    alignItems: 'center',
    backgroundColor: colors.accentSoft,
    borderRadius: 999,
    height: 40,
    justifyContent: 'center',
    position: 'relative',
    width: 40,
  },
  sentinelCard: {
    backgroundColor: 'rgba(22, 27, 34, 0.9)',
    borderColor: colors.accent,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  sentinelLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  sentinelSection: {
    gap: spacing.xs,
  },
  sentinelNote: {
    color: colors.textSoft,
    fontSize: 12,
    lineHeight: 17,
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
    flexShrink: 1,
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
    // 状态徽章 + chevron 固定在右侧、永不被挤压；左侧文字区自行截断让出空间。
    flexShrink: 0,
    gap: 6,
    marginLeft: spacing.sm,
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
