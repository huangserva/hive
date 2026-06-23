import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import {
  createHandshakeResponder,
  decodeBase64,
  decodeJson,
  encodeBase64,
  encodeJson,
  generateKeyPair,
  generateSigningKeyPair,
  type KeyPair,
} from '../../relay-crypto/src/index.js'
import { createRuntimeClient } from '../src/api/client.js'
import { createRelayTransport, type RelayTransportConfig } from '../src/api/relay-transport.js'
import { createVoiceCallStateFrame } from '../src/api/voice-call-state-protocol.js'
import { createVoiceDownlinkSegmentFrame } from '../src/api/voice-downlink-segment-protocol.js'
import { createVoiceStreamFrame } from '../src/api/voice-stream-protocol.js'
import { createWebRtcSignalFrame } from '../src/api/webrtc-signal-protocol.js'

class FakeRelaySocket {
  static instances: FakeRelaySocket[] = []

  onclose: ((event: unknown) => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onopen: (() => void) | null = null
  readyState = 0
  sent: unknown[] = []

  constructor(readonly url: string) {
    FakeRelaySocket.instances.push(this)
    setTimeout(() => {
      this.readyState = 1
      this.onopen?.()
    }, 0)
  }

  send(data: string) {
    this.sent.push(JSON.parse(data) as unknown)
  }

  close(code = 1000, reason = 'closed') {
    this.readyState = 3
    this.onclose?.({ code, reason })
  }

  receive(value: unknown) {
    this.onmessage?.({ data: JSON.stringify(value) })
  }
}

const toBase64 = (bytes: Uint8Array) => {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

const buildConfig = (): RelayTransportConfig => {
  const daemon = generateKeyPair()
  const device = generateKeyPair()
  return {
    capabilities: ['read_dashboard', 'send_prompt', 'admin_runtime'],
    daemon_public_key: toBase64(daemon.publicKey),
    device_id: 'device-1',
    device_keypair: {
      publicKey: toBase64(device.publicKey),
      secretKey: toBase64(device.secretKey),
    },
    device_token: 'mobile-token',
    relay_auth_token: 'relay-secret',
    relay_url: 'wss://relay.example.test/v1',
    room_id: 'room-1',
  }
}

const buildV2Config = (): { config: RelayTransportConfig; daemonSigning: KeyPair } => {
  const base = buildConfig()
  const daemonSigning = generateSigningKeyPair()
  return {
    config: {
      ...base,
      daemon_signing_public_key: toBase64(daemonSigning.publicKey),
      relay_protocol_version: 2,
      room_auth_token: 'room-secret',
    },
    daemonSigning,
  }
}

const latestSocket = () => {
  const socket = FakeRelaySocket.instances.at(-1)
  if (!socket) throw new Error('No fake socket')
  return socket
}

const setupReadyRelay = async () => {
  const config = buildConfig()
  const transport = createRelayTransport(config, {
    WebSocketCtor: FakeRelaySocket,
    reconnectBaseMs: 10,
  })
  const connectPromise = transport.connect()
  await vi.advanceTimersByTimeAsync(0)
  const socket = latestSocket()
  expect(socket.sent[0]).toMatchObject({
    auth_token: 'relay-secret',
    role: 'device',
    room: 'room-1',
    type: 'join',
  })
  socket.receive({ type: 'joined' })
  const helloFrame = socket.sent.at(-1) as { payload: string; type: string }
  expect(helloFrame.type).toBe('data')
  // Contract guard: the hello goes on the wire as base64(JSON) and must match the
  // daemon's decodeClearFrame + isHandshakeHello (relay-connector.ts) — a nested
  // `handshake` init-message object and a `token` field. Plain JSON or wrong field
  // names only surface on a real relay handshake (4G), never on LAN, so decode it
  // exactly as the daemon does.
  const hello = decodeJson(decodeBase64(helloFrame.payload)) as {
    device_id: string
    handshake: { ephemeral_public_key: string }
    token: string
    type: string
  }
  expect(hello).toMatchObject({
    device_id: 'device-1',
    token: 'mobile-token',
    type: 'e2ee_hello',
  })
  expect(typeof hello.handshake?.ephemeral_public_key).toBe('string')
  const responder = createHandshakeResponder(generateKeyPair())
  // Drive the handshake exactly as relay-connector does: processInit(frame.handshake)
  // and reply with base64(JSON) carrying the response nested under `handshake`.
  responder.processInit(hello.handshake)
  socket.receive({
    payload: encodeBase64(encodeJson({ type: 'e2ee_ready', handshake: responder.getResponse() })),
    type: 'data',
  })
  await connectPromise
  return { channel: responder.getChannel(), socket, transport }
}

const setupReadyRelayV2 = async () => {
  const { config, daemonSigning } = buildV2Config()
  const transport = createRelayTransport(config, {
    WebSocketCtor: FakeRelaySocket,
    reconnectBaseMs: 10,
  })
  const connectPromise = transport.connect()
  await vi.advanceTimersByTimeAsync(0)
  const socket = latestSocket()
  expect(socket.sent[0]).toMatchObject({
    role: 'device',
    room: 'room-1',
    room_auth_token: 'room-secret',
    type: 'join',
    version: 2,
  })
  expect(socket.sent[0]).not.toHaveProperty('auth_token')
  socket.receive({ type: 'joined' })
  const helloFrame = socket.sent.at(-1) as { payload: string; type: string }
  const hello = decodeJson(decodeBase64(helloFrame.payload)) as {
    device_id: string
    handshake: { ephemeral_public_key: string }
    token: string
    type: string
    version: number
  }
  expect(hello.version).toBe(2)
  const responder = createHandshakeResponder(generateKeyPair(), { signingKeyPair: daemonSigning })
  responder.processInit(hello.handshake)
  socket.receive({
    payload: encodeBase64(encodeJson({ type: 'e2ee_ready', handshake: responder.getResponse() })),
    type: 'data',
  })
  await connectPromise
  return { channel: responder.getChannel(), socket, transport }
}

beforeEach(() => {
  vi.useFakeTimers()
  FakeRelaySocket.instances = []
})

afterEach(() => {
  vi.useRealTimers()
})

describe('relay transport', () => {
  test('connects, joins the relay room, and completes the E2E handshake', async () => {
    const { transport } = await setupReadyRelay()

    expect(transport.status()).toBe('ready')
  })

  test('v2 joins with room_auth_token and verifies the daemon signing key', async () => {
    const { transport } = await setupReadyRelayV2()

    expect(transport.status()).toBe('ready')
  })

  test('encrypts JSON-RPC calls and resolves matching encrypted responses', async () => {
    const { channel, socket, transport } = await setupReadyRelay()

    const callPromise = transport.call<{ version: string }>('runtime.status')
    const encryptedRequest = socket.sent.at(-1) as { payload: string; type: string }
    expect(encryptedRequest.type).toBe('data')
    const request = decodeJson(channel.decrypt(encryptedRequest.payload) ?? new Uint8Array()) as {
      id: string
      method: string
    }
    expect(request.method).toBe('runtime.status')

    socket.receive({
      payload: channel.encrypt(encodeJson({ id: request.id, result: { version: '2.0.0' } })),
      type: 'data',
    })

    await expect(callPromise).resolves.toEqual({ version: '2.0.0' })
  })

  test('sends encrypted voice_stream frames without creating an RPC pending request', async () => {
    const { channel, socket, transport } = await setupReadyRelay()

    transport.sendVoiceStreamFrame(createVoiceStreamFrame('open', 'voice-1', 0))
    const encryptedFrame = socket.sent.at(-1) as { payload: string; type: string }
    expect(encryptedFrame.type).toBe('data')
    const decrypted = decodeJson(channel.decrypt(encryptedFrame.payload) ?? new Uint8Array()) as {
      op: string
      seq: number
      stream_id: string
      type: string
    }

    expect(decrypted).toMatchObject({
      op: 'open',
      seq: 0,
      stream_id: 'voice-1',
      type: 'voice_stream',
    })
  })

  test('routes inbound voice_stream frames to stream listeners and leaves RPC frames untouched', async () => {
    const { channel, socket, transport } = await setupReadyRelay()
    const voiceFrames: unknown[] = []
    transport.onVoiceStreamFrame((frame) => voiceFrames.push(frame))

    const callPromise = transport.call<{ ok: boolean }>('runtime.status')
    const encryptedRequest = socket.sent.at(-1) as { payload: string }
    const request = decodeJson(channel.decrypt(encryptedRequest.payload) ?? new Uint8Array()) as {
      id: string
    }

    socket.receive({
      payload: channel.encrypt(
        encodeJson(createVoiceStreamFrame('ack', 'voice-1', 1, { sent_at_ms: 1_000 }))
      ),
      type: 'data',
    })
    expect(voiceFrames).toEqual([
      expect.objectContaining({ op: 'ack', seq: 1, stream_id: 'voice-1' }),
    ])

    socket.receive({
      payload: channel.encrypt(encodeJson({ id: request.id, result: { ok: true } })),
      type: 'data',
    })
    await expect(callPromise).resolves.toEqual({ ok: true })
  })

  test('routes inbound voice_downlink_segment frames to downlink listeners only', async () => {
    const { channel, socket, transport } = await setupReadyRelay()
    const downlinkFrames: unknown[] = []
    const voiceFrames: unknown[] = []
    transport.onVoiceDownlinkSegmentFrame((frame) => downlinkFrames.push(frame))
    transport.onVoiceStreamFrame((frame) => voiceFrames.push(frame))

    socket.receive({
      payload: channel.encrypt(
        encodeJson(
          createVoiceDownlinkSegmentFrame('segment_chunk', {
            callId: 'call-1',
            done: true,
            generation: 3,
            payload: 'abc',
            segmentId: 1,
            seq: 1,
            turnId: 'turn-1',
          })
        )
      ),
      type: 'data',
    })

    expect(downlinkFrames).toEqual([
      expect.objectContaining({
        call_id: 'call-1',
        generation: 3,
        op: 'segment_chunk',
        segment_id: 1,
        turn_id: 'turn-1',
        type: 'voice_downlink_segment',
      }),
    ])
    expect(voiceFrames).toEqual([])
  })

  test('routes inbound voice_downlink_segment retract frames to downlink listeners', async () => {
    const { channel, socket, transport } = await setupReadyRelay()
    const downlinkFrames: unknown[] = []
    transport.onVoiceDownlinkSegmentFrame((frame) => downlinkFrames.push(frame))

    socket.receive({
      payload: channel.encrypt(
        encodeJson(
          createVoiceDownlinkSegmentFrame('retract', {
            callId: 'call-1',
            generation: 5,
            retractGeneration: 4,
            segmentId: 0,
            seq: 0,
            turnId: 'turn-1',
          })
        )
      ),
      type: 'data',
    })

    expect(downlinkFrames).toEqual([
      expect.objectContaining({
        call_id: 'call-1',
        generation: 5,
        op: 'retract',
        retract_generation: 4,
        turn_id: 'turn-1',
        type: 'voice_downlink_segment',
      }),
    ])
  })

  test('routes inbound voice_call_state frames to call-state listeners only', async () => {
    const { channel, socket, transport } = await setupReadyRelay()
    const callStateFrames: unknown[] = []
    const downlinkFrames: unknown[] = []
    const voiceFrames: unknown[] = []
    transport.onVoiceCallStateFrame((frame) => callStateFrames.push(frame))
    transport.onVoiceDownlinkSegmentFrame((frame) => downlinkFrames.push(frame))
    transport.onVoiceStreamFrame((frame) => voiceFrames.push(frame))

    socket.receive({
      payload: channel.encrypt(
        encodeJson(
          createVoiceCallStateFrame({
            callId: 'call-1',
            phase: 'processing',
            ts: 1_717_000,
            turnId: 'turn-1',
          })
        )
      ),
      type: 'data',
    })

    expect(callStateFrames).toEqual([
      expect.objectContaining({
        call_id: 'call-1',
        phase: 'processing',
        ts: 1_717_000,
        turn_id: 'turn-1',
        type: 'voice_call_state',
      }),
    ])
    expect(downlinkFrames).toEqual([])
    expect(voiceFrames).toEqual([])
  })

  test('sends and routes encrypted webrtc_signal frames without touching RPC or voice_stream listeners', async () => {
    const { channel, socket, transport } = await setupReadyRelay()
    const webRtcFrames: unknown[] = []
    const voiceFrames: unknown[] = []
    transport.onWebRtcSignalFrame((frame) => {
      webRtcFrames.push(frame)
    })
    transport.onVoiceStreamFrame((frame) => voiceFrames.push(frame))

    transport.sendWebRtcSignalFrame(
      createWebRtcSignalFrame('offer', 'call-1', { sdp: 'offer-sdp', sent_at_ms: 1_000 })
    )
    const encryptedOutbound = socket.sent.at(-1) as { payload: string; type: string }
    const outbound = decodeJson(channel.decrypt(encryptedOutbound.payload) ?? new Uint8Array())
    expect(outbound).toMatchObject({
      call_id: 'call-1',
      kind: 'offer',
      sdp: 'offer-sdp',
      sdp_type: 'offer',
      type: 'webrtc_signal',
    })

    const callPromise = transport.call<{ ok: boolean }>('runtime.status')
    const encryptedRequest = socket.sent.at(-1) as { payload: string }
    const request = decodeJson(channel.decrypt(encryptedRequest.payload) ?? new Uint8Array()) as {
      id: string
    }

    socket.receive({
      payload: channel.encrypt(
        encodeJson(createWebRtcSignalFrame('answer', 'call-1', { sdp: 'answer-sdp' }))
      ),
      type: 'data',
    })
    expect(webRtcFrames).toEqual([
      expect.objectContaining({ call_id: 'call-1', kind: 'answer', sdp: 'answer-sdp' }),
    ])
    expect(voiceFrames).toEqual([])

    socket.receive({
      payload: channel.encrypt(encodeJson({ id: request.id, result: { ok: true } })),
      type: 'data',
    })
    await expect(callPromise).resolves.toEqual({ ok: true })
  })

  test('measures voice_stream latency from daemon echo acknowledgements', async () => {
    const { channel, socket, transport } = await setupReadyRelay()

    let sentCursor = socket.sent.length
    const measurePromise = transport.measureVoiceStreamLatency({
      count: 3,
      intervalMs: 10,
      timeoutMs: 1_000,
    })

    for (let acked = 0; acked < 3; ) {
      let outbound:
        | {
            sent_at_ms?: number
            seq: number
            stream_id: string
          }
        | undefined
      for (const frame of socket.sent.slice(sentCursor)) {
        const candidate = frame as { payload?: string; type?: string }
        if (candidate.type !== 'data' || !candidate.payload) continue
        const decrypted = channel.decrypt(candidate.payload)
        if (!decrypted) continue
        const decoded = decodeJson(decrypted) as {
          op?: string
          sent_at_ms?: number
          seq: number
          stream_id: string
        }
        if (decoded.op === 'chunk') {
          outbound = decoded
          break
        }
      }
      sentCursor = socket.sent.length
      if (!outbound) {
        await vi.advanceTimersByTimeAsync(10)
        continue
      }
      acked += 1
      await vi.advanceTimersByTimeAsync(acked * 5)
      socket.receive({
        payload: channel.encrypt(
          encodeJson(
            createVoiceStreamFrame('ack', outbound.stream_id, outbound.seq, {
              sent_at_ms: outbound.sent_at_ms,
            })
          )
        ),
        type: 'data',
      })
    }

    await expect(measurePromise).resolves.toMatchObject({
      count: 3,
      lost: 0,
      max_ms: 20,
      p95_ms: 20,
      received: 3,
    })
  })

  test('requests voice_stream synthesis and reassembles audio chunks by seq before resolving', async () => {
    const { channel, socket, transport } = await setupReadyRelay()

    const audioPromise = transport.requestVoiceStreamSynthesis('你好这是流式测试', {
      voice: 'zh-CN-YunxiNeural',
    })
    const openFrame = socket.sent.at(-1) as { payload: string; type: string }
    const open = decodeJson(channel.decrypt(openFrame.payload) ?? new Uint8Array()) as {
      seq: number
      stream_id: string
      text: string
      type: string
      voice?: string
    }
    expect(open).toMatchObject({
      seq: 0,
      text: '你好这是流式测试',
      type: 'voice_stream',
      voice: 'zh-CN-YunxiNeural',
    })

    socket.receive({
      payload: channel.encrypt(
        encodeJson(
          createVoiceStreamFrame('chunk', open.stream_id, 2, {
            done: true,
            format: 'm4a',
            mime: 'audio/mp4',
            payload: 'bbbb',
          })
        )
      ),
      type: 'data',
    })
    socket.receive({
      payload: channel.encrypt(
        encodeJson(
          createVoiceStreamFrame('chunk', open.stream_id, 1, {
            done: false,
            payload: 'aaaa',
          })
        )
      ),
      type: 'data',
    })

    await expect(audioPromise).resolves.toEqual({
      audio: 'aaaabbbb',
      format: 'm4a',
      mime: 'audio/mp4',
      stream_id: open.stream_id,
    })
  })

  test('rejects JSON-RPC calls when encrypted response carries an error', async () => {
    const { channel, socket, transport } = await setupReadyRelay()

    const callPromise = transport.call('worker.stop', { worker_id: 'w1' })
    const encryptedRequest = socket.sent.at(-1) as { payload: string }
    const request = decodeJson(channel.decrypt(encryptedRequest.payload) ?? new Uint8Array()) as {
      id: string
    }
    socket.receive({
      payload: channel.encrypt(
        encodeJson({
          error: { code: 'missing_mobile_capability', message: 'denied' },
          id: request.id,
        })
      ),
      type: 'data',
    })

    await expect(callPromise).rejects.toThrow('denied')
  })

  // P0 复现 + dispatch 8855a45c 修复2a：4G 下单条 RPC 可能超时（对端慢/半死），call() 必须超时 reject
  // 防永久挂起；但**只 reject，绝不关 socket**——旧实现一超时就 close(4000) 在 4G 高频超时下会触发
  // churn 环（见 connectInternal）。socket 是否真死改由心跳探活裁决（见下方 liveness 测试）。
  // 退回"超时即关 socket"必红（status 会变 disconnected / socket 会关）。
  test('times out an RPC but does NOT close the socket (Fix2a: reject-only, no churn)', async () => {
    const { socket, transport } = await setupReadyRelay()
    expect(transport.status()).toBe('ready')
    expect(socket.readyState).toBe(1)

    const callPromise = transport.call('runtime.status')
    callPromise.catch(() => {}) // 防 unhandled rejection（断言前）

    // 不发任何响应，推进超过 RPC 超时窗口（默认 22s）。
    await vi.advanceTimersByTimeAsync(23_000)

    await expect(callPromise).rejects.toThrow(/timed out/i)
    // 关键：超时只 reject，socket 不被关、连接保持 ready（不再自残触发 churn）。
    expect(transport.status()).toBe('ready')
    expect(socket.readyState).toBe(1)
  })

  test('a resolved RPC clears its timeout and the socket is never closed by a late timer', async () => {
    const { channel, socket, transport } = await setupReadyRelay()
    const callPromise = transport.call<{ version: string }>('runtime.status')
    const encryptedRequest = socket.sent.at(-1) as { payload: string }
    const request = decodeJson(channel.decrypt(encryptedRequest.payload) ?? new Uint8Array()) as {
      id: string
    }
    socket.receive({
      payload: channel.encrypt(encodeJson({ id: request.id, result: { version: '2.0.0' } })),
      type: 'data',
    })
    await expect(callPromise).resolves.toEqual({ version: '2.0.0' })

    // resolve 后远超超时窗口推进：timer 已清，socket 不应被误关、连接仍 ready。
    await vi.advanceTimersByTimeAsync(23_000)
    expect(transport.status()).toBe('ready')
    expect(socket.readyState).toBe(1)
  })

  // BugH1：onerror 路径必须立即 reject + 清空 pending。某些 RN/Hermes 下 onerror 不再跟 onclose，
  // 若只在 onclose 清 pending，在途 RPC 会泄漏到各自 22s 超时才 reject。此处不推进任何定时器，断言
  // onerror 后 RPC 立即 reject（退回「onerror 不清 pending」此处会一直 pending → 测试超时红）。
  test('onerror immediately rejects in-flight RPCs without waiting for the 22s timeout (BugH1)', async () => {
    const { socket, transport } = await setupReadyRelay()
    const callPromise = transport.call('runtime.status')
    callPromise.catch(() => {}) // 防 unhandled rejection（断言前）

    // 模拟服务端拒连 / RST：触发 onerror，且**不**触发 onclose、**不**推进 RPC 超时定时器。
    socket.onerror?.(new Error('connection reset'))

    await expect(callPromise).rejects.toThrow(/socket error/i)
  })

  test('sends heartbeat frames every 20 seconds while ready', async () => {
    const { socket } = await setupReadyRelay()

    await vi.advanceTimersByTimeAsync(20_000)

    expect(socket.sent.at(-1)).toMatchObject({ room: 'room-1', type: 'heartbeat' })
  })

  test('notifies status changes during connect and handshake', async () => {
    const config = buildConfig()
    const transport = createRelayTransport(config, { WebSocketCtor: FakeRelaySocket })
    const statuses: string[] = []
    transport.onStatusChange((status) => statuses.push(status))

    const connectPromise = transport.connect()
    await vi.advanceTimersByTimeAsync(0)
    latestSocket().receive({ type: 'joined' })

    expect(statuses).toContain('connecting')
    expect(statuses).toContain('handshaking')
    connectPromise.catch(() => {})
  })

  test('stays disconnected after socket closes and does not self-reconnect (context is the sole reconnect engine)', async () => {
    const { socket, transport } = await setupReadyRelay()
    expect(FakeRelaySocket.instances).toHaveLength(1)

    socket.close(1006, 'network')
    await vi.advanceTimersByTimeAsync(50)

    // transport 是被动连接器：断了停在 disconnected，绝不自开第二条 socket（churn 根因之一已除）。
    expect(transport.status()).toBe('disconnected')
    expect(FakeRelaySocket.instances).toHaveLength(1)
  })

  test('external connect() after a close drives reconnection (no overlapping sockets)', async () => {
    const { socket, transport } = await setupReadyRelay()
    expect(FakeRelaySocket.instances).toHaveLength(1)

    socket.close(1006, 'network')
    await vi.advanceTimersByTimeAsync(50)
    expect(FakeRelaySocket.instances).toHaveLength(1)

    // 旧 socket 已关（socket=null），connect() 同步开新连。
    void transport.connect()
    await vi.advanceTimersByTimeAsync(0)
    expect(FakeRelaySocket.instances).toHaveLength(2)
    expect(transport.status()).toBe('connecting')

    // 新 socket 握手推进正常。
    latestSocket().receive({ type: 'joined' })
    expect(transport.status()).toBe('handshaking')
  })

  test('reuses one in-flight connect for concurrent callers', async () => {
    const config = buildConfig()
    const transport = createRelayTransport(config, {
      WebSocketCtor: FakeRelaySocket,
      reconnectBaseMs: 10,
    })

    const first = transport.connect()
    const second = transport.connect()
    const third = transport.connect()

    expect(FakeRelaySocket.instances).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(0)
    const socket = latestSocket()
    socket.receive({ type: 'joined' })
    const helloFrame = socket.sent.at(-1) as { payload: string; type: string }
    const hello = decodeJson(decodeBase64(helloFrame.payload)) as {
      handshake: { ephemeral_public_key: string }
    }
    const responder = createHandshakeResponder(generateKeyPair())
    responder.processInit(hello.handshake)
    socket.receive({
      payload: encodeBase64(encodeJson({ type: 'e2ee_ready', handshake: responder.getResponse() })),
      type: 'data',
    })

    await expect(Promise.all([first, second, third])).resolves.toEqual([
      undefined,
      undefined,
      undefined,
    ])
  })

  test('does not open a new socket when connect is called after ready', async () => {
    const { transport } = await setupReadyRelay()
    expect(FakeRelaySocket.instances).toHaveLength(1)

    await transport.connect()

    expect(FakeRelaySocket.instances).toHaveLength(1)
  })

  test('routes a no-id event frame to onEvent without touching pending RPCs (M27 Part B)', async () => {
    const { channel, socket, transport } = await setupReadyRelay()
    const events: Array<{ kind: string; payload?: unknown }> = []
    transport.onEvent((event) => events.push(event))

    // 同时挂一个 RPC，证明事件帧不会误 resolve 它。
    const callPromise = transport.call<{ version: string }>('runtime.status')
    let callResolved = false
    void callPromise.then(() => {
      callResolved = true
    })

    // 服务器主动推送：加密的 type:'event' 帧，无 id。
    socket.receive({
      payload: channel.encrypt(
        encodeJson({ kind: 'chat_message', payload: { message: { id: 'm1' } }, type: 'event' })
      ),
      type: 'data',
    })

    expect(events).toEqual([{ kind: 'chat_message', payload: { message: { id: 'm1' } } }])
    // 事件帧没有 id，绝不能解掉在途 RPC。
    await Promise.resolve()
    expect(callResolved).toBe(false)

    // 之后真正的 RPC 回应仍正常 resolve（事件路由没破坏请求-回应）。
    const encryptedRequest = socket.sent.at(-1) as { payload: string }
    const request = decodeJson(channel.decrypt(encryptedRequest.payload) ?? new Uint8Array()) as {
      id: string
    }
    socket.receive({
      payload: channel.encrypt(encodeJson({ id: request.id, result: { version: '2.0.0' } })),
      type: 'data',
    })
    await expect(callPromise).resolves.toEqual({ version: '2.0.0' })
  })

  test('onEvent unsubscribe stops further event delivery', async () => {
    const { channel, socket, transport } = await setupReadyRelay()
    const events: unknown[] = []
    const unsubscribe = transport.onEvent((event) => events.push(event))
    unsubscribe()

    socket.receive({
      payload: channel.encrypt(
        encodeJson({ kind: 'dashboard_update', payload: {}, type: 'event' })
      ),
      type: 'data',
    })

    expect(events).toEqual([])
  })

  test('repeated close notifications never self-open a new socket', async () => {
    const { socket, transport } = await setupReadyRelay()
    expect(FakeRelaySocket.instances).toHaveLength(1)

    socket.close(1006, 'network')
    socket.close(1006, 'network')
    await vi.advanceTimersByTimeAsync(50)

    // 删掉 transport 自带重连后，无论收到多少 close 通知都不会自开 socket。
    expect(FakeRelaySocket.instances).toHaveLength(1)
    expect(transport.status()).toBe('disconnected')
  })
})

// 「延迟 close」fake socket：close() 只把 socket 推进 CLOSING(2)、**不同步触发 onclose**（真实 RN
// WebSocket 在 4G 上的行为——close 帧在途，onclose 之后才到）；onclose 由测试用 driveClose 显式驱动。
class DeferredCloseRelaySocket {
  static instances: DeferredCloseRelaySocket[] = []

  onclose: ((event: unknown) => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onopen: (() => void) | null = null
  readyState = 0
  sent: unknown[] = []
  private pendingClose: { code: number; reason: string } | null = null

  constructor(readonly url: string) {
    DeferredCloseRelaySocket.instances.push(this)
    setTimeout(() => {
      this.readyState = 1
      this.onopen?.()
    }, 0)
  }

  send(data: string) {
    this.sent.push(JSON.parse(data) as unknown)
  }

  close(code = 1000, reason = 'closed') {
    if (this.readyState === 3) return
    this.readyState = 2 // CLOSING：close 帧在途，onclose 尚未触发
    this.pendingClose = { code, reason }
  }

  driveClose(code?: number, reason?: string) {
    const detail = {
      code: code ?? this.pendingClose?.code ?? 1000,
      reason: reason ?? this.pendingClose?.reason ?? 'closed',
    }
    this.readyState = 3
    this.onclose?.(detail)
  }

  receive(value: unknown) {
    this.onmessage?.({ data: JSON.stringify(value) })
  }
}

// 通用握手驱动：joined → e2ee_hello → e2ee_ready（同 daemon 的 base64(JSON) 约定）。FakeRelaySocket
// 与 DeferredCloseRelaySocket 都有 .receive/.sent，可共用。
const driveHandshakeToReady = (socket: { receive(v: unknown): void; sent: unknown[] }) => {
  socket.receive({ type: 'joined' })
  const helloFrame = socket.sent.at(-1) as { payload: string }
  const hello = decodeJson(decodeBase64(helloFrame.payload)) as {
    handshake: { ephemeral_public_key: string }
  }
  const responder = createHandshakeResponder(generateKeyPair())
  responder.processInit(hello.handshake)
  socket.receive({
    payload: encodeBase64(encodeJson({ type: 'e2ee_ready', handshake: responder.getResponse() })),
    type: 'data',
  })
  return responder.getChannel()
}

describe('relay transport device-side liveness + 4G churn (dispatch 8855a45c)', () => {
  // Fix2a 探活：对端不再回任何帧（半开 socket）→ 心跳 tick 时「自上次入站」超阈值即判死、关连接。
  // 这是替代「per-RPC 超时关 socket」的原则性判死信号（对称 daemon ①）。无探活则半开 socket 永久僵尸。
  test('liveness: a half-open socket with no inbound frames is closed → disconnected (Fix2a)', async () => {
    FakeRelaySocket.instances = []
    const transport = createRelayTransport(buildConfig(), {
      WebSocketCtor: FakeRelaySocket,
      heartbeatIntervalMs: 1000,
      livenessTimeoutMs: 2500,
    })
    const connectPromise = transport.connect()
    await vi.advanceTimersByTimeAsync(0)
    driveHandshakeToReady(latestSocket())
    await connectPromise
    expect(transport.status()).toBe('ready')
    expect(FakeRelaySocket.instances).toHaveLength(1)

    // 对端此后不回任何帧 → 心跳 tick 在 1000/2000/3000；t=3000 时 3000>2500 判死关闭。
    await vi.advanceTimersByTimeAsync(3000)
    expect(transport.status()).toBe('disconnected') // 被探活判死
    expect(FakeRelaySocket.instances).toHaveLength(1) // transport 被动：自身不重连
  })

  // Fix2a 反面：只要持续收到入站帧（heartbeat_ack）就刷新 lastInboundAt → 慢但活的 4G 连接不被误杀。
  test('liveness: keeps the socket alive while inbound heartbeat_ack frames keep arriving (Fix2a)', async () => {
    FakeRelaySocket.instances = []
    const transport = createRelayTransport(buildConfig(), {
      WebSocketCtor: FakeRelaySocket,
      heartbeatIntervalMs: 1000,
      livenessTimeoutMs: 2500,
    })
    const connectPromise = transport.connect()
    await vi.advanceTimersByTimeAsync(0)
    const socket = latestSocket()
    driveHandshakeToReady(socket)
    await connectPromise

    // 每 1000ms 回一帧 heartbeat_ack（< 2500ms 阈值）→ lastInboundAt 持续刷新 → 不判死。
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(1000)
      socket.receive({ type: 'heartbeat_ack' })
    }
    expect(transport.status()).toBe('ready')
    expect(socket.readyState).toBe(1)
  })

  // Fix1（断 churn 环·核心）：被探活关闭的旧 socket 在 4G 上滞留 CLOSING（close 帧在途），重连开新
  // socket B；中继 newest-wins 的延迟 1008 'replaced' 此时才到旧 socket。旧 socket 业务 handler 必须
  // 已被无条件 detach（connectInternal 守卫覆盖 CLOSING(2)），否则其 onclose 会 setStatus('disconnected')
  // + 清空 B 的 pending → 把活着的 B 打下线 → 自激 churn。退回旧守卫（只认 0/1）此测试必红。
  test("Fix1: a dead CLOSING socket's delayed 1008 'replaced' must NOT knock the current ready socket offline", async () => {
    DeferredCloseRelaySocket.instances = []
    const transport = createRelayTransport(buildConfig(), {
      WebSocketCtor: DeferredCloseRelaySocket as unknown as new (url: string) => never,
      heartbeatIntervalMs: 1000,
      livenessTimeoutMs: 2500,
    })

    // 1) socket A 建连到 ready。
    const connectPromise = transport.connect()
    await vi.advanceTimersByTimeAsync(0)
    const socketA = DeferredCloseRelaySocket.instances[0]
    driveHandshakeToReady(socketA)
    await connectPromise
    expect(transport.status()).toBe('ready')

    // 2) A 半死：对端不再回帧 → 探活判死 close(4001)；DeferredClose 的 close 只进 CLOSING、onclose 不触发。
    await vi.advanceTimersByTimeAsync(3000)
    expect(socketA.readyState).toBe(2) // CLOSING：close 帧在 4G 在途
    expect(transport.status()).toBe('ready') // onclose 没跑，status 仍 ready

    // 3) 上层重连 connect()：守卫遇 CLOSING(2)，Fix1 无条件 detach A → 开 socket B。
    void transport.connect()
    await vi.advanceTimersByTimeAsync(0)
    expect(DeferredCloseRelaySocket.instances.length).toBe(2)
    const socketB = DeferredCloseRelaySocket.instances[1]
    driveHandshakeToReady(socketB)
    expect(transport.status()).toBe('ready')

    // 4) 中继 newest-wins 的延迟 1008 'replaced' 现在才到达已死的 A。
    socketA.driveClose(1008, 'replaced')

    // Fix1：A 已被 detach，延迟 close 不进活连接状态机 → B 仍 ready（churn 环已断）。
    expect(transport.status()).toBe('ready')
  })

  // BugB（HIGH ghost socket）：connectInternal 对 OPEN/CONNECTING 旧 socket 走
  // closePreviousSocket(prev).then(openNewSocket)；grace 等待期间外部 close() 必须取消这条链，
  // 否则 grace resolve 后照样新建 socket → 连上 relay → 双连接被 evict → 重连风暴 + ghost heartbeat 泄漏。
  // 用「延迟 close」fake 让 grace 走真实 500ms 定时器窗口，期间 close()，断言之后不再新建 socket。
  // 退回「无 aborted 守卫」此测试必红（grace 后冒出第 2 条 ghost socket）。
  test('BugB: close() during the closePreviousSocket grace wait cancels the pending reconnect (no ghost socket)', async () => {
    DeferredCloseRelaySocket.instances = []
    const transport = createRelayTransport(buildConfig(), {
      WebSocketCtor: DeferredCloseRelaySocket as unknown as new (url: string) => never,
    })

    // 1) 首连 → socket A（CONNECTING，readyState 0；onopen 定时器尚未推进）。
    transport.connect().catch(() => {})
    const socketA = DeferredCloseRelaySocket.instances[0]
    expect(socketA.readyState).toBe(0)

    // 2) A 出错 → failConnect → state 'error'，但 socket 仍指向 A（未置 null）。
    socketA.onerror?.({})
    // 冲刷 connect#1 的 .finally(connectPromise=null) 微任务，否则下面的 connect#2 会复用在途 promise 短路、
    // 根本进不了换 socket 的 grace 路径（这条 flush 缺了，本测试就测不到 ghost-socket 真实路径）。
    await vi.advanceTimersByTimeAsync(0)
    expect(transport.status()).toBe('error')

    // 3) 再次 connect → connectInternal 见 OPEN/CONNECTING 旧 socket A → 走 closePreviousSocket(A).then(openNewSocket)
    //    grace 路径（A.close 进 CLOSING、onclose 延迟，靠 500ms grace 定时器放行 .then）。此刻还没开新 socket。
    transport.connect().catch(() => {})
    expect(DeferredCloseRelaySocket.instances.length).toBe(1)

    // 4) grace 等待期间 close()：取消那条 .then(openNewSocket) 链 + settle 在途 connect。
    transport.close()
    expect(transport.status()).toBe('disconnected')

    // 5) 推进过 grace 窗口（含 A 的 onopen 定时器 + 500ms grace）：openNewSocket 被取消跳过，绝不建 ghost socket。
    await vi.advanceTimersByTimeAsync(1000)
    expect(DeferredCloseRelaySocket.instances.length).toBe(1) // 仍只有 A，无 ghost B
    expect(transport.status()).toBe('disconnected')

    // 6) 再推进：确认无 ghost heartbeat / 重连风暴（不会再冒出新 socket）。
    await vi.advanceTimersByTimeAsync(60_000)
    expect(DeferredCloseRelaySocket.instances.length).toBe(1)
  })
})

describe('runtime client relay fallback', () => {
  test('uses LAN first and falls back to relay JSON-RPC after LAN timeout/failure', async () => {
    const relay = {
      call: vi.fn().mockResolvedValue({ version: 'relay-version' }),
      close: vi.fn(),
      connect: vi.fn().mockResolvedValue(undefined),
      measureVoiceStreamLatency: vi.fn(),
      onEvent: vi.fn(() => () => {}),
      onStatusChange: vi.fn(() => () => {}),
      onVoiceCallStateFrame: vi.fn(() => () => {}),
      onVoiceDownlinkSegmentFrame: vi.fn(() => () => {}),
      onWebRtcSignalFrame: vi.fn(() => () => {}),
      onVoiceStreamFrame: vi.fn(() => () => {}),
      requestVoiceStreamSynthesis: vi.fn(),
      sendWebRtcSignalFrame: vi.fn(),
      sendVoiceStreamFrame: vi.fn(),
      status: vi.fn(() => 'ready' as const),
    }
    const client = createRuntimeClient({
      fetchImpl: vi.fn().mockRejectedValue(new Error('network down')),
      host: '10.0.0.2:4010',
      relayTransport: relay,
      token: 'mobile-token',
    })

    await expect(client.getMobileRuntimeStatus()).resolves.toEqual({ version: 'relay-version' })
    expect(client.connectionMode()).toBe('relay')
    expect(relay.call).toHaveBeenCalledWith('runtime.status')
  })
})
