import { createEncryptedChannel, type EncryptedChannel } from './channel.js'
import { decodeBase64, encodeBase64 } from './encoding.js'
import { generateEphemeralKeyPair, type KeyPair } from './keys.js'

export interface HandshakeInitMessage {
  ephemeral_public_key: string
}

export interface HandshakeResponseMessage {
  ephemeral_public_key: string
}

export interface HandshakeInitiator {
  getInitMessage(): HandshakeInitMessage
  processResponse(msg: HandshakeResponseMessage): EncryptedChannel
}

export interface HandshakeResponder {
  processInit(msg: HandshakeInitMessage): void
  getResponse(): HandshakeResponseMessage
  getChannel(): EncryptedChannel
}

export const createHandshakeInitiator = (_myLongTermKeyPair: KeyPair): HandshakeInitiator => {
  const ephemeral = generateEphemeralKeyPair()
  let channel: EncryptedChannel | null = null

  return {
    getInitMessage() {
      return { ephemeral_public_key: encodeBase64(ephemeral.publicKey) }
    },

    processResponse(msg: HandshakeResponseMessage) {
      if (channel) throw new Error('Handshake already completed')
      const theirEphemeralPublicKey = decodeBase64(msg.ephemeral_public_key)
      channel = createEncryptedChannel(ephemeral.secretKey, theirEphemeralPublicKey)
      return channel
    },
  }
}

export const createHandshakeResponder = (_myLongTermKeyPair: KeyPair): HandshakeResponder => {
  const ephemeral = generateEphemeralKeyPair()
  let theirEphemeralPublicKey: Uint8Array | null = null
  let channel: EncryptedChannel | null = null

  return {
    processInit(msg: HandshakeInitMessage) {
      if (theirEphemeralPublicKey) throw new Error('Init already processed')
      theirEphemeralPublicKey = decodeBase64(msg.ephemeral_public_key)
    },

    getResponse() {
      return { ephemeral_public_key: encodeBase64(ephemeral.publicKey) }
    },

    getChannel() {
      if (!theirEphemeralPublicKey) throw new Error('Init not yet processed')
      if (!channel) {
        channel = createEncryptedChannel(ephemeral.secretKey, theirEphemeralPublicKey)
      }
      return channel
    },
  }
}
