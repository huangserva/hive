import { Ionicons } from '@expo/vector-icons'
import type { ComponentProps } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

import type { MobileCockpitData, MobileDashboard } from '../api/client'
import { useMobileRuntime } from '../api/mobile-runtime-context'
import { colors, radius, spacing } from '../theme'

type IconName = ComponentProps<typeof Ionicons>['name']

const PRIORITY_CONFIG = {
  high: { bg: colors.errorSoft, color: colors.error, label: 'High Priority' },
  low: { bg: 'rgba(139, 148, 158, 0.14)', color: colors.muted, label: 'Low' },
  medium: { bg: colors.warningSoft, color: colors.warning, label: 'Medium' },
}

const TYPE_ICON: Record<string, { color: string; icon: IconName }> = {
  audit: { color: colors.warning, icon: 'document-text-outline' },
  decision: { color: colors.accent, icon: 'git-branch-outline' },
  missing_impl_milestone: { color: colors.error, icon: 'alert-circle-outline' },
  playbook: { color: '#A064FF', icon: 'book-outline' },
  promote: { color: colors.success, icon: 'arrow-up-circle-outline' },
  question: { color: colors.warning, icon: 'help-circle-outline' },
}

const stripMarkdown = (text: string) => text.replace(/[*`#]/gu, '').trim()

type Feedback = {
  kind: 'error' | 'success'
  text: string
}

export function ActionsView({ dashboard: _dashboard }: { dashboard: MobileDashboard }) {
  const { getCockpit, sendPromptToOrchestrator } = useMobileRuntime()
  const [cockpit, setCockpit] = useState<MobileCockpitData | null>(null)
  const [loading, setLoading] = useState(true)
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => new Set())
  const [sendingId, setSendingId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showFeedback = useCallback((nextFeedback: Feedback) => {
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current)
    setFeedback(nextFeedback)
    feedbackTimerRef.current = setTimeout(() => {
      setFeedback(null)
      feedbackTimerRef.current = null
    }, 3000)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    const data = await getCockpit()
    setCockpit(data)
    setLoading(false)
  }, [getCockpit])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(
    () => () => {
      if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current)
    },
    []
  )

  const actions = (cockpit?.aiActions ?? []).filter((action) => !dismissedIds.has(action.id))
  const actionCount = actions.length

  const runAction = async (actionId: string, text: string) => {
    if (sendingId) return
    setSendingId(actionId)
    setFeedback(null)
    const ok = await sendPromptToOrchestrator(`Please execute this AI action: ${text}`)
    setSendingId(null)
    showFeedback({
      kind: ok ? 'success' : 'error',
      text: ok
        ? 'Sent to orchestrator — watch Chat for the result.'
        : 'Send failed, tap the action to retry.',
    })
  }

  const dismissAction = (actionId: string) => {
    setDismissedIds((current) => {
      const next = new Set(current)
      next.add(actionId)
      return next
    })
    showFeedback({
      kind: 'success',
      text: 'Dismissed locally.',
    })
  }

  if (loading) {
    return (
      <View style={s.loadingWrap}>
        <ActivityIndicator color={colors.accent} />
      </View>
    )
  }

  return (
    <ScrollView contentContainerStyle={s.container} showsVerticalScrollIndicator={false}>
      <View style={s.headerRow}>
        <Text style={s.sectionTitle}>AI Recommended Actions</Text>
        <View style={s.filterBtn}>
          <Ionicons color={colors.muted} name="filter-outline" size={14} />
          <Text style={s.filterText}>Filter</Text>
        </View>
      </View>
      <Text style={s.subtitle}>{actionCount} actions need your review</Text>

      {feedback ? <FeedbackBanner feedback={feedback} /> : null}

      {actions.map((action) => {
        const cfg = PRIORITY_CONFIG[action.priority] ?? PRIORITY_CONFIG.low
        const typeInfo = TYPE_ICON[action.type] ?? {
          color: colors.accent,
          icon: 'flash-outline' as IconName,
        }
        return (
          <View key={action.id} style={s.actionCard}>
            <View style={s.actionHeader}>
              <View style={[s.iconCircle, { backgroundColor: `${typeInfo.color}22` }]}>
                <Ionicons color={typeInfo.color} name={typeInfo.icon} size={18} />
              </View>
              <View style={[s.priorityBadge, { backgroundColor: cfg.bg }]}>
                <Text style={[s.priorityText, { color: cfg.color }]}>{cfg.label}</Text>
              </View>
            </View>
            <Text style={s.actionTitle}>{stripMarkdown(action.text)}</Text>
            <View style={s.actionFooter}>
              <Pressable onPress={() => dismissAction(action.id)}>
                <Text style={s.dismissText}>Dismiss</Text>
              </Pressable>
              <Pressable
                disabled={sendingId !== null}
                onPress={() => runAction(action.id, action.text)}
                style={[
                  s.actionBtn,
                  { backgroundColor: typeInfo.color },
                  sendingId === action.id && s.actionBtnDisabled,
                ]}
              >
                <Text style={s.actionBtnText}>
                  {sendingId === action.id ? 'Sending...' : stripMarkdown(action.action)}
                </Text>
              </Pressable>
            </View>
          </View>
        )
      })}

      {actions.length === 0 && (
        <View style={s.emptyCard}>
          <Ionicons color={colors.success} name="checkmark-circle" size={32} />
          <Text style={s.emptyText}>No actions pending</Text>
        </View>
      )}
    </ScrollView>
  )
}

const FeedbackBanner = ({ feedback }: { feedback: Feedback }) => {
  const isSuccess = feedback.kind === 'success'
  return (
    <View
      style={[
        s.feedbackBanner,
        {
          backgroundColor: isSuccess ? colors.successSoft : colors.errorSoft,
          borderColor: isSuccess ? colors.success : colors.error,
        },
      ]}
    >
      <Ionicons
        color={isSuccess ? colors.success : colors.error}
        name={isSuccess ? 'checkmark-circle' : 'alert-circle'}
        size={16}
      />
      <Text style={[s.feedbackText, { color: isSuccess ? colors.success : colors.error }]}>
        {feedback.text}
      </Text>
    </View>
  )
}

const s = StyleSheet.create({
  actionBtn: { borderRadius: radius.sm, paddingHorizontal: 14, paddingVertical: 8 },
  actionBtnDisabled: { opacity: 0.5 },
  actionBtnText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  actionCard: {
    backgroundColor: colors.card,
    borderColor: colors.borderMuted,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: 8,
    padding: spacing.md,
  },
  actionFooter: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  actionHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  actionTitle: { color: colors.text, fontSize: 14, fontWeight: '700' },
  container: { gap: spacing.sm, paddingBottom: 40 },
  dismissText: { color: colors.muted, fontSize: 13, fontWeight: '700' },
  emptyCard: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.borderMuted,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: 8,
    padding: spacing.lg,
  },
  emptyText: { color: colors.muted, fontSize: 14 },
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
  feedbackBanner: {
    alignItems: 'center',
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  feedbackText: { flex: 1, fontSize: 12, fontWeight: '800' },
  headerRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  iconCircle: {
    alignItems: 'center',
    borderRadius: 14,
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  loadingWrap: { alignItems: 'center', flex: 1, justifyContent: 'center', paddingTop: 60 },
  priorityBadge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  priorityText: { fontSize: 11, fontWeight: '800' },
  sectionTitle: { color: colors.text, fontSize: 17, fontWeight: '800' },
  subtitle: { color: colors.muted, fontSize: 13 },
})
