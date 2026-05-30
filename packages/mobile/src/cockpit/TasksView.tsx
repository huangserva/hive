import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native'

import type {
  MobileCockpitData,
  MobileCockpitTasks,
  MobileTaskItem,
  MobileTaskSection,
  MobileTaskSubsection,
} from '../api/client'
import { useMobileRuntime } from '../api/mobile-runtime-context'
import { useT } from '../i18n'
import { colors, radius, spacing } from '../theme'

const completionPercent = (done: number, open: number) => {
  const total = done + open
  return total === 0 ? 0 : Math.round((done / total) * 100)
}

// 内容对齐 web TasksTab：渲染 .hive/tasks.md 的 sprint 段（段标题 + done/total + [x]/[ ] 项 + 子段），
// 后端 cockpit endpoint 直接发 cockpit.tasks（与 web 同一 ParsedTasks）。不再渲染派单 ledger。
export function TasksView() {
  const { getCockpit, syncRevision } = useMobileRuntime()
  const t = useT()
  const [tasks, setTasks] = useState<MobileCockpitTasks | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    void syncRevision
    setLoading(true)
    const data: MobileCockpitData | null = await getCockpit()
    setTasks(data?.tasks ?? null)
    setLoading(false)
  }, [getCockpit, syncRevision])

  useEffect(() => {
    void load()
  }, [load])

  if (loading) {
    return (
      <View style={s.loadingWrap}>
        <ActivityIndicator color={colors.accent} />
      </View>
    )
  }

  const sections = tasks?.sections ?? []
  const totalDone = tasks?.totalDone ?? 0
  const totalOpen = tasks?.totalOpen ?? 0
  const overallPct = completionPercent(totalDone, totalOpen)

  return (
    <ScrollView contentContainerStyle={s.container} showsVerticalScrollIndicator={false}>
      <View style={s.overallCard}>
        <View style={s.overallHeader}>
          <Text style={s.overallTitle}>{t('cockpit.tasks.title')}</Text>
          <Text style={s.overallCount}>
            {totalDone}/{totalDone + totalOpen}
          </Text>
        </View>
        <ProgressBar percent={overallPct} />
      </View>

      {sections.length === 0 ? (
        <View style={s.emptyCard}>
          <Text style={s.emptyText}>{t('cockpit.tasks.empty')}</Text>
        </View>
      ) : (
        sections.map((section) => <SectionBlock key={section.title} section={section} t={t} />)
      )}
    </ScrollView>
  )
}

const SectionBlock = ({
  section,
  t,
}: {
  section: MobileTaskSection
  t: ReturnType<typeof useT>
}) => {
  const pct = completionPercent(section.doneCount, section.openCount)
  return (
    <View style={s.sectionCard}>
      <View style={s.sectionHeader}>
        <View style={s.sectionHeadCopy}>
          <Text style={s.sectionTitle}>{section.title}</Text>
          <Text style={s.sectionMeta}>
            {section.openCount} {t('cockpit.tasks.open')} · {section.doneCount}{' '}
            {t('cockpit.tasks.done')}
          </Text>
        </View>
        <Text style={s.sectionPct}>{pct}%</Text>
      </View>
      <ProgressBar percent={pct} />
      <View style={s.taskLines}>
        <TaskLines items={section.items} />
        {section.subsections.map((subsection) => (
          <SubsectionBlock key={subsection.title} subsection={subsection} />
        ))}
      </View>
    </View>
  )
}

const SubsectionBlock = ({ subsection }: { subsection: MobileTaskSubsection }) => (
  <View style={s.subCard}>
    <View style={s.subHeader}>
      <Text style={s.subTitle}>{subsection.title}</Text>
      <Text style={s.subCount}>
        {subsection.doneCount}/{subsection.totalCount}
      </Text>
    </View>
    <TaskLines items={subsection.items} />
  </View>
)

const TaskLines = ({ items }: { items: MobileTaskItem[] }) =>
  items.length === 0 ? null : (
    <View style={s.lineWrap}>
      {items.map((item) => (
        <View key={item.raw} style={s.taskLine}>
          <Text style={[s.checkMark, item.done ? s.checkMarkDone : s.checkMarkOpen]}>
            {item.done ? '[x]' : '[ ]'}
          </Text>
          <Text style={[s.taskText, item.done && s.taskTextDone]}>{item.text}</Text>
        </View>
      ))}
    </View>
  )

const ProgressBar = ({ percent }: { percent: number }) => (
  <View style={s.progressTrack}>
    <View style={[s.progressFill, { width: `${Math.max(0, Math.min(percent, 100))}%` }]} />
  </View>
)

const s = StyleSheet.create({
  checkMark: { fontSize: 13, fontWeight: '700' },
  checkMarkDone: { color: colors.accent },
  checkMarkOpen: { color: colors.muted },
  container: { gap: spacing.sm, paddingBottom: 40 },
  emptyCard: {
    backgroundColor: colors.card,
    borderColor: colors.borderMuted,
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.md,
  },
  emptyText: { color: colors.muted, fontSize: 13 },
  lineWrap: { gap: 6 },
  loadingWrap: { alignItems: 'center', flex: 1, justifyContent: 'center', paddingTop: 60 },
  overallCard: {
    backgroundColor: colors.cardElevated,
    borderColor: colors.borderMuted,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  overallCount: { color: colors.muted, fontSize: 13, fontWeight: '700' },
  overallHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  overallTitle: { color: colors.text, fontSize: 16, fontWeight: '800' },
  progressFill: { backgroundColor: colors.accent, borderRadius: 999, height: '100%' },
  progressTrack: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 999,
    height: 6,
    overflow: 'hidden',
  },
  sectionCard: {
    backgroundColor: colors.card,
    borderColor: colors.borderMuted,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.sm,
  },
  sectionHeadCopy: { flex: 1, gap: 2 },
  sectionHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  sectionMeta: { color: colors.muted, fontSize: 12 },
  sectionPct: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  sectionTitle: { color: colors.text, fontSize: 14, fontWeight: '700' },
  subCard: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderColor: colors.borderMuted,
    borderRadius: radius.sm,
    borderWidth: 1,
    gap: 6,
    padding: spacing.sm,
  },
  subCount: { color: colors.muted, fontSize: 11, fontWeight: '700' },
  subHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  subTitle: { color: colors.textSoft, fontSize: 13, fontWeight: '700' },
  taskLine: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.sm },
  taskLines: { gap: spacing.sm },
  taskText: { color: colors.textSoft, flex: 1, fontSize: 13, lineHeight: 19 },
  taskTextDone: { color: colors.muted, textDecorationLine: 'line-through' },
})
