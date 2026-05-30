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
import type { RelayPairingInput } from '../lib/connection-qr'
import {
  buildStoredRelayConfig,
  parseStoredRelayConfig,
  type StoredRelayConfig,
} from '../lib/relay-config-store'
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
  type MobileWorkerTranscript,
  type MobileWorkspace,
  type MobileWorkspaceTasks,
  type RuntimeStatus,
} from './client'
import {
  createApprovalOutboxItem,
  createDispatchOutboxItem,
  createMobileOutboxState,
  createPromptOutboxItem,
  enqueueOutboxItem,
  flushOutboxState,
  getOutboxCounts,
  hasQueuedOutboxItems,
  type MobileOutboxState,
  parseOutboxState,
  retryFailedOutboxItems,
  serializeOutboxState,
} from './mobile-outbox'
import { nextReconnectDelayMs, shouldAttemptAutoReconnect } from './mobile-reconnect-policy'
import { generateDeviceKeypair } from './relay-device-keys'
import { createRelayTransport } from './relay-transport'

export type { RelayPairingInput }

const RUNTIME_HOST_KEY = 'hippoteam.runtimeHost'
const MOBILE_TOKEN_KEY = 'hippoteam.mobileToken'
const WORKSPACE_ID_KEY = 'hippoteam.mobileWorkspaceId'
const RELAY_CONFIG_KEY = 'hippoteam.mobileRelayConfig'
const OUTBOX_KEY = 'hippoteam.mobileOutbox'

export type MobileRuntimeState = 'idle' | 'checking' | 'connected' | 'error'
type RuntimeClient = ReturnType<typeof createRuntimeClient>

interface MobileRuntimeContextValue {
  answerQuestion: (questionId: string, answer: string) => Promise<boolean>
  approveRequest: (approvalId: string, decision: 'allow' | 'deny') => Promise<boolean>
  chatMessages: ChatMessage[]
  connect: (nextHost: string, nextToken: string) => Promise<RuntimeStatus | null>
  configureRelay: (input: RelayPairingInput) => Promise<void>
  connectionMode: MobileConnectionMode
  createWorker: (input: MobileCreateWorkerInput) => Promise<MobileCreateWorkerResponse | null>
  dashboard: MobileDashboard | null
  demoMode: boolean
  disconnect: () => Promise<void>
  dispatchTask: (workerId: string, task: string) => Promise<MobileDispatchResponse | null>
  listCommandPresets: () => Promise<MobileCommandPreset[]>
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
  relayConfig: StoredRelayConfig | null
  refreshDashboard: (workspaceId?: string) => Promise<MobileDashboard | null>
  restartWorker: (workerId: string) => Promise<boolean>
  runtimeStatus: RuntimeStatus | null
  retryOutbox: () => Promise<void>
  selectWorkspace: (workspaceId: string) => Promise<void>
  selectedWorkspaceId: string | null
  sendPromptToOrchestrator: (text: string) => Promise<boolean>
  setHost: (host: string) => void
  setToken: (token: string) => void
  state: MobileRuntimeState
  syncRevision: number
  stopWorker: (workerId: string) => Promise<boolean>
  token: string
  transcribeVoice: (audioBase64: string, format?: string) => Promise<string | null>
  uploadMedia: (
    data: string,
    filename: string,
    mimeType: string
  ) => Promise<{ file_id: string; url: string } | null>
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
  const [state, setState] = useState<MobileRuntimeState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [outbox, setOutbox] = useState<MobileOutboxState>(createMobileOutboxState())
  const [syncRevision, setSyncRevision] = useState(0)
  const chatSinceRef = useRef<number | undefined>(undefined)
  const chatFetchFailureCountRef = useRef(0)
  const reconnectAttemptRef = useRef(0)
  const reconnectInFlightRef = useRef(false)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const outboxFlushInFlightRef = useRef(false)
  const outboxLoadedRef = useRef(false)
  const appStateRef = useRef<AppStateStatus>(AppState.currentState)
  const hostRef = useRef(host)
  const tokenRef = useRef(token)
  const relayConfigRef = useRef(relayConfig)
  const selectedWorkspaceIdRef = useRef(selectedWorkspaceId)
  const stateRef = useRef(state)
  const outboxRef = useRef(outbox)

  hostRef.current = host
  tokenRef.current = token
  relayConfigRef.current = relayConfig
  selectedWorkspaceIdRef.current = selectedWorkspaceId
  stateRef.current = state
  outboxRef.current = outbox

  const createRelay = useCallback(
    (nextToken: string, nextRelayConfig = relayConfig) =>
      nextRelayConfig
        ? createRelayTransport({ ...nextRelayConfig, device_token: nextToken.trim() })
        : null,
    [relayConfig]
  )

  const client = useMemo(
    () =>
      createRuntimeClient({
        host,
        relayTransport: token.trim() ? createRelay(token) : null,
        token: token.trim() || null,
      }),
    [createRelay, host, token]
  )

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
    const latest = messages.at(-1)
    if (latest) chatSinceRef.current = latest.created_at
  }, [])

  const syncChatMessages = useCallback(
    async (
      nextClient: RuntimeClient,
      workspaceId: string,
      options: { resetSince?: boolean } = {}
    ) => {
      if (options.resetSince) chatSinceRef.current = undefined
      const res = await nextClient.getChatMessages(workspaceId, chatSinceRef.current)
      mergeChatMessages(res.messages)
      chatFetchFailureCountRef.current = 0
    },
    [mergeChatMessages]
  )

  const bumpSyncRevision = useCallback(() => {
    setSyncRevision((current) => current + 1)
  }, [])

  const refreshDashboard = useCallback(
    async (workspaceId = selectedWorkspaceId) => {
      if (!workspaceId) {
        setDashboard(null)
        return null
      }
      try {
        const nextDashboard = await client.getMobileDashboard(workspaceId)
        setDashboard(nextDashboard)
        return nextDashboard
      } catch (dashboardError) {
        const message =
          dashboardError instanceof Error ? dashboardError.message : String(dashboardError)
        setError(message)
        return null
      }
    },
    [client, selectedWorkspaceId]
  )

  const syncWorkspaceData = useCallback(
    async (workspaceId: string, options: { bumpRevision?: boolean; resetChat?: boolean } = {}) => {
      if (selectedWorkspaceIdRef.current !== workspaceId) return
      await refreshDashboard(workspaceId)
      try {
        await syncChatMessages(client, workspaceId, {
          resetSince: options.resetChat ?? false,
        })
      } catch {
        // Chat catch-up is best-effort; the poller and reconnect loop keep retrying.
      }
      if (options.bumpRevision ?? true) {
        bumpSyncRevision()
      }
    },
    [bumpSyncRevision, client, refreshDashboard, syncChatMessages]
  )

  const flushOutbox = useCallback(async () => {
    if (outboxFlushInFlightRef.current) return
    if (stateRef.current !== 'connected') return
    if (!hasQueuedOutboxItems(outboxRef.current)) return
    outboxFlushInFlightRef.current = true
    try {
      const { sentCount, state: nextOutbox } = await flushOutboxState(
        outboxRef.current,
        async (item) => {
          if (item.kind === 'prompt') {
            await client.sendPromptToOrchestrator(item.workspaceId, item.payload.text)
            await syncWorkspaceData(item.workspaceId, {
              bumpRevision: false,
              resetChat: true,
            })
            return
          }
          if (item.kind === 'dispatch') {
            await client.dispatchTask(item.workspaceId, item.payload.workerId, item.payload.task)
            await syncWorkspaceData(item.workspaceId, {
              bumpRevision: false,
              resetChat: true,
            })
            return
          }
          await client.approveRequest(
            item.workspaceId,
            item.payload.approvalId,
            item.payload.decision
          )
          await syncWorkspaceData(item.workspaceId, {
            bumpRevision: false,
            resetChat: true,
          })
        }
      )
      setOutbox(nextOutbox)
      if (sentCount > 0) {
        bumpSyncRevision()
      }
    } finally {
      outboxFlushInFlightRef.current = false
    }
  }, [bumpSyncRevision, client, syncWorkspaceData])

  useEffect(() => {
    const unsubscribe = client.onConnectionModeChange((mode) =>
      setConnectionMode(mode as MobileConnectionMode)
    )
    return () => {
      unsubscribe()
    }
  }, [client])

  const connect = useCallback(
    async (nextHost: string, nextToken: string, nextRelayConfig = relayConfig) => {
      const trimmedToken = nextToken.trim()
      setState('checking')
      setError(null)
      try {
        const nextClient = createRuntimeClient({
          host: nextHost,
          relayTransport: createRelay(trimmedToken, nextRelayConfig),
          token: trimmedToken,
        })
        const [nextStatus, nextWorkspaces] = await Promise.all([
          nextClient.getMobileRuntimeStatus(),
          nextClient.listMobileWorkspaces(),
        ])
        const nextWorkspaceId = chooseWorkspace(nextWorkspaces, selectedWorkspaceId)
        const nextDashboard = nextWorkspaceId
          ? await nextClient.getMobileDashboard(nextWorkspaceId)
          : null
        await registerPushToken(nextClient)

        setHost(nextHost)
        setToken(trimmedToken)
        setRuntimeStatus(nextStatus)
        setWorkspaces(nextWorkspaces)
        setSelectedWorkspaceId(nextWorkspaceId)
        setDashboard(nextDashboard)
        setConnectionMode(nextClient.connectionMode())
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
        const message = connectError instanceof Error ? connectError.message : String(connectError)
        setError(message)
        setDashboard(null)
        setRuntimeStatus(null)
        setState('error')
        return null
      }
    },
    [
      bumpSyncRevision,
      createRelay,
      flushOutbox,
      registerPushToken,
      relayConfig,
      selectedWorkspaceId,
      syncChatMessages,
    ]
  )
  const connectRef = useRef(connect)
  connectRef.current = connect

  const selectWorkspace = useCallback(
    async (workspaceId: string) => {
      setSelectedWorkspaceId(workspaceId)
      await secureSet(WORKSPACE_ID_KEY, workspaceId)
      await refreshDashboard(workspaceId)
      bumpSyncRevision()
    },
    [bumpSyncRevision, refreshDashboard]
  )

  const disconnect = useCallback(async () => {
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
    setSelectedWorkspaceId(null)
    setPairedDevice(null)
    setRelayConfig(null)
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
    relayConfigRef.current = next
    setRelayConfig(next)
    await secureSet(RELAY_CONFIG_KEY, JSON.stringify(next))
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

  const sendPromptToOrchestrator = useCallback(
    async (text: string) => {
      if (!selectedWorkspaceId) {
        setError('Select a workspace before sending prompts')
        return false
      }
      setError(null)
      if (stateRef.current !== 'connected') {
        setOutbox((current) =>
          enqueueOutboxItem(
            current,
            createPromptOutboxItem({
              text,
              workspaceId: selectedWorkspaceId,
            })
          )
        )
        return false
      }
      try {
        await client.sendPromptToOrchestrator(selectedWorkspaceId, text)
        chatFetchFailureCountRef.current = 0
        await syncWorkspaceData(selectedWorkspaceId, { resetChat: true })
        return true
      } catch (promptError) {
        const message = promptError instanceof Error ? promptError.message : String(promptError)
        setOutbox((current) =>
          enqueueOutboxItem(
            current,
            createPromptOutboxItem(
              {
                text,
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
    async (options: { forceFullSync?: boolean } = {}) => {
      const nextHost = hostRef.current
      const nextToken = tokenRef.current.trim()
      if (!nextToken || reconnectInFlightRef.current) return false
      reconnectInFlightRef.current = true
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
      try {
        const status = await connectRef.current(nextHost, nextToken, relayConfigRef.current)
        reconnectInFlightRef.current = false
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
        reconnectAttemptRef.current += 1
        const message =
          reconnectError instanceof Error ? reconnectError.message : String(reconnectError)
        setError(message)
        return false
      }
    },
    [syncWorkspaceData]
  )

  const scheduleReconnect = useCallback(
    (options: { immediate?: boolean } = {}) => {
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
        void attemptReconnect({ forceFullSync: true }).then((ok) => {
          if (!ok) scheduleReconnect()
        })
      }, delay)
    },
    [attemptReconnect, demoMode]
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
    ]).then(([storedHost, storedToken, storedWorkspaceId, storedRelay, storedOutbox]) => {
      if (cancelled) return
      const nextHost = storedHost || DEFAULT_RUNTIME_HOST
      const nextRelayConfig = parseStoredRelayConfig(storedRelay)
      setHost(nextHost)
      if (storedToken) setToken(storedToken)
      if (storedWorkspaceId) setSelectedWorkspaceId(storedWorkspaceId)
      if (nextRelayConfig) setRelayConfig(nextRelayConfig)
      setOutbox(parseOutboxState(storedOutbox))
      outboxLoadedRef.current = true
      if (storedToken) {
        void connectRef.current(nextHost, storedToken, nextRelayConfig)
      }
    })
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
    if (state !== 'connected' || outboxCounts.queuedCount === 0) return
    void flushOutbox()
  }, [flushOutbox, outboxCounts.queuedCount, state])

  const retryOutbox = useCallback(async () => {
    setOutbox((current) => retryFailedOutboxItems(current))
  }, [])

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      const wasBackgrounded =
        appStateRef.current === 'background' || appStateRef.current === 'inactive'
      appStateRef.current = nextState
      if (nextState !== 'active' || !wasBackgrounded || !tokenRef.current.trim()) return
      void attemptReconnect({ forceFullSync: true }).then((ok) => {
        if (!ok) scheduleReconnect({ immediate: true })
      })
    })
    return () => {
      subscription.remove()
    }
  }, [attemptReconnect, scheduleReconnect])

  useEffect(
    () => () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
    },
    []
  )

  useEffect(() => {
    if (connectionMode === 'relay') return
    if (state !== 'connected' || !selectedWorkspaceId || !token.trim()) return
    const socket = new WebSocket(client.buildMobileDashboardWebSocketUrl(selectedWorkspaceId))
    let closing = false
    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data)) as {
          kind?: string
          payload?: MobileDashboard
        }
        if (
          (message.kind === 'mobile-dashboard-snapshot' ||
            message.kind === 'mobile-dashboard-update') &&
          message.payload
        ) {
          setDashboard(message.payload)
        }
      } catch (socketError) {
        const message = socketError instanceof Error ? socketError.message : String(socketError)
        setError(message)
      }
    }
    socket.onerror = () => {
      setError('Mobile dashboard websocket disconnected')
      setState('error')
      scheduleReconnect()
    }
    socket.onclose = () => {
      if (closing) return
      if (stateRef.current === 'connected') {
        setError('Mobile dashboard websocket disconnected')
        setState('error')
        scheduleReconnect()
      }
    }
    return () => {
      closing = true
      socket.close()
    }
  }, [client, connectionMode, scheduleReconnect, selectedWorkspaceId, state, token])

  useEffect(() => {
    if (state !== 'connected' || !selectedWorkspaceId) return
    void fetchChatMessages()
    const interval = setInterval(() => void fetchChatMessages(), 5000)
    return () => clearInterval(interval)
  }, [fetchChatMessages, selectedWorkspaceId, state])

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
      createWorker,
      dashboard: demoMode ? DEMO_DASHBOARD : dashboard,
      demoMode,
      disconnect,
      dispatchTask,
      enableDemoMode,
      listCommandPresets,
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
      relayConfig,
      refreshDashboard,
      restartWorker,
      runtimeStatus,
      retryOutbox,
      selectWorkspace,
      selectedWorkspaceId,
      sendPromptToOrchestrator,
      setHost,
      setToken,
      state: demoMode ? 'connected' : state,
      syncRevision,
      stopWorker,
      token,
      transcribeVoice,
      uploadMedia,
      workspaces,
    }),
    [
      answerQuestion,
      approveRequest,
      chatMessages,
      configureRelay,
      connect,
      connectionMode,
      createWorker,
      dashboard,
      demoMode,
      disconnect,
      dispatchTask,
      enableDemoMode,
      error,
      fetchChatMessages,
      listCommandPresets,
      getCockpit,
      getWorkerTranscript,
      getWorkspaceTasks,
      host,
      pairedDevice,
      outboxCounts,
      retryOutbox,
      relayConfig,
      refreshDashboard,
      restartWorker,
      runtimeStatus,
      selectWorkspace,
      selectedWorkspaceId,
      sendPromptToOrchestrator,
      state,
      syncRevision,
      stopWorker,
      token,
      transcribeVoice,
      uploadMedia,
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
