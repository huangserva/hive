import * as SecureStore from 'expo-secure-store'
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'

import { encodeBase64, generateKeyPair } from '../../../relay-crypto/src/index.js'
import {
  createRuntimeClient,
  DEFAULT_RUNTIME_HOST,
  type MobileConnectionMode,
  type MobileDashboard,
  type MobileDeviceSummary,
  type MobileDispatchResponse,
  type MobilePairRedeemResponse,
  type MobilePairResponse,
  type MobileRelayConfig,
  type MobileWorkerTranscript,
  type MobileWorkspace,
  type MobileWorkspaceTasks,
  type RuntimeStatus,
} from './client'
import { createRelayTransport, type RelayTransportConfig } from './relay-transport'

const RUNTIME_HOST_KEY = 'hippoteam.runtimeHost'
const MOBILE_TOKEN_KEY = 'hippoteam.mobileToken'
const WORKSPACE_ID_KEY = 'hippoteam.mobileWorkspaceId'
const RELAY_CONFIG_KEY = 'hippoteam.mobileRelayConfig'

export type MobileRuntimeState = 'idle' | 'checking' | 'connected' | 'error'

interface StoredRelayConfig extends Omit<RelayTransportConfig, 'device_token'> {}

interface MobileRuntimeContextValue {
  connect: (nextHost: string, nextToken: string) => Promise<RuntimeStatus | null>
  connectionMode: MobileConnectionMode
  dashboard: MobileDashboard | null
  disconnect: () => Promise<void>
  dispatchTask: (workerId: string, task: string) => Promise<MobileDispatchResponse | null>
  error: string | null
  getWorkerTranscript: (workerId: string) => Promise<MobileWorkerTranscript | null>
  getWorkspaceTasks: () => Promise<MobileWorkspaceTasks | null>
  host: string
  pairHost: (nextHost: string) => Promise<MobilePairResponse | null>
  pairedDevice: MobileDeviceSummary | null
  relayConfig: StoredRelayConfig | null
  redeemPairingCode: (nextHost: string, code: string) => Promise<MobilePairRedeemResponse | null>
  refreshDashboard: (workspaceId?: string) => Promise<MobileDashboard | null>
  restartWorker: (workerId: string) => Promise<boolean>
  runtimeStatus: RuntimeStatus | null
  selectWorkspace: (workspaceId: string) => Promise<void>
  selectedWorkspaceId: string | null
  setHost: (host: string) => void
  setToken: (token: string) => void
  state: MobileRuntimeState
  stopWorker: (workerId: string) => Promise<boolean>
  token: string
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

const buildStoredRelayConfig = (
  relay: MobileRelayConfig,
  device: MobileDeviceSummary
): StoredRelayConfig => {
  const keypair = generateKeyPair()
  return {
    capabilities: device.capabilities ?? [],
    daemon_public_key: relay.daemon_public_key,
    device_id: device.id,
    device_keypair: {
      publicKey: encodeBase64(keypair.publicKey),
      secretKey: encodeBase64(keypair.secretKey),
    },
    relay_url: relay.relay_url,
    room_id: relay.room_id,
  }
}

const parseStoredRelayConfig = (value: string | null): StoredRelayConfig | null => {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as StoredRelayConfig
    if (
      typeof parsed.relay_url !== 'string' ||
      typeof parsed.room_id !== 'string' ||
      typeof parsed.daemon_public_key !== 'string' ||
      typeof parsed.device_id !== 'string' ||
      !Array.isArray(parsed.capabilities)
    ) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export const MobileRuntimeProvider = ({ children }: PropsWithChildren) => {
  const [host, setHost] = useState(DEFAULT_RUNTIME_HOST)
  const [token, setToken] = useState('')
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null)
  const [workspaces, setWorkspaces] = useState<MobileWorkspace[]>([])
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus | null>(null)
  const [dashboard, setDashboard] = useState<MobileDashboard | null>(null)
  const [pairedDevice, setPairedDevice] = useState<MobileDeviceSummary | null>(null)
  const [relayConfig, setRelayConfig] = useState<StoredRelayConfig | null>(null)
  const [connectionMode, setConnectionMode] = useState<MobileConnectionMode>('disconnected')
  const [state, setState] = useState<MobileRuntimeState>('idle')
  const [error, setError] = useState<string | null>(null)

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

  useEffect(() => {
    const unsubscribe = client.onConnectionModeChange((mode) =>
      setConnectionMode(mode as MobileConnectionMode)
    )
    return () => {
      unsubscribe()
    }
  }, [client])

  const pairHost = useCallback(async (nextHost: string) => {
    setState('checking')
    setError(null)
    try {
      const pair = await createRuntimeClient({ host: nextHost }).pairMobile()
      setToken(pair.token)
      await secureSet(MOBILE_TOKEN_KEY, pair.token)
      return pair
    } catch (pairError) {
      const message = pairError instanceof Error ? pairError.message : String(pairError)
      setError(message)
      setState('error')
      return null
    }
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

        setHost(nextHost)
        setToken(trimmedToken)
        setRuntimeStatus(nextStatus)
        setWorkspaces(nextWorkspaces)
        setSelectedWorkspaceId(nextWorkspaceId)
        setDashboard(nextDashboard)
        setConnectionMode(nextClient.connectionMode())
        setState('connected')

        await Promise.all([
          secureSet(RUNTIME_HOST_KEY, nextHost),
          secureSet(MOBILE_TOKEN_KEY, trimmedToken),
          nextWorkspaceId ? secureSet(WORKSPACE_ID_KEY, nextWorkspaceId) : Promise.resolve(),
        ])
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
    [createRelay, relayConfig, selectedWorkspaceId]
  )

  const redeemPairingCode = useCallback(
    async (nextHost: string, code: string) => {
      setState('checking')
      setError(null)
      try {
        const redeemed = await createRuntimeClient({ host: nextHost }).redeemPairingCode(code)
        const nextRelayConfig = redeemed.relay
          ? buildStoredRelayConfig(redeemed.relay, redeemed.device)
          : null
        setPairedDevice(redeemed.device)
        setRelayConfig(nextRelayConfig)
        if (nextRelayConfig) {
          await secureSet(RELAY_CONFIG_KEY, JSON.stringify(nextRelayConfig))
        } else {
          await secureDelete(RELAY_CONFIG_KEY)
        }
        await connect(nextHost, redeemed.token, nextRelayConfig)
        return redeemed
      } catch (pairError) {
        const message = pairError instanceof Error ? pairError.message : String(pairError)
        setError(message)
        setState('error')
        return null
      }
    },
    [connect]
  )

  const selectWorkspace = useCallback(
    async (workspaceId: string) => {
      setSelectedWorkspaceId(workspaceId)
      await secureSet(WORKSPACE_ID_KEY, workspaceId)
      await refreshDashboard(workspaceId)
    },
    [refreshDashboard]
  )

  const disconnect = useCallback(async () => {
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
        return true
      } catch (stopError) {
        const message = stopError instanceof Error ? stopError.message : String(stopError)
        setError(message)
        return false
      }
    },
    [client, refreshDashboard, selectedWorkspaceId]
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
        return true
      } catch (restartError) {
        const message = restartError instanceof Error ? restartError.message : String(restartError)
        setError(message)
        return false
      }
    },
    [client, refreshDashboard, selectedWorkspaceId]
  )

  const dispatchTask = useCallback(
    async (workerId: string, task: string) => {
      if (!selectedWorkspaceId) {
        setError('Select a workspace before dispatching tasks')
        return null
      }
      setError(null)
      try {
        const dispatch = await client.dispatchTask(selectedWorkspaceId, workerId, task)
        await refreshDashboard(selectedWorkspaceId)
        return dispatch
      } catch (dispatchError) {
        const message =
          dispatchError instanceof Error ? dispatchError.message : String(dispatchError)
        setError(message)
        return null
      }
    },
    [client, refreshDashboard, selectedWorkspaceId]
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

  useEffect(() => {
    let cancelled = false
    Promise.all([
      secureGet(RUNTIME_HOST_KEY),
      secureGet(MOBILE_TOKEN_KEY),
      secureGet(WORKSPACE_ID_KEY),
      secureGet(RELAY_CONFIG_KEY),
    ]).then(([storedHost, storedToken, storedWorkspaceId, storedRelay]) => {
      if (cancelled) return
      const nextHost = storedHost || DEFAULT_RUNTIME_HOST
      const nextRelayConfig = parseStoredRelayConfig(storedRelay)
      setHost(nextHost)
      if (storedToken) setToken(storedToken)
      if (storedWorkspaceId) setSelectedWorkspaceId(storedWorkspaceId)
      if (nextRelayConfig) setRelayConfig(nextRelayConfig)
      if (storedToken) {
        void connect(nextHost, storedToken, nextRelayConfig)
      }
    })
    return () => {
      cancelled = true
    }
  }, [connect])

  useEffect(() => {
    if (connectionMode === 'relay') return
    if (state !== 'connected' || !selectedWorkspaceId || !token.trim()) return
    const socket = new WebSocket(client.buildMobileDashboardWebSocketUrl(selectedWorkspaceId))
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
    }
    return () => {
      socket.close()
    }
  }, [client, connectionMode, selectedWorkspaceId, state, token])

  const value = useMemo<MobileRuntimeContextValue>(
    () => ({
      connect,
      connectionMode,
      dashboard,
      disconnect,
      dispatchTask,
      error,
      getWorkerTranscript,
      getWorkspaceTasks,
      host,
      pairHost,
      pairedDevice,
      relayConfig,
      redeemPairingCode,
      refreshDashboard,
      restartWorker,
      runtimeStatus,
      selectWorkspace,
      selectedWorkspaceId,
      setHost,
      setToken,
      state,
      stopWorker,
      token,
      workspaces,
    }),
    [
      connect,
      connectionMode,
      dashboard,
      disconnect,
      dispatchTask,
      error,
      getWorkerTranscript,
      getWorkspaceTasks,
      host,
      pairHost,
      pairedDevice,
      relayConfig,
      redeemPairingCode,
      refreshDashboard,
      restartWorker,
      runtimeStatus,
      selectWorkspace,
      selectedWorkspaceId,
      state,
      stopWorker,
      token,
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
