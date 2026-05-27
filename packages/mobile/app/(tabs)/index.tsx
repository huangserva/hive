import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'

import type { ChatMessage } from '../../src/api/client'
import { useMobileRuntime } from '../../src/api/mobile-runtime-context'
import { Screen } from '../../src/components/Screen'
import { colors, radius, spacing } from '../../src/theme'

type OptimisticMessage = {
  id: string
  direction: 'outbound'
  message_type: 'user_text'
  content_json: string
  created_at: number
  pending?: boolean
  error?: boolean
}

type DisplayMessage = ChatMessage | OptimisticMessage

export default function ChatTab() {
  const {
    approveRequest,
    chatMessages,
    dashboard,
    error,
    fetchChatMessages,
    sendPromptToOrchestrator,
    state,
  } = useMobileRuntime()
  const router = useRouter()
  const [draft, setDraft] = useState('')
  const [optimistic, setOptimistic] = useState<OptimisticMessage[]>([])
  const [sending, setSending] = useState(false)
  const flatListRef = useRef<FlatList<DisplayMessage>>(null)
  const isConnected = state === 'connected' && Boolean(dashboard)

  const connectionLabel = useMemo(() => {
    if (state === 'checking') return 'Connecting'
    if (isConnected) return 'Connected'
    if (state === 'error') return 'Needs attention'
    return 'Not connected'
  }, [isConnected, state])

  const allMessages = useMemo<DisplayMessage[]>(() => {
    const serverIds = new Set(chatMessages.map((m) => m.id))
    const pending = optimistic.filter((m) => !serverIds.has(m.id))
    return [...chatMessages, ...pending].sort((a, b) => a.created_at - b.created_at)
  }, [chatMessages, optimistic])

  const sendMessage = useCallback(async () => {
    const body = draft.trim()
    if (!body || sending) return
    const msgId = `opt-${Date.now()}`
    const msg: OptimisticMessage = {
      id: msgId,
      direction: 'outbound',
      message_type: 'user_text',
      content_json: JSON.stringify({ text: body }),
      created_at: Date.now(),
      pending: true,
    }
    setOptimistic((prev) => [...prev, msg])
    setDraft('')
    setSending(true)
    const ok = await sendPromptToOrchestrator(body)
    if (!ok) {
      setOptimistic((prev) =>
        prev.map((m) => (m.id === msgId ? { ...m, error: true, pending: false } : m))
      )
    } else {
      setOptimistic((prev) => prev.map((m) => (m.id === msgId ? { ...m, pending: false } : m)))
      void fetchChatMessages()
    }
    setSending(false)
  }, [draft, sending, sendPromptToOrchestrator, fetchChatMessages])

  useEffect(() => {
    if (allMessages.length > 0) {
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100)
    }
  }, [allMessages.length])

  if (!isConnected) {
    return (
      <Screen>
        <View style={styles.emptyWrap}>
          <View style={styles.emptyIcon}>
            <Ionicons color={colors.accent} name="phone-portrait-outline" size={34} />
          </View>
          <Text style={styles.emptyTitle}>Connect your command center</Text>
          <Text style={styles.emptyBody}>
            Pair this phone with HippoTeam on your computer to see orchestrator updates, approvals,
            worker state, and quick replies here.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/settings')}
            style={styles.primaryButton}
          >
            <Text style={styles.primaryButtonText}>Open Settings</Text>
          </Pressable>
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          <Text style={styles.stateText}>State: {state}</Text>
        </View>
      </Screen>
    )
  }

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboard}
      >
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>HippoTeam</Text>
            <Text style={styles.title}>Chat</Text>
          </View>
          <View style={styles.connectionPill}>
            <View style={styles.liveDot} />
            <Text style={styles.connectionText}>{connectionLabel}</Text>
          </View>
        </View>

        <FlatList
          ref={flatListRef}
          data={allMessages}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.messages}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
          ListEmptyComponent={<EmptyChat />}
          renderItem={({ item }) => <MessageCard message={item} onApprove={approveRequest} />}
        />

        <View style={styles.composer}>
          <TextInput
            multiline
            onChangeText={setDraft}
            placeholder="Message orchestrator..."
            placeholderTextColor={colors.muted2}
            style={styles.input}
            value={draft}
          />
          {sending ? (
            <View style={styles.sendButton}>
              <ActivityIndicator color={colors.background} size="small" />
            </View>
          ) : (
            <Pressable
              accessibilityRole="button"
              disabled={!draft.trim()}
              onPress={sendMessage}
              style={[styles.sendButton, !draft.trim() ? styles.sendButtonDisabled : null]}
            >
              <Ionicons color={colors.background} name="arrow-up" size={18} />
            </Pressable>
          )}
        </View>
      </KeyboardAvoidingView>
    </Screen>
  )
}

const EmptyChat = () => (
  <View style={styles.hintCard}>
    <Ionicons color={colors.accent} name="chatbubble-ellipses-outline" size={20} />
    <Text style={styles.hintText}>Send a message to the Orchestrator to start a conversation.</Text>
  </View>
)

const parseContent = (json: string): string => {
  try {
    const parsed = JSON.parse(json) as { text?: string; summary?: string }
    return parsed.text ?? parsed.summary ?? JSON.stringify(parsed)
  } catch {
    return json
  }
}

const parseWorkerName = (json: string): string | null => {
  try {
    return (JSON.parse(json) as { worker?: string }).worker ?? null
  } catch {
    return null
  }
}

const parseApprovalId = (json: string): string | null => {
  try {
    return (JSON.parse(json) as { approval_id?: string }).approval_id ?? null
  } catch {
    return null
  }
}

type MessageCardProps = {
  message: DisplayMessage
  onApprove: (approvalId: string, decision: 'allow' | 'deny') => Promise<boolean>
}

const MessageCard = ({ message, onApprove }: MessageCardProps) => {
  const content = parseContent(message.content_json)
  const isPending = 'pending' in message && message.pending
  const isError = 'error' in message && message.error

  if (message.message_type === 'system_event') {
    return (
      <View style={styles.systemBubble}>
        <Ionicons color={colors.muted} name="information-circle-outline" size={14} />
        <Text style={styles.systemText}>{content}</Text>
      </View>
    )
  }

  if (message.direction === 'outbound') {
    return (
      <View style={styles.userBubble}>
        <Text style={styles.userBubbleText}>{content}</Text>
        <View style={styles.bubbleFooter}>
          {isPending ? (
            <ActivityIndicator color="rgba(13, 17, 23, 0.5)" size={10} />
          ) : isError ? (
            <Ionicons color={colors.error} name="alert-circle" size={12} />
          ) : (
            <Ionicons color="rgba(13, 17, 23, 0.5)" name="checkmark-done" size={12} />
          )}
        </View>
      </View>
    )
  }

  if (message.message_type === 'approval_request') {
    const approvalId = parseApprovalId(message.content_json)
    return (
      <View style={styles.approvalCard}>
        <View style={styles.approvalHeader}>
          <Ionicons color={colors.warning} name="shield-checkmark-outline" size={16} />
          <Text style={styles.approvalTitle}>Approval Required</Text>
        </View>
        <Text style={styles.inboundText}>{content}</Text>
        {approvalId ? (
          <View style={styles.approvalActions}>
            <Pressable style={styles.allowBtn} onPress={() => void onApprove(approvalId, 'allow')}>
              <Text style={styles.allowBtnText}>Allow</Text>
            </Pressable>
            <Pressable style={styles.denyBtn} onPress={() => void onApprove(approvalId, 'deny')}>
              <Text style={styles.denyBtnText}>Deny</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    )
  }

  if (message.message_type === 'worker_report') {
    const workerName = parseWorkerName(message.content_json)
    return (
      <View style={styles.workerCard}>
        {workerName ? (
          <View style={styles.workerBadge}>
            <Ionicons color={colors.accent} name="person-outline" size={12} />
            <Text style={styles.workerBadgeText}>{workerName}</Text>
          </View>
        ) : null}
        <Text style={styles.inboundText}>{content}</Text>
      </View>
    )
  }

  return (
    <View style={styles.inboundBubble}>
      <Text style={styles.inboundText}>{content}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  allowBtn: {
    backgroundColor: colors.successSoft,
    borderColor: colors.success,
    borderRadius: radius.sm,
    borderWidth: 1,
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  allowBtnText: {
    color: colors.success,
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
  approvalActions: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  approvalCard: {
    alignSelf: 'flex-start',
    backgroundColor: colors.warningSoft,
    borderColor: colors.warning,
    borderRadius: radius.md,
    borderWidth: 1,
    maxWidth: '86%',
    padding: spacing.sm,
  },
  approvalHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
    marginBottom: 6,
  },
  approvalTitle: {
    color: colors.warning,
    fontSize: 13,
    fontWeight: '700',
  },
  bubbleFooter: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'flex-end',
    marginTop: 4,
  },
  composer: {
    alignItems: 'flex-end',
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    padding: spacing.xs,
  },
  connectionPill: {
    alignItems: 'center',
    backgroundColor: colors.successSoft,
    borderColor: 'rgba(63, 185, 80, 0.32)',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 7,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  connectionText: { color: colors.text, fontSize: 12, fontWeight: '800' },
  denyBtn: {
    backgroundColor: colors.errorSoft,
    borderColor: colors.error,
    borderRadius: radius.sm,
    borderWidth: 1,
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  denyBtnText: { color: colors.error, fontSize: 13, fontWeight: '700', textAlign: 'center' },
  emptyBody: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22,
    maxWidth: 330,
    textAlign: 'center',
  },
  emptyIcon: {
    alignItems: 'center',
    backgroundColor: colors.accentSoft,
    borderColor: 'rgba(88, 166, 255, 0.24)',
    borderRadius: 28,
    borderWidth: 1,
    height: 82,
    justifyContent: 'center',
    width: 82,
  },
  emptyTitle: { color: colors.text, fontSize: 24, fontWeight: '800', textAlign: 'center' },
  emptyWrap: {
    alignItems: 'center',
    flex: 1,
    gap: spacing.md,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  errorText: { color: colors.error, fontSize: 13, textAlign: 'center' },
  eyebrow: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  hintCard: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.borderMuted,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  hintText: { color: colors.muted, flex: 1, fontSize: 14, lineHeight: 20 },
  inboundBubble: {
    alignSelf: 'flex-start',
    backgroundColor: colors.card,
    borderColor: colors.borderMuted,
    borderRadius: radius.md,
    borderWidth: 1,
    maxWidth: '86%',
    padding: spacing.sm,
  },
  inboundText: { color: colors.textSoft, fontSize: 15, lineHeight: 21 },
  input: {
    color: colors.text,
    flex: 1,
    fontSize: 15,
    maxHeight: 96,
    minHeight: 42,
    paddingHorizontal: spacing.xs,
    paddingVertical: 10,
  },
  keyboard: { flex: 1, gap: spacing.md },
  liveDot: { backgroundColor: colors.success, borderRadius: 999, height: 8, width: 8 },
  messages: { gap: spacing.sm, paddingBottom: spacing.md },
  primaryButton: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingHorizontal: 20,
    paddingVertical: 13,
  },
  primaryButtonText: { color: colors.background, fontSize: 15, fontWeight: '900' },
  sendButton: {
    alignItems: 'center',
    backgroundColor: colors.accent,
    borderRadius: 999,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  sendButtonDisabled: { opacity: 0.35 },
  stateText: { color: colors.muted2, fontSize: 13 },
  systemBubble: {
    alignItems: 'center',
    alignSelf: 'center',
    flexDirection: 'row',
    gap: 6,
    paddingVertical: 4,
  },
  systemText: { color: colors.muted, fontSize: 12 },
  title: { color: colors.text, fontSize: 24, fontWeight: '900' },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    maxWidth: '86%',
    padding: spacing.sm,
  },
  userBubbleText: { color: colors.background, fontSize: 15, fontWeight: '600', lineHeight: 21 },
  workerBadge: {
    alignItems: 'center',
    backgroundColor: colors.accentSoft,
    borderRadius: 8,
    flexDirection: 'row',
    gap: 4,
    marginBottom: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  workerBadgeText: { color: colors.accent, fontSize: 11, fontWeight: '700' },
  workerCard: {
    alignSelf: 'flex-start',
    backgroundColor: colors.card,
    borderColor: colors.borderMuted,
    borderRadius: radius.md,
    borderWidth: 1,
    maxWidth: '86%',
    padding: spacing.sm,
  },
})
