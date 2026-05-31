import { Ionicons } from '@expo/vector-icons'
import type { ComponentProps } from 'react'
import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import type { MobileCockpitMilestone, MobileDashboard } from '../api/client'
import { useMobileRuntime } from '../api/mobile-runtime-context'
import { type TFunction, useT } from '../i18n'
import { colors, spacing } from '../theme'
import { CockpitScroll } from './CockpitScroll'
import {
  extractPlanMilestoneDetails,
  type PlanMarkdownSegment,
  parsePlanMarkdownBlocks,
} from './plan-markdown'
import { sortPlanMilestonesForDisplay } from './plan-milestone-sort'
import { useRefreshableData } from './useRefreshableCockpit'

type IconName = ComponentProps<typeof Ionicons>['name']
type MilestoneStatus = MobileCockpitMilestone['status']

const TIMELINE_RAIL_WIDTH = 38
const STATUS_CIRCLE_SIZE = 26
const STATUS_ICON_SIZE = 14
const STATUS_DOT_SIZE = 8

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
  const { data: cockpit, loading, refreshing, error, onRefresh } = useRefreshableData(getCockpit)
  const [expandedId, setExpandedId] = useState('')

  const milestones = cockpit?.plan.milestones ?? []
  const displayMilestones = sortPlanMilestonesForDisplay(milestones)
  const doneCount = milestones.reduce((t, m) => t + m.doneCount, 0)
  const totalCount = milestones.reduce((t, m) => t + m.totalCount, 0)
  const progress = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0
  const remainingCount = Math.max(0, totalCount - doneCount)

  return (
    <CockpitScroll
      contentContainerStyle={styles.container}
      error={error}
      loading={loading}
      onRefresh={onRefresh}
      refreshing={refreshing}
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
            onPress={() => setExpandedId(expandedId === milestone.id ? '' : milestone.id)}
            t={t}
          />
        ))}
      </View>
    </CockpitScroll>
  )
}

const MilestoneCard = ({
  isExpanded,
  isLast,
  milestone,
  onPress,
  t,
}: {
  isExpanded: boolean
  isLast: boolean
  milestone: MobileCockpitMilestone
  onPress: () => void
  t: TFunction
}) => {
  const status = STATUS_CONFIG[milestone.status] ?? STATUS_CONFIG.open
  const pct =
    milestone.totalCount > 0 ? Math.round((milestone.doneCount / milestone.totalCount) * 100) : 0
  const details = extractPlanMilestoneDetails(milestone.body)

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
            <Ionicons color={status.color} name={status.icon} size={STATUS_ICON_SIZE} />
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
              {milestone.id ? `${milestone.id} · ` : ''}
              {milestone.title}
            </Text>
            {milestone.date ? (
              <Text numberOfLines={1} style={styles.milestoneSubtitle}>
                {milestone.date}
              </Text>
            ) : details.subtitle ? (
              <Text numberOfLines={1} style={styles.milestoneSubtitle}>
                {details.subtitle}
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
            {details.markdown ? (
              <View style={styles.detailsBlock}>
                <Text style={styles.detailsTitle}>{t('cockpit.plan.details')}</Text>
                <PlanMarkdownText text={details.markdown} />
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

const PlanMarkdownText = ({ text }: { text: string }) => {
  const blocks = parsePlanMarkdownBlocks(text)
  return (
    <View style={styles.markdownBlocks}>
      {blocks.map((block, index) => {
        const key = `${block.kind}-${index}`
        if (block.kind === 'quote') {
          return (
            <View key={key} style={styles.markdownQuote}>
              <Text style={styles.detailsBody}>{renderMarkdownSegments(block.segments)}</Text>
            </View>
          )
        }
        if (block.kind === 'listItem') {
          return (
            <View key={key} style={styles.markdownListItem}>
              <Text style={styles.markdownBullet}>{'\u2022'}</Text>
              <Text style={styles.detailsBody}>{renderMarkdownSegments(block.segments)}</Text>
            </View>
          )
        }
        return (
          <Text key={key} style={styles.detailsBody}>
            {renderMarkdownSegments(block.segments)}
          </Text>
        )
      })}
    </View>
  )
}

const renderMarkdownSegments = (segments: PlanMarkdownSegment[]) =>
  segments.map((segment, index) => {
    const key = `${segment.kind}-${index}-${segment.text}`
    if (segment.kind === 'bold') {
      return (
        <Text key={key} style={styles.markdownBold}>
          {segment.text}
        </Text>
      )
    }
    if (segment.kind === 'code') {
      return (
        <Text key={key} style={styles.markdownCode}>
          {segment.text}
        </Text>
      )
    }
    return segment.text
  })

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
  markdownBlocks: { gap: 6 },
  markdownBold: { color: colors.text, fontWeight: '800' },
  markdownBullet: { color: colors.accent, fontSize: 13, lineHeight: 18 },
  markdownCode: {
    backgroundColor: colors.cardElevated,
    borderColor: colors.borderMuted,
    borderRadius: 5,
    borderWidth: 1,
    color: colors.text,
    fontFamily: 'Courier',
    fontSize: 12,
  },
  markdownListItem: { alignItems: 'flex-start', flexDirection: 'row', gap: 8 },
  markdownQuote: {
    borderLeftColor: colors.accent,
    borderLeftWidth: 3,
    paddingLeft: spacing.sm,
  },
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
  railLine: { backgroundColor: 'rgba(139, 148, 158, 0.22)', flex: 1, marginTop: 5, width: 2 },
  statusBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  statusBadgeText: { fontSize: 11, fontWeight: '600' },
  statusCircle: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 2,
    height: STATUS_CIRCLE_SIZE,
    justifyContent: 'center',
    width: STATUS_CIRCLE_SIZE,
  },
  statusDot: { borderRadius: 999, height: STATUS_DOT_SIZE, width: STATUS_DOT_SIZE },
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
  timelineRail: { alignItems: 'center', width: TIMELINE_RAIL_WIDTH },
  timelineRow: { alignItems: 'stretch', flexDirection: 'row' },
})
