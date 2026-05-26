import nacl from 'tweetnacl'

export interface KeyPair {
  publicKey: Uint8Array
  secretKey: Uint8Array
}

export const generateKeyPair = (): KeyPair => nacl.box.keyPair()

export const generateEphemeralKeyPair = (): KeyPair => nacl.box.keyPair()

export const deriveSessionKey = (mySecretKey: Uint8Array, theirPublicKey: Uint8Array): Uint8Array =>
  nacl.box.before(theirPublicKey, mySecretKey)
