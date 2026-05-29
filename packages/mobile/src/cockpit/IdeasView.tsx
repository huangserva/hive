import { Ionicons } from '@expo/vector-icons'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

import type { MobileCockpitData } from '../api/client'
import { useMobileRuntime } from '../api/mobile-runtime-context'
import { colors, radius, spacing } from '../theme'

const stripMarkdown = (text: string) => text.replace(/[*`#]/gu, '').trim()

type Feedback = {
  kind: 'error' | 'success'
  text: string
}

export function IdeasView() {
  const { getCockpit, sendPromptToOrchestrator } = useMobileRuntime()
  const [cockpit, setCockpit] = useState<MobileCockpitData | null>(null)
  const [loading, setLoading] = useState(true)
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
        text: 'Sent to orchestrator — watch Chat for the result.',
      })
    } else {
      showFeedback({
        kind: 'error',
        text: 'Send failed, tap Promote to retry.',
      })
    }
    setPromotingId(null)
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
      <Text style={s.sectionTitle}>Idea Inbox</Text>

      {feedback ? <FeedbackBanner feedback={feedback} /> : null}

      {inbox.length === 0 && (
        <View style={s.emptyCard}>
          <Ionicons color={colors.muted} name="bulb-outline" size={28} />
          <Text style={s.emptyText}>No ideas yet</Text>
        </View>
      )}

      {inbox.map((idea, idx) => (
        <View key={idea.id} style={s.ideaCard}>
          <View style={s.ideaHeader}>
            <View style={s.ideaLeft}>
              <Text style={s.ideaNum}>#{idx + 1}</Text>
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
                  ? 'Sent'
                  : promotingId === idea.id
                    ? 'Promoting...'
                    : 'Promote'}
              </Text>
            </Pressable>
          </View>
        </View>
      ))}

      {promoted.length > 0 && (
        <>
          <Text style={s.promotedTitle}>Promoted Ideas</Text>
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
  container: { gap: spacing.sm, paddingBottom: 40 },
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
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: 8,
    padding: spacing.md,
  },
  ideaDate: { color: colors.muted2, fontSize: 11 },
  ideaFooter: { alignItems: 'center', flexDirection: 'row', justifyContent: 'flex-end' },
  ideaHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  ideaLeft: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  ideaNum: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  ideaTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
  loadingWrap: { alignItems: 'center', flex: 1, justifyContent: 'center', paddingTop: 60 },
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
  promotedName: { color: colors.text, fontSize: 14, fontWeight: '700' },
  promotedTitle: { color: colors.text, fontSize: 16, fontWeight: '800', marginTop: spacing.xs },
  sectionTitle: { color: colors.text, fontSize: 17, fontWeight: '800' },
})
