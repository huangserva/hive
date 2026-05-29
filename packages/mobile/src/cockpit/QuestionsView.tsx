import { Ionicons } from '@expo/vector-icons'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'

import type { MobileCockpitData, MobileDashboard } from '../api/client'
import { useMobileRuntime } from '../api/mobile-runtime-context'
import { colors, radius, spacing } from '../theme'

const PRIORITY_CONFIG = {
  high: { bg: colors.errorSoft, color: colors.error, label: 'High' },
  low: { bg: 'rgba(139, 148, 158, 0.14)', color: colors.muted, label: 'Low' },
  medium: { bg: colors.warningSoft, color: colors.warning, label: 'Medium' },
}

type Feedback = {
  kind: 'error' | 'success'
  text: string
}

export function QuestionsView({ dashboard: _dashboard }: { dashboard: MobileDashboard }) {
  const { answerQuestion, getCockpit } = useMobileRuntime()
  const [cockpit, setCockpit] = useState<MobileCockpitData | null>(null)
  const [loading, setLoading] = useState(true)
  const [answerText, setAnswerText] = useState('')
  const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(null)
  const [showAnswered, setShowAnswered] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const inputRef = useRef<TextInput>(null)
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

  const questions = [
    ...(cockpit?.questions.high ?? []),
    ...(cockpit?.questions.medium ?? []),
    ...(cockpit?.questions.low ?? []),
  ]
  const answered = cockpit?.questions.answered ?? []
  const selectedQuestion = questions.find((q) => q.id === selectedQuestionId) ?? null

  const selectQuestion = (questionId: string) => {
    setSelectedQuestionId(questionId)
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  const submitAnswer = async () => {
    const answer = answerText.trim()
    if (!selectedQuestion || !answer || submitting) return
    setSubmitting(true)
    const ok = await answerQuestion(selectedQuestion.id, answer)
    if (ok) {
      setAnswerText('')
      setSelectedQuestionId(null)
      showFeedback({
        kind: 'success',
        text: 'Answer sent — the orchestrator will handle it; watch Chat.',
      })
      await load()
    } else {
      showFeedback({
        kind: 'error',
        text: 'Send failed, tap Submit Answer to retry.',
      })
    }
    setSubmitting(false)
  }

  if (loading) {
    return (
      <View style={s.loadingWrap}>
        <ActivityIndicator color={colors.accent} />
      </View>
    )
  }

  if (questions.length === 0 && answered.length === 0) {
    return (
      <View style={s.emptyWrap}>
        <Ionicons color={colors.success} name="checkmark-circle" size={40} />
        <Text style={s.emptyText}>No open questions</Text>
      </View>
    )
  }

  return (
    <ScrollView contentContainerStyle={s.container} showsVerticalScrollIndicator={false}>
      <View style={s.headerRow}>
        <Text style={s.sectionTitle}>Open Questions</Text>
        <Text style={s.sortHint}>Sorted by priority</Text>
      </View>

      {feedback ? <FeedbackBanner feedback={feedback} /> : null}

      {questions.map((q) => {
        const cfg = PRIORITY_CONFIG[q.priority]
        return (
          <View key={q.id} style={[s.qCard, selectedQuestionId === q.id && s.qCardSelected]}>
            <View style={s.qHeader}>
              <View style={[s.priorityBadge, { backgroundColor: cfg.bg }]}>
                <Text style={[s.priorityText, { color: cfg.color }]}>{cfg.label}</Text>
              </View>
            </View>
            <Text style={s.qTitle}>{q.text}</Text>
            <View style={s.qFooter}>
              <Pressable onPress={() => selectQuestion(q.id)} style={s.answerBtn}>
                <Text style={s.answerBtnText}>Answer</Text>
              </Pressable>
            </View>
          </View>
        )
      })}

      <View style={s.inputCard}>
        <Text style={s.inputLabel}>
          {selectedQuestion ? `Your Answer · ${selectedQuestion.id}` : 'Your Answer'}
        </Text>
        <TextInput
          ref={inputRef}
          multiline
          onChangeText={setAnswerText}
          placeholder={selectedQuestion ? 'Type your answer...' : 'Select a question first'}
          placeholderTextColor={colors.muted2}
          style={s.textInput}
          value={answerText}
        />
        <Pressable
          disabled={!selectedQuestion || !answerText.trim() || submitting}
          onPress={submitAnswer}
          style={[
            s.submitBtn,
            (!selectedQuestion || !answerText.trim() || submitting) && s.submitDisabled,
          ]}
        >
          <Text style={s.submitText}>{submitting ? 'Submitting...' : 'Submit Answer'}</Text>
        </Pressable>
      </View>

      <Pressable onPress={() => setShowAnswered(!showAnswered)} style={s.toggleRow}>
        <Text style={s.toggleText}>Answered ({answered.length})</Text>
        <Ionicons
          color={colors.muted}
          name={showAnswered ? 'chevron-up' : 'chevron-down'}
          size={14}
        />
      </Pressable>

      {showAnswered &&
        answered.map((q) => (
          <View key={q.id} style={s.qCard}>
            <Text style={s.qTitle}>{q.text}</Text>
            {q.answer ? <Text style={s.answerPreview}>{q.answer}</Text> : null}
          </View>
        ))}
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
  answerBtn: {
    backgroundColor: colors.accentSoft,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  answerBtnText: { color: colors.accent, fontSize: 12, fontWeight: '800' },
  answerPreview: { color: colors.success, fontSize: 13, fontStyle: 'italic' },
  container: { gap: spacing.sm, paddingBottom: 40 },
  emptyText: { color: colors.muted, fontSize: 15, marginTop: 8 },
  emptyWrap: { alignItems: 'center', flex: 1, justifyContent: 'center', paddingTop: 60 },
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
  inputCard: {
    backgroundColor: colors.card,
    borderColor: colors.borderMuted,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.xs,
    padding: spacing.md,
  },
  inputLabel: { color: colors.text, fontSize: 14, fontWeight: '800' },
  loadingWrap: { alignItems: 'center', flex: 1, justifyContent: 'center', paddingTop: 60 },
  priorityBadge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  priorityText: { fontSize: 11, fontWeight: '800' },
  qCard: {
    backgroundColor: colors.card,
    borderColor: colors.borderMuted,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: 8,
    padding: spacing.md,
  },
  qCardSelected: { borderColor: colors.accent },
  qFooter: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'flex-end',
  },
  qHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  qTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
  sectionTitle: { color: colors.text, fontSize: 17, fontWeight: '800' },
  sortHint: { color: colors.muted, fontSize: 12 },
  submitBtn: {
    alignItems: 'center',
    backgroundColor: colors.success,
    borderRadius: radius.sm,
    paddingVertical: 10,
  },
  submitDisabled: { opacity: 0.4 },
  submitText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  textInput: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderColor: colors.borderMuted,
    borderRadius: radius.sm,
    borderWidth: 1,
    color: colors.text,
    fontSize: 14,
    minHeight: 80,
    padding: spacing.sm,
    textAlignVertical: 'top',
  },
  toggleRow: { alignItems: 'center', flexDirection: 'row', gap: 4 },
  toggleText: { color: colors.muted, fontSize: 13, fontWeight: '700' },
})
