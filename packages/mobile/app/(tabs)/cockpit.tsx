import { Ionicons } from '@expo/vector-icons'
import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useLocalSearchParams } from 'expo-router'

import { useMobileRuntime } from '../../src/api/mobile-runtime-context'
import { ActionsView } from '../../src/cockpit/ActionsView'
import { IdeasView } from '../../src/cockpit/IdeasView'
import { PlanView } from '../../src/cockpit/PlanView'
import { QuestionsView } from '../../src/cockpit/QuestionsView'
import { TasksView } from '../../src/cockpit/TasksView'
import { Screen } from '../../src/components/Screen'
import { useT } from '../../src/i18n'
import { colors, spacing } from '../../src/theme'

type CockpitTab = 'plan' | 'tasks' | 'questions' | 'ideas' | 'actions'

const TABS: { key: CockpitTab; labelKey: Parameters<ReturnType<typeof useT>>[0] }[] = [
  { key: 'plan', labelKey: 'cockpit.tab.plan' },
  { key: 'tasks', labelKey: 'cockpit.tab.tasks' },
  { key: 'questions', labelKey: 'cockpit.tab.questions' },
  { key: 'ideas', labelKey: 'cockpit.tab.ideas' },
  { key: 'actions', labelKey: 'cockpit.tab.actions' },
]

const parseCockpitTab = (value?: string | string[]) => {
  const candidate = Array.isArray(value) ? value[0] : value
  return TABS.some((tab) => tab.key === candidate) ? (candidate as CockpitTab) : 'plan'
}

export default function CockpitTab() {
  const { dashboard, state } = useMobileRuntime()
  const t = useT()
  const params = useLocalSearchParams<{ tab?: string | string[] }>()
  const [activeTab, setActiveTab] = useState<CockpitTab>(() => parseCockpitTab(params.tab))
  const activeLabel = t(TABS.find((tab) => tab.key === activeTab)?.labelKey ?? 'cockpit.tab.plan')

  useEffect(() => {
    setActiveTab(parseCockpitTab(params.tab))
  }, [params.tab])

  if (!dashboard) {
    return (
      <Screen>
        <Text style={styles.title}>{t('tabs.cockpit')}</Text>
        <Text style={styles.hint}>{t('cockpit.connectFirst', { state })}</Text>
      </Screen>
    )
  }

  return (
    <Screen>
      <View style={styles.header}>
        <View style={styles.headerCenter}>
          <View style={styles.titleRow}>
            <Text style={styles.title}>{t('tabs.cockpit')}</Text>
            <Text style={styles.titleDivider}>/</Text>
            <Text style={styles.titleActive}>{activeLabel}</Text>
            <Ionicons color={colors.accent} name="chevron-down" size={19} />
          </View>
          <View style={styles.subtitleRow}>
            <Text numberOfLines={1} style={styles.subtitle}>
              {dashboard.workspace.name}
            </Text>
            <Ionicons color={colors.muted} name="open-outline" size={15} />
          </View>
        </View>
      </View>

      <View style={styles.tabBar}>
        {TABS.map((tab) => {
          const isActive = activeTab === tab.key
          return (
            <Pressable
              accessibilityRole="button"
              key={tab.key}
              onPress={() => setActiveTab(tab.key)}
              style={[styles.tab, isActive && styles.tabActive]}
            >
              <Text numberOfLines={1} style={[styles.tabText, isActive && styles.tabTextActive]}>
                {t(tab.labelKey)}
              </Text>
            </Pressable>
          )
        })}
      </View>

      {activeTab === 'plan' && <PlanView dashboard={dashboard} />}
      {activeTab === 'tasks' && <TasksView dashboard={dashboard} />}
      {activeTab === 'questions' && <QuestionsView dashboard={dashboard} />}
      {activeTab === 'ideas' && <IdeasView />}
      {activeTab === 'actions' && <ActionsView dashboard={dashboard} />}
    </Screen>
  )
}

const styles = StyleSheet.create({
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
    paddingBottom: spacing.md,
    paddingTop: 2,
  },
  headerCenter: {
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
  },
  hint: {
    color: colors.muted,
    fontSize: 14,
    marginTop: spacing.sm,
  },
  subtitle: {
    color: colors.muted,
    flexShrink: 1,
    fontSize: 13,
    fontWeight: '500',
  },
  subtitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
    marginTop: 2,
    maxWidth: 220,
  },
  tab: {
    alignItems: 'center',
    borderRadius: 14,
    flex: 1,
    justifyContent: 'center',
    minHeight: 36,
    minWidth: 0,
    paddingHorizontal: 2,
    paddingVertical: 8,
  },
  tabActive: {
    backgroundColor: colors.accent,
  },
  tabBar: {
    flexDirection: 'row',
    gap: 4,
    height: 40,
    marginBottom: spacing.sm,
  },
  tabText: {
    color: colors.textSoft,
    fontSize: 12,
    fontWeight: '600',
  },
  tabTextActive: {
    color: colors.text,
  },
  title: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
  },
  titleActive: {
    color: colors.accent,
    fontSize: 18,
    fontWeight: '700',
  },
  titleDivider: {
    color: colors.muted,
    fontSize: 16,
    fontWeight: '500',
  },
  titleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
})
