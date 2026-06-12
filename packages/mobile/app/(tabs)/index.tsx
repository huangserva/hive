import { Ionicons } from '@expo/vector-icons'
import * as DocumentPicker from 'expo-document-picker'
import * as FileSystem from 'expo-file-system/legacy'
import * as ImagePicker from 'expo-image-picker'
import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  type KeyboardEvent,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import {
  type ChatMessage,
  type MobileDashboardWorker,
  normalizeRuntimeHost,
} from '../../src/api/client'
import { useMobileRuntime } from '../../src/api/mobile-runtime-context'
import { ConnectionModeBadge } from '../../src/components/ConnectionModeBanner'
import { ImagePreviewModal, type PreviewImageSource } from '../../src/components/ImagePreviewModal'
import { Screen } from '../../src/components/Screen'
import { VideoPreviewModal } from '../../src/components/VideoPreviewModal'
import { type TFunction, useT } from '../../src/i18n'
import {
  buildChatMediaEnvelopeJson,
  type ChatMediaItem,
  extractChatMediaItems,
  isChatMediaImage,
  isChatMediaVideo,
  isPickedVideoOverLimit,
  normalizePickedMediaAttachment,
  type StagedChatAttachment,
} from '../../src/lib/chat-media'
import { filterPendingOptimisticMessages } from '../../src/lib/chat-message-dedupe'
import { resolveChatSendOutcome } from '../../src/lib/chat-send-status'
import {
  COMPOSER_INPUT_MIN_HEIGHT,
  resolveComposerInputHeight,
} from '../../src/lib/composer-height'
import { deriveMediaContentImageState } from '../../src/lib/media-content-image-state'
import { stripInlineMarkdown } from '../../src/lib/strip-markdown'
import { useRelayMediaSource } from '../../src/lib/use-relay-media-source'
import { colors, radius, spacing } from '../../src/theme'

type OptimisticMessage = {
  clientNonce: string
  id: string
  workspaceId: string
  direction: 'inbound'
  queued?: boolean
  message_type: 'user_text'
  content_json: string
  created_at: number
  pending?: boolean
  error?: boolean
}

type DisplayMessage = ChatMessage | OptimisticMessage

type StagedAttachment = StagedChatAttachment

interface UploadedMediaPromptItem {
  file_id: string
  filename: string
  url: string
}

type MarkdownSegment =
  | { level: 1 | 2 | 3; text: string; type: 'heading' }
  | { text: string; type: 'code'; language?: string }
  | { text: string; type: 'listItem' }
  | { type: 'spacer' }
  | { text: string; type: 'paragraph' }

const AUTO_SCROLL_THRESHOLD_PX = 80
const DEDUPE_MESSAGE_TYPES = new Set<DisplayMessage['message_type']>([
  'orch_reply',
  'worker_report',
])

const createClientNonce = () => globalThis.crypto?.randomUUID?.() ?? `chat-${Date.now()}`

export const normalizeUploadedMediaResult = (
  file: Pick<StagedAttachment, 'filename'>,
  result: { file_id: string; url: string } | null
): UploadedMediaPromptItem => {
  if (!result?.url) {
    throw new Error(`Upload failed for ${file.filename}`)
  }
  return {
    file_id: result.file_id,
    filename: file.filename,
    url: result.url,
  }
}

export const buildUploadedMediaPrompt = (files: UploadedMediaPromptItem[], body: string) => {
  const parts = files.map((file, index) =>
    [`[附件 ${index + 1}: ${file.filename}]`, `URL: ${file.url}`, `file_id: ${file.file_id}`].join(
      '\n'
    )
  )
  if (body) parts.push(body)
  return parts.join('\n\n')
}

export const buildMarkdownSegments = (text: string): MarkdownSegment[] => {
  const segments: MarkdownSegment[] = []
  const codeLines: string[] = []
  let codeLanguage: string | undefined

  const flushCodeBlock = () => {
    segments.push({
      language: codeLanguage,
      text: codeLines.join('\n'),
      type: 'code',
    })
    codeLines.length = 0
    codeLanguage = undefined
  }

  for (const line of text.split('\n')) {
    if (line.startsWith('```')) {
      if (codeLanguage !== undefined) {
        flushCodeBlock()
      } else {
        codeLanguage = line.slice(3).trim() || ''
      }
      continue
    }
    if (codeLanguage !== undefined) {
      codeLines.push(line)
      continue
    }
    if (line.startsWith('# ')) {
      segments.push({ level: 1, text: line.slice(2), type: 'heading' })
      continue
    }
    if (line.startsWith('## ')) {
      segments.push({ level: 2, text: line.slice(3), type: 'heading' })
      continue
    }
    if (line.startsWith('### ')) {
      segments.push({ level: 3, text: line.slice(4), type: 'heading' })
      continue
    }
    if (line.startsWith('- ') || line.startsWith('* ')) {
      segments.push({ text: line.slice(2), type: 'listItem' })
      continue
    }
    if (line.trim() === '') {
      segments.push({ type: 'spacer' })
      continue
    }
    segments.push({ text: line, type: 'paragraph' })
  }
  if (codeLanguage !== undefined) flushCodeBlock()
  return segments
}

const messageContentKey = (message: Pick<DisplayMessage, 'content_json' | 'message_type'>) =>
  `${message.message_type}:${parseContent(message.content_json).replace(/\s+/g, ' ').trim()}`

const dedupeAdjacentMessages = (messages: DisplayMessage[]) => {
  const deduped: DisplayMessage[] = []
  for (const message of messages) {
    const previous = deduped.at(-1)
    if (
      previous &&
      DEDUPE_MESSAGE_TYPES.has(message.message_type) &&
      previous.message_type === message.message_type &&
      messageContentKey(previous) === messageContentKey(message)
    ) {
      deduped[deduped.length - 1] = message
      continue
    }
    deduped.push(message)
  }
  return deduped
}

export default function ChatTab() {
  const {
    approveRequest,
    chatMessages,
    dashboard,
    fetchChatMessages,
    host,
    sendPromptToOrchestratorWithOutcome,
    selectedWorkspaceId,
    state,
    token,
    uploadMedia,
  } = useMobileRuntime()
  const t = useT()
  const router = useRouter()
  const [draft, setDraft] = useState('')
  const [composerHeight, setComposerHeight] = useState(COMPOSER_INPUT_MIN_HEIGHT)
  const [optimistic, setOptimistic] = useState<OptimisticMessage[]>([])
  const [sending, setSending] = useState(false)
  const [attachments, setAttachments] = useState<StagedAttachment[]>([])
  const [readingMedia, setReadingMedia] = useState(false)
  const [previewImage, setPreviewImage] = useState<{
    label: string
    source: PreviewImageSource
  } | null>(null)
  const [previewVideo, setPreviewVideo] = useState<{
    label: string
    source: PreviewImageSource
  } | null>(null)
  const [headerExpanded, setHeaderExpanded] = useState(false)
  const [keyboardInset, setKeyboardInset] = useState(0)
  const [showScrollToBottom, setShowScrollToBottom] = useState(false)
  const flatListRef = useRef<FlatList<DisplayMessage>>(null)
  const contentFitsViewportRef = useRef(false)
  const contentHeightRef = useRef(0)
  const hasInitialAutoScrolledRef = useRef(false)
  const isNearBottomRef = useRef(true)
  const isDraggingRef = useRef(false)
  const forceScrollToEndRef = useRef(false)
  const scrollFrameRef = useRef<number | null>(null)
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const forceScrollRetryRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dimensionSettleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const keyboardSettleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const selectedWorkspaceIdRef = useRef(selectedWorkspaceId)
  const keyboardInsetRef = useRef(0)
  const viewportHeightRef = useRef(0)
  selectedWorkspaceIdRef.current = selectedWorkspaceId
  const isConnected = state === 'connected' && Boolean(dashboard)

  const connectionLabel = useMemo(() => {
    if (state === 'checking') return t('chat.status.connecting')
    if (isConnected) return t('chat.status.online')
    if (state === 'error') return t('chat.status.needsAttention')
    return t('chat.status.offline')
  }, [isConnected, state, t])

  const workspaceStats = useMemo(
    () => ({
      blocked: dashboard?.cockpit.high_ai_actions ?? 0,
      done: dashboard?.tasks.total_done ?? 0,
      inProgress: dashboard?.tasks.total_open ?? 0,
      name: dashboard?.workspace.name ?? t('chat.workspace.fallbackName'),
      phase: stripInlineMarkdown(dashboard?.plan.current_phase ?? null) || null,
    }),
    [dashboard, t]
  )

  const allMessages = useMemo<DisplayMessage[]>(() => {
    const pending = filterPendingOptimisticMessages({
      chatMessages,
      currentWorkspaceId: selectedWorkspaceId,
      optimisticMessages: optimistic,
    })
    return dedupeAdjacentMessages(
      [...chatMessages, ...pending].sort((a, b) => a.created_at - b.created_at)
    )
  }, [chatMessages, optimistic, selectedWorkspaceId])

  const latestMessageToken = useMemo(() => {
    const latest = allMessages.at(-1)
    return latest ? `${allMessages.length}:${latest.id}:${latest.created_at}` : ''
  }, [allMessages])

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
    const newAttachments: StagedAttachment[] = []
    setReadingMedia(true)
    try {
      for (const asset of result.assets) {
        const info = await FileSystem.getInfoAsync(asset.uri)
        if (isPickedVideoOverLimit(asset, info.exists ? info.size : undefined)) {
          Alert.alert(t('chat.media.videoTooLargeTitle'), t('chat.media.videoTooLargeBody'))
          continue
        }
        try {
          newAttachments.push(
            await normalizePickedMediaAttachment(asset, (uri) =>
              FileSystem.readAsStringAsync(uri, {
                encoding: FileSystem.EncodingType.Base64,
              })
            )
          )
        } catch {
          Alert.alert(t('chat.media.readFailedTitle'), t('chat.media.readFailedBody'))
        }
      }
      if (newAttachments.length > 0) {
        setAttachments((prev) => [...prev, ...newAttachments])
      }
    } finally {
      setReadingMedia(false)
    }
  }, [t])

  const pickDocument = useCallback(async () => {
    const result = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      multiple: true,
    })
    if (result.canceled || !result.assets) return
    const newAttachments: StagedAttachment[] = []
    setReadingMedia(true)
    try {
      for (const asset of result.assets) {
        const pickedAsset = {
          fileName: asset.name,
          mimeType: asset.mimeType ?? null,
          type: asset.mimeType?.startsWith('video/') ? 'video' : null,
          uri: asset.uri,
        }
        const info = await FileSystem.getInfoAsync(asset.uri)
        if (isPickedVideoOverLimit(pickedAsset, info.exists ? info.size : asset.size)) {
          Alert.alert(t('chat.media.videoTooLargeTitle'), t('chat.media.videoTooLargeBody'))
          continue
        }
        try {
          newAttachments.push(
            await normalizePickedMediaAttachment(pickedAsset, (uri) =>
              FileSystem.readAsStringAsync(uri, {
                encoding: FileSystem.EncodingType.Base64,
              })
            )
          )
        } catch {
          Alert.alert(t('chat.media.readFailedTitle'), t('chat.media.readFailedBody'))
        }
      }
      if (newAttachments.length > 0) {
        setAttachments((prev) => [...prev, ...newAttachments])
      }
    } finally {
      setReadingMedia(false)
    }
  }, [t])

  const removeAttachment = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const cancelScheduledScroll = useCallback(() => {
    if (scrollFrameRef.current !== null) {
      cancelAnimationFrame(scrollFrameRef.current)
      scrollFrameRef.current = null
    }
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current)
      scrollTimeoutRef.current = null
    }
    if (forceScrollRetryRef.current) {
      clearTimeout(forceScrollRetryRef.current)
      forceScrollRetryRef.current = null
    }
  }, [])

  const updateContentFit = useCallback(
    (contentHeight: number, viewportHeight: number) => {
      contentHeightRef.current = contentHeight
      viewportHeightRef.current = viewportHeight
      const fitsViewport = viewportHeight > 0 && contentHeight <= viewportHeight + 1
      contentFitsViewportRef.current = fitsViewport
      if (fitsViewport) {
        forceScrollToEndRef.current = false
        hasInitialAutoScrolledRef.current = true
        setShowScrollToBottom(false)
        cancelScheduledScroll()
      }
    },
    [cancelScheduledScroll]
  )

  const scrollToEnd = useCallback(
    (animated: boolean) => {
      if (isDraggingRef.current || contentFitsViewportRef.current) return
      cancelScheduledScroll()
      setShowScrollToBottom(false)
      scrollFrameRef.current = requestAnimationFrame(() => {
        scrollFrameRef.current = null
        scrollTimeoutRef.current = setTimeout(() => {
          scrollTimeoutRef.current = null
          if (isDraggingRef.current || contentFitsViewportRef.current) return
          flatListRef.current?.scrollToEnd({ animated })
        }, 50)
      })
    },
    [cancelScheduledScroll]
  )

  const maybeAutoScrollToEnd = useCallback(
    (animated: boolean, trigger: 'content' | 'message' = 'message') => {
      if (isDraggingRef.current || contentFitsViewportRef.current) {
        if (contentFitsViewportRef.current) {
          forceScrollToEndRef.current = false
          hasInitialAutoScrolledRef.current = true
        }
        return
      }
      const shouldScroll =
        forceScrollToEndRef.current ||
        !hasInitialAutoScrolledRef.current ||
        (trigger === 'message' && isNearBottomRef.current)
      if (!shouldScroll) return
      hasInitialAutoScrolledRef.current = true
      forceScrollToEndRef.current = false
      scrollToEnd(animated)
    },
    [scrollToEnd]
  )

  const scheduleForceScrollRetry = useCallback(
    (animated: boolean) => {
      if (forceScrollRetryRef.current) {
        clearTimeout(forceScrollRetryRef.current)
      }
      forceScrollRetryRef.current = setTimeout(() => {
        forceScrollRetryRef.current = null
        if (isDraggingRef.current || contentFitsViewportRef.current) return
        forceScrollToEndRef.current = true
        maybeAutoScrollToEnd(animated)
      }, 120)
    },
    [maybeAutoScrollToEnd]
  )

  const handleMessageListLayout = useCallback(
    (event: LayoutChangeEvent) => {
      updateContentFit(contentHeightRef.current, event.nativeEvent.layout.height)
    },
    [updateContentFit]
  )

  const handleContentSizeChange = useCallback(
    (_width: number, height: number) => {
      updateContentFit(height, viewportHeightRef.current)
      if (isDraggingRef.current) return
      maybeAutoScrollToEnd(false, 'content')
      if (forceScrollToEndRef.current) {
        scheduleForceScrollRetry(false)
      }
    },
    [maybeAutoScrollToEnd, scheduleForceScrollRetry, updateContentFit]
  )

  const handleChatScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent
      if (!isDraggingRef.current) {
        updateContentFit(contentSize.height, layoutMeasurement.height)
      }
      const distanceFromBottom = contentSize.height - (contentOffset.y + layoutMeasurement.height)
      isNearBottomRef.current = distanceFromBottom <= AUTO_SCROLL_THRESHOLD_PX
      const shouldShowScrollToBottom =
        !contentFitsViewportRef.current && distanceFromBottom > AUTO_SCROLL_THRESHOLD_PX
      setShowScrollToBottom((current) =>
        current === shouldShowScrollToBottom ? current : shouldShowScrollToBottom
      )
    },
    [updateContentFit]
  )

  const handleScrollBeginDrag = useCallback(() => {
    isDraggingRef.current = true
    cancelScheduledScroll()
  }, [cancelScheduledScroll])

  const handleScrollEndDrag = useCallback(() => {
    isDraggingRef.current = false
    if (forceScrollToEndRef.current) {
      maybeAutoScrollToEnd(false)
    }
  }, [maybeAutoScrollToEnd])

  const handleMomentumScrollEnd = useCallback(() => {
    isDraggingRef.current = false
    if (forceScrollToEndRef.current) {
      maybeAutoScrollToEnd(false)
    }
  }, [maybeAutoScrollToEnd])

  const openImagePreview = useCallback((source: PreviewImageSource, label: string) => {
    setPreviewImage({ label, source })
  }, [])

  const closeImagePreview = useCallback(() => {
    setPreviewImage(null)
  }, [])

  const openVideoPreview = useCallback((source: PreviewImageSource, label: string) => {
    setPreviewVideo({ label, source })
  }, [])

  const closeVideoPreview = useCallback(() => {
    setPreviewVideo(null)
  }, [])

  const scrollToLatestMessage = useCallback(
    (animated: boolean) => {
      forceScrollToEndRef.current = true
      setShowScrollToBottom(false)
      maybeAutoScrollToEnd(animated)
      scheduleForceScrollRetry(animated)
    },
    [maybeAutoScrollToEnd, scheduleForceScrollRetry]
  )

  const sendMessage = useCallback(async () => {
    const body = draft.trim()
    if (!body && attachments.length === 0) return
    if (sending) return
    const workspaceId = selectedWorkspaceIdRef.current
    if (!workspaceId) return
    const clientNonce = createClientNonce()
    const msgId = `opt-${clientNonce}`
    // 把全部 N 张附件都写进 optimistic content（attachments 数组），气泡才能渲染 N 个真实缩略图，
    // 而不是只显示第一张或一片空绿框。本地 asset uri 直接当 url，发送中即可预览。
    const optimisticContentJson =
      attachments.length > 0
        ? buildChatMediaEnvelopeJson({
            attachments: attachments.map((attachment) => ({
              filename: attachment.filename,
              mimeType: attachment.mimeType,
              uri: attachment.uri,
            })),
            text: body,
          })
        : JSON.stringify({ text: body })
    const msg: OptimisticMessage = {
      clientNonce,
      id: msgId,
      workspaceId,
      direction: 'inbound',
      message_type: 'user_text',
      content_json: optimisticContentJson,
      created_at: Date.now(),
      pending: true,
    }
    forceScrollToEndRef.current = true
    isNearBottomRef.current = true
    setOptimistic((prev) => [...prev, msg])
    scrollToLatestMessage(true)
    setDraft('')
    const stagedFiles = [...attachments]
    setAttachments([])
    setComposerHeight(COMPOSER_INPUT_MIN_HEIGHT)
    setSending(true)
    try {
      const uploadedFiles: UploadedMediaPromptItem[] = []
      for (const file of stagedFiles) {
        const result = await uploadMedia(file.base64, file.filename, file.mimeType)
        uploadedFiles.push(normalizeUploadedMediaResult(file, result))
      }
      const prompt = buildUploadedMediaPrompt(uploadedFiles, body)
      const sendOutcome =
        prompt.length > 0 ? await sendPromptToOrchestratorWithOutcome(prompt) : 'sent'
      setOptimistic((prev) =>
        prev.map((m) =>
          m.id === msgId
            ? sendOutcome === 'queued'
              ? { ...m, pending: false, queued: true }
              : sendOutcome === 'sent'
                ? { ...m, pending: false }
                : { ...m, error: true, pending: false }
            : m
        )
      )
      if (sendOutcome === 'sent') {
        void fetchChatMessages()
        scrollToLatestMessage(true)
      }
    } catch {
      setOptimistic((prev) =>
        prev.map((m) => (m.id === msgId ? { ...m, error: true, pending: false } : m))
      )
    }
    setSending(false)
  }, [
    attachments,
    draft,
    fetchChatMessages,
    scrollToLatestMessage,
    sendPromptToOrchestratorWithOutcome,
    sending,
    uploadMedia,
  ])

  useFocusEffect(
    useCallback(() => {
      if (!allMessages.length) return undefined
      scrollToLatestMessage(true)
      return undefined
    }, [allMessages.length, scrollToLatestMessage])
  )

  useEffect(() => {
    if (latestMessageToken) {
      maybeAutoScrollToEnd(true)
    }
  }, [latestMessageToken, maybeAutoScrollToEnd])

  useEffect(
    () => () => {
      if (dimensionSettleTimeoutRef.current) {
        clearTimeout(dimensionSettleTimeoutRef.current)
      }
      if (forceScrollRetryRef.current) {
        clearTimeout(forceScrollRetryRef.current)
      }
      if (scrollFrameRef.current !== null) {
        cancelAnimationFrame(scrollFrameRef.current)
      }
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current)
      }
    },
    []
  )

  useEffect(() => {
    const scheduleDimensionSettle = () => {
      contentFitsViewportRef.current = false
      cancelScheduledScroll()
      if (dimensionSettleTimeoutRef.current) {
        clearTimeout(dimensionSettleTimeoutRef.current)
      }
      dimensionSettleTimeoutRef.current = setTimeout(() => {
        dimensionSettleTimeoutRef.current = null
        updateContentFit(contentHeightRef.current, viewportHeightRef.current)
      }, 240)
    }

    const subscription = Dimensions.addEventListener('change', scheduleDimensionSettle)
    return () => {
      subscription.remove()
      if (dimensionSettleTimeoutRef.current) {
        clearTimeout(dimensionSettleTimeoutRef.current)
        dimensionSettleTimeoutRef.current = null
      }
    }
  }, [cancelScheduledScroll, updateContentFit])

  useEffect(() => {
    const setMeasuredKeyboardInset = (nextInset: number) => {
      if (Math.abs(keyboardInsetRef.current - nextInset) < 2) return
      keyboardInsetRef.current = nextInset
      setKeyboardInset(nextInset)
    }

    const settleAfterKeyboardChange = () => {
      if (keyboardSettleTimeoutRef.current) {
        clearTimeout(keyboardSettleTimeoutRef.current)
      }
      keyboardSettleTimeoutRef.current = setTimeout(() => {
        keyboardSettleTimeoutRef.current = null
        if (isNearBottomRef.current || forceScrollToEndRef.current) {
          scrollToEnd(false)
        }
      }, 180)
    }

    const handleKeyboardShow = (event: KeyboardEvent) => {
      const measuredHeight = Math.max(0, event.endCoordinates?.height ?? 0)
      setMeasuredKeyboardInset(Platform.OS === 'android' ? measuredHeight : 0)
      settleAfterKeyboardChange()
    }

    const handleKeyboardHide = () => {
      setMeasuredKeyboardInset(0)
      settleAfterKeyboardChange()
    }

    const showSubscription = Keyboard.addListener('keyboardDidShow', handleKeyboardShow)
    const hideSubscription = Keyboard.addListener('keyboardDidHide', handleKeyboardHide)
    return () => {
      showSubscription.remove()
      hideSubscription.remove()
      if (keyboardSettleTimeoutRef.current) {
        clearTimeout(keyboardSettleTimeoutRef.current)
      }
    }
  }, [scrollToEnd])

  return (
    <Screen showConnectionModeBanner={false}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
        style={styles.keyboard}
      >
        <View style={styles.header}>
          <Pressable
            accessibilityLabel={t(headerExpanded ? 'chat.header.collapse' : 'chat.header.expand')}
            accessibilityRole="button"
            accessibilityState={{ expanded: headerExpanded }}
            onPress={() => setHeaderExpanded((v) => !v)}
            style={styles.headerRow}
          >
            <View style={styles.titleColumn}>
              <Text ellipsizeMode="tail" numberOfLines={1} style={styles.title}>
                {workspaceStats.name}
              </Text>
              <Text ellipsizeMode="tail" numberOfLines={1} style={styles.subtitle}>
                {t('chat.header.subtitle')}
              </Text>
            </View>
            <ConnectionModeBadge />
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
                  {t('chat.workspace.label', { name: workspaceStats.name })}
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
                    text={t('chat.workspace.tasksDone', { count: workspaceStats.done })}
                  />
                  <WorkspaceStat
                    color={colors.warning}
                    icon="ellipse-outline"
                    text={t('chat.workspace.tasksInProgress', {
                      count: workspaceStats.inProgress,
                    })}
                  />
                  {workspaceStats.blocked > 0 ? (
                    <WorkspaceStat
                      color={colors.error}
                      icon="warning-outline"
                      text={t('chat.workspace.tasksBlocked', { count: workspaceStats.blocked })}
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
          style={styles.messageList}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={handleContentSizeChange}
          onLayout={handleMessageListLayout}
          onMomentumScrollEnd={handleMomentumScrollEnd}
          onScroll={handleChatScroll}
          onScrollBeginDrag={handleScrollBeginDrag}
          onScrollEndDrag={handleScrollEndDrag}
          scrollEventThrottle={16}
          ListEmptyComponent={<EmptyChat />}
          renderItem={({ item }) => (
            <MessageCard
              message={item}
              onOpenApproval={(approvalId) =>
                router.push({ pathname: '/approval', params: { approvalId } })
              }
              onApprove={approveRequest}
              onPreviewImage={openImagePreview}
              onPreviewVideo={openVideoPreview}
              runtimeHost={host}
              token={token}
              workers={dashboard?.workers ?? []}
            />
          )}
        />

        {showScrollToBottom ? (
          <Pressable
            accessibilityHint={t('chat.scrollToBottom.hint')}
            accessibilityLabel={t('chat.scrollToBottom.label')}
            accessibilityRole="button"
            onPress={() => scrollToLatestMessage(true)}
            style={[
              styles.scrollToBottomButton,
              { bottom: keyboardInset > 0 ? keyboardInset + 84 : 84 },
            ]}
          >
            <Ionicons color={colors.background} name="arrow-down" size={20} />
          </Pressable>
        ) : null}

        {attachments.length > 0 && (
          <View style={styles.attachmentPreview}>
            {attachments.map((att, i) => (
              <View key={att.uri} style={styles.thumbWrap}>
                {att.mimeType.startsWith('image/') ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => openImagePreview({ uri: att.uri }, att.filename)}
                  >
                    <Image source={{ uri: att.uri }} style={styles.thumb} />
                  </Pressable>
                ) : att.mimeType.startsWith('video/') ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => openVideoPreview({ uri: att.uri }, att.filename)}
                    style={styles.videoThumb}
                  >
                    <Ionicons color="#fff" name="play-circle" size={30} />
                  </Pressable>
                ) : (
                  <Image source={{ uri: att.uri }} style={styles.thumb} />
                )}
                <Pressable style={styles.thumbRemove} onPress={() => removeAttachment(i)}>
                  <Ionicons color="#fff" name="close" size={12} />
                </Pressable>
              </View>
            ))}
          </View>
        )}

        <View style={styles.composer}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ busy: readingMedia, disabled: readingMedia }}
            disabled={readingMedia}
            onPress={pickImages}
            style={[styles.attachButton, readingMedia ? styles.buttonDisabled : null]}
          >
            {readingMedia ? (
              <ActivityIndicator color={colors.textSoft} size="small" />
            ) : (
              <Ionicons color={colors.textSoft} name="image-outline" size={22} />
            )}
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ busy: readingMedia, disabled: readingMedia }}
            disabled={readingMedia}
            onPress={pickDocument}
            style={[styles.attachButton, readingMedia ? styles.buttonDisabled : null]}
          >
            <Ionicons color={colors.textSoft} name="attach-outline" size={22} />
          </Pressable>
          <TextInput
            multiline
            onChangeText={setDraft}
            onContentSizeChange={(event) => {
              setComposerHeight(resolveComposerInputHeight(event.nativeEvent.contentSize.height))
            }}
            placeholder={t('chat.input.placeholder')}
            placeholderTextColor={colors.muted2}
            scrollEnabled
            style={[styles.input, { height: composerHeight }]}
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

        {keyboardInset > 0 ? (
          <View
            pointerEvents="none"
            style={[styles.keyboardLiftSpacer, { height: keyboardInset }]}
          />
        ) : null}

        {previewImage ? (
          <ImagePreviewModal
            label={previewImage.label}
            onClose={closeImagePreview}
            source={previewImage.source}
            visible
          />
        ) : null}
        {previewVideo ? (
          <VideoPreviewModal
            label={previewVideo.label}
            onClose={closeVideoPreview}
            source={previewVideo.source}
            visible
          />
        ) : null}
      </KeyboardAvoidingView>
    </Screen>
  )
}

const EmptyChat = () => {
  const t = useT()
  return (
    <View style={styles.hintCard}>
      <Ionicons color={colors.accent} name="chatbubble-ellipses-outline" size={20} />
      <Text style={styles.hintText}>{t('chat.empty')}</Text>
    </View>
  )
}

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

export const normalizeChatDisplayText = (text: string): string => {
  let result = ''
  for (let index = 0; index < text.length; ) {
    if (text[index] !== '\\') {
      result += text[index]
      index += 1
      continue
    }

    let slashCount = 0
    while (text[index + slashCount] === '\\') {
      slashCount += 1
    }

    const nextIndex = index + slashCount
    const next = text[nextIndex]
    const escapedCrLf = next === 'r' && text[nextIndex + 1] === '\\' && text[nextIndex + 2] === 'n'

    if (slashCount % 2 === 1 && escapedCrLf) {
      result += '\\'.repeat(Math.floor(slashCount / 2))
      result += '\n'
      index = nextIndex + 3
      continue
    }

    if (slashCount % 2 === 1 && (next === 'n' || next === 'r')) {
      result += '\\'.repeat(Math.floor(slashCount / 2))
      result += '\n'
      index = nextIndex + 1
      continue
    }

    result += '\\'.repeat(slashCount)
    index = nextIndex
  }
  return result
}

export const parseContent = (json: string): string => {
  const parsed = parseContentObject(json)
  const text =
    firstString(parsed.text, parsed.summary, parsed.description, parsed.reason, parsed.action) ??
    (Object.keys(parsed).length > 0 ? JSON.stringify(parsed) : json)
  return normalizeChatDisplayText(text)
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

const compactSummary = (value: string | null | undefined, maxLength = 96) => {
  const firstLine = value
    ?.split('\n')
    .find((line) => line.trim().length > 0)
    ?.trim()
  if (!firstLine) return null
  return firstLine.length > maxLength ? `${firstLine.slice(0, maxLength - 1)}…` : firstLine
}

const parseSystemEventPayload = (json: string, t: TFunction) => {
  const parsed = parseContentObject(json)
  const event = firstString(parsed.event, parsed.type) ?? 'system'
  const worker = firstString(parsed.worker, parsed.worker_name)
  const taskSummary = compactSummary(firstString(parsed.task_summary, parsed.task, parsed.summary))
  const description = compactSummary(
    firstString(parsed.text, parsed.description, parsed.message, parsed.reason)
  )

  if (event === 'dispatch') {
    return {
      icon: 'paper-plane-outline' as const,
      summary: taskSummary ?? description ?? t('chat.system.dispatchFallback'),
      title: worker ? t('chat.system.dispatchedTo', { worker }) : t('chat.system.dispatched'),
    }
  }

  if (event === 'report' || event === 'done') {
    return {
      icon: 'checkmark-circle-outline' as const,
      summary: description ?? taskSummary ?? t('chat.system.reportFallback'),
      title: worker ? t('chat.system.reportFrom', { worker }) : t('chat.system.workerReport'),
    }
  }

  // 未知事件：回显事件名本身（数据驱动，非固定英文 UI 文案）。
  return {
    icon: 'information-circle-outline' as const,
    summary: description ?? taskSummary ?? titleCase(event),
    title: titleCase(event),
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
  onPreviewImage: (source: PreviewImageSource, label: string) => void
  onPreviewVideo: (source: PreviewImageSource, label: string) => void
  runtimeHost: string
  token: string
  workers: MobileDashboardWorker[]
}

const MessageCard = ({
  message,
  onApprove,
  onOpenApproval,
  onPreviewImage,
  onPreviewVideo,
  runtimeHost,
  token,
  workers,
}: MessageCardProps) => {
  const t = useT()
  const content = parseContent(message.content_json)
  const isPending = 'pending' in message && Boolean(message.pending)
  const isError = 'error' in message && Boolean(message.error)
  const isQueued = 'queued' in message && Boolean(message.queued)
  const deliveryOutcome = resolveChatSendOutcome({
    queued: isQueued,
    sendSucceeded: !isPending && !isError && !isQueued,
    syncSucceeded: !isError && !isPending,
  })
  const time = formatMessageTime(message.created_at)
  const mediaItems = extractChatMediaItems(message.content_json)
  const hasMedia = mediaItems.length > 0
  const isMultiMedia = mediaItems.length > 1

  if (message.message_type === 'user_text') {
    return (
      <View style={[styles.userBubble, hasMedia ? styles.userMediaBubble : null]}>
        {hasMedia ? (
          <View style={styles.mediaGrid}>
            {mediaItems.map((item) => (
              <MediaContent
                authToken={token}
                compact={isMultiMedia}
                key={`${item.url}:${item.filename}`}
                media={item}
                onPreviewImage={onPreviewImage}
                onPreviewVideo={onPreviewVideo}
                runtimeHost={runtimeHost}
                tint="outbound"
              />
            ))}
          </View>
        ) : (
          <Text selectable style={styles.userBubbleText}>
            {content}
          </Text>
        )}
        <View style={styles.bubbleFooter}>
          <Text style={styles.userTime}>{time}</Text>
          {isPending ? (
            <ActivityIndicator color="rgba(13, 17, 23, 0.5)" size={10} />
          ) : deliveryOutcome === 'error' ? (
            <Ionicons color={colors.error} name="alert-circle" size={12} />
          ) : deliveryOutcome === 'queued' ? (
            <Ionicons color={colors.warning} name="time-outline" size={12} />
          ) : (
            <Ionicons color={colors.success} name="checkmark-done" size={12} />
          )}
        </View>
      </View>
    )
  }

  if (message.message_type === 'system_event') {
    const event = parseSystemEventPayload(message.content_json, t)
    return (
      <View style={styles.systemBubble}>
        <View style={styles.systemIcon}>
          <Ionicons color={colors.muted} name={event.icon} size={18} />
        </View>
        <View style={styles.systemCopy}>
          <Text selectable style={styles.systemTitle}>
            {event.title}
          </Text>
          {event.summary ? (
            <Text numberOfLines={2} selectable style={styles.systemText}>
              {event.summary}
            </Text>
          ) : null}
        </View>
      </View>
    )
  }

  if (message.message_type === 'approval_request') {
    const approvalId = parseApprovalId(message.content_json)
    const approval = parseApprovalPayload(message.content_json)
    const riskLabel = !approval.risk
      ? null
      : approval.risk === 'high'
        ? t('chat.approval.riskHigh')
        : approval.risk === 'medium'
          ? t('chat.approval.riskMedium')
          : t('chat.approval.riskOther', { level: titleCase(approval.risk) })
    return (
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          if (approvalId) onOpenApproval(approvalId)
        }}
        style={styles.approvalCard}
      >
        <View style={styles.approvalHeader}>
          <Text selectable style={styles.approvalTitle}>
            {t('chat.approval.required')}
          </Text>
          <View style={styles.reviewBadge}>
            <Ionicons color={colors.warning} name="time-outline" size={14} />
            <Text selectable style={styles.reviewBadgeText}>
              {t('chat.approval.needsReview')}
            </Text>
          </View>
        </View>
        <View style={styles.approvalContentRow}>
          <View style={styles.approvalIcon}>
            <Ionicons color={colors.warning} name="document-outline" size={24} />
          </View>
          <View style={styles.approvalCopy}>
            <Text selectable style={styles.approvalSubject}>
              {approval.action ?? t('chat.approval.fallbackSubject')}
            </Text>
            {approval.description ? (
              <Text selectable style={styles.approvalDescription}>
                {approval.description}
              </Text>
            ) : null}
          </View>
        </View>
        {riskLabel ? (
          <View style={styles.tagRow}>
            <View style={[styles.riskTag, styles.highRiskTag]}>
              <Ionicons color={colors.error} name="warning-outline" size={13} />
              <Text selectable style={styles.highRiskText}>
                {riskLabel}
              </Text>
            </View>
          </View>
        ) : null}
        {approvalId ? (
          <View style={styles.approvalActions}>
            <Pressable style={styles.denyBtn} onPress={() => void onApprove(approvalId, 'deny')}>
              <Text style={styles.denyBtnText}>{t('chat.approval.requestChanges')}</Text>
            </Pressable>
            <Pressable style={styles.allowBtn} onPress={() => void onApprove(approvalId, 'allow')}>
              <Text style={styles.allowBtnText}>{t('chat.approval.approve')}</Text>
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
          <Text selectable style={styles.workerReportTitle}>
            {t('chat.system.workerReport')}
          </Text>
        </View>
        <Text selectable style={styles.reportSummary}>
          {content}
        </Text>
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
                  <Text selectable style={[styles.workerAvatarText, { color: worker.accent }]}>
                    {workerInitials(worker.name)}
                  </Text>
                </View>
                <View style={styles.workerTileCopy}>
                  <Text numberOfLines={1} selectable style={styles.workerTileName}>
                    {worker.name}
                  </Text>
                  <Text numberOfLines={1} selectable style={styles.workerTileRole}>
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
      <View
        style={[
          styles.inboundBubble,
          message.message_type === 'orch_reply' && styles.orchestratorBubble,
        ]}
      >
        <Text selectable style={styles.senderLabel}>
          {t('chat.message.orchestratorLabel')}
        </Text>
        {hasMedia ? (
          <View style={styles.mediaGrid}>
            {mediaItems.map((item) => (
              <MediaContent
                authToken={token}
                compact={isMultiMedia}
                key={`${item.url}:${item.filename}`}
                media={item}
                onPreviewImage={onPreviewImage}
                onPreviewVideo={onPreviewVideo}
                runtimeHost={runtimeHost}
                tint="inbound"
              />
            ))}
          </View>
        ) : (
          <MarkdownText text={content} />
        )}
        <Text style={styles.inboundTime}>{time}</Text>
      </View>
    </View>
  )
}

const resolveMediaUrl = (url: string, runtimeHost: string) => {
  if (/^(https?:|file:|content:|data:|asset:)/iu.test(url)) return url
  const baseUrl = normalizeRuntimeHost(runtimeHost)
  return `${baseUrl}${url.startsWith('/') ? url : `/${url}`}`
}

const mediaSizeLabel = (size?: number) => {
  if (!size) return null
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`
  return `${(size / 1024).toFixed(0)} KB`
}

const MediaContent = ({
  authToken,
  compact = false,
  media,
  onPreviewImage,
  onPreviewVideo,
  runtimeHost,
  tint,
}: {
  authToken: string
  compact?: boolean
  media: ChatMediaItem
  onPreviewImage: (source: PreviewImageSource, label: string) => void
  onPreviewVideo: (source: PreviewImageSource, label: string) => void
  runtimeHost: string
  tint: 'outbound' | 'inbound'
}) => {
  const t = useT()
  const [imageFailed, setImageFailed] = useState(false)
  const isImage = isChatMediaImage(media)
  const isVideo = isChatMediaVideo(media)
  const lanUri = resolveMediaUrl(media.url, runtimeHost)
  // relay 模式下经 media.get 分块拉到本地缓存；LAN 模式下保持直连 URI（headers + token）。
  const relaySource = useRelayMediaSource({
    lanFallbackUri: lanUri,
    mediaUrl: media.url,
    totalSize: media.size ?? null,
  })
  const uri = relaySource.uri
  const isRemoteHttp = /^https?:\/\//iu.test(uri)
  const imageSource =
    isRemoteHttp && authToken ? { headers: { Authorization: `Bearer ${authToken}` }, uri } : { uri }
  const meta = mediaSizeLabel(media.size)
  const downloadProgressLabel = relaySource.isDownloading
    ? relaySource.progress && relaySource.progress.totalBytes > 0
      ? `${Math.min(
          100,
          Math.round((relaySource.progress.bytesDownloaded / relaySource.progress.totalBytes) * 100)
        )}%`
      : '…'
    : null

  // 钟馗 blocking #2：把"render Image / 显示下载占位 / reset failed flag"集中到
  // 纯函数 deriveMediaContentImageState 做决策（见 media-content-image-state.ts 决策表）。
  // 旧 bug：LAN onError → imageFailed=true，relay 下完切到 file:// URI 后没人 reset，
  // 图片永久挡。新逻辑：uri 一变就 reset failed；下载中根本不渲染 Image（避免 LAN
  // URI 闪红）。
  const previousUriRef = useRef<string | null>(null)
  const imageRenderState = isImage
    ? deriveMediaContentImageState({
        uri,
        previousUri: previousUriRef.current,
        imageFailed,
        isDownloading: relaySource.isDownloading,
      })
    : null
  useEffect(() => {
    if (imageRenderState?.shouldResetImageFailed) setImageFailed(false)
    previousUriRef.current = uri
  }, [imageRenderState?.shouldResetImageFailed, uri])

  if (imageRenderState?.shouldShowDownloadingPlaceholder) {
    return (
      <View
        accessibilityLabel={`${media.filename} · 4G 下载中`}
        style={compact ? mediaStyles.imageContainerCompact : mediaStyles.imageContainer}
      >
        <View style={mediaStyles.fileCard}>
          <Ionicons color={colors.accent} name="cloud-download-outline" size={24} />
          <View style={mediaStyles.fileMeta}>
            <Text numberOfLines={1} style={mediaStyles.fileNameOut}>
              {media.filename}
            </Text>
            <Text style={mediaStyles.fileSize}>{`4G 下载 ${downloadProgressLabel ?? '…'}`}</Text>
          </View>
        </View>
      </View>
    )
  }

  if (imageRenderState?.shouldRenderImage) {
    return (
      <View style={compact ? mediaStyles.imageContainerCompact : mediaStyles.imageContainer}>
        <Pressable
          accessibilityRole="button"
          onPress={() => onPreviewImage(imageSource, media.filename)}
        >
          <Image
            accessibilityLabel={media.filename}
            onError={() => setImageFailed(true)}
            source={imageSource}
            style={compact ? mediaStyles.imageCompact : mediaStyles.image}
            resizeMode="cover"
          />
        </Pressable>
      </View>
    )
  }
  if (isVideo) {
    const videoSizeText = meta
      ? t('chat.media.videoWithSize', { size: meta })
      : t('chat.media.video')
    const sublabel = downloadProgressLabel
      ? `${videoSizeText} · 4G 下载 ${downloadProgressLabel}`
      : relaySource.error
        ? `${videoSizeText} · 4G 下载失败`
        : videoSizeText
    return (
      <Pressable
        accessibilityLabel={media.filename}
        accessibilityRole="button"
        disabled={relaySource.isDownloading}
        onPress={() => onPreviewVideo(imageSource, media.filename)}
        style={mediaStyles.fileCard}
      >
        <Ionicons color={colors.accent} name="play-circle-outline" size={24} />
        <View style={mediaStyles.fileMeta}>
          <Text
            numberOfLines={1}
            selectable
            style={tint === 'outbound' ? mediaStyles.fileNameOut : mediaStyles.fileNameIn}
          >
            {media.filename}
          </Text>
          <Text selectable style={mediaStyles.fileSize}>
            {sublabel}
          </Text>
        </View>
      </Pressable>
    )
  }
  return (
    <View style={mediaStyles.fileCard}>
      <Ionicons
        color={colors.accent}
        name={isImage ? 'image-outline' : 'document-outline'}
        size={24}
      />
      <View style={mediaStyles.fileMeta}>
        <Text
          numberOfLines={1}
          selectable
          style={tint === 'outbound' ? mediaStyles.fileNameOut : mediaStyles.fileNameIn}
        >
          {media.filename}
        </Text>
        <Text selectable style={mediaStyles.fileSize}>
          {isImage
            ? meta
              ? t('chat.media.imageWithSize', { size: meta })
              : t('chat.media.image')
            : (meta ?? t('chat.media.file'))}
        </Text>
      </View>
    </View>
  )
}

const MarkdownText = ({ text }: { text: string }) => {
  const segments = buildMarkdownSegments(text)
  const seen = new Map<string, number>()
  const keyedSegments = segments.map((segment) => {
    const keyText = 'text' in segment ? segment.text : segment.type
    const count = seen.get(`${segment.type}:${keyText}`) ?? 0
    seen.set(`${segment.type}:${keyText}`, count + 1)
    return { key: `${segment.type}:${keyText || 'blank'}-${count}`, segment }
  })
  return (
    <View>
      {keyedSegments.map(({ key, segment }) => {
        if (segment.type === 'heading' && segment.level === 1) {
          return (
            <Text key={key} selectable style={mdStyles.h1}>
              {segment.text}
            </Text>
          )
        }
        if (segment.type === 'heading' && segment.level === 2) {
          return (
            <Text key={key} selectable style={mdStyles.h2}>
              {segment.text}
            </Text>
          )
        }
        if (segment.type === 'heading' && segment.level === 3) {
          return (
            <Text key={key} selectable style={mdStyles.h3}>
              {segment.text}
            </Text>
          )
        }
        if (segment.type === 'listItem') {
          return (
            <View key={key} style={mdStyles.listItem}>
              <Text selectable style={mdStyles.bullet}>
                {'  •  '}
              </Text>
              <Text selectable style={mdStyles.listText}>
                {renderInline(segment.text)}
              </Text>
            </View>
          )
        }
        if (segment.type === 'code') {
          return (
            <View key={key} style={mdStyles.codeBlock}>
              <Text selectable style={mdStyles.codeText}>
                {segment.text}
              </Text>
            </View>
          )
        }
        if (segment.type === 'spacer') {
          return <View key={key} style={mdStyles.spacer} />
        }
        return (
          <Text key={key} selectable style={mdStyles.paragraph}>
            {renderInline(segment.text)}
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
  fileCard: {
    alignItems: 'center',
    backgroundColor: 'rgba(13, 17, 23, 0.36)',
    borderColor: colors.borderMuted,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    maxWidth: 260,
    minWidth: 190,
    padding: spacing.sm,
  },
  fileMetaRow: { flexDirection: 'row', gap: 4 },
  fileMeta: { flex: 1, gap: 2 },
  fileNameIn: { color: colors.text, fontSize: 14, fontWeight: '500' },
  fileNameOut: { color: colors.text, fontSize: 14, fontWeight: '500' },
  fileSize: { color: colors.textSoft, fontSize: 12 },
  image: { borderRadius: radius.sm, height: 170, width: 230 },
  imageContainer: { maxWidth: 230 },
  imageCompact: { borderRadius: radius.sm, height: 104, width: 104 },
  imageContainerCompact: { maxWidth: 104 },
})

const mdStyles = StyleSheet.create({
  bullet: { color: colors.textSoft, fontSize: 15 },
  codeBlock: {
    backgroundColor: 'rgba(13, 17, 23, 0.36)',
    borderColor: colors.borderMuted,
    borderRadius: radius.sm,
    borderWidth: 1,
    marginVertical: 4,
    padding: spacing.sm,
  },
  codeText: {
    color: colors.text,
    fontFamily: Platform.select({ default: 'monospace', ios: 'Menlo' }),
    fontSize: 13,
    lineHeight: 19,
  },
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
    // 调小一档（15→14）：placeholder「给 orchestrator 发消息…」不再挤成两行。
    fontSize: 14,
    minHeight: COMPOSER_INPUT_MIN_HEIGHT,
    paddingHorizontal: spacing.sm,
    paddingVertical: 10,
    textAlignVertical: 'top',
  },
  keyboard: { flex: 1, gap: spacing.md },
  mediaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  keyboardLiftSpacer: { flexShrink: 0 },
  messageList: { flex: 1, minHeight: 0 },
  messages: { gap: spacing.md, paddingBottom: spacing.md },
  scrollToBottomButton: {
    alignItems: 'center',
    backgroundColor: colors.accent,
    borderRadius: 999,
    bottom: 84,
    elevation: 5,
    height: 48,
    justifyContent: 'center',
    position: 'absolute',
    right: spacing.md,
    shadowColor: colors.background,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.22,
    shadowRadius: 10,
    width: 48,
    zIndex: 10,
  },
  moreButton: { display: 'none' },
  onlineBadge: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.borderMuted,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 4,
    height: 24,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  onlineDot: { backgroundColor: colors.success, borderRadius: 3, height: 6, width: 6 },
  onlineLabel: {
    color: colors.success,
    fontSize: 10,
    fontWeight: '800',
    lineHeight: 12,
    textTransform: 'uppercase',
  },
  onlineText: { color: colors.success, fontSize: 10, fontWeight: '800', lineHeight: 12 },
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
  orchestratorBubble: {
    backgroundColor: colors.accentSoft,
    borderColor: 'rgba(88, 166, 255, 0.35)',
  },
  systemBubble: {
    alignItems: 'flex-start',
    alignSelf: 'flex-start',
    backgroundColor: colors.cardElevated,
    borderColor: colors.borderMuted,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    maxWidth: '88%',
    padding: spacing.md,
  },
  systemCopy: {
    flex: 1,
    gap: 3,
  },
  systemIcon: {
    alignItems: 'center',
    backgroundColor: 'rgba(139, 148, 158, 0.12)',
    borderColor: 'rgba(139, 148, 158, 0.2)',
    borderRadius: 999,
    borderWidth: 1,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  systemText: { color: colors.textSoft, fontSize: 13, lineHeight: 18 },
  systemTitle: { color: colors.text, fontSize: 14, fontWeight: '800' },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.md },
  titleColumn: { flex: 1, flexShrink: 1, minWidth: 0 },
  title: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '900',
  },
  subtitle: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '700',
    marginTop: 1,
  },
  titleOnlineDot: {
    backgroundColor: colors.success,
    borderRadius: 999,
    height: 10,
    marginTop: 3,
    width: 10,
  },
  titleRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs },
  buttonDisabled: {
    opacity: 0.5,
  },
  scanPhotoButton: {
    alignItems: 'center',
    alignSelf: 'stretch',
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    minHeight: 42,
    paddingHorizontal: spacing.md,
  },
  scanPhotoButtonText: {
    color: colors.background,
    fontSize: 14,
    fontWeight: '900',
  },
  scannerActions: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: colors.success,
    borderRadius: 20,
    maxWidth: '86%',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  userMediaBubble: {
    backgroundColor: 'rgba(63, 185, 80, 0.14)',
    borderColor: 'rgba(63, 185, 80, 0.32)',
    borderWidth: 1,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
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
  videoThumb: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: 8,
    height: 60,
    justifyContent: 'center',
    width: 60,
  },
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
