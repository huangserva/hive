import { Ionicons } from '@expo/vector-icons'
import * as DocumentPicker from 'expo-document-picker'
import * as FileSystem from 'expo-file-system'
import * as ImagePicker from 'expo-image-picker'
import { useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Image,
  KeyboardAvoidingView,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import type { ChatMessage, MobileDashboardWorker } from '../../src/api/client'
import { useMobileRuntime } from '../../src/api/mobile-runtime-context'
import { OfflineScreen } from '../../src/components/OfflineScreen'
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

interface StagedAttachment {
  uri: string
  base64: string
  filename: string
  mimeType: string
}

const AUTO_SCROLL_THRESHOLD_PX = 80

export default function ChatTab() {
  const {
    approveRequest,
    chatMessages,
    connect,
    connectionMode,
    dashboard,
    error,
    fetchChatMessages,
    host,
    sendPromptToOrchestrator,
    state,
    token,
    uploadMedia,
  } = useMobileRuntime()
  const router = useRouter()
  const [draft, setDraft] = useState('')
  const [optimistic, setOptimistic] = useState<OptimisticMessage[]>([])
  const [sending, setSending] = useState(false)
  const [attachments, setAttachments] = useState<StagedAttachment[]>([])
  const [headerExpanded, setHeaderExpanded] = useState(false)
  const flatListRef = useRef<FlatList<DisplayMessage>>(null)
  const hasInitialAutoScrolledRef = useRef(false)
  const isNearBottomRef = useRef(true)
  const forceScrollToEndRef = useRef(false)
  const isConnected = state === 'connected' && Boolean(dashboard)

  const connectionLabel = useMemo(() => {
    if (state === 'checking') return 'Connecting'
    if (isConnected) return 'Online'
    if (state === 'error') return 'Needs attention'
    return 'Offline'
  }, [isConnected, state])

  const workspaceStats = useMemo(
    () => ({
      blocked: dashboard?.cockpit.high_ai_actions ?? 0,
      done: dashboard?.tasks.total_done ?? 0,
      inProgress: dashboard?.tasks.total_open ?? 0,
      name: dashboard?.workspace.name ?? 'Workspace',
      phase: dashboard?.plan.current_phase ?? null,
    }),
    [dashboard]
  )

  const allMessages = useMemo<DisplayMessage[]>(() => {
    const serverIds = new Set(chatMessages.map((m) => m.id))
    const pending = optimistic.filter((m) => !serverIds.has(m.id))
    return [...chatMessages, ...pending].sort((a, b) => a.created_at - b.created_at)
  }, [chatMessages, optimistic])

  const sendMessage = useCallback(async () => {
    const body = draft.trim()
    if (!body && attachments.length === 0) return
    if (sending) return
    const msgId = `opt-${Date.now()}`
    const msg: OptimisticMessage = {
      id: msgId,
      direction: 'outbound',
      message_type: 'user_text',
      content_json: JSON.stringify({ text: body || `[${attachments.length} files]` }),
      created_at: Date.now(),
      pending: true,
    }
    forceScrollToEndRef.current = true
    isNearBottomRef.current = true
    setOptimistic((prev) => [...prev, msg])
    setDraft('')
    const stagedFiles = [...attachments]
    setAttachments([])
    setSending(true)
    try {
      const uploadedFiles: string[] = []
      for (const file of stagedFiles) {
        await uploadMedia(file.base64, file.filename, file.mimeType)
        uploadedFiles.push(file.filename)
      }
      const parts: string[] = []
      if (uploadedFiles.length > 0) {
        parts.push(`[附件: ${uploadedFiles.join(', ')}]`)
      }
      if (body) {
        parts.push(body)
      }
      if (parts.length > 0) {
        await sendPromptToOrchestrator(parts.join('\n'))
      }
      setOptimistic((prev) => prev.map((m) => (m.id === msgId ? { ...m, pending: false } : m)))
      void fetchChatMessages()
    } catch {
      setOptimistic((prev) =>
        prev.map((m) => (m.id === msgId ? { ...m, error: true, pending: false } : m))
      )
    }
    setSending(false)
  }, [draft, sending, attachments, sendPromptToOrchestrator, uploadMedia, fetchChatMessages])

  const pickImages = useCallback(async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (status !== 'granted') return
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      allowsMultipleSelection: true,
      quality: 0.8,
      base64: true,
    })
    if (result.canceled || !result.assets) return
    const newAttachments: StagedAttachment[] = result.assets
      .filter((a): a is typeof a & { base64: string } => Boolean(a.base64))
      .map((a) => ({
        uri: a.uri,
        base64: a.base64,
        filename: a.fileName ?? `media_${Date.now()}.${a.type === 'video' ? 'mp4' : 'jpg'}`,
        mimeType: a.mimeType ?? (a.type === 'video' ? 'video/mp4' : 'image/jpeg'),
      }))
    setAttachments((prev) => [...prev, ...newAttachments])
  }, [])

  const pickDocument = useCallback(async () => {
    const result = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      multiple: true,
    })
    if (result.canceled || !result.assets) return
    const newAttachments: StagedAttachment[] = []
    for (const asset of result.assets) {
      const base64 = await FileSystem.readAsStringAsync(asset.uri, {
        encoding: FileSystem.EncodingType.Base64,
      })
      newAttachments.push({
        uri: asset.uri,
        base64,
        filename: asset.name,
        mimeType: asset.mimeType ?? 'application/octet-stream',
      })
    }
    setAttachments((prev) => [...prev, ...newAttachments])
  }, [])

  const removeAttachment = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const scrollToEnd = useCallback((animated: boolean) => {
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated }), 50)
  }, [])

  const maybeAutoScrollToEnd = useCallback(
    (animated: boolean) => {
      const shouldScroll =
        forceScrollToEndRef.current || isNearBottomRef.current || !hasInitialAutoScrolledRef.current
      if (!shouldScroll) return
      hasInitialAutoScrolledRef.current = true
      forceScrollToEndRef.current = false
      scrollToEnd(animated)
    },
    [scrollToEnd]
  )

  const handleChatScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent
    const distanceFromBottom = contentSize.height - (contentOffset.y + layoutMeasurement.height)
    isNearBottomRef.current = distanceFromBottom <= AUTO_SCROLL_THRESHOLD_PX
  }, [])

  useEffect(() => {
    if (allMessages.length > 0) {
      maybeAutoScrollToEnd(true)
    }
  }, [allMessages.length, maybeAutoScrollToEnd])

  if (!isConnected) {
    return (
      <Screen>
        <OfflineScreen
          connectionMode={connectionMode}
          error={error}
          host={host}
          onOpenSettings={() => router.push('/settings')}
          onRetry={() => void connect(host, token)}
        />
      </Screen>
    )
  }

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
        style={styles.keyboard}
      >
        <View style={styles.header}>
          <Pressable
            accessibilityLabel={
              headerExpanded ? 'Collapse workspace summary' : 'Expand workspace summary'
            }
            accessibilityRole="button"
            accessibilityState={{ expanded: headerExpanded }}
            onPress={() => setHeaderExpanded((v) => !v)}
            style={styles.headerRow}
          >
            <Text style={styles.title}>Orchestrator</Text>
            <View style={styles.onlineBadge}>
              <View style={styles.onlineDot} />
              <Text style={styles.onlineLabel}>{connectionLabel}</Text>
            </View>
            <Ionicons
              color={colors.textSoft}
              name={headerExpanded ? 'chevron-up' : 'chevron-down'}
              size={16}
            />
          </Pressable>
          {headerExpanded && (
            <View style={styles.workspaceCard}>
              <View style={styles.workspaceIcon}>
                <Ionicons color={colors.textSoft} name="folder-outline" size={24} />
              </View>
              <View style={styles.workspaceBody}>
                <Text numberOfLines={1} style={styles.workspaceName}>
                  Workspace: {workspaceStats.name}
                </Text>
                <View style={styles.workspaceStats}>
                  {workspaceStats.phase ? (
                    <WorkspaceStat
                      color={colors.accent}
                      icon="git-branch-outline"
                      text={workspaceStats.phase}
                    />
                  ) : null}
                  <WorkspaceStat
                    color={colors.success}
                    icon="checkmark-circle-outline"
                    text={`${workspaceStats.done} tasks done`}
                  />
                  <WorkspaceStat
                    color={colors.warning}
                    icon="ellipse-outline"
                    text={`${workspaceStats.inProgress} in progress`}
                  />
                  {workspaceStats.blocked > 0 ? (
                    <WorkspaceStat
                      color={colors.error}
                      icon="warning-outline"
                      text={`${workspaceStats.blocked} blocked`}
                    />
                  ) : null}
                </View>
              </View>
            </View>
          )}
        </View>

        <FlatList
          ref={flatListRef}
          data={allMessages}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.messages}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() => maybeAutoScrollToEnd(false)}
          onScroll={handleChatScroll}
          scrollEventThrottle={16}
          ListEmptyComponent={<EmptyChat />}
          renderItem={({ item }) => (
            <MessageCard
              message={item}
              onOpenApproval={(approvalId) =>
                router.push({ pathname: '/approval', params: { approvalId } })
              }
              onApprove={approveRequest}
              workers={dashboard?.workers ?? []}
            />
          )}
        />

        {attachments.length > 0 && (
          <View style={styles.attachmentPreview}>
            {attachments.map((att, i) => (
              <View key={att.uri} style={styles.thumbWrap}>
                <Image source={{ uri: att.uri }} style={styles.thumb} />
                <Pressable style={styles.thumbRemove} onPress={() => removeAttachment(i)}>
                  <Ionicons color="#fff" name="close" size={12} />
                </Pressable>
              </View>
            ))}
          </View>
        )}

        <View style={styles.composer}>
          <Pressable accessibilityRole="button" onPress={pickImages} style={styles.attachButton}>
            <Ionicons color={colors.textSoft} name="image-outline" size={22} />
          </Pressable>
          <Pressable accessibilityRole="button" onPress={pickDocument} style={styles.attachButton}>
            <Ionicons color={colors.textSoft} name="attach-outline" size={22} />
          </Pressable>
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
              disabled={!draft.trim() && attachments.length === 0}
              onPress={sendMessage}
              style={[
                styles.sendButton,
                !draft.trim() && attachments.length === 0 ? styles.sendButtonDisabled : null,
              ]}
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
    <Text style={styles.hintText}>Send a message to Orchestrator to start.</Text>
  </View>
)

const WorkspaceStat = ({
  color,
  icon,
  text,
}: {
  color: string
  icon: keyof typeof Ionicons.glyphMap
  text: string
}) => (
  <View style={styles.workspaceStat}>
    <Ionicons color={color} name={icon} size={14} />
    <Text numberOfLines={1} style={styles.workspaceStatText}>
      {text}
    </Text>
  </View>
)

type ParsedContent = Record<string, unknown>

const parseContentObject = (json: string): ParsedContent => {
  try {
    const parsed = JSON.parse(json) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as ParsedContent
    }
    return {}
  } catch {
    return {}
  }
}

const firstString = (...values: unknown[]) =>
  values
    .find((value): value is string => typeof value === 'string' && value.trim().length > 0)
    ?.trim()

const parseContent = (json: string): string => {
  const parsed = parseContentObject(json)
  return (
    firstString(parsed.text, parsed.summary, parsed.description, parsed.reason, parsed.action) ??
    (Object.keys(parsed).length > 0 ? JSON.stringify(parsed) : json)
  )
}

interface MediaInfo {
  file_id: string
  filename: string
  mime_type: string
  size?: number
  url: string
}

const parseMedia = (json: string): MediaInfo | null => {
  try {
    const parsed = JSON.parse(json) as { media?: MediaInfo }
    if (parsed.media?.url) return parsed.media
    return null
  } catch {
    return null
  }
}

const parseWorkerName = (json: string): string | null => {
  const parsed = parseContentObject(json)
  return firstString(parsed.worker_name, parsed.worker, parsed.name) ?? null
}

const parseApprovalId = (json: string): string | null => {
  const parsed = parseContentObject(json)
  return firstString(parsed.approval_id, parsed.approvalId) ?? null
}

const parseApprovalPayload = (json: string) => {
  const parsed = parseContentObject(json)
  return {
    action: firstString(parsed.action),
    description: firstString(parsed.description, parsed.reason, parsed.text, parsed.summary),
    risk: firstString(parsed.risk),
  }
}

const titleCase = (value: string) =>
  value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1).toLowerCase()}`)
    .join(' ')

const formatMessageTime = (timestamp: number) =>
  new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(timestamp))

const workerInitials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || 'AI'

const workerReportItems = (workers: MobileDashboardWorker[], fallbackName: string | null) => {
  const visibleWorkers = fallbackName
    ? workers.filter((worker) => worker.name === fallbackName)
    : workers.slice(0, 4)

  return visibleWorkers.map((worker, index) => ({
    accent:
      index % 4 === 0
        ? colors.accent
        : index % 4 === 1
          ? colors.success
          : index % 4 === 2
            ? colors.warning
            : colors.error,
    name: worker.name,
    role: worker.role,
  }))
}

type MessageCardProps = {
  message: DisplayMessage
  onApprove: (approvalId: string, decision: 'allow' | 'deny') => Promise<boolean>
  onOpenApproval: (approvalId: string) => void
  workers: MobileDashboardWorker[]
}

const MessageCard = ({ message, onApprove, onOpenApproval, workers }: MessageCardProps) => {
  const content = parseContent(message.content_json)
  const isPending = 'pending' in message && message.pending
  const isError = 'error' in message && message.error
  const time = formatMessageTime(message.created_at)

  if (message.message_type === 'system_event') {
    return (
      <View style={styles.systemBubble}>
        <Ionicons color={colors.muted} name="information-circle-outline" size={14} />
        <Text style={styles.systemText}>{content}</Text>
      </View>
    )
  }

  if (message.direction === 'outbound') {
    const media = parseMedia(message.content_json)
    return (
      <View style={styles.userBubble}>
        {media ? (
          <MediaContent media={media} tint="outbound" />
        ) : (
          <Text style={styles.userBubbleText}>{content}</Text>
        )}
        <View style={styles.bubbleFooter}>
          <Text style={styles.userTime}>{time}</Text>
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
    const approval = parseApprovalPayload(message.content_json)
    const riskLabel = approval.risk ? `${titleCase(approval.risk)} Risk` : null
    return (
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          if (approvalId) onOpenApproval(approvalId)
        }}
        style={styles.approvalCard}
      >
        <View style={styles.approvalHeader}>
          <Text style={styles.approvalTitle}>Approval Required</Text>
          <View style={styles.reviewBadge}>
            <Ionicons color={colors.warning} name="time-outline" size={14} />
            <Text style={styles.reviewBadgeText}>Needs Review</Text>
          </View>
        </View>
        <View style={styles.approvalContentRow}>
          <View style={styles.approvalIcon}>
            <Ionicons color={colors.warning} name="document-outline" size={24} />
          </View>
          <View style={styles.approvalCopy}>
            <Text style={styles.approvalSubject}>{approval.action ?? 'Approval request'}</Text>
            {approval.description ? (
              <Text style={styles.approvalDescription}>{approval.description}</Text>
            ) : null}
          </View>
        </View>
        {riskLabel ? (
          <View style={styles.tagRow}>
            <View style={[styles.riskTag, styles.highRiskTag]}>
              <Ionicons color={colors.error} name="warning-outline" size={13} />
              <Text style={styles.highRiskText}>{riskLabel}</Text>
            </View>
          </View>
        ) : null}
        {approvalId ? (
          <View style={styles.approvalActions}>
            <Pressable style={styles.denyBtn} onPress={() => void onApprove(approvalId, 'deny')}>
              <Text style={styles.denyBtnText}>Request Changes</Text>
            </Pressable>
            <Pressable style={styles.allowBtn} onPress={() => void onApprove(approvalId, 'allow')}>
              <Text style={styles.allowBtnText}>Approve</Text>
            </Pressable>
          </View>
        ) : null}
      </Pressable>
    )
  }

  if (message.message_type === 'worker_report') {
    const workerName = parseWorkerName(message.content_json)
    const reportItems = workerReportItems(workers, workerName)
    return (
      <View style={styles.workerCard}>
        <View style={styles.workerReportHeader}>
          <Text style={styles.workerReportTitle}>Worker Report</Text>
        </View>
        <Text style={styles.reportSummary}>{content}</Text>
        {reportItems.length > 0 ? (
          <View style={styles.workerGrid}>
            {reportItems.map((worker) => (
              <View key={`${worker.name}-${worker.role}`} style={styles.workerTile}>
                <View
                  style={[
                    styles.workerAvatar,
                    { borderColor: worker.accent, backgroundColor: `${worker.accent}22` },
                  ]}
                >
                  <Text style={[styles.workerAvatarText, { color: worker.accent }]}>
                    {workerInitials(worker.name)}
                  </Text>
                </View>
                <View style={styles.workerTileCopy}>
                  <Text numberOfLines={1} style={styles.workerTileName}>
                    {worker.name}
                  </Text>
                  <Text numberOfLines={1} style={styles.workerTileRole}>
                    {worker.role}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    )
  }

  return (
    <View style={styles.inboundRow}>
      <View style={styles.botAvatar}>
        <Ionicons color={colors.accent} name="hardware-chip-outline" size={20} />
      </View>
      <View style={styles.inboundBubble}>
        <Text style={styles.senderLabel}>Orchestrator</Text>
        <MarkdownText text={content} />
        <Text style={styles.inboundTime}>{time}</Text>
      </View>
    </View>
  )
}

const MediaContent = ({ media, tint }: { media: MediaInfo; tint: 'outbound' | 'inbound' }) => {
  const isImage = media.mime_type.startsWith('image/')
  const isVideo = media.mime_type.startsWith('video/')
  if (isImage) {
    return (
      <View style={mediaStyles.imageContainer}>
        <Image source={{ uri: media.url }} style={mediaStyles.image} resizeMode="cover" />
        <Text style={tint === 'outbound' ? mediaStyles.captionOut : mediaStyles.captionIn}>
          {media.filename}
        </Text>
      </View>
    )
  }
  if (isVideo) {
    return (
      <View style={mediaStyles.fileRow}>
        <Ionicons color={colors.accent} name="videocam-outline" size={24} />
        <View style={mediaStyles.fileMeta}>
          <Text
            style={tint === 'outbound' ? mediaStyles.fileNameOut : mediaStyles.fileNameIn}
            numberOfLines={1}
          >
            {media.filename}
          </Text>
          <Text style={mediaStyles.fileSize}>
            {media.size ? `${(media.size / 1024 / 1024).toFixed(1)} MB` : 'Video'}
          </Text>
        </View>
      </View>
    )
  }
  return (
    <View style={mediaStyles.fileRow}>
      <Ionicons color={colors.accent} name="document-outline" size={24} />
      <View style={mediaStyles.fileMeta}>
        <Text
          style={tint === 'outbound' ? mediaStyles.fileNameOut : mediaStyles.fileNameIn}
          numberOfLines={1}
        >
          {media.filename}
        </Text>
        <Text style={mediaStyles.fileSize}>
          {media.size ? `${(media.size / 1024).toFixed(0)} KB` : 'File'}
        </Text>
      </View>
    </View>
  )
}

const MarkdownText = ({ text }: { text: string }) => {
  const lines = text.split('\n')
  const seen = new Map<string, number>()
  const keyedLines = lines.map((line) => {
    const count = seen.get(line) ?? 0
    seen.set(line, count + 1)
    return { key: `${line || 'blank'}-${count}`, line }
  })
  return (
    <View>
      {keyedLines.map(({ key, line }) => {
        if (line.startsWith('# ')) {
          return (
            <Text key={key} style={mdStyles.h1}>
              {line.slice(2)}
            </Text>
          )
        }
        if (line.startsWith('## ')) {
          return (
            <Text key={key} style={mdStyles.h2}>
              {line.slice(3)}
            </Text>
          )
        }
        if (line.startsWith('### ')) {
          return (
            <Text key={key} style={mdStyles.h3}>
              {line.slice(4)}
            </Text>
          )
        }
        if (line.startsWith('- ') || line.startsWith('* ')) {
          return (
            <View key={key} style={mdStyles.listItem}>
              <Text style={mdStyles.bullet}>{'  •  '}</Text>
              <Text style={mdStyles.listText}>{renderInline(line.slice(2))}</Text>
            </View>
          )
        }
        if (line.startsWith('```')) {
          return null
        }
        if (line.trim() === '') {
          return <View key={key} style={mdStyles.spacer} />
        }
        return (
          <Text key={key} style={mdStyles.paragraph}>
            {renderInline(line)}
          </Text>
        )
      })}
    </View>
  )
}

const renderInline = (text: string): string => {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/\[(.+?)\]\(.+?\)/g, '$1')
}

const mediaStyles = StyleSheet.create({
  captionIn: { color: colors.textSoft, fontSize: 12, marginTop: 4 },
  captionOut: { color: 'rgba(13, 17, 23, 0.6)', fontSize: 12, marginTop: 4 },
  fileMetaRow: { flexDirection: 'row', gap: 4 },
  fileMeta: { flex: 1, gap: 2 },
  fileNameIn: { color: colors.text, fontSize: 14, fontWeight: '500' },
  fileNameOut: { color: colors.background, fontSize: 14, fontWeight: '500' },
  fileRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  fileSize: { color: colors.textSoft, fontSize: 12 },
  image: { borderRadius: radius.sm, height: 200, width: '100%' },
  imageContainer: { gap: 2 },
})

const mdStyles = StyleSheet.create({
  bullet: { color: colors.textSoft, fontSize: 15 },
  h1: { color: colors.text, fontSize: 18, fontWeight: '700', marginBottom: 4 },
  h2: { color: colors.text, fontSize: 16, fontWeight: '600', marginBottom: 3 },
  h3: { color: colors.text, fontSize: 15, fontWeight: '600', marginBottom: 2 },
  listItem: { flexDirection: 'row', paddingLeft: 4 },
  listText: { color: colors.text, flex: 1, fontSize: 15, lineHeight: 22 },
  paragraph: { color: colors.text, fontSize: 15, lineHeight: 22 },
  spacer: { height: 8 },
})

const styles = StyleSheet.create({
  allowBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.sm,
    flex: 1,
    paddingVertical: 13,
  },
  allowBtnText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
  },
  approvalActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  approvalCard: {
    alignSelf: 'stretch',
    backgroundColor: colors.card,
    borderColor: 'rgba(210, 153, 34, 0.58)',
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.md,
  },
  approvalContentRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  approvalCopy: { flex: 1, gap: 4, justifyContent: 'center' },
  approvalDescription: { color: colors.textSoft, fontSize: 15, lineHeight: 21 },
  approvalHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  approvalIcon: {
    alignItems: 'center',
    backgroundColor: 'rgba(210, 153, 34, 0.16)',
    borderColor: 'rgba(210, 153, 34, 0.5)',
    borderRadius: radius.sm,
    borderWidth: 1,
    height: 54,
    justifyContent: 'center',
    width: 54,
  },
  approvalSubject: { color: colors.text, fontSize: 16, fontWeight: '800' },
  approvalTitle: {
    color: colors.text,
    fontSize: 19,
    fontWeight: '900',
  },
  bubbleFooter: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'flex-end',
    marginTop: spacing.sm,
  },
  botAvatar: {
    alignItems: 'center',
    backgroundColor: colors.accentSoft,
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    marginTop: 2,
    width: 36,
  },
  completedBadge: {
    alignItems: 'center',
    backgroundColor: colors.successSoft,
    borderColor: 'rgba(63, 185, 80, 0.35)',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  completedBadgeText: { color: colors.success, fontSize: 13, fontWeight: '800' },
  composer: {
    alignItems: 'flex-end',
    backgroundColor: 'rgba(22, 27, 34, 0.94)',
    borderColor: colors.borderMuted,
    borderRadius: 28,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 4,
    padding: spacing.xs,
  },
  attachButton: {
    alignItems: 'center',
    borderRadius: 999,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  denyBtn: {
    backgroundColor: colors.cardElevated,
    borderColor: colors.borderMuted,
    borderRadius: radius.sm,
    borderWidth: 1,
    flex: 1,
    paddingVertical: 13,
  },
  denyBtnText: { color: colors.text, fontSize: 16, fontWeight: '800', textAlign: 'center' },
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
  header: { gap: spacing.sm, paddingBottom: 8 },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 44,
  },
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
    backgroundColor: colors.card,
    borderColor: colors.borderMuted,
    borderRadius: radius.md,
    borderWidth: 1,
    flexShrink: 1,
    maxWidth: '86%',
    padding: spacing.md,
  },
  inboundRow: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.sm },
  inboundText: { color: colors.textSoft, fontSize: 15, lineHeight: 21 },
  inboundTime: {
    alignSelf: 'flex-end',
    color: colors.muted,
    fontSize: 12,
    marginTop: 4,
  },
  input: {
    color: colors.text,
    flex: 1,
    fontSize: 15,
    maxHeight: 96,
    minHeight: 42,
    paddingHorizontal: spacing.sm,
    paddingVertical: 10,
  },
  keyboard: { flex: 1, gap: spacing.md },
  messages: { gap: spacing.md, paddingBottom: spacing.md },
  moreButton: { display: 'none' },
  onlineBadge: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.borderMuted,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  onlineDot: { backgroundColor: colors.success, borderRadius: 4, height: 8, width: 8 },
  onlineLabel: { color: colors.success, fontSize: 13, fontWeight: '600' },
  onlineText: { color: colors.success, fontSize: 13, fontWeight: '600' },
  statsRow: { flexDirection: 'row', gap: 8 },
  statChip: {
    backgroundColor: colors.card,
    borderRadius: 10,
    color: colors.textSoft,
    fontSize: 12,
    fontWeight: '600',
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  statChipWarn: { color: colors.warning },
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
  senderLabel: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 5,
    textTransform: 'uppercase',
  },
  stateText: { color: colors.muted2, fontSize: 13 },
  systemBubble: {
    alignItems: 'center',
    alignSelf: 'center',
    flexDirection: 'row',
    gap: 6,
    paddingVertical: 4,
  },
  systemText: { color: colors.muted, fontSize: 12 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.md },
  title: { color: colors.text, flex: 1, fontSize: 20, fontWeight: '900' },
  titleOnlineDot: {
    backgroundColor: colors.success,
    borderRadius: 999,
    height: 10,
    marginTop: 3,
    width: 10,
  },
  titleRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: colors.accent,
    borderRadius: 20,
    maxWidth: '86%',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  userTime: { color: 'rgba(13, 17, 23, 0.58)', fontSize: 13, fontWeight: '700' },
  userBubbleText: { color: colors.background, fontSize: 15, fontWeight: '600', lineHeight: 21 },
  workerAvatar: {
    alignItems: 'center',
    borderRadius: radius.sm,
    borderWidth: 1,
    height: 46,
    justifyContent: 'center',
    width: 46,
  },
  workerAvatarText: { fontSize: 14, fontWeight: '900' },
  workerCard: {
    alignSelf: 'stretch',
    backgroundColor: colors.card,
    borderColor: colors.borderMuted,
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.md,
  },
  workerGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: spacing.md },
  workerReportHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  workerReportTitle: { color: colors.text, fontSize: 19, fontWeight: '900' },
  workerTile: {
    flexBasis: '46%',
    flexDirection: 'row',
    gap: spacing.sm,
    minWidth: 130,
  },
  workerTileCopy: { flex: 1, gap: 3 },
  workerTileName: { color: colors.text, fontSize: 14, fontWeight: '800' },
  workerTileRole: { color: colors.muted, fontSize: 13 },
  progressBadge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    marginTop: 3,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  progressText: { fontSize: 12, fontWeight: '800' },
  reportDivider: { backgroundColor: colors.borderMuted, height: 1, marginTop: spacing.md },
  reportLink: { color: colors.accent, fontSize: 15, fontWeight: '800' },
  reportLinkRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: spacing.sm,
  },
  reportSummary: {
    color: colors.textSoft,
    fontSize: 15,
    lineHeight: 22,
    marginTop: spacing.sm,
  },
  reviewBadge: {
    alignItems: 'center',
    backgroundColor: colors.warningSoft,
    borderColor: 'rgba(210, 153, 34, 0.35)',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  reviewBadgeText: { color: colors.warning, fontSize: 13, fontWeight: '800' },
  riskTag: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  highRiskTag: { backgroundColor: colors.errorSoft, borderColor: 'rgba(248, 81, 73, 0.35)' },
  highRiskText: { color: colors.error, fontSize: 13, fontWeight: '800' },
  productionTag: {
    backgroundColor: colors.warningSoft,
    borderColor: 'rgba(210, 153, 34, 0.35)',
  },
  productionText: { color: colors.warning, fontSize: 13, fontWeight: '800' },
  workspaceBody: { flex: 1, gap: 7 },
  workspaceCard: {
    alignItems: 'center',
    backgroundColor: 'rgba(22, 27, 34, 0.86)',
    borderColor: colors.borderMuted,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  workspaceIcon: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: radius.md,
    height: 52,
    justifyContent: 'center',
    width: 52,
  },
  workspaceName: { color: colors.text, fontSize: 16, fontWeight: '900' },
  workspaceStat: { alignItems: 'center', flexDirection: 'row', gap: 5, maxWidth: '48%' },
  workspaceStats: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  workspaceStatText: { color: colors.textSoft, flexShrink: 1, fontSize: 12, fontWeight: '700' },
  attachmentPreview: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  thumb: { borderRadius: 8, height: 60, width: 60 },
  thumbWrap: { position: 'relative' },
  thumbRemove: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 10,
    height: 20,
    justifyContent: 'center',
    position: 'absolute',
    right: -4,
    top: -4,
    width: 20,
  },
})
