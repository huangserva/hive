import type { StoredRelayConfig } from '../lib/relay-config-store'
import type { MobileConnectionMode } from './client'
import type { MobileRuntimeState } from './mobile-runtime-context'
import type { RelayTransportStatus } from './relay-transport'

export interface ConnectionDiagnosticEvent {
  detail?: string
  ts: number
  type: string
}

export interface ConnectionAttemptDiagnostic {
  durationMs?: number
  error?: string
  method?: string
  ok: boolean
  path?: string
  status?: RelayTransportStatus | string
  ts: number
}

export interface RelayConfigDiagnostic {
  configured: boolean
  daemon_public_key: string
  device_id: string | null
  device_keypair: string
  relay_auth_token: string
  relay_url: string | null
  room_id: string | null
  token: string
}

export interface MobileConnectionDiagnostics {
  connectionMode: MobileConnectionMode
  error: string | null
  events: ConnectionDiagnosticEvent[]
  host: string
  lastLanAttempt: ConnectionAttemptDiagnostic | null
  lastRelayResult: ConnectionAttemptDiagnostic | null
  relay: RelayConfigDiagnostic
  state: MobileRuntimeState
}

export type ConnectionDiagnosticEventInput = Omit<ConnectionDiagnosticEvent, 'ts'> & {
  ts?: number
}

const EVENT_LIMIT = 30

export const maskSecret = (value: string | null | undefined) => {
  const trimmed = value?.trim()
  if (!trimmed) return 'not configured'
  if (trimmed.length < 8) return 'configured'
  return `configured (...${trimmed.slice(-4)})`
}

export const sanitizeRelayConfigForDiagnostics = (
  relayConfig: StoredRelayConfig | null,
  token: string
): RelayConfigDiagnostic => {
  if (!relayConfig) {
    return {
      configured: false,
      daemon_public_key: 'not configured',
      device_id: null,
      device_keypair: 'not configured',
      relay_auth_token: 'not configured',
      relay_url: null,
      room_id: null,
      token: maskSecret(token),
    }
  }
  return {
    configured: true,
    daemon_public_key: maskSecret(relayConfig.daemon_public_key),
    device_id: relayConfig.device_id,
    device_keypair:
      relayConfig.device_keypair.publicKey && relayConfig.device_keypair.secretKey
        ? 'configured'
        : 'not configured',
    relay_auth_token: maskSecret(relayConfig.relay_auth_token),
    relay_url: relayConfig.relay_url,
    room_id: relayConfig.room_id,
    token: maskSecret(token),
  }
}

export const createInitialConnectionDiagnostics = (): MobileConnectionDiagnostics => ({
  connectionMode: 'disconnected',
  error: null,
  events: [],
  host: '',
  lastLanAttempt: null,
  lastRelayResult: null,
  relay: sanitizeRelayConfigForDiagnostics(null, ''),
  state: 'idle',
})

export const appendConnectionEvent = (
  diagnostics: MobileConnectionDiagnostics,
  event: ConnectionDiagnosticEventInput
): MobileConnectionDiagnostics => ({
  ...diagnostics,
  events: [...diagnostics.events, { ...event, ts: event.ts ?? Date.now() }].slice(-EVENT_LIMIT),
})

export const formatDiagnosticTime = (ts: number) => new Date(ts).toISOString()

const formatAttempt = (label: 'LAN' | 'Relay', attempt: ConnectionAttemptDiagnostic | null) => {
  if (!attempt) return `${label}: none`
  if (label === 'LAN') {
    const result = attempt.ok ? 'ok' : 'failed'
    const path = attempt.path ?? 'unknown path'
    const duration = attempt.durationMs === undefined ? '' : ` in ${attempt.durationMs}ms`
    const error = attempt.error ? ` error=${attempt.error}` : ''
    return `${label}: ${result} ${path}${duration}${error}`
  }
  const result = attempt.ok ? 'ok' : 'failed'
  const method = attempt.method ?? 'unknown method'
  const status = attempt.status ? ` status=${attempt.status}` : ''
  const error = attempt.error ? ` error=${attempt.error}` : ''
  return `${label}: ${result} ${method}${status}${error}`
}

export const buildConnectionDiagnosticsText = (diagnostics: MobileConnectionDiagnostics) => {
  const lines = [
    'HippoTeam Mobile Connection Diagnostics',
    `generated_at: ${formatDiagnosticTime(Date.now())}`,
    `state: ${diagnostics.state}`,
    `connectionMode: ${diagnostics.connectionMode}`,
    `lastError: ${diagnostics.error ?? 'none'}`,
    `host: ${diagnostics.host || 'not configured'}`,
    '',
    'Relay',
    `configured: ${diagnostics.relay.configured ? 'yes' : 'no'}`,
    `relay_url: ${diagnostics.relay.relay_url ?? 'not configured'}`,
    `room_id: ${diagnostics.relay.room_id ?? 'not configured'}`,
    `device_id: ${diagnostics.relay.device_id ?? 'not configured'}`,
    `token: ${diagnostics.relay.token}`,
    `relay_auth_token: ${diagnostics.relay.relay_auth_token}`,
    `daemon_public_key: ${diagnostics.relay.daemon_public_key}`,
    `device_keypair: ${diagnostics.relay.device_keypair}`,
    '',
    formatAttempt('LAN', diagnostics.lastLanAttempt),
    formatAttempt('Relay', diagnostics.lastRelayResult),
    '',
    'Events',
    ...diagnostics.events.map(
      (event) =>
        `${formatDiagnosticTime(event.ts)} ${event.type}${event.detail ? ` ${event.detail}` : ''}`
    ),
  ]
  return lines.join('\n')
}
