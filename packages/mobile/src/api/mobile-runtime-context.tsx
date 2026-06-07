import Constants from 'expo-constants'
import * as SecureStore from 'expo-secure-store'
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { AppState, type AppStateStatus } from 'react-native'
import { DEMO_CHAT_MESSAGES, DEMO_DASHBOARD } from '../demo-data'
import type { ChatSendOutcome } from '../lib/chat-send-status'
import type { RelayPairingInput } from '../lib/connection-qr'
import {
  buildStoredRelayConfig,
  parseStoredRelayConfig,
  type StoredRelayConfig,
} from '../lib/relay-config-store'
import { withUiOperationTimeout } from '../lib/ui-operation-timeout'
import { createWebRtcCaller, resolveWebRtcForceRelayEnabled } from '../lib/webrtc-caller'
import { runWebRtcConnectionProbeSession } from '../lib/webrtc-connection-probe'
import type { WebRtcInCallAudioRoute } from '../lib/webrtc-incall-manager'
import { startWebRtcInCallAudioRoute } from '../lib/webrtc-incall-manager'
import {
  applyWebRtcDownlinkVolumeToRefs,
  DEFAULT_WEBRTC_DOWNLINK_VOLUME,
  parseStoredWebRtcDownlinkVolume,
} from '../lib/webrtc-track-volume'
import { getExpoPushToken } from '../notifications'
import {
  type ChatMessage,
  createRuntimeClient,
  DEFAULT_RUNTIME_HOST,
  type MobileCockpitData,
  type MobileCommandPreset,
  type MobileConnectionMode,
  type MobileCreateWorkerInput,
  type MobileCreateWorkerResponse,
  type MobileDashboard,
  type MobileDeviceSummary,
  type MobileDispatchResponse,
  type MobilePromptSource,
  type MobileVoiceSynthesisOptions,
  type MobileWorkerTranscript,
  type MobileWorkspace,
  type MobileWorkspaceTasks,
  type RuntimeClientDiagnosticEvent,
  type RuntimeStatus,
} from './client'
import {
  appendConnectionEvent,
  buildConnectionDiagnosticsText,
  createInitialConnectionDiagnostics,
  type MobileConnectionDiagnostics,
  sanitizeRelayConfigForDiagnostics,
} from './mobile-diagnostics'
import {
  clearFailedOutboxItems,
  createApprovalOutboxItem,
  createDispatchOutboxItem,
  createMobileOutboxState,
  createPromptOutboxItem,
  enqueueOutboxItem,
  flushOutboxConcurrently,
  getOutboxCounts,
  hasQueuedOutboxItems,
  type MobileOutboxState,
  parseOutboxState,
  retryFailedOutboxItems,
  serializeOutboxState,
} from './mobile-outbox'
import { nextReconnectDelayMs, shouldAttemptAutoReconnect } from './mobile-reconnect-policy'
import type { ConnectionPreference } from './mobile-runtime-context-logic'
import {
  createDashboardSocketHandlers,
  nextChatSince,
  resetChatRuntimeForDisconnect,
  shouldApplyChatMessagesForWorkspace,
  shouldClearLoadedStateOnConnectFailure,
  shouldFlushQueuedOutbox,
  shouldProbeForegroundReconnect,
  shouldQueuePromptBeforeSend,
  shouldResetChatForConnectionSwitch,
  shouldResetChatForWorkspaceSwitch,
  shouldResetLanCooldownBeforeForegroundProbe,
} from './mobile-runtime-context-logic'
import { generateDeviceKeypair } from './relay-device-keys'
import { resolveRelayEventActions } from './relay-event-actions'
import type { RelayTransportEvent } from './relay-transport'
import { createRelayTransportRegistry } from './relay-transport-registry'
import type {
  VoiceStreamAudioResult,
  VoiceStreamLatencyOptions,
  VoiceStreamLatencyResult,
} from './voice-stream-protocol'

export type { RelayPairingInput }

const RUNTIME_HOST_KEY = 'hippoteam.runtimeHost'
const MOBILE_TOKEN_KEY = 'hippoteam.mobileToken'
const WORKSPACE_ID_KEY = 'hippoteam.mobileWorkspaceId'
const RELAY_CONFIG_KEY = 'hippoteam.mobileRelayConfig'
const OUTBOX_KEY = 'hippoteam.mobileOutbox'
const WEBRTC_DOWNLINK_VOLUME_KEY = 'hippoteam.webRtcDownlinkVolume'

export type MobileRuntimeState = 'idle' | 'checking' | 'connected' | 'error'
type RuntimeClient = ReturnType<typeof createRuntimeClient>
export type MobileVoiceSynthesisResult = { audio: string; format: string; mime: string }
export type WebRtcConnectionProbeResult =
  | { callId: string; ok: true }
  | { ok: false; reason: string }
export type WebRtcTestCallState =
  | { status: 'idle' }
  | { status: 'connecting' }
  | { callId: string; remoteAudioTrackCount: number; status: 'connected' }
  | { reason: string; status: 'error' }

type WebRtcAudioSender = { track?: { enabled?: boolean; kind?: string } | null } | null
type WebRtcCallerSession = {
  callId: string
  close: () => void
  peerConnection?: unknown
  waitForConnected: (timeoutMs?: number) => Promise<void>
}

interface MobileRuntimeContextValue {
  answerQuestion: (questionId: string, answer: string) => Promise<boolean>
  approveRequest: (approvalId: string, decision: 'allow' | 'deny') => Promise<boolean>
  chatMessages: ChatMessage[]
  connect: (
    nextHost: string,
    nextToken: string,
    nextRelayConfig?: StoredRelayConfig | null,
    options?: { preserveUiState?: boolean; preferredConnectionMode?: ConnectionPreference }
  ) => Promise<RuntimeStatus | null>
  configureRelay: (input: RelayPairingInput) => Promise<StoredRelayConfig>
  connectionMode: MobileConnectionMode
  connectionDiagnostics: MobileConnectionDiagnostics
  connectionDiagnosticsText: string
  createWorker: (input: MobileCreateWorkerInput) => Promise<MobileCreateWorkerResponse | null>
  dashboard: MobileDashboard | null
  demoMode: boolean
  disconnect: () => Promise<void>
  dispatchTask: (workerId: string, task: string) => Promise<MobileDispatchResponse | null>
  listCommandPresets: () => Promise<MobileCommandPreset[]>
  measureRelayVoiceStreamLatency: (
    options?: VoiceStreamLatencyOptions
  ) => Promise<VoiceStreamLatencyResult | null>
  enableDemoMode: () => void
  error: string | null
  fetchChatMessages: (options?: { resetSince?: boolean }) => Promise<void>
  getCockpit: () => Promise<MobileCockpitData | null>
  getWorkerTranscript: (workerId: string) => Promise<MobileWorkerTranscript | null>
  getWorkspaceTasks: () => Promise<MobileWorkspaceTasks | null>
  host: string
  pairedDevice: MobileDeviceSummary | null
  outboxFailedCount: number
  outboxPendingCount: number
  outboxSendingCount: number
  reconnecting: boolean
  relayConfig: StoredRelayConfig | null
  refreshDashboard: (workspaceId?: string) => Promise<MobileDashboard | null>
  restartWorker: (workerId: string) => Promise<boolean>
  runtimeStatus: RuntimeStatus | null
  clearFailedOutbox: () => Promise<void>
  retryOutbox: () => Promise<void>
  runWebRtcConnectionProbe: () => Promise<WebRtcConnectionProbeResult>
  selectWorkspace: (workspaceId: string) => Promise<void>
  selectedWorkspaceId: string | null
  sendPromptToOrchestrator: (text: string) => Promise<boolean>
  sendPromptToOrchestratorWithOutcome: (
    text: string,
    options?: { source?: MobilePromptSource }
  ) => Promise<ChatSendOutcome>
  setHost: (host: string) => void
  setToken: (token: string) => void
  setWebRtcDownlinkVolume: (volume: number) => void
  setWebRtcCallMuted: (muted: boolean) => boolean
  startWebRtcTestCall: () => Promise<WebRtcConnectionProbeResult>
  state: MobileRuntimeState
  stopWebRtcTestCall: () => void
  syncRevision: number
  stopWorker: (workerId: string) => Promise<boolean>
  token: string
  transcribeVoice: (audioBase64: string, format?: string) => Promise<string | null>
  synthesizeVoice: (
    text: string,
    options?: MobileVoiceSynthesisOptions
  ) => Promise<MobileVoiceSynthesisResult | null>
  synthesizeVoiceStream: (
    text: string,
    options?: MobileVoiceSynthesisOptions
  ) => Promise<VoiceStreamAudioResult | null>
  uploadMedia: (
    data: string,
    filename: string,
    mimeType: string
  ) => Promise<{ file_id: string; url: string } | null>
  webRtcTestCall: WebRtcTestCallState
  webRtcDownlinkVolume: number
  workspaces: MobileWorkspace[]
}

const MobileRuntimeContext = createContext<MobileRuntimeContextValue | null>(null)

const secureSet = async (key: string, value: string) => {
  try {
    await SecureStore.setItemAsync(key, value)
  } catch {
    // SecureStore can be unavailable in web/simulator paths; in-memory state still works.
  }
}

const secureGet = async (key: string) => {
  try {
    return await SecureStore.getItemAsync(key)
  } catch {
    return null
  }
}

const secureDelete = async (key: string) => {
  try {
    await SecureStore.deleteItemAsync(key)
  } catch {
    // SecureStore can be unavailable in web/simulator paths; in-memory state still works.
  }
}

const chooseWorkspace = (workspaces: MobileWorkspace[], preferredWorkspaceId: string | null) =>
  workspaces.find((workspace) => workspace.id === preferredWorkspaceId)?.id ??
  workspaces[0]?.id ??
  null

const getWebRtcRuntimeExtra = () =>
  Constants.expoConfig?.extra && typeof Constants.expoConfig.extra === 'object'
    ? (Constants.expoConfig.extra as { webRtcForceRelay?: unknown })
    : undefined

export const MobileRuntimeProvider = ({ children }: PropsWithChildren) => {
  const [host, setHost] = useState(DEFAULT_RUNTIME_HOST)
  const [token, setToken] = useState('')
  const [demoMode, setDemoMode] = useState(false)
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null)
  const [workspaces, setWorkspaces] = useState<MobileWorkspace[]>([])
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus | null>(null)
  const [dashboard, setDashboard] = useState<MobileDashboard | null>(null)
  const [pairedDevice, setPairedDevice] = useState<MobileDeviceSummary | null>(null)
  const [relayConfig, setRelayConfig] = useState<StoredRelayConfig | null>(null)
  const [connectionMode, setConnectionMode] = useState<MobileConnectionMode>('disconnected')
  const [preferredConnectionMode, setPreferredConnectionMode] =
    useState<ConnectionPreference>('auto')
  const [connectionDiagnostics, setConnectionDiagnostics] = useState<MobileConnectionDiagnostics>(
    () => createInitialConnectionDiagnostics()
  )
  const [state, setState] = useState<MobileRuntimeState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [reconnecting, setReconnecting] = useState(false)
  // dispatch 8855a45c 修复3：relay transport 是否 ready 的响应式信号，用于 flush 门槛 + relay 转 ready
  // 重新触发 flush。由 getRelayTransport 订阅 transport 状态变更更新；disconnect / 无 relay 时置 false。
  const [relayTransportReady, setRelayTransportReady] = useState(false)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [outbox, setOutbox] = useState<MobileOutboxState>(createMobileOutboxState())
  const [syncRevision, setSyncRevision] = useState(0)
  const [webRtcTestCall, setWebRtcTestCall] = useState<WebRtcTestCallState>({ status: 'idle' })
  const [webRtcDownlinkVolume, setWebRtcDownlinkVolumeState] = useState(
    DEFAULT_WEBRTC_DOWNLINK_VOLUME
  )
  const chatSinceRef = useRef<number | undefined>(undefined)
  const chatFetchFailureCountRef = useRef(0)
  const reconnectAttemptRef = useRef(0)
  const reconnectInFlightRef = useRef(false)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const outboxFlushInFlightRef = useRef(false)
  const outboxLoadedRef = useRef(false)
  const webRtcTestCallSessionRef = useRef<WebRtcCallerSession | null>(null)
  const webRtcTestCallAudioRouteRef = useRef<WebRtcInCallAudioRoute | null>(null)
  const webRtcRemoteAudioRefsRef = useRef<unknown[]>([])
  const webRtcDownlinkVolumeRef = useRef(DEFAULT_WEBRTC_DOWNLINK_VOLUME)
  const relayTransportRegistryRef = useRef(createRelayTransportRegistry())
  const relayDiagnosticsUnsubscribeRef = useRef<(() => void) | null>(null)
  // M27 Part B：relay 服务器推送事件的处理器（指向最新闭包，避免 getRelayTransport 依赖 churn）
  // + 订阅取消句柄。事件→即时 merge chat / 刷新 dashboard，治 5s 轮询延迟。
  const relayEventHandlerRef = useRef<(event: RelayTransportEvent) => void>(() => {})
  const relayEventUnsubscribeRef = useRef<(() => void) | null>(null)
  const observedRelayTransportRef = useRef<ReturnType<
    ReturnType<typeof createRelayTransportRegistry>['get']
  > | null>(null)
  const appStateRef = useRef<AppStateStatus>(AppState.currentState)
  const hostRef = useRef(host)
  const tokenRef = useRef(token)
  const relayConfigRef = useRef(relayConfig)
  const selectedWorkspaceIdRef = useRef(selectedWorkspaceId)
  const connectionModeRef = useRef(connectionMode)
  const preferredConnectionModeRef = useRef(preferredConnectionMode)
  const stateRef = useRef(state)
  const outboxRef = useRef(outbox)
  const reconnectingRef = useRef(reconnecting)
  const dashboardRef = useRef(dashboard)

  hostRef.current = host
  tokenRef.current = token
  relayConfigRef.current = relayConfig
  selectedWorkspaceIdRef.current = selectedWorkspaceId
  connectionModeRef.current = connectionMode
  preferredConnectionModeRef.current = preferredConnectionMode
  stateRef.current = state
  outboxRef.current = outbox
  reconnectingRef.current = reconnecting
  dashboardRef.current = dashboard

  const syncReconnectingState = useCallback(() => {
    setReconnecting(Boolean(reconnectInFlightRef.current || reconnectTimerRef.current))
  }, [])

  const appendDiagnosticEvent = useCallback(
    (event: { detail?: string; ts?: number; type: string }) => {
      setConnectionDiagnostics((current) => appendConnectionEvent(current, event))
    },
    []
  )

  const recordClientDiagnosticEvent = useCallback((event: RuntimeClientDiagnosticEvent) => {
    setConnectionDiagnostics((current) => {
      const detail =
        event.type === 'lan_attempt'
          ? `${event.ok ? 'ok' : 'failed'} ${event.path ?? 'unknown path'}${event.durationMs === undefined ? '' : ` ${event.durationMs}ms`}${event.error ? ` ${event.error}` : ''}`
          : `${event.ok ? 'ok' : 'failed'} ${event.method ?? 'unknown method'} status=${event.status ?? 'unknown'}${event.error ? ` ${event.error}` : ''}`
      const next = appendConnectionEvent(current, {
        detail,
        ts: event.ts,
        type: event.type,
      })
      if (event.type === 'lan_attempt') return { ...next, lastLanAttempt: event }
      return { ...next, lastRelayResult: event }
    })
  }, [])

  const getRelayTransport = useCallback(
    (nextToken: string, nextRelayConfig: StoredRelayConfig | null) => {
      const transport = relayTransportRegistryRef.current.get(nextToken, nextRelayConfig)
      if (observedRelayTransportRef.current === transport) return transport
      relayDiagnosticsUnsubscribeRef.current?.()
      relayDiagnosticsUnsubscribeRef.current = null
      relayEventUnsubscribeRef.current?.()
      relayEventUnsubscribeRef.current = null
      observedRelayTransportRef.current = transport
      // 切换 transport（含切到 null）时，relay-ready 信号按当前实际状态重置（修复3）。
      setRelayTransportReady(transport ? transport.status() === 'ready' : false)
      // M27 Part B：订阅服务器推送事件（chat/dashboard），通过 ref 转发到最新处理器闭包，
      // 不把 mergeChatMessages/refreshDashboard 拉进 getRelayTransport 依赖（否则 client useMemo 连锁重建）。
      if (transport) {
        relayEventUnsubscribeRef.current = transport.onEvent((event) =>
          relayEventHandlerRef.current(event)
        )
      }
      if (transport?.onDiagnosticsEvent) {
        relayDiagnosticsUnsubscribeRef.current = transport.onDiagnosticsEvent((event) => {
          const detail =
            event.type === 'status'
              ? event.status
              : event.type === 'socket_close'
                ? `code=${event.code ?? 'unknown'} reason=${event.reason ?? 'none'}`
                : event.error
          appendDiagnosticEvent({
            detail,
            ts: event.ts,
            type: `relay_${event.type}`,
          })
          if (event.type === 'status' && event.status) {
            setRelayTransportReady(event.status === 'ready')
            setConnectionDiagnostics((current) => ({
              ...current,
              lastRelayResult: {
                ...(current.lastRelayResult ?? { ok: false, ts: event.ts }),
                ok: event.status === 'ready',
                status: event.status,
                ts: event.ts,
              },
            }))
          }
        })
      } else if (transport) {
        relayDiagnosticsUnsubscribeRef.current = transport.onStatusChange((status) => {
          setRelayTransportReady(status === 'ready')
          appendDiagnosticEvent({ detail: status, type: 'relay_status' })
        })
      }
      return transport
    },
    [appendDiagnosticEvent]
  )

  const applyConnectionPreference = useCallback(
    (nextClient: RuntimeClient, preference: ConnectionPreference) => {
      if (preference === 'lan') {
        nextClient.resetLanCooldown()
      } else if (preference === 'relay') {
        nextClient.preferRelayUntilReset()
      }
    },
    []
  )

  const client = useMemo(() => {
    const nextClient = createRuntimeClient({
      host,
      onDiagnosticsEvent: recordClientDiagnosticEvent,
      relayTransport: getRelayTransport(token, relayConfig),
      token: token.trim() || null,
    })
    applyConnectionPreference(nextClient, preferredConnectionMode)
    return nextClient
  }, [
    applyConnectionPreference,
    getRelayTransport,
    host,
    preferredConnectionMode,
    recordClientDiagnosticEvent,
    relayConfig,
    token,
  ])
  // 始终指向最新 client（M 修复）：flushOutbox 等长任务在 await 期间若切了 token/host，闭包里的旧 client
  // 会把请求发到旧连接；用 ref 取最新。
  const clientRef = useRef(client)
  clientRef.current = client

  const registerPushToken = useCallback(
    async (nextClient = client) => {
      const pushToken = await getExpoPushToken()
      if (!pushToken) return
      try {
        await nextClient.registerPushToken(pushToken)
      } catch {
        // Push is best-effort; connection should still succeed without it.
      }
    },
    [client]
  )

  const mergeChatMessages = useCallback((messages: ChatMessage[]) => {
    if (messages.length === 0) return
    setChatMessages((prev) => {
      const byId = new Map(prev.map((message) => [message.id, message]))
      for (const message of messages) byId.set(message.id, message)
      return [...byId.values()].sort((a, b) => a.created_at - b.created_at)
    })
    // chatSince 只前进不后退（M 修复）：relay 推送可能送来更早/乱序的消息，单调推进防 since 倒退重复拉。
    chatSinceRef.current = nextChatSince(chatSinceRef.current, messages)
  }, [])

  const resetChatForWorkspace = useCallback((workspaceId: string | null, force = false) => {
    if (
      !force &&
      !shouldResetChatForWorkspaceSwitch({
        currentWorkspaceId: selectedWorkspaceIdRef.current,
        nextWorkspaceId: workspaceId,
      })
    ) {
      return
    }
    chatSinceRef.current = undefined
    chatFetchFailureCountRef.current = 0
    setChatMessages([])
  }, [])

  const syncChatMessages = useCallback(
    async (
      nextClient: RuntimeClient,
      workspaceId: string,
      options: { resetSince?: boolean } = {}
    ) => {
      if (options.resetSince) chatSinceRef.current = undefined
      const res = await nextClient.getChatMessages(workspaceId, chatSinceRef.current)
      if (
        !shouldApplyChatMessagesForWorkspace({
          currentWorkspaceId: selectedWorkspaceIdRef.current,
          requestedWorkspaceId: workspaceId,
        })
      ) {
        return
      }
      mergeChatMessages(res.messages)
      chatFetchFailureCountRef.current = 0
    },
    [mergeChatMessages]
  )

  const bumpSyncRevision = useCallback(() => {
    setSyncRevision((current) => current + 1)
  }, [])

  const refreshDashboard = useCallback(
    async (workspaceId = selectedWorkspaceId, options: { suppressError?: boolean } = {}) => {
      if (!workspaceId) {
        setDashboard(null)
        return null
      }
      try {
        const nextDashboard = await client.getMobileDashboard(workspaceId)
        // 到达时守卫（M 修复）：请求在途时用户可能已切到别的 workspace（ref 已更新），此时丢弃过期响应，
        // 否则把 A 的 dashboard 覆盖到 B 的 UI（跨 workspace 数据串写）。
        if (selectedWorkspaceIdRef.current !== workspaceId) return null
        setDashboard(nextDashboard)
        return nextDashboard
      } catch (dashboardError) {
        // 失败路径也加到达时守卫（non-blocking 修复）：切到别的 workspace 后，A 的失败不得 setError 污染当前。
        if (selectedWorkspaceIdRef.current !== workspaceId) return null
        if (!options.suppressError) {
          const message =
            dashboardError instanceof Error ? dashboardError.message : String(dashboardError)
          setError(message)
        }
        return null
      }
    },
    [client, selectedWorkspaceId]
  )

  // M27 Part B：把 relay 服务器推送事件落到 state（只处理当前 workspace）。
  // chat 消息直接 merge（store 消息字段是 mobile ChatMessage 超集，安全）；dashboard 信号触发即时刷新。
  // 每次 render 重指最新闭包，始终用最新 mergeChatMessages/refreshDashboard。
  relayEventHandlerRef.current = (event: RelayTransportEvent) => {
    const actions = resolveRelayEventActions(event, selectedWorkspaceIdRef.current)
    if (actions.mergeChatMessage) mergeChatMessages([actions.mergeChatMessage])
    if (actions.refreshDashboardWorkspaceId)
      void refreshDashboard(actions.refreshDashboardWorkspaceId)
    // dashboard_update 才 bump：让 cockpit 各标签页（plan/tasks/questions/ideas/actions）随
    // .hive 变更推送一起 refetch，整个 Cockpit 与 web（chokidar+WS）一样实时；chat_message 只 merge 不 bump。
    if (actions.bumpSyncRevision) bumpSyncRevision()
  }

  const syncWorkspaceData = useCallback(
    async (workspaceId: string, options: { bumpRevision?: boolean; resetChat?: boolean } = {}) => {
      if (selectedWorkspaceIdRef.current !== workspaceId) return
      await refreshDashboard(workspaceId, { suppressError: true })
      try {
        await syncChatMessages(client, workspaceId, {
          resetSince: options.resetChat ?? false,
        })
      } catch {
        // Chat catch-up is best-effort; the poller and reconnect loop keep retrying.
      }
      // 二次 workspace 守卫（non-blocking 修复）：await 期间切走后不再为旧 workspace 多余 bump 触发 refetch。
      if (selectedWorkspaceIdRef.current !== workspaceId) return
      if (options.bumpRevision ?? true) {
        bumpSyncRevision()
      }
    },
    [bumpSyncRevision, client, refreshDashboard, syncChatMessages]
  )

  const flushOutbox = useCallback(async () => {
    if (outboxFlushInFlightRef.current) return
    if (reconnectingRef.current) return
    if (stateRef.current !== 'connected') return
    if (!hasQueuedOutboxItems(outboxRef.current)) return
    outboxFlushInFlightRef.current = true
    try {
      // CRITICAL 竞态修复：对快照 flush，但用**函数式 commit**(setOutbox(updater)) 只移除已发 id、
      // 标失败项、保留 flush 期间并发入队的新消息——绝不用 setOutbox(衍生值) 整体覆盖（会静默丢失
      // flush 期间用户发的消息）。编排+合并在 flushOutboxConcurrently 内，已被并发竞态测试覆盖。
      const { sentCount } = await flushOutboxConcurrently(
        outboxRef.current,
        async (item) => {
          // 用 clientRef.current（M 修复）：flush 在 await 期间若切了 token/host，旧闭包 client 会发到旧连接。
          const activeClient = clientRef.current
          if (item.kind === 'prompt') {
            await activeClient.sendPromptToOrchestrator(item.workspaceId, item.payload.text)
            await syncWorkspaceData(item.workspaceId, {
              bumpRevision: false,
              resetChat: true,
            })
            return
          }
          if (item.kind === 'dispatch') {
            await activeClient.dispatchTask(
              item.workspaceId,
              item.payload.workerId,
              item.payload.task
            )
            await syncWorkspaceData(item.workspaceId, {
              bumpRevision: false,
              resetChat: true,
            })
            return
          }
          await activeClient.approveRequest(
            item.workspaceId,
            item.payload.approvalId,
            item.payload.decision
          )
          await syncWorkspaceData(item.workspaceId, {
            bumpRevision: false,
            resetChat: true,
          })
        },
        setOutbox
      )
      if (sentCount > 0) {
        bumpSyncRevision()
      }
    } finally {
      outboxFlushInFlightRef.current = false
    }
  }, [bumpSyncRevision, syncWorkspaceData])

  useEffect(() => {
    const unsubscribe = client.onConnectionModeChange((mode) =>
      setConnectionMode(mode as MobileConnectionMode)
    )
    return () => {
      unsubscribe()
    }
  }, [client])

  const connect = useCallback(
    async (
      nextHost: string,
      nextToken: string,
      nextRelayConfig = relayConfig,
      options: { preserveUiState?: boolean; preferredConnectionMode?: ConnectionPreference } = {}
    ) => {
      const trimmedToken = nextToken.trim()
      const nextPreference = options.preferredConnectionMode ?? preferredConnectionModeRef.current
      if (!options.preserveUiState) {
        setState('checking')
        setError(null)
      }
      try {
        const nextClient = createRuntimeClient({
          host: nextHost,
          onDiagnosticsEvent: recordClientDiagnosticEvent,
          relayTransport: getRelayTransport(trimmedToken, nextRelayConfig),
          token: trimmedToken,
        })
        applyConnectionPreference(nextClient, nextPreference)
        const [nextStatus, nextWorkspaces] = await withUiOperationTimeout(
          Promise.all([nextClient.getMobileRuntimeStatus(), nextClient.listMobileWorkspaces()]),
          { label: 'runtime connect' }
        )
        // 用 ref 最新值而非渲染闭包的 selectedWorkspaceId（M 修复）：启动时 setSelectedWorkspaceId 还没
        // flush，闭包是 null → chooseWorkspace 误选 workspaces[0]、丢持久化偏好；重连时闭包可能是切换前旧值。
        const nextWorkspaceId = chooseWorkspace(nextWorkspaces, selectedWorkspaceIdRef.current)
        const nextDashboard = nextWorkspaceId
          ? await withUiOperationTimeout(nextClient.getMobileDashboard(nextWorkspaceId), {
              label: 'dashboard load',
            })
          : null
        void registerPushToken(nextClient)
        const shouldResetForConnection = shouldResetChatForConnectionSwitch({
          currentHost: hostRef.current,
          currentToken: tokenRef.current.trim(),
          nextHost,
          nextToken: trimmedToken,
        })

        setHost(nextHost)
        setToken(trimmedToken)
        setRuntimeStatus(nextStatus)
        setWorkspaces(nextWorkspaces)
        resetChatForWorkspace(nextWorkspaceId, shouldResetForConnection)
        selectedWorkspaceIdRef.current = nextWorkspaceId
        setSelectedWorkspaceId(nextWorkspaceId)
        setDashboard(nextDashboard)
        setConnectionMode(nextClient.connectionMode())
        setPreferredConnectionMode(nextPreference)
        setState('connected')
        reconnectAttemptRef.current = 0
        chatFetchFailureCountRef.current = 0

        await Promise.all([
          secureSet(RUNTIME_HOST_KEY, nextHost),
          secureSet(MOBILE_TOKEN_KEY, trimmedToken),
          nextWorkspaceId ? secureSet(WORKSPACE_ID_KEY, nextWorkspaceId) : Promise.resolve(),
        ])
        if (nextWorkspaceId) {
          try {
            await syncChatMessages(nextClient, nextWorkspaceId, { resetSince: true })
          } catch {
            // Chat catch-up is retried by the poller/reconnect loop; do not fail a healthy connect.
          }
        }
        bumpSyncRevision()
        void flushOutbox()
        return nextStatus
      } catch (connectError) {
        if (!options.preserveUiState) {
          const message =
            connectError instanceof Error ? connectError.message : String(connectError)
          setError(message)
          if (shouldClearLoadedStateOnConnectFailure(Boolean(dashboardRef.current))) {
            setDashboard(null)
            setRuntimeStatus(null)
          }
          setState('error')
        }
        return null
      }
    },
    [
      applyConnectionPreference,
      bumpSyncRevision,
      flushOutbox,
      getRelayTransport,
      registerPushToken,
      recordClientDiagnosticEvent,
      relayConfig,
      resetChatForWorkspace,
      syncChatMessages,
    ]
  )
  const connectRef = useRef(connect)
  connectRef.current = connect

  const selectWorkspace = useCallback(
    async (workspaceId: string) => {
      resetChatForWorkspace(workspaceId)
      selectedWorkspaceIdRef.current = workspaceId
      setSelectedWorkspaceId(workspaceId)
      await secureSet(WORKSPACE_ID_KEY, workspaceId)
      await refreshDashboard(workspaceId)
      try {
        await syncChatMessages(client, workspaceId, { resetSince: true })
      } catch {
        // Chat catch-up is retried by the poller/reconnect loop.
      }
      bumpSyncRevision()
    },
    [bumpSyncRevision, client, refreshDashboard, resetChatForWorkspace, syncChatMessages]
  )

  const disconnect = useCallback(async () => {
    const audioRoute = webRtcTestCallAudioRouteRef.current
    webRtcTestCallSessionRef.current?.close()
    webRtcTestCallSessionRef.current = null
    webRtcTestCallAudioRouteRef.current = null
    webRtcRemoteAudioRefsRef.current = []
    void audioRoute?.stop().catch(() => {})
    setWebRtcTestCall({ status: 'idle' })
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }
    reconnectAttemptRef.current = 0
    chatFetchFailureCountRef.current = 0
    setToken('')
    setRuntimeStatus(null)
    setDashboard(null)
    setWorkspaces([])
    const chatReset = resetChatRuntimeForDisconnect()
    selectedWorkspaceIdRef.current = chatReset.selectedWorkspaceId
    setSelectedWorkspaceId(chatReset.selectedWorkspaceId)
    chatSinceRef.current = chatReset.chatSince
    if (chatReset.shouldClearMessages) setChatMessages([])
    setPairedDevice(null)
    setRelayConfig(null)
    relayDiagnosticsUnsubscribeRef.current?.()
    relayDiagnosticsUnsubscribeRef.current = null
    relayEventUnsubscribeRef.current?.()
    relayEventUnsubscribeRef.current = null
    observedRelayTransportRef.current = null
    relayTransportRegistryRef.current.close()
    setRelayTransportReady(false)
    setConnectionMode('disconnected')
    setState('idle')
    setError(null)
    await Promise.all([
      secureDelete(MOBILE_TOKEN_KEY),
      secureDelete(WORKSPACE_ID_KEY),
      secureDelete(RELAY_CONFIG_KEY),
    ])
  }, [])

  // 把扫码 / 手动录入的 relay 配置 + 本机生成的 device keypair 持久化到 SecureStore，
  // 并更新 relayConfig state。relayConfig 一变，下面的 client useMemo 会重建带 relayTransport 的
  // client，LAN 连不上时即可回落 relay。
  const configureRelay = useCallback(async (input: RelayPairingInput) => {
    const next = buildStoredRelayConfig(input, generateDeviceKeypair())
    await secureSet(RELAY_CONFIG_KEY, JSON.stringify(next))
    relayConfigRef.current = next
    setRelayConfig(next)
    return next
  }, [])

  const stopWorker = useCallback(
    async (workerId: string) => {
      if (!selectedWorkspaceId) {
        setError('Select a workspace before controlling workers')
        return false
      }
      setError(null)
      try {
        await client.stopWorker(selectedWorkspaceId, workerId)
        await refreshDashboard(selectedWorkspaceId)
        bumpSyncRevision()
        return true
      } catch (stopError) {
        const message = stopError instanceof Error ? stopError.message : String(stopError)
        setError(message)
        return false
      }
    },
    [bumpSyncRevision, client, refreshDashboard, selectedWorkspaceId]
  )

  const restartWorker = useCallback(
    async (workerId: string) => {
      if (!selectedWorkspaceId) {
        setError('Select a workspace before controlling workers')
        return false
      }
      setError(null)
      try {
        await client.restartWorker(selectedWorkspaceId, workerId)
        await refreshDashboard(selectedWorkspaceId)
        bumpSyncRevision()
        return true
      } catch (restartError) {
        const message = restartError instanceof Error ? restartError.message : String(restartError)
        setError(message)
        return false
      }
    },
    [bumpSyncRevision, client, refreshDashboard, selectedWorkspaceId]
  )

  const dispatchTask = useCallback(
    async (workerId: string, task: string) => {
      if (!selectedWorkspaceId) {
        setError('Select a workspace before dispatching tasks')
        return null
      }
      setError(null)
      if (stateRef.current !== 'connected') {
        setOutbox((current) =>
          enqueueOutboxItem(
            current,
            createDispatchOutboxItem({
              task,
              workerId,
              workspaceId: selectedWorkspaceId,
            })
          )
        )
        return null
      }
      try {
        const dispatch = await client.dispatchTask(selectedWorkspaceId, workerId, task)
        await syncWorkspaceData(selectedWorkspaceId, { resetChat: true })
        return dispatch
      } catch (dispatchError) {
        const message =
          dispatchError instanceof Error ? dispatchError.message : String(dispatchError)
        setOutbox((current) =>
          enqueueOutboxItem(
            current,
            createDispatchOutboxItem(
              {
                task,
                workerId,
                workspaceId: selectedWorkspaceId,
              },
              { status: 'failed' }
            )
          )
        )
        setError(message)
        return null
      }
    },
    [client, selectedWorkspaceId, syncWorkspaceData]
  )

  const listCommandPresets = useCallback(async () => {
    setError(null)
    try {
      return await client.listCommandPresets()
    } catch (presetError) {
      const message = presetError instanceof Error ? presetError.message : String(presetError)
      setError(message)
      return []
    }
  }, [client])

  const createWorker = useCallback(
    async (input: MobileCreateWorkerInput) => {
      if (!selectedWorkspaceId) {
        setError('Select a workspace before creating workers')
        return null
      }
      setError(null)
      try {
        const result = await client.createWorker(selectedWorkspaceId, input)
        await refreshDashboard(selectedWorkspaceId)
        bumpSyncRevision()
        return result
      } catch (createError) {
        const message = createError instanceof Error ? createError.message : String(createError)
        setError(message)
        return null
      }
    },
    [bumpSyncRevision, client, refreshDashboard, selectedWorkspaceId]
  )

  const getWorkerTranscript = useCallback(
    async (workerId: string) => {
      if (!selectedWorkspaceId) {
        setError('Select a workspace before reading worker output')
        return null
      }
      setError(null)
      try {
        return await client.getWorkerTranscript(selectedWorkspaceId, workerId)
      } catch (transcriptError) {
        const message =
          transcriptError instanceof Error ? transcriptError.message : String(transcriptError)
        setError(message)
        return null
      }
    },
    [client, selectedWorkspaceId]
  )

  const getWorkspaceTasks = useCallback(async () => {
    if (!selectedWorkspaceId) {
      setError('Select a workspace before reading tasks')
      return null
    }
    setError(null)
    try {
      return await client.getWorkspaceTasks(selectedWorkspaceId)
    } catch (tasksError) {
      const message = tasksError instanceof Error ? tasksError.message : String(tasksError)
      setError(message)
      return null
    }
  }, [client, selectedWorkspaceId])

  const getCockpit = useCallback(async () => {
    if (!selectedWorkspaceId) {
      setError('Select a workspace before reading cockpit')
      return null
    }
    setError(null)
    try {
      return await client.getCockpit(selectedWorkspaceId)
    } catch (cockpitError) {
      const message = cockpitError instanceof Error ? cockpitError.message : String(cockpitError)
      setError(message)
      return null
    }
  }, [client, selectedWorkspaceId])

  const outboxCounts = useMemo(
    () => getOutboxCounts(demoMode ? createMobileOutboxState() : outbox),
    [demoMode, outbox]
  )

  const answerQuestion = useCallback(
    async (questionId: string, answer: string) => {
      if (!selectedWorkspaceId) {
        setError('Select a workspace before answering questions')
        return false
      }
      setError(null)
      try {
        await client.answerQuestion(selectedWorkspaceId, questionId, answer)
        await syncWorkspaceData(selectedWorkspaceId, { resetChat: true })
        return true
      } catch (answerError) {
        const message = answerError instanceof Error ? answerError.message : String(answerError)
        setError(message)
        return false
      }
    },
    [client, selectedWorkspaceId, syncWorkspaceData]
  )

  const transcribeVoice = useCallback(
    async (audioBase64: string, format = 'm4a') => {
      setError(null)
      try {
        const result = await client.transcribeVoice(audioBase64, format)
        if ('error' in result && result.error) {
          setError(result.error as string)
          return null
        }
        return result.text
      } catch (voiceError) {
        const message = voiceError instanceof Error ? voiceError.message : String(voiceError)
        setError(message)
        return null
      }
    },
    [client]
  )

  const synthesizeVoice = useCallback(
    async (text: string, options: MobileVoiceSynthesisOptions = {}) => {
      setError(null)
      try {
        const result = await client.synthesizeVoice(text, options)
        if ('error' in result && result.error) {
          setError(result.error)
          return null
        }
        const success = result as { audio: string; format: string; mime: string }
        return { audio: success.audio, format: success.format, mime: success.mime }
      } catch (ttsError) {
        const message = ttsError instanceof Error ? ttsError.message : String(ttsError)
        setError(message)
        return null
      }
    },
    [client]
  )

  const measureRelayVoiceStreamLatency = useCallback(
    async (options?: VoiceStreamLatencyOptions) => {
      const transport = observedRelayTransportRef.current
      if (!transport || transport.status() !== 'ready') {
        setError('Relay transport is not ready')
        return null
      }
      setError(null)
      try {
        return await transport.measureVoiceStreamLatency(options)
      } catch (latencyError) {
        const message = latencyError instanceof Error ? latencyError.message : String(latencyError)
        setError(message)
        return null
      }
    },
    []
  )

  const synthesizeVoiceStream = useCallback(
    async (text: string, options: MobileVoiceSynthesisOptions = {}) => {
      const transport = observedRelayTransportRef.current
      if (!transport || transport.status() !== 'ready') {
        setError('Relay transport is not ready')
        return null
      }
      setError(null)
      try {
        return await transport.requestVoiceStreamSynthesis(text, options)
      } catch (streamError) {
        const message = streamError instanceof Error ? streamError.message : String(streamError)
        setError(message)
        return null
      }
    },
    []
  )

  const runWebRtcConnectionProbe = useCallback(async (): Promise<WebRtcConnectionProbeResult> => {
    const transport = observedRelayTransportRef.current
    if (!transport || transport.status() !== 'ready') {
      return { ok: false, reason: 'Relay transport is not ready' }
    }
    const workspaceId = selectedWorkspaceIdRef.current
    if (!workspaceId) {
      return { ok: false, reason: 'Select a workspace before starting WebRTC' }
    }
    setError(null)
    const result = await runWebRtcConnectionProbeSession(async () => {
      const session = await createWebRtcCaller({
        audio: true,
        forceRelay: resolveWebRtcForceRelayEnabled(getWebRtcRuntimeExtra()),
        transport,
        workspaceId,
      }).start()
      console.log('[WEBRTCDBG] connection_probe_started', { callId: session.callId })
      return session
    })
    if (result.ok) {
      console.log('[WEBRTCDBG] connection_probe_connected', { callId: result.callId })
      return result
    }
    {
      const reason = result.reason
      console.warn('[WEBRTCDBG] connection_probe_failed', reason)
      setError(reason)
      return result
    }
  }, [])

  const stopWebRtcTestCall = useCallback(() => {
    const session = webRtcTestCallSessionRef.current
    const audioRoute = webRtcTestCallAudioRouteRef.current
    webRtcTestCallSessionRef.current = null
    webRtcTestCallAudioRouteRef.current = null
    webRtcRemoteAudioRefsRef.current = []
    session?.close()
    void audioRoute?.stop().catch(() => {})
    setWebRtcTestCall({ status: 'idle' })
    console.log('[WEBRTCDBG] test_call_closed')
  }, [])

  // Mute / unmute the local uplink by toggling the audio sender track's `enabled`
  // flag (canonical WebRTC mute — keeps the call up, sends silence). Returns
  // whether an audio track was found to apply it to. Call-page only; the talk
  // page does not use this.
  const setWebRtcCallMuted = useCallback((muted: boolean): boolean => {
    const peerConnection = webRtcTestCallSessionRef.current?.peerConnection as
      | { getSenders?: () => WebRtcAudioSender[] }
      | undefined
    const senders = peerConnection?.getSenders?.() ?? []
    let applied = false
    for (const sender of senders) {
      const track = sender?.track
      if (track && track.kind === 'audio') {
        track.enabled = !muted
        applied = true
      }
    }
    console.log('[WEBRTCDBG] test_call_mute', { applied, muted })
    return applied
  }, [])

  const setWebRtcDownlinkVolume = useCallback((volume: number) => {
    const nextVolume = parseStoredWebRtcDownlinkVolume(String(volume))
    webRtcDownlinkVolumeRef.current = nextVolume
    setWebRtcDownlinkVolumeState(nextVolume)
    void secureSet(WEBRTC_DOWNLINK_VOLUME_KEY, String(nextVolume))
    const result = applyWebRtcDownlinkVolumeToRefs(webRtcRemoteAudioRefsRef.current, nextVolume)
    console.log('[WEBRTCDBG] test_call_downlink_volume', { ...result, volume: nextVolume })
  }, [])

  const startWebRtcTestCall = useCallback(async (): Promise<WebRtcConnectionProbeResult> => {
    const transport = observedRelayTransportRef.current
    if (!transport || transport.status() !== 'ready') {
      const reason = 'Relay transport is not ready'
      setWebRtcTestCall({ reason, status: 'error' })
      setError(reason)
      return { ok: false, reason }
    }
    const workspaceId = selectedWorkspaceIdRef.current
    if (!workspaceId) {
      const reason = 'Select a workspace before starting WebRTC'
      setWebRtcTestCall({ reason, status: 'error' })
      setError(reason)
      return { ok: false, reason }
    }

    const previousAudioRoute = webRtcTestCallAudioRouteRef.current
    webRtcTestCallSessionRef.current?.close()
    webRtcTestCallSessionRef.current = null
    webRtcTestCallAudioRouteRef.current = null
    webRtcRemoteAudioRefsRef.current = []
    void previousAudioRoute?.stop().catch(() => {})
    setWebRtcTestCall({ status: 'connecting' })
    setError(null)

    let session: WebRtcCallerSession | null = null
    try {
      session = await createWebRtcCaller({
        audio: true,
        forceRelay: resolveWebRtcForceRelayEnabled(getWebRtcRuntimeExtra()),
        onConnectionClosed: ({ callId, state }) => {
          if (webRtcTestCallSessionRef.current?.callId !== callId) return
          const closedAudioRoute = webRtcTestCallAudioRouteRef.current
          webRtcTestCallSessionRef.current = null
          webRtcTestCallAudioRouteRef.current = null
          webRtcRemoteAudioRefsRef.current = []
          void closedAudioRoute?.stop().catch(() => {})
          const reason = `WebRTC connection ${state}`
          setWebRtcTestCall({ reason, status: 'error' })
          setError(reason)
          console.warn('[WEBRTCDBG] test_call_closed_by_peer', { callId, state })
        },
        onRemoteTrack: (event) => {
          const refs = [...(event.streams ?? []), ...(event.track ? [event.track] : [])]
          webRtcRemoteAudioRefsRef.current = [...webRtcRemoteAudioRefsRef.current, ...refs]
          if (event.track && typeof event.track === 'object' && 'enabled' in event.track) {
            ;(event.track as { enabled: boolean }).enabled = true
          }
          const volumeResult = applyWebRtcDownlinkVolumeToRefs(
            refs,
            webRtcDownlinkVolumeRef.current
          )
          console.log('[WEBRTCDBG] test_call_remote_track', {
            remoteAudioTrackCount: webRtcRemoteAudioRefsRef.current.length,
            volumeApplied: volumeResult.applied,
            volumeFailed: volumeResult.failed,
            volumeUnsupported: volumeResult.unsupported,
          })
          setWebRtcTestCall((current) =>
            current.status === 'connected'
              ? {
                  ...current,
                  remoteAudioTrackCount: webRtcRemoteAudioRefsRef.current.length,
                }
              : current
          )
        },
        runAudioSession: async (runSession) => {
          const audioRoute = await startWebRtcInCallAudioRoute()
          webRtcTestCallAudioRouteRef.current = audioRoute
          return {
            close: () => audioRoute?.stop(),
            result: await runSession(),
          }
        },
        transport,
        workspaceId,
      }).start()
      webRtcTestCallSessionRef.current = session
      console.log('[WEBRTCDBG] test_call_started', { callId: session.callId })
      await session.waitForConnected()
      if (webRtcTestCallSessionRef.current !== session) {
        session.close()
        return { ok: false, reason: 'WebRTC test call was closed before connecting' }
      }
      setWebRtcTestCall({
        callId: session.callId,
        remoteAudioTrackCount: webRtcRemoteAudioRefsRef.current.length,
        status: 'connected',
      })
      console.log('[WEBRTCDBG] test_call_connected', { callId: session.callId })
      return { callId: session.callId, ok: true }
    } catch (callError) {
      const reason = callError instanceof Error ? callError.message : String(callError)
      if (session && webRtcTestCallSessionRef.current === session) {
        webRtcTestCallSessionRef.current = null
      }
      const failedAudioRoute: WebRtcInCallAudioRoute | null = webRtcTestCallAudioRouteRef.current
      webRtcTestCallAudioRouteRef.current = null
      session?.close()
      if (failedAudioRoute) {
        await (failedAudioRoute as WebRtcInCallAudioRoute).stop().catch(() => {})
      }
      webRtcRemoteAudioRefsRef.current = []
      setWebRtcTestCall({ reason, status: 'error' })
      setError(reason)
      console.warn('[WEBRTCDBG] test_call_failed', reason)
      return { ok: false, reason }
    }
  }, [])

  const sendPromptToOrchestratorWithOutcome = useCallback(
    async (
      text: string,
      options: { source?: MobilePromptSource } = {}
    ): Promise<ChatSendOutcome> => {
      if (!selectedWorkspaceId) {
        setError('Select a workspace before sending prompts')
        return 'error'
      }
      setError(null)
      const queuePrompt = (status: 'queued' | 'failed') => {
        setOutbox((current) =>
          enqueueOutboxItem(
            current,
            createPromptOutboxItem(
              { text, workspaceId: selectedWorkspaceId },
              status === 'failed' ? { status: 'failed' } : undefined
            )
          )
        )
      }
      const relayTransportReady = observedRelayTransportRef.current
        ? observedRelayTransportRef.current.status() === 'ready'
        : true
      if (
        shouldQueuePromptBeforeSend({
          connectionMode: connectionModeRef.current,
          connectionState: stateRef.current,
          reconnecting: reconnectingRef.current,
          relayTransportReady,
        })
      ) {
        queuePrompt('queued')
        return 'queued'
      }
      try {
        await client.sendPromptToOrchestrator(selectedWorkspaceId, text, options)
        chatFetchFailureCountRef.current = 0
        void syncWorkspaceData(selectedWorkspaceId, { resetChat: true })
        return 'sent'
      } catch (promptError) {
        const message = promptError instanceof Error ? promptError.message : String(promptError)
        const transportReady = observedRelayTransportRef.current
          ? observedRelayTransportRef.current.status() === 'ready'
          : true
        if (
          shouldQueuePromptBeforeSend({
            connectionMode: connectionModeRef.current,
            connectionState: stateRef.current,
            reconnecting: reconnectingRef.current,
            relayTransportReady: transportReady,
          })
        ) {
          queuePrompt('queued')
          return 'queued'
        }
        queuePrompt('failed')
        setError(message)
        return 'error'
      }
    },
    [client, selectedWorkspaceId, syncWorkspaceData]
  )

  const sendPromptToOrchestrator = useCallback(
    async (text: string) => {
      const outcome = await sendPromptToOrchestratorWithOutcome(text)
      return outcome === 'sent'
    },
    [sendPromptToOrchestratorWithOutcome]
  )

  const uploadMedia = useCallback(
    async (data: string, filename: string, mimeType: string) => {
      if (!selectedWorkspaceId) {
        setError('Select a workspace before uploading')
        return null
      }
      setError(null)
      try {
        const result = await client.uploadMedia(selectedWorkspaceId, data, filename, mimeType)
        return { file_id: result.file_id, url: result.url }
      } catch (uploadError) {
        const message = uploadError instanceof Error ? uploadError.message : String(uploadError)
        setError(message)
        return null
      }
    },
    [client, selectedWorkspaceId]
  )

  const attemptReconnect = useCallback(
    async (options: { forceFullSync?: boolean; silent?: boolean } = {}) => {
      const nextHost = hostRef.current
      const nextToken = tokenRef.current.trim()
      if (!nextToken || reconnectInFlightRef.current) return false
      reconnectInFlightRef.current = true
      syncReconnectingState()
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
        syncReconnectingState()
      }
      try {
        const status = await connectRef.current(nextHost, nextToken, relayConfigRef.current, {
          preserveUiState: Boolean(options.silent),
        })
        reconnectInFlightRef.current = false
        syncReconnectingState()
        if (!status) {
          reconnectAttemptRef.current += 1
          return false
        }
        reconnectAttemptRef.current = 0
        const workspaceId = selectedWorkspaceIdRef.current
        if (options.forceFullSync && workspaceId) {
          await syncWorkspaceData(workspaceId, { resetChat: true })
        }
        return true
      } catch (reconnectError) {
        reconnectInFlightRef.current = false
        syncReconnectingState()
        reconnectAttemptRef.current += 1
        if (!options.silent) {
          const message =
            reconnectError instanceof Error ? reconnectError.message : String(reconnectError)
          setError(message)
        }
        return false
      }
    },
    [syncReconnectingState, syncWorkspaceData]
  )

  const scheduleReconnect = useCallback(
    (options: { immediate?: boolean; silent?: boolean } = {}) => {
      if (
        !shouldAttemptAutoReconnect({
          demoMode,
          hasToken: Boolean(tokenRef.current.trim()),
          inFlight: reconnectInFlightRef.current,
          state: stateRef.current,
        })
      ) {
        return
      }
      if (reconnectTimerRef.current) return
      const delay = options.immediate ? 0 : nextReconnectDelayMs(reconnectAttemptRef.current)
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null
        syncReconnectingState()
        void attemptReconnect({ forceFullSync: true, silent: options.silent }).then((ok) => {
          if (!ok) scheduleReconnect({ silent: options.silent })
        })
      }, delay)
      syncReconnectingState()
    },
    [attemptReconnect, demoMode, syncReconnectingState]
  )

  const fetchChatMessages = useCallback(
    async (options: { resetSince?: boolean } = {}) => {
      if (!selectedWorkspaceId) return
      try {
        await syncChatMessages(client, selectedWorkspaceId, options)
      } catch (chatError) {
        chatFetchFailureCountRef.current += 1
        const message = chatError instanceof Error ? chatError.message : String(chatError)
        setError(message)
        if (chatFetchFailureCountRef.current >= 2) {
          setState('error')
          scheduleReconnect()
        }
      }
    },
    [client, scheduleReconnect, selectedWorkspaceId, syncChatMessages]
  )

  const approveRequest = useCallback(
    async (approvalId: string, decision: 'allow' | 'deny') => {
      if (!selectedWorkspaceId) {
        setError('Select a workspace before approving')
        return false
      }
      setError(null)
      if (stateRef.current !== 'connected') {
        setOutbox((current) =>
          enqueueOutboxItem(
            current,
            createApprovalOutboxItem({
              approvalId,
              decision,
              workspaceId: selectedWorkspaceId,
            })
          )
        )
        return false
      }
      try {
        await client.approveRequest(selectedWorkspaceId, approvalId, decision)
        await syncWorkspaceData(selectedWorkspaceId, { resetChat: true })
        return true
      } catch (approveError) {
        const message = approveError instanceof Error ? approveError.message : String(approveError)
        setOutbox((current) =>
          enqueueOutboxItem(
            current,
            createApprovalOutboxItem(
              {
                approvalId,
                decision,
                workspaceId: selectedWorkspaceId,
              },
              { status: 'failed' }
            )
          )
        )
        setError(message)
        return false
      }
    },
    [client, selectedWorkspaceId, syncWorkspaceData]
  )

  useEffect(() => {
    let cancelled = false
    Promise.all([
      secureGet(RUNTIME_HOST_KEY),
      secureGet(MOBILE_TOKEN_KEY),
      secureGet(WORKSPACE_ID_KEY),
      secureGet(RELAY_CONFIG_KEY),
      secureGet(OUTBOX_KEY),
      secureGet(WEBRTC_DOWNLINK_VOLUME_KEY),
    ]).then(
      ([storedHost, storedToken, storedWorkspaceId, storedRelay, storedOutbox, storedVolume]) => {
        if (cancelled) return
        const nextHost = storedHost || DEFAULT_RUNTIME_HOST
        const nextRelayConfig = parseStoredRelayConfig(storedRelay)
        const nextWebRtcDownlinkVolume = parseStoredWebRtcDownlinkVolume(storedVolume)
        setHost(nextHost)
        if (storedToken) setToken(storedToken)
        if (storedWorkspaceId) setSelectedWorkspaceId(storedWorkspaceId)
        if (nextRelayConfig) setRelayConfig(nextRelayConfig)
        webRtcDownlinkVolumeRef.current = nextWebRtcDownlinkVolume
        setWebRtcDownlinkVolumeState(nextWebRtcDownlinkVolume)
        setOutbox(parseOutboxState(storedOutbox))
        outboxLoadedRef.current = true
        if (storedToken) {
          void connectRef.current(nextHost, storedToken, nextRelayConfig)
        }
      }
    )
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (state === 'connected' || state === 'checking') return
    scheduleReconnect()
  }, [scheduleReconnect, state])

  useEffect(() => {
    if (!outboxLoadedRef.current) return
    void secureSet(OUTBOX_KEY, serializeOutboxState(outbox))
  }, [outbox])

  useEffect(() => {
    // 修复3：relay 模式下 relay transport 未 ready（churn/重连中途）不 flush，避免 flush RPC 撞超时再喂
    // churn；relayTransportReady 翻 true 时此 effect 重跑 → 自动补发卡住的队列（连带修 #4）。
    if (
      !shouldFlushQueuedOutbox({
        connectionMode,
        connectionState: state,
        reconnecting,
        queuedCount: outboxCounts.queuedCount,
        relayTransportReady,
      })
    ) {
      return
    }
    void flushOutbox()
  }, [
    connectionMode,
    flushOutbox,
    outboxCounts.queuedCount,
    reconnecting,
    relayTransportReady,
    state,
  ])

  const retryOutbox = useCallback(async () => {
    setOutbox((current) => retryFailedOutboxItems(current))
  }, [])

  const clearFailedOutbox = useCallback(async () => {
    setOutbox((current) => clearFailedOutboxItems(current))
  }, [])

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      const wasBackgrounded =
        appStateRef.current === 'background' || appStateRef.current === 'inactive'
      appStateRef.current = nextState
      if (nextState !== 'active' || !wasBackgrounded || !tokenRef.current.trim()) return
      const shouldProbe = shouldProbeForegroundReconnect({
        hasToken: Boolean(tokenRef.current.trim()),
        connectionMode: connectionModeRef.current,
        preferredConnectionMode: preferredConnectionModeRef.current,
        isBackgrounded: wasBackgrounded,
        isReconnecting: Boolean(reconnectInFlightRef.current || reconnectTimerRef.current),
        state: stateRef.current,
      })
      if (!shouldProbe) return
      setReconnecting(true)
      if (
        shouldResetLanCooldownBeforeForegroundProbe({
          hasToken: Boolean(tokenRef.current.trim()),
          connectionMode: connectionModeRef.current,
          preferredConnectionMode: preferredConnectionModeRef.current,
          isBackgrounded: wasBackgrounded,
          isReconnecting: Boolean(reconnectInFlightRef.current || reconnectTimerRef.current),
          state: stateRef.current,
        })
      ) {
        client.resetLanCooldown()
      }
      void withUiOperationTimeout(client.getMobileRuntimeStatus(), { label: 'foreground probe' })
        .then(() => {
          setReconnecting(false)
          // 探活成功也补一次同步（M 修复）：后台期间漏推的 dashboard/chat 在回前台时立即追平，
          // 而不是干等下一轮 20s 轮询；syncWorkspaceData 内有 workspace 守卫 + best-effort。
          const workspaceId = selectedWorkspaceIdRef.current
          if (workspaceId) void syncWorkspaceData(workspaceId, { resetChat: true })
        })
        .catch(() => {
          void attemptReconnect({ forceFullSync: true, silent: true }).then((ok) => {
            if (!ok) scheduleReconnect({ immediate: true, silent: true })
            setReconnecting(Boolean(reconnectInFlightRef.current || reconnectTimerRef.current))
          })
        })
    })
    return () => {
      subscription.remove()
    }
  }, [attemptReconnect, client, scheduleReconnect, syncWorkspaceData])

  useEffect(
    () => () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
      webRtcTestCallSessionRef.current?.close()
      void webRtcTestCallAudioRouteRef.current?.stop().catch(() => {})
      webRtcTestCallAudioRouteRef.current = null
      relayDiagnosticsUnsubscribeRef.current?.()
      relayEventUnsubscribeRef.current?.()
      relayTransportRegistryRef.current.close()
    },
    []
  )

  useEffect(() => {
    setConnectionDiagnostics((current) => ({
      ...current,
      connectionMode,
      error,
      host,
      relay: sanitizeRelayConfigForDiagnostics(relayConfig, token),
      state,
    }))
  }, [connectionMode, error, host, relayConfig, state, token])

  useEffect(() => {
    appendDiagnosticEvent({ detail: connectionMode, type: 'connection_mode' })
  }, [appendDiagnosticEvent, connectionMode])

  useEffect(() => {
    if (state === 'idle') return
    appendDiagnosticEvent({ detail: state, type: 'runtime_state' })
  }, [appendDiagnosticEvent, state])

  useEffect(() => {
    if (!error) return
    appendDiagnosticEvent({ detail: error, type: 'last_error' })
  }, [appendDiagnosticEvent, error])

  useEffect(() => {
    if (connectionMode === 'relay') return
    if (state !== 'connected' || !selectedWorkspaceId || !token.trim()) return
    const socketWorkspaceId = selectedWorkspaceId
    const socket = new WebSocket(client.buildMobileDashboardWebSocketUrl(socketWorkspaceId))
    let closing = false
    // 三个 handler 统一走工厂里的 workspace 到达时守卫（BLOCKING 修复）：切走后旧 socket 的
    // message/error/close 都不得污染当前 workspace 的 dashboard / 连接状态。
    const handlers = createDashboardSocketHandlers({
      socketWorkspaceId,
      currentWorkspaceId: () => selectedWorkspaceIdRef.current,
      isClosing: () => closing,
      isConnected: () => stateRef.current === 'connected',
      onChatMessage: (message) => mergeChatMessages([message]),
      onDashboard: (payload) => setDashboard(payload as MobileDashboard),
      onParseError: (message) => setError(message),
      onDisconnected: () => {
        setError('Mobile dashboard websocket disconnected')
        setState('error')
        scheduleReconnect()
      },
    })
    socket.onmessage = (event) => handlers.handleMessage(String(event.data))
    socket.onerror = handlers.handleError
    socket.onclose = handlers.handleClose
    return () => {
      closing = true
      socket.close()
    }
  }, [
    client,
    connectionMode,
    mergeChatMessages,
    scheduleReconnect,
    selectedWorkspaceId,
    state,
    token,
  ])

  useEffect(() => {
    if (reconnecting || state !== 'connected' || !selectedWorkspaceId) return
    void fetchChatMessages()
    // M27 Part B：relay 推送（transport.onEvent → mergeChatMessages）是主路径，轮询降为兜底（5s→20s），
    // 推送漏了最多 20s 补上，4G 下少发请求。
    const interval = setInterval(() => void fetchChatMessages(), 20_000)
    return () => clearInterval(interval)
  }, [fetchChatMessages, reconnecting, selectedWorkspaceId, state])

  const enableDemoMode = useCallback(() => {
    setDemoMode(true)
    setDashboard(DEMO_DASHBOARD)
    setChatMessages(DEMO_CHAT_MESSAGES)
    setState('connected')
  }, [])

  const value = useMemo<MobileRuntimeContextValue>(
    () => ({
      answerQuestion,
      approveRequest,
      chatMessages: demoMode ? DEMO_CHAT_MESSAGES : chatMessages,
      configureRelay,
      connect,
      connectionMode: demoMode ? 'lan' : connectionMode,
      connectionDiagnostics: demoMode
        ? {
            ...connectionDiagnostics,
            connectionMode: 'lan',
            error: null,
            state: 'connected',
          }
        : connectionDiagnostics,
      connectionDiagnosticsText: buildConnectionDiagnosticsText(
        demoMode
          ? {
              ...connectionDiagnostics,
              connectionMode: 'lan',
              error: null,
              state: 'connected',
            }
          : connectionDiagnostics
      ),
      createWorker,
      dashboard: demoMode ? DEMO_DASHBOARD : dashboard,
      demoMode,
      disconnect,
      dispatchTask,
      enableDemoMode,
      listCommandPresets,
      measureRelayVoiceStreamLatency,
      error,
      fetchChatMessages,
      getCockpit,
      getWorkerTranscript,
      getWorkspaceTasks,
      host,
      pairedDevice,
      outboxFailedCount: outboxCounts.failedCount,
      outboxPendingCount: outboxCounts.queuedCount,
      outboxSendingCount: outboxCounts.sendingCount,
      reconnecting: demoMode ? false : reconnecting,
      relayConfig,
      refreshDashboard,
      restartWorker,
      runtimeStatus,
      clearFailedOutbox,
      retryOutbox,
      runWebRtcConnectionProbe,
      selectWorkspace,
      selectedWorkspaceId,
      sendPromptToOrchestrator,
      sendPromptToOrchestratorWithOutcome,
      setHost,
      setToken,
      setWebRtcCallMuted,
      setWebRtcDownlinkVolume,
      startWebRtcTestCall,
      state: demoMode ? 'connected' : state,
      stopWebRtcTestCall,
      syncRevision,
      stopWorker,
      synthesizeVoice,
      synthesizeVoiceStream,
      token,
      transcribeVoice,
      uploadMedia,
      webRtcTestCall,
      webRtcDownlinkVolume,
      workspaces,
    }),
    [
      answerQuestion,
      approveRequest,
      chatMessages,
      configureRelay,
      connect,
      connectionMode,
      connectionDiagnostics,
      createWorker,
      dashboard,
      demoMode,
      disconnect,
      dispatchTask,
      enableDemoMode,
      error,
      fetchChatMessages,
      listCommandPresets,
      measureRelayVoiceStreamLatency,
      getCockpit,
      getWorkerTranscript,
      getWorkspaceTasks,
      host,
      pairedDevice,
      outboxCounts,
      clearFailedOutbox,
      reconnecting,
      retryOutbox,
      runWebRtcConnectionProbe,
      relayConfig,
      refreshDashboard,
      restartWorker,
      runtimeStatus,
      selectWorkspace,
      selectedWorkspaceId,
      sendPromptToOrchestrator,
      sendPromptToOrchestratorWithOutcome,
      setWebRtcCallMuted,
      setWebRtcDownlinkVolume,
      startWebRtcTestCall,
      state,
      stopWebRtcTestCall,
      syncRevision,
      stopWorker,
      synthesizeVoice,
      synthesizeVoiceStream,
      token,
      transcribeVoice,
      uploadMedia,
      webRtcTestCall,
      webRtcDownlinkVolume,
      workspaces,
    ]
  )

  return <MobileRuntimeContext.Provider value={value}>{children}</MobileRuntimeContext.Provider>
}

export const useMobileRuntime = () => {
  const context = useContext(MobileRuntimeContext)
  if (!context) throw new Error('useMobileRuntime must be used within MobileRuntimeProvider')
  return context
}
