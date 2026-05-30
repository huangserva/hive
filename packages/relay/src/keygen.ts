import { randomBytes, randomUUID } from 'node:crypto'

export interface RelaySecrets {
  /** Shared secret. Must be identical in the relay server's RELAY_AUTH_TOKEN env
   *  and in ~/.config/hive/relay.json `relay_auth_token`. Gatekeeps who may join a room. */
  authToken: string
  /** Pairing room name. Daemon (Mac runtime) and device (phone) join the SAME room.
   *  Hard to guess so strangers cannot land in your room even if they have the auth token. */
  roomId: string
  /** Stable identifier for this runtime. Cosmetic / for the handshake `runtime_id` echo. */
  runtimeId: string
}

const token = (bytes: number) => randomBytes(bytes).toString('base64url')

/**
 * Generate the secrets a HippoTeam relay deployment needs. Pure + deterministic in
 * shape (only the random bytes vary), so it is unit-testable without a live relay.
 */
export const generateRelaySecrets = (): RelaySecrets => ({
  authToken: token(32),
  roomId: token(12),
  runtimeId: `runtime-${randomUUID()}`,
})
