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

export const createEncryptedChannel = (
  mySecretKey: Uint8Array,
  theirPublicKey: Uint8Array
): EncryptedChannel => {
  const sharedKey = deriveSessionKey(mySecretKey, theirPublicKey)
  const noncePrefix = nacl.randomBytes(NONCE_PREFIX_BYTES)
  let counter = 0

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

  return {
    encrypt(plaintext: Uint8Array): string {
      const nonce = nextNonce()
      const ciphertext = nacl.box.after(plaintext, nonce, sharedKey)
      const bundle = new Uint8Array(nonce.length + ciphertext.length)
      bundle.set(nonce, 0)
      bundle.set(ciphertext, nonce.length)
      return encodeBase64(bundle)
    },

    decrypt(encoded: string): Uint8Array | null {
      const bundle = decodeBase64(encoded)
      if (bundle.length < NONCE_TOTAL_BYTES + nacl.box.overheadLength) {
        return null
      }
      const nonce = bundle.subarray(0, NONCE_TOTAL_BYTES)
      const ciphertext = bundle.subarray(NONCE_TOTAL_BYTES)
      return nacl.box.open.after(ciphertext, nonce, sharedKey) ?? null
    },
  }
}
