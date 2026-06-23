import nacl from 'tweetnacl'
import { decodeBase64, encodeBase64 } from './encoding.js'
import { deriveSessionKey } from './keys.js'

const NONCE_PREFIX_BYTES = 16
const NONCE_COUNTER_BYTES = 8
const NONCE_TOTAL_BYTES = nacl.box.nonceLength

export interface EncryptedChannel {
  encrypt(plaintext: Uint8Array): string
  decrypt(encoded: string): Uint8Array | null
}

export interface EncryptedChannelOptions {
  channelId?: string
  receiveDirection?: string
  sendDirection?: string
}

type EncryptedFrameV2 = {
  channel_id: string
  counter: number
  direction: string
  nonce: string
  payload: string
  version: 2
}

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

const randomChannelId = () => encodeBase64(nacl.randomBytes(16))

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const parseFrame = (encoded: string): EncryptedFrameV2 | null => {
  try {
    const parsed = JSON.parse(textDecoder.decode(decodeBase64(encoded))) as unknown
    if (
      !isObject(parsed) ||
      parsed.version !== 2 ||
      typeof parsed.channel_id !== 'string' ||
      typeof parsed.direction !== 'string' ||
      typeof parsed.counter !== 'number' ||
      !Number.isSafeInteger(parsed.counter) ||
      parsed.counter < 0 ||
      typeof parsed.nonce !== 'string' ||
      typeof parsed.payload !== 'string'
    ) {
      return null
    }
    return parsed as EncryptedFrameV2
  } catch {
    return null
  }
}

export const createEncryptedChannelFromSharedKey = (
  sharedKey: Uint8Array,
  options: EncryptedChannelOptions = {}
): EncryptedChannel => {
  const channelId = options.channelId ?? randomChannelId()
  const sendDirection = options.sendDirection ?? 'bidirectional'
  const receiveDirection = options.receiveDirection ?? sendDirection
  const noncePrefix = nacl.randomBytes(NONCE_PREFIX_BYTES)
  let counter = 0
  let lastSeenCounter = -1
  let receiveChannelId: string | null = null

  const nextNonce = (): Uint8Array => {
    const nonce = new Uint8Array(NONCE_TOTAL_BYTES)
    nonce.set(noncePrefix, 0)
    const view = new DataView(
      nonce.buffer,
      nonce.byteOffset + NONCE_PREFIX_BYTES,
      NONCE_COUNTER_BYTES
    )
    view.setBigUint64(0, BigInt(counter), false)
    counter++
    return nonce
  }

  const decryptLegacyBundle = (bundle: Uint8Array) => {
    if (bundle.length < NONCE_TOTAL_BYTES + nacl.box.overheadLength) {
      return null
    }
    const nonce = bundle.subarray(0, NONCE_TOTAL_BYTES)
    const ciphertext = bundle.subarray(NONCE_TOTAL_BYTES)
    return nacl.box.open.after(ciphertext, nonce, sharedKey) ?? null
  }

  return {
    encrypt(plaintext: Uint8Array): string {
      const nonce = nextNonce()
      const frameCounter = counter - 1
      const ciphertext = nacl.box.after(plaintext, nonce, sharedKey)
      const frame: EncryptedFrameV2 = {
        channel_id: channelId,
        counter: frameCounter,
        direction: sendDirection,
        nonce: encodeBase64(nonce),
        payload: encodeBase64(ciphertext),
        version: 2,
      }
      return encodeBase64(textEncoder.encode(JSON.stringify(frame)))
    },

    decrypt(encoded: string): Uint8Array | null {
      const frame = parseFrame(encoded)
      if (!frame) {
        return decryptLegacyBundle(decodeBase64(encoded))
      }
      if (frame.direction !== receiveDirection) return null
      if (receiveChannelId && frame.channel_id !== receiveChannelId) return null
      if (frame.counter <= lastSeenCounter) return null
      const nonce = decodeBase64(frame.nonce)
      const ciphertext = decodeBase64(frame.payload)
      if (nonce.length !== NONCE_TOTAL_BYTES) return null
      const opened = nacl.box.open.after(ciphertext, nonce, sharedKey) ?? null
      if (!opened) return null
      receiveChannelId = frame.channel_id
      lastSeenCounter = frame.counter
      return opened
    },
  }
}

export const createEncryptedChannel = (
  mySecretKey: Uint8Array,
  theirPublicKey: Uint8Array,
  options: EncryptedChannelOptions = {}
): EncryptedChannel => {
  const sharedKey = deriveSessionKey(mySecretKey, theirPublicKey)
  return createEncryptedChannelFromSharedKey(sharedKey, options)
}
