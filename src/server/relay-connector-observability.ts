import { redactText } from './secret-redactor.js'

export const RELAY_CONNECTOR_EVENTS = [
  'peer_connected',
  'peer_disconnected',
  'handshake_start',
  'handshake_ok',
  'handshake_failed',
  'device_mismatch',
  'capability_denied',
  'liveness_timeout',
  'decode_error',
] as const

export type RelayConnectorEventName = (typeof RELAY_CONNECTOR_EVENTS)[number]

export interface RelayConnectorDiagnosticEvent {
  device_id?: string
  error_code?: string
  error_message?: string
  event: RelayConnectorEventName
  protocol_version: 'v1' | 'v2' | 'unknown'
  room_id: string
}

export interface RelayConnectorEventInput {
  deviceId?: string | null | undefined
  error?: unknown
  errorCode?: string | undefined
  event: RelayConnectorEventName
  protocolVersion?: number | null | undefined
  roomId: string
  secretValues?: string[] | undefined
}

export const isRelayConnectorEventName = (value: unknown): value is RelayConnectorEventName =>
  typeof value === 'string' && RELAY_CONNECTOR_EVENTS.includes(value as RelayConnectorEventName)

const protocolVersionLabel = (version: number | null | undefined) => {
  if (version === 1) return 'v1'
  if (version === 2) return 'v2'
  return 'unknown'
}

const errorMessage = (error: unknown) => {
  if (error === undefined) return undefined
  if (error instanceof Error) return error.message
  return String(error)
}

export const toRelayConnectorDiagnosticEvent = (
  input: RelayConnectorEventInput
): RelayConnectorDiagnosticEvent => {
  const secretValues = input.secretValues ?? []
  const rawMessage = errorMessage(input.error)
  return {
    ...(input.deviceId ? { device_id: redactText(input.deviceId, secretValues) } : {}),
    ...(input.errorCode ? { error_code: input.errorCode } : {}),
    ...(rawMessage ? { error_message: redactText(rawMessage, secretValues) } : {}),
    event: input.event,
    protocol_version: protocolVersionLabel(input.protocolVersion),
    room_id: input.roomId,
  }
}

const quote = (value: string) => JSON.stringify(value)

export const formatRelayConnectorLogLine = (event: RelayConnectorDiagnosticEvent) =>
  [
    'relay_connector',
    `event=${event.event}`,
    `room_id=${event.room_id}`,
    event.device_id ? `device_id=${event.device_id}` : null,
    `protocol_version=${event.protocol_version}`,
    event.error_code ? `error_code=${event.error_code}` : null,
    event.error_message ? `error_message=${quote(event.error_message)}` : null,
  ]
    .filter((part): part is string => typeof part === 'string')
    .join(' ')
