import { Ionicons } from '@expo/vector-icons'
import type { ComponentProps } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

import type { MobileCockpitData, MobileCockpitMilestone, MobileDashboard } from '../api/client'
import { useMobileRuntime } from '../api/mobile-runtime-context'
import { type TFunction, useT } from '../i18n'
import { colors, spacing } from '../theme'

type IconName = ComponentProps<typeof Ionicons>['name']
type MilestoneStatus = MobileCockpitMilestone['status']

const STATUS_CONFIG: Record<
  MilestoneStatus,
  {
    badgeBg: string
    color: string
    icon: IconName
    labelKey: Parameters<TFunction>[0]
    ringBg: string
  }
> = {
  blocked: {
    badgeBg: colors.errorSoft,
    color: colors.error,
    icon: 'ellipse-outline',
    labelKey: 'cockpit.plan.status.blocked',
    ringBg: 'rgba(248, 81, 73, 0.1)',
  },
  in_progress: {
    badgeBg: colors.warningSoft,
    color: colors.warning,
    icon: 'ellipse-outline',
    labelKey: 'cockpit.plan.status.inProgress',
    ringBg: 'rgba(210, 153, 34, 0.1)',
  },
  open: {
    badgeBg: colors.accentSoft,
    color: colors.accent,
    icon: 'ellipse-outline',
    labelKey: 'cockpit.plan.status.open',
    ringBg: 'rgba(88, 166, 255, 0.1)',
  },
  proposed: {
    badgeBg: 'rgba(139, 148, 158, 0.14)',
    color: colors.muted,
    icon: 'ellipse-outline',
    labelKey: 'cockpit.plan.status.proposed',
    ringBg: 'rgba(139, 148, 158, 0.1)',
  },
  shipped: {
    badgeBg: colors.successSoft,
    color: colors.success,
    icon: 'checkmark',
    labelKey: 'cockpit.plan.status.shipped',
    ringBg: 'rgba(63, 185, 80, 0.1)',
  },
}

export function PlanView({ dashboard: _dashboard }: { dashboard: MobileDashboard }) {
  const { getCockpit } = useMobileRuntime()
  const t = useT()
  const [cockpit, setCockpit] = useState<MobileCockpitData | null>(null)
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const data = await getCockpit()
    setCockpit(data)
    setLoading(false)
  }, [getCockpit])

  useEffect(() => {
    void load()
  }, [load])

  const milestones = cockpit?.plan.milestones ?? []
  const displayMilestones = [...milestones].reverse()
  const doneCount = milestones.reduce((t, m) => t + m.doneCount, 0)
  const totalCount = milestones.reduce((t, m) => t + m.totalCount, 0)
  const progress = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0
  const remainingCount = Math.max(0, totalCount - doneCount)

  if (loading) {
    return (
      <View style={styles.loadingWrap}>
        <ActivityIndicator color={colors.accent} />
      </View>
    )
  }

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      showsVerticalScrollIndicator={false}
      style={{ flex: 1 }}
    >
      <View style={styles.progressCard}>
        <View style={styles.progressHeader}>
          <Text style={styles.cardTitle}>{t('cockpit.plan.overall')}</Text>
          <Text style={styles.progressPercent}>{t('cockpit.plan.complete', { progress })}</Text>
        </View>
        <ProgressBar progress={progress} />
        <View style={styles.progressMetaRow}>
          <Text style={styles.progressMeta}>
            {t('cockpit.plan.tasksDone', { done: doneCount, total: totalCount })}
          </Text>
          <Text style={styles.progressMeta}>
            {t('cockpit.plan.remaining', { count: remainingCount })}
          </Text>
        </View>
      </View>

      <View style={styles.milestoneHeader}>
        <Text style={styles.milestonesTitle}>{t('cockpit.plan.milestones')}</Text>
        <View style={styles.milestoneCountWrap}>
          <Text style={styles.milestoneCount}>
            {t('cockpit.plan.count', { count: milestones.length })}
          </Text>
          <Ionicons color={colors.muted} name="swap-vertical-outline" size={22} />
        </View>
      </View>

      <View style={styles.timeline}>
        {displayMilestones.map((milestone, index) => (
          <MilestoneCard
            isExpanded={expandedId === milestone.id}
            isLast={index === displayMilestones.length - 1}
            key={milestone.id}
            milestone={milestone}
            ordinal={milestones.length - index}
            onPress={() => setExpandedId(expandedId === milestone.id ? '' : milestone.id)}
            t={t}
          />
        ))}
      </View>
    </ScrollView>
  )
}

const MilestoneCard = ({
  isExpanded,
  isLast,
  milestone,
  onPress,
  ordinal,
  t,
}: {
  isExpanded: boolean
  isLast: boolean
  milestone: MobileCockpitMilestone
  onPress: () => void
  ordinal: number
  t: TFunction
}) => {
  const status = STATUS_CONFIG[milestone.status] ?? STATUS_CONFIG.open
  const pct =
    milestone.totalCount > 0 ? Math.round((milestone.doneCount / milestone.totalCount) * 100) : 0
  const details = extractMilestoneDetails(milestone.body)

  return (
    <View style={styles.timelineRow}>
      <View style={styles.timelineRail}>
        <View
          style={[
            styles.statusCircle,
            { backgroundColor: status.ringBg, borderColor: status.color },
          ]}
        >
          {milestone.status === 'shipped' ? (
            <Ionicons color={status.color} name={status.icon} size={22} />
          ) : (
            <View style={[styles.statusDot, { backgroundColor: status.color }]} />
          )}
        </View>
        {isLast ? null : <View style={[styles.railLine, { backgroundColor: status.color }]} />}
      </View>
      <Pressable accessibilityRole="button" onPress={onPress} style={styles.milestoneCard}>
        <View style={styles.milestoneTopRow}>
          <View style={styles.milestoneCopy}>
            <Text numberOfLines={2} style={styles.milestoneTitle}>
              {ordinal}. {milestone.title}
            </Text>
            {milestone.date ? (
              <Text numberOfLines={1} style={styles.milestoneSubtitle}>
                {milestone.date}
              </Text>
            ) : details ? (
              <Text numberOfLines={1} style={styles.milestoneSubtitle}>
                {details}
              </Text>
            ) : null}
          </View>
          <View style={styles.statusSide}>
            <View style={[styles.statusBadge, { backgroundColor: status.badgeBg }]}>
              <Text style={[styles.statusBadgeText, { color: status.color }]}>
                {t(status.labelKey)}
              </Text>
            </View>
            <Ionicons
              color={colors.textSoft}
              name={isExpanded ? 'chevron-up' : 'chevron-down'}
              size={20}
            />
          </View>
        </View>
        {isExpanded ? (
          <View style={styles.expanded}>
            <View style={styles.taskProgressRow}>
              <Text style={styles.taskProgressText}>
                {t('cockpit.plan.tasksCompleted', {
                  done: milestone.doneCount,
                  total: milestone.totalCount,
                })}
              </Text>
              <Text style={styles.taskProgressPercent}>{pct}%</Text>
            </View>
            <ProgressBar progress={pct} />
            {milestone.items.map((item) => (
              <View key={item.text} style={styles.taskRow}>
                <View style={[styles.checkbox, item.done && styles.checkboxDone]}>
                  {item.done ? (
                    <Ionicons color={colors.background} name="checkmark" size={18} />
                  ) : null}
                </View>
                <Text style={styles.taskTitle}>{item.text}</Text>
              </View>
            ))}
            {details ? (
              <View style={styles.detailsBlock}>
                <Text style={styles.detailsTitle}>{t('cockpit.plan.details')}</Text>
                <Text numberOfLines={3} style={styles.detailsBody}>
                  {details}
                </Text>
              </View>
            ) : null}
            {milestone.date ? (
              <View style={styles.milestoneDateRow}>
                <Ionicons color={colors.muted} name="calendar-outline" size={18} />
                <Text style={styles.milestoneDateText}>{milestone.date}</Text>
              </View>
            ) : null}
          </View>
        ) : null}
      </Pressable>
    </View>
  )
}

const ProgressBar = ({ progress }: { progress: number }) => (
  <View style={styles.progressTrack}>
    <View style={[styles.progressFill, { width: `${Math.max(0, Math.min(progress, 100))}%` }]} />
  </View>
)

const extractMilestoneDetails = (body: string): string => {
  const lines = body
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) return false
      if (/^- \[[ xX]\]/u.test(line)) return false
      if (/^#{1,6}\s+/u.test(line)) return false
      if (/^[-*]\s+/u.test(line)) return false
      if (/^```/u.test(line)) return false
      return true
    })
    .map((line) =>
      line
        .replace(/\*\*(.+?)\*\*/gu, '$1')
        .replace(/`(.+?)`/gu, '$1')
        .replace(/\[(.+?)\]\(.+?\)/gu, '$1')
    )

  return lines.slice(0, 2).join(' ')
}

const styles = StyleSheet.create({
  cardTitle: { color: '#E6EDF3', fontSize: 15, fontWeight: '700' },
  checkbox: {
    alignItems: 'center',
    borderColor: colors.muted2,
    borderRadius: 6,
    borderWidth: 2,
    height: 26,
    justifyContent: 'center',
    width: 26,
  },
  checkboxDone: { backgroundColor: colors.accent, borderColor: colors.accent },
  container: { gap: 14, paddingBottom: 34 },
  detailsBlock: { gap: spacing.xs, paddingTop: spacing.md },
  detailsBody: { color: colors.textSoft, fontSize: 13, lineHeight: 18 },
  detailsTitle: { color: '#E6EDF3', fontSize: 13, fontWeight: '700' },
  expanded: { gap: spacing.sm, paddingTop: spacing.lg },
  loadingWrap: { alignItems: 'center', flex: 1, justifyContent: 'center', paddingTop: 60 },
  milestoneDateRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    paddingTop: spacing.md,
  },
  milestoneDateText: { color: colors.muted, fontSize: 12 },
  milestoneCard: {
    backgroundColor: '#161B22',
    borderColor: 'rgba(139, 148, 158, 0.2)',
    borderRadius: 14,
    borderWidth: 1,
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  milestoneCopy: { flex: 1, gap: 2, minWidth: 0 },
  milestoneCount: { color: colors.muted, fontSize: 12 },
  milestoneCountWrap: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  milestoneHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  milestoneSubtitle: { color: colors.muted, fontSize: 12, lineHeight: 16 },
  milestoneTitle: { color: '#E6EDF3', fontSize: 13, fontWeight: '700', lineHeight: 18 },
  milestoneTopRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  milestonesTitle: { color: '#E6EDF3', fontSize: 16, fontWeight: '700' },
  progressCard: {
    backgroundColor: '#161B22',
    borderColor: 'rgba(139, 148, 158, 0.2)',
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
  },
  progressFill: { backgroundColor: colors.accent, borderRadius: 999, height: '100%' },
  progressHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  progressMeta: { color: colors.muted, fontSize: 13 },
  progressMetaRow: { flexDirection: 'row', gap: 16, justifyContent: 'space-between', marginTop: 4 },
  progressPercent: { color: colors.accent, fontSize: 14, fontWeight: '700' },
  progressTrack: {
    backgroundColor: 'rgba(139, 148, 158, 0.18)',
    borderRadius: 999,
    height: 8,
    marginBottom: 18,
    marginTop: 14,
    overflow: 'hidden',
  },
  railLine: { backgroundColor: 'rgba(139, 148, 158, 0.22)', flex: 1, marginTop: 6, width: 3 },
  statusBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  statusBadgeText: { fontSize: 11, fontWeight: '600' },
  statusCircle: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 3,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  statusDot: { borderRadius: 999, height: 14, width: 14 },
  statusSide: { alignItems: 'center', flexDirection: 'row', flexShrink: 0, gap: 8 },
  taskProgressPercent: { color: colors.textSoft, fontSize: 13, fontWeight: '700' },
  taskProgressRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  taskProgressText: { color: colors.textSoft, fontSize: 13 },
  taskRow: {
    alignItems: 'center',
    borderBottomColor: colors.borderMuted,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 56,
    paddingVertical: spacing.sm,
  },
  taskTitle: { color: colors.textSoft, flex: 1, fontSize: 14, lineHeight: 20 },
  timeline: { gap: spacing.sm },
  timelineRail: { alignItems: 'center', width: 66 },
  timelineRow: { alignItems: 'stretch', flexDirection: 'row' },
})
