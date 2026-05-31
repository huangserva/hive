import { Ionicons } from '@expo/vector-icons'
import type { ComponentProps } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import type { MobileDashboard } from '../api/client'
import { useMobileRuntime } from '../api/mobile-runtime-context'
import { useT } from '../i18n'
import { colors, radius, spacing } from '../theme'
import { CockpitScroll } from './CockpitScroll'
import { useRefreshableData } from './useRefreshableCockpit'

type IconName = ComponentProps<typeof Ionicons>['name']

const PRIORITY_CONFIG = {
  high: { bg: colors.errorSoft, color: colors.error },
  low: { bg: 'rgba(139, 148, 158, 0.14)', color: colors.muted },
  medium: { bg: colors.warningSoft, color: colors.warning },
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
  const { getCockpit, sendPromptToOrchestrator, state } = useMobileRuntime()
  const t = useT()
  const { data: cockpit, loading, refreshing, error, onRefresh } = useRefreshableData(getCockpit)
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

  useEffect(
    () => () => {
      if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current)
    },
    []
  )

  // 与 web ActionBar 一致：最多展示前 10 条（slice(0,10)），避免手机上长列表跟 PC 数量不一致。
  const actions = (cockpit?.aiActions ?? [])
    .filter((action) => !dismissedIds.has(action.id))
    .slice(0, 10)
  const actionCount = actions.length

  const runAction = async (actionId: string, text: string) => {
    if (sendingId) return
    setSendingId(actionId)
    setFeedback(null)
    const ok = await sendPromptToOrchestrator(`Please execute this AI action: ${text}`)
    setSendingId(null)
    showFeedback({
      kind: ok || state !== 'connected' ? 'success' : 'error',
      text:
        ok || state !== 'connected'
          ? ok
            ? t('cockpit.actions.sent')
            : t('outbox.queued')
          : t('cockpit.actions.failed'),
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
      text: t('cockpit.actions.dismissed'),
    })
  }

  return (
    <CockpitScroll
      contentContainerStyle={s.container}
      error={error}
      loading={loading}
      onRefresh={onRefresh}
      refreshing={refreshing}
    >
      <View style={s.headerRow}>
        <Text style={s.sectionTitle}>{t('cockpit.actions.title')}</Text>
      </View>
      <Text style={s.subtitle}>{t('cockpit.actions.count', { count: actionCount })}</Text>

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
                <Text style={[s.priorityText, { color: cfg.color }]}>
                  {t(
                    action.priority === 'high'
                      ? 'cockpit.priority.highLong'
                      : action.priority === 'medium'
                        ? 'cockpit.priority.medium'
                        : 'cockpit.priority.low'
                  )}
                </Text>
              </View>
            </View>
            <Text style={s.actionTitle}>{stripMarkdown(action.text)}</Text>
            <View style={s.actionFooter}>
              <Pressable onPress={() => dismissAction(action.id)}>
                <Text style={s.dismissText}>{t('cockpit.actions.dismiss')}</Text>
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
                  {sendingId === action.id
                    ? t('agent.dispatch.sending')
                    : stripMarkdown(action.action)}
                </Text>
              </Pressable>
            </View>
          </View>
        )
      })}

      {actions.length === 0 && (
        <View style={s.emptyCard}>
          <Ionicons color={colors.success} name="checkmark-circle" size={32} />
          <Text style={s.emptyText}>{t('cockpit.actions.empty')}</Text>
        </View>
      )}
    </CockpitScroll>
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
  actionBtn: { borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 7 },
  actionBtnDisabled: { opacity: 0.5 },
  actionBtnText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  actionCard: {
    backgroundColor: colors.card,
    borderColor: colors.borderMuted,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: 6,
    padding: spacing.sm,
  },
  actionFooter: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  actionHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  actionTitle: { color: colors.text, fontSize: 13, fontWeight: '700', lineHeight: 19 },
  container: { gap: spacing.xs, paddingBottom: 40 },
  dismissText: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  emptyCard: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.borderMuted,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: 6,
    padding: spacing.md,
  },
  emptyText: { color: colors.muted, fontSize: 13 },
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
  priorityBadge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  priorityText: { fontSize: 11, fontWeight: '800' },
  sectionTitle: { color: colors.text, fontSize: 16, fontWeight: '800' },
  subtitle: { color: colors.muted, fontSize: 12 },
})
