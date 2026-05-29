import { Ionicons } from '@expo/vector-icons'
import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { useMobileRuntime } from '../../src/api/mobile-runtime-context'
import { ActionsView } from '../../src/cockpit/ActionsView'
import { IdeasView } from '../../src/cockpit/IdeasView'
import { PlanView } from '../../src/cockpit/PlanView'
import { QuestionsView } from '../../src/cockpit/QuestionsView'
import { TasksView } from '../../src/cockpit/TasksView'
import { Screen } from '../../src/components/Screen'
import { colors, spacing } from '../../src/theme'

type CockpitTab = 'plan' | 'tasks' | 'questions' | 'ideas' | 'actions'

const TABS: { key: CockpitTab; label: string }[] = [
  { key: 'plan', label: 'Plan' },
  { key: 'tasks', label: 'Tasks' },
  { key: 'questions', label: 'Questions' },
  { key: 'ideas', label: 'Ideas' },
  { key: 'actions', label: 'Actions' },
]

export default function CockpitTab() {
  const { dashboard, state } = useMobileRuntime()
  const [activeTab, setActiveTab] = useState<CockpitTab>('plan')
  const activeLabel = TABS.find((tab) => tab.key === activeTab)?.label ?? 'Plan'

  if (!dashboard) {
    return (
      <Screen>
        <Text style={styles.title}>Cockpit</Text>
        <Text style={styles.hint}>Connect in Settings first. State: {state}</Text>
      </Screen>
    )
  }

  return (
    <Screen>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" style={styles.headerIconButton}>
          <Ionicons color={colors.text} name="menu-outline" size={27} />
        </Pressable>
        <View style={styles.headerCenter}>
          <View style={styles.titleRow}>
            <Text style={styles.title}>Cockpit</Text>
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
        <View style={styles.headerActions}>
          <Pressable accessibilityRole="button" style={styles.headerIconButton}>
            <Ionicons color={colors.text} name="filter-outline" size={23} />
          </Pressable>
          <Pressable accessibilityRole="button" style={styles.headerIconButton}>
            <Ionicons color={colors.text} name="ellipsis-horizontal" size={24} />
          </Pressable>
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
                {tab.label}
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
  headerActions: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  headerCenter: {
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
  },
  headerIconButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderColor: 'rgba(139, 148, 158, 0.2)',
    borderRadius: 999,
    borderWidth: 1,
    height: 44,
    justifyContent: 'center',
    width: 44,
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
