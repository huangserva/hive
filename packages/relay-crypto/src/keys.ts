import nacl from 'tweetnacl'

export interface KeyPair {
  publicKey: Uint8Array
  secretKey: Uint8Array
}

export const generateKeyPair = (): KeyPair => nacl.box.keyPair()

export const generateEphemeralKeyPair = (): KeyPair => nacl.box.keyPair()

export const generateSigningKeyPair = (): KeyPair => nacl.sign.keyPair()

export const deriveSessionKey = (mySecretKey: Uint8Array, theirPublicKey: Uint8Array): Uint8Array =>
  nacl.box.before(theirPublicKey, mySecretKey)

export const signDetached = (message: Uint8Array, secretKey: Uint8Array): Uint8Array =>
  nacl.sign.detached(message, secretKey)

export const verifyDetached = (
  message: Uint8Array,
  signature: Uint8Array,
  publicKey: Uint8Array
): boolean => nacl.sign.detached.verify(message, signature, publicKey)
