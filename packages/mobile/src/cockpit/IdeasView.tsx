import { Ionicons } from '@expo/vector-icons'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { useMobileRuntime } from '../api/mobile-runtime-context'
import { useT } from '../i18n'
import { colors, radius, spacing } from '../theme'
import { CockpitScroll } from './CockpitScroll'
import { useRefreshableData } from './useRefreshableCockpit'

const stripMarkdown = (text: string) => text.replace(/[*`#]/gu, '').trim()

type Feedback = {
  kind: 'error' | 'success'
  text: string
}

export function IdeasView() {
  const { getCockpit, sendPromptToOrchestrator, state } = useMobileRuntime()
  const t = useT()
  const { data: cockpit, loading, refreshing, error, onRefresh } = useRefreshableData(getCockpit)
  const [promotingId, setPromotingId] = useState<string | null>(null)
  const [promotedId, setPromotedId] = useState<string | null>(null)
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

  const inbox = cockpit?.ideas.inbox ?? []
  const promoted = cockpit?.ideas.promoted ?? []

  const promoteIdea = async (ideaId: string, text: string) => {
    if (promotingId) return
    setPromotingId(ideaId)
    setFeedback(null)
    const ok = await sendPromptToOrchestrator(`Please promote this idea into a milestone: ${text}`)
    if (ok) {
      setPromotedId(ideaId)
      showFeedback({
        kind: 'success',
        text: t('cockpit.ideas.sent'),
      })
    } else if (state !== 'connected') {
      showFeedback({
        kind: 'success',
        text: t('outbox.queued'),
      })
    } else {
      showFeedback({
        kind: 'error',
        text: t('cockpit.ideas.failed'),
      })
    }
    setPromotingId(null)
  }

  return (
    <CockpitScroll
      contentContainerStyle={s.container}
      error={error}
      loading={loading}
      onRefresh={onRefresh}
      refreshing={refreshing}
    >
      <Text style={s.sectionTitle}>{t('cockpit.ideas.inbox')}</Text>

      {feedback ? <FeedbackBanner feedback={feedback} /> : null}

      {inbox.length === 0 && (
        <View style={s.emptyCard}>
          <Ionicons color={colors.muted} name="bulb-outline" size={28} />
          <Text style={s.emptyText}>{t('cockpit.ideas.empty')}</Text>
        </View>
      )}

      {inbox.map((idea) => (
        <View key={idea.id} style={s.ideaCard}>
          <View style={s.ideaHeader}>
            <View style={s.ideaLeft}>
              <Text style={s.ideaNum}>{idea.id}</Text>
              <Ionicons color="#A064FF" name="bulb-outline" size={18} />
            </View>
            {idea.addedAt ? <Text style={s.ideaDate}>{idea.addedAt}</Text> : null}
          </View>
          <Text style={s.ideaTitle}>{stripMarkdown(idea.text)}</Text>
          <View style={s.ideaFooter}>
            <Pressable
              disabled={promotingId !== null}
              onPress={() => promoteIdea(idea.id, idea.text)}
              style={[s.promoteBtn, promotingId === idea.id && s.promoteBtnDisabled]}
            >
              <Text style={s.promoteBtnText}>
                {promotedId === idea.id
                  ? t('cockpit.ideas.promotedState')
                  : promotingId === idea.id
                    ? t('cockpit.ideas.promoting')
                    : t('cockpit.ideas.promote')}
              </Text>
            </Pressable>
          </View>
        </View>
      ))}

      {promoted.length > 0 && (
        <>
          <Text style={s.promotedTitle}>{t('cockpit.ideas.promoted')}</Text>
          {promoted.map((idea) => (
            <View key={idea.id} style={s.promotedCard}>
              <Ionicons color={colors.success} name="checkmark-circle" size={18} />
              <View style={s.promotedInfo}>
                <Text style={s.promotedName}>{stripMarkdown(idea.text)}</Text>
              </View>
            </View>
          ))}
        </>
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
  container: { gap: spacing.xs, paddingBottom: 40 },
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
  ideaCard: {
    backgroundColor: colors.card,
    borderColor: colors.borderMuted,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: 6,
    padding: spacing.sm,
  },
  ideaDate: { color: colors.muted2, fontSize: 11 },
  ideaFooter: { alignItems: 'center', flexDirection: 'row', justifyContent: 'flex-end' },
  ideaHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  ideaLeft: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  ideaNum: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  ideaTitle: { color: colors.text, fontSize: 14, fontWeight: '700', lineHeight: 20 },
  promoteBtn: {
    backgroundColor: 'rgba(160,100,255,0.14)',
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  promoteBtnDisabled: { opacity: 0.5 },
  promoteBtnText: { color: '#A064FF', fontSize: 12, fontWeight: '800' },
  promotedCard: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.borderMuted,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.sm,
  },
  promotedInfo: { flex: 1, gap: 2 },
  promotedName: { color: colors.text, fontSize: 13, fontWeight: '700', lineHeight: 18 },
  promotedTitle: { color: colors.text, fontSize: 15, fontWeight: '800', marginTop: spacing.xs },
  sectionTitle: { color: colors.text, fontSize: 16, fontWeight: '800' },
})
