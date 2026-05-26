import { describe, expect, test } from 'vitest'
import {
  createEncryptedChannel,
  createHandshakeInitiator,
  createHandshakeResponder,
  decodeBase64,
  decodeJson,
  deriveSessionKey,
  encodeBase64,
  encodeJson,
  generateEphemeralKeyPair,
  generateKeyPair,
} from '../../src/index.js'

describe('relay-crypto encoding', () => {
  test('encodeBase64 / decodeBase64 round-trip', () => {
    const bytes = new Uint8Array([0, 127, 255, 1, 2, 3])
    expect(decodeBase64(encodeBase64(bytes))).toEqual(bytes)
  })

  test('encodeJson / decodeJson round-trip', () => {
    const obj = { hello: 'world', num: 42, arr: [1, 2, 3] }
    expect(decodeJson(encodeJson(obj))).toEqual(obj)
  })
})

describe('relay-crypto keys', () => {
  test('generateKeyPair returns 32-byte keys', () => {
    const kp = generateKeyPair()
    expect(kp.publicKey).toHaveLength(32)
    expect(kp.secretKey).toHaveLength(32)
  })

  test('shared key is consistent from both sides', () => {
    const alice = generateKeyPair()
    const bob = generateKeyPair()
    const sharedAB = deriveSessionKey(alice.secretKey, bob.publicKey)
    const sharedBA = deriveSessionKey(bob.secretKey, alice.publicKey)
    expect(sharedAB).toEqual(sharedBA)
  })

  test('different key pairs produce different shared keys', () => {
    const alice = generateKeyPair()
    const bob = generateKeyPair()
    const eve = generateKeyPair()
    const sharedAB = deriveSessionKey(alice.secretKey, bob.publicKey)
    const sharedAE = deriveSessionKey(alice.secretKey, eve.publicKey)
    expect(sharedAB).not.toEqual(sharedAE)
  })

  test('generateEphemeralKeyPair returns unique pairs', () => {
    const a = generateEphemeralKeyPair()
    const b = generateEphemeralKeyPair()
    expect(a.publicKey).not.toEqual(b.publicKey)
  })
})

describe('relay-crypto channel', () => {
  test('encrypt → decrypt round-trip', () => {
    const alice = generateKeyPair()
    const bob = generateKeyPair()
    const chA = createEncryptedChannel(alice.secretKey, bob.publicKey)
    const chB = createEncryptedChannel(bob.secretKey, alice.publicKey)
    const plaintext = new Uint8Array([1, 2, 3, 4, 5])
    const encrypted = chA.encrypt(plaintext)
    expect(chB.decrypt(encrypted)).toEqual(plaintext)
  })

  test('bidirectional encrypt → decrypt', () => {
    const alice = generateKeyPair()
    const bob = generateKeyPair()
    const chA = createEncryptedChannel(alice.secretKey, bob.publicKey)
    const chB = createEncryptedChannel(bob.secretKey, alice.publicKey)
    const msgA = encodeJson({ from: 'alice' })
    const msgB = encodeJson({ from: 'bob' })
    expect(decodeJson(chB.decrypt(chA.encrypt(msgA)) as Uint8Array)).toEqual({ from: 'alice' })
    expect(decodeJson(chA.decrypt(chB.encrypt(msgB)) as Uint8Array)).toEqual({ from: 'bob' })
  })

  test('tampered ciphertext returns null', () => {
    const alice = generateKeyPair()
    const bob = generateKeyPair()
    const chA = createEncryptedChannel(alice.secretKey, bob.publicKey)
    const chB = createEncryptedChannel(bob.secretKey, alice.publicKey)
    const encrypted = chA.encrypt(new Uint8Array([1, 2, 3]))
    const bytes = decodeBase64(encrypted)
    const last = bytes.length - 1
    bytes[last] = (bytes[last] as number) ^ 0xff
    const tampered = encodeBase64(bytes)
    expect(chB.decrypt(tampered)).toBeNull()
  })

  test('wrong key fails to decrypt', () => {
    const alice = generateKeyPair()
    const bob = generateKeyPair()
    const eve = generateKeyPair()
    const chA = createEncryptedChannel(alice.secretKey, bob.publicKey)
    const chE = createEncryptedChannel(eve.secretKey, alice.publicKey)
    const encrypted = chA.encrypt(new Uint8Array([1, 2, 3]))
    expect(chE.decrypt(encrypted)).toBeNull()
  })

  test('sequential messages use different ciphertext', () => {
    const alice = generateKeyPair()
    const bob = generateKeyPair()
    const chA = createEncryptedChannel(alice.secretKey, bob.publicKey)
    const data = new Uint8Array([42])
    const a = chA.encrypt(data)
    const b = chA.encrypt(data)
    expect(a).not.toEqual(b)
    expect(chA.decrypt(a)).toEqual(data)
    expect(chA.decrypt(b)).toEqual(data)
  })

  test('decrypt with too-short input returns null', () => {
    const alice = generateKeyPair()
    const bob = generateKeyPair()
    const ch = createEncryptedChannel(alice.secretKey, bob.publicKey)
    expect(ch.decrypt(encodeBase64(new Uint8Array(5)))).toBeNull()
  })
})

describe('relay-crypto handshake', () => {
  test('initiator and responder establish a working channel', () => {
    const daemonKP = generateKeyPair()
    const mobileKP = generateKeyPair()
    const initiator = createHandshakeInitiator(mobileKP)
    const responder = createHandshakeResponder(daemonKP)
    const initMsg = initiator.getInitMessage()
    responder.processInit(initMsg)
    const respMsg = responder.getResponse()
    const channelA = initiator.processResponse(respMsg)
    const channelB = responder.getChannel()
    const plaintext = encodeJson({ test: 'hello' })
    const encrypted = channelA.encrypt(plaintext)
    expect(decodeJson(channelB.decrypt(encrypted) as Uint8Array)).toEqual({ test: 'hello' })
  })

  test('bidirectional after handshake', () => {
    const daemonKP = generateKeyPair()
    const mobileKP = generateKeyPair()
    const initiator = createHandshakeInitiator(mobileKP)
    const responder = createHandshakeResponder(daemonKP)
    responder.processInit(initiator.getInitMessage())
    const channelA = initiator.processResponse(responder.getResponse())
    const channelB = responder.getChannel()
    const msgA = encodeJson({ direction: 'A→B' })
    const msgB = encodeJson({ direction: 'B→A' })
    expect(decodeJson(channelB.decrypt(channelA.encrypt(msgA)) as Uint8Array)).toEqual({
      direction: 'A→B',
    })
    expect(decodeJson(channelA.decrypt(channelB.encrypt(msgB)) as Uint8Array)).toEqual({
      direction: 'B→A',
    })
  })

  test('responder getChannel before processInit throws', () => {
    const kp = generateKeyPair()
    const responder = createHandshakeResponder(kp)
    expect(() => responder.getChannel()).toThrow(/not yet processed/)
  })

  test('processInit called twice throws', () => {
    const kp = generateKeyPair()
    const responder = createHandshakeResponder(kp)
    const eph = generateEphemeralKeyPair()
    const msg = { ephemeral_public_key: encodeBase64(eph.publicKey) }
    responder.processInit(msg)
    expect(() => responder.processInit(msg)).toThrow(/already processed/)
  })

  test('processResponse called twice throws', () => {
    const kp = generateKeyPair()
    const initiator = createHandshakeInitiator(kp)
    const eph = generateEphemeralKeyPair()
    const msg = { ephemeral_public_key: encodeBase64(eph.publicKey) }
    initiator.processResponse(msg)
    expect(() => initiator.processResponse(msg)).toThrow(/already completed/)
  })
})
