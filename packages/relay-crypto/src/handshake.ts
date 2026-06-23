import nacl from 'tweetnacl'
import {
  createEncryptedChannel,
  createEncryptedChannelFromSharedKey,
  type EncryptedChannel,
} from './channel.js'
import { decodeBase64, encodeBase64 } from './encoding.js'
import {
  deriveSessionKey,
  generateEphemeralKeyPair,
  type KeyPair,
  signDetached,
  verifyDetached,
} from './keys.js'

export interface HandshakeInitMessage {
  ephemeral_public_key: string
  version?: number
}

export interface HandshakeResponseMessage {
  ephemeral_public_key: string
  signature?: string
  signing_public_key?: string
  version?: number
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

export interface HandshakeInitiatorOptions {
  expectedResponderSigningPublicKey?: Uint8Array
}

export interface HandshakeResponderOptions {
  signingKeyPair?: KeyPair
}

const textEncoder = new TextEncoder()

const concatBytes = (...chunks: Uint8Array[]) => {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

const handshakeTranscript = (
  initiatorEphemeralPublicKey: Uint8Array,
  responderEphemeralPublicKey: Uint8Array,
  responderSigningPublicKey?: Uint8Array
) =>
  concatBytes(
    textEncoder.encode('hive-relay-v2-handshake:'),
    initiatorEphemeralPublicKey,
    responderEphemeralPublicKey,
    responderSigningPublicKey ?? new Uint8Array()
  )

const deriveTranscriptSessionKey = (
  myEphemeralSecretKey: Uint8Array,
  theirEphemeralPublicKey: Uint8Array,
  transcript: Uint8Array
) => {
  const shared = deriveSessionKey(myEphemeralSecretKey, theirEphemeralPublicKey)
  return nacl
    .hash(concatBytes(textEncoder.encode('hive-relay-v2-kdf:'), shared, transcript))
    .subarray(0, 32)
}

export const createHandshakeInitiator = (
  _myLongTermKeyPair: KeyPair,
  options: HandshakeInitiatorOptions = {}
): HandshakeInitiator => {
  const ephemeral = generateEphemeralKeyPair()
  let channel: EncryptedChannel | null = null

  return {
    getInitMessage() {
      return {
        ephemeral_public_key: encodeBase64(ephemeral.publicKey),
        ...(options.expectedResponderSigningPublicKey ? { version: 2 } : {}),
      }
    },

    processResponse(msg: HandshakeResponseMessage) {
      if (channel) throw new Error('Handshake already completed')
      const theirEphemeralPublicKey = decodeBase64(msg.ephemeral_public_key)
      if (options.expectedResponderSigningPublicKey) {
        if (!msg.signature) throw new Error('Handshake response signature is required')
        const signingPublicKey = msg.signing_public_key
          ? decodeBase64(msg.signing_public_key)
          : options.expectedResponderSigningPublicKey
        if (
          encodeBase64(signingPublicKey) !== encodeBase64(options.expectedResponderSigningPublicKey)
        ) {
          throw new Error('Handshake responder signing public key mismatch')
        }
        const transcript = handshakeTranscript(
          ephemeral.publicKey,
          theirEphemeralPublicKey,
          options.expectedResponderSigningPublicKey
        )
        if (
          !verifyDetached(
            transcript,
            decodeBase64(msg.signature),
            options.expectedResponderSigningPublicKey
          )
        ) {
          throw new Error('Handshake response signature verification failed')
        }
        channel = createEncryptedChannelFromSharedKey(
          deriveTranscriptSessionKey(ephemeral.secretKey, theirEphemeralPublicKey, transcript),
          {
            receiveDirection: 'responder_to_initiator',
            sendDirection: 'initiator_to_responder',
          }
        )
        return channel
      }
      channel = createEncryptedChannel(ephemeral.secretKey, theirEphemeralPublicKey)
      return channel
    },
  }
}

export const createHandshakeResponder = (
  _myLongTermKeyPair: KeyPair,
  options: HandshakeResponderOptions = {}
): HandshakeResponder => {
  const ephemeral = generateEphemeralKeyPair()
  let theirEphemeralPublicKey: Uint8Array | null = null
  let channel: EncryptedChannel | null = null

  return {
    processInit(msg: HandshakeInitMessage) {
      if (theirEphemeralPublicKey) throw new Error('Init already processed')
      theirEphemeralPublicKey = decodeBase64(msg.ephemeral_public_key)
    },

    getResponse() {
      if (!theirEphemeralPublicKey) throw new Error('Init not yet processed')
      if (!options.signingKeyPair)
        return { ephemeral_public_key: encodeBase64(ephemeral.publicKey) }
      const transcript = handshakeTranscript(
        theirEphemeralPublicKey,
        ephemeral.publicKey,
        options.signingKeyPair.publicKey
      )
      return {
        ephemeral_public_key: encodeBase64(ephemeral.publicKey),
        signature: encodeBase64(signDetached(transcript, options.signingKeyPair.secretKey)),
        signing_public_key: encodeBase64(options.signingKeyPair.publicKey),
        version: 2,
      }
    },

    getChannel() {
      if (!theirEphemeralPublicKey) throw new Error('Init not yet processed')
      if (!channel) {
        if (!options.signingKeyPair) {
          channel = createEncryptedChannel(ephemeral.secretKey, theirEphemeralPublicKey)
        } else {
          const transcript = handshakeTranscript(
            theirEphemeralPublicKey,
            ephemeral.publicKey,
            options.signingKeyPair.publicKey
          )
          channel = createEncryptedChannelFromSharedKey(
            deriveTranscriptSessionKey(ephemeral.secretKey, theirEphemeralPublicKey, transcript),
            {
              receiveDirection: 'initiator_to_responder',
              sendDirection: 'responder_to_initiator',
            }
          )
        }
      }
      return channel
    },
  }
}
