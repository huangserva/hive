import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'

import { createRelayServer, type RelayServerHandle } from '../../packages/relay/src/relay-server.js'
import {
  createHandshakeInitiator,
  decodeBase64,
  decodeJson,
  type EncryptedChannel,
  encodeBase64,
  encodeJson,
  generateKeyPair,
} from '../../packages/relay-crypto/src/index.js'
import {
  createRelayConnector,
  type RelayConfig,
  type RelayConnectorHandle,
  type RelayConnectorOptions,
} from '../../src/server/relay-connector.js'

const relayServers: RelayServerHandle[] = []
const connectors: RelayConnectorHandle[] = []
const sockets: WebSocket[] = []

const startRelay = async () => {
  const relay = createRelayServer({
    authToken: 'relay-secret',
    cleanupIntervalMs: 500,
    heartbeatIntervalMs: 1_000,
    host: '127.0.0.1',
    port: 0,
    roomIdleTimeoutMs: 30_000,
  })
  relayServers.push(relay)
  await relay.ready
  return relay
}

const connectDevice = async (relay: RelayServerHandle) => {
  const socket = new WebSocket(`ws://127.0.0.1:${relay.port}`)
  sockets.push(socket)
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve)
    socket.once('error', reject)
  })
  socket.send(
    JSON.stringify({
      auth_token: 'relay-secret',
      role: 'device',
      room: 'room-1',
      type: 'join',
    })
  )
  await expect(nextRelayFrame(socket)).resolves.toMatchObject({ type: 'joined' })
  return socket
}

const nextRelayFrame = async <T>(socket: WebSocket): Promise<T> =>
  await new Promise<T>((resolve) => {
    socket.once('message', (data) => {
      resolve(JSON.parse(data.toString()) as T)
    })
  })

const dataPayload = async (socket: WebSocket): Promise<string> => {
  for (;;) {
    const frame = await nextRelayFrame<{ payload?: string; type: string }>(socket)
    if (frame.type === 'data' && typeof frame.payload === 'string') return frame.payload
  }
}

const waitFor = async (predicate: () => boolean, timeoutMs = 1_000) => {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('Timed out waiting for condition')
}

const configFor = (relay: RelayServerHandle): RelayConfig => ({
  daemon_keypair: generateKeyPair(),
  enabled: true,
  relay_auth_token: 'relay-secret',
  relay_url: `ws://127.0.0.1:${relay.port}`,
  room_id: 'room-1',
  runtime_id: 'runtime-1',
})

const createConnector = (config: RelayConfig) => {
  const calls: Array<{
    capabilities: string[]
    deviceId: string
    method: string
    params: unknown
  }> = []
  const connector = createRelayConnector(
    config,
    async (method, params, deviceId, capabilities) => {
      calls.push({ capabilities, deviceId, method, params })
      return { ok: true, method, params }
    },
    {
      authenticateDevice: (token) => {
        if (token !== 'device-token') throw new Error('bad token')
        return {
          capabilities: ['read_dashboard', 'send_prompt'],
          id: 'device-1',
        }
      },
      heartbeatIntervalMs: 25,
      reconnectBaseDelayMs: 20,
      reconnectMaxDelayMs: 50,
    }
  )
  connectors.push(connector)
  return { calls, connector }
}

const createConnectorWithVoiceStreamHandler = (
  config: RelayConfig,
  handler: NonNullable<RelayConnectorOptions['voiceStreamHandler']>
) => {
  const calls: Array<{ method: string }> = []
  const connector = createRelayConnector(
    config,
    async (method) => {
      calls.push({ method })
      return { ok: true, method }
    },
    {
      authenticateDevice: (token) => {
        if (token !== 'device-token') throw new Error('bad token')
        return {
          capabilities: ['read_dashboard', 'send_prompt'],
          id: 'device-1',
        }
      },
      heartbeatIntervalMs: 25,
      reconnectBaseDelayMs: 20,
      reconnectMaxDelayMs: 50,
      voiceStreamHandler: handler,
    }
  )
  connectors.push(connector)
  return { calls, connector }
}

const createConnectorWithWebRtcSignalHandler = (
  config: RelayConfig,
  handler: NonNullable<RelayConnectorOptions['webrtcSignalHandler']>
) => {
  const calls: Array<{ method: string }> = []
  const connector = createRelayConnector(
    config,
    async (method) => {
      calls.push({ method })
      return { ok: true, method }
    },
    {
      authenticateDevice: (token) => {
        if (token !== 'device-token') throw new Error('bad token')
        return {
          capabilities: ['read_dashboard', 'send_prompt'],
          id: 'device-1',
        }
      },
      heartbeatIntervalMs: 25,
      reconnectBaseDelayMs: 20,
      reconnectMaxDelayMs: 50,
      webrtcSignalHandler: handler,
    }
  )
  connectors.push(connector)
  return { calls, connector }
}

const completeHandshake = async (socket: WebSocket): Promise<EncryptedChannel> => {
  const initiator = createHandshakeInitiator(generateKeyPair())
  socket.send(
    JSON.stringify({
      payload: encodeBase64(
        encodeJson({
          capabilities: ['read_dashboard'],
          device_id: 'device-1',
          handshake: initiator.getInitMessage(),
          token: 'device-token',
          type: 'e2ee_hello',
        })
      ),
      type: 'data',
    })
  )
  const ready = decodeJson(decodeBase64(await dataPayload(socket))) as {
    handshake: { ephemeral_public_key: string }
    type: string
  }
  expect(ready.type).toBe('e2ee_ready')
  return initiator.processResponse(ready.handshake)
}

const completeHandshakeWithCapabilities = async (
  socket: WebSocket,
  capabilities: string[]
): Promise<EncryptedChannel> => {
  const initiator = createHandshakeInitiator(generateKeyPair())
  socket.send(
    JSON.stringify({
      payload: encodeBase64(
        encodeJson({
          capabilities,
          device_id: 'device-1',
          handshake: initiator.getInitMessage(),
          token: 'device-token',
          type: 'e2ee_hello',
        })
      ),
      type: 'data',
    })
  )
  const ready = decodeJson(decodeBase64(await dataPayload(socket))) as {
    handshake: { ephemeral_public_key: string }
    type: string
  }
  expect(ready.type).toBe('e2ee_ready')
  return initiator.processResponse(ready.handshake)
}

afterEach(async () => {
  for (const connector of connectors.splice(0)) connector.close()
  for (const socket of sockets.splice(0)) {
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      socket.close()
    }
  }
  await Promise.all(relayServers.splice(0).map((relay) => relay.close()))
})

describe('relay connector', () => {
  it('connects to relay as daemon and reports connected status', async () => {
    const relay = await startRelay()
    const { connector } = createConnector(configFor(relay))

    await waitFor(() => connector.status().mode === 'connected')

    expect(connector.status()).toMatchObject({
      last_error: null,
      mode: 'connected',
      relay_url: `ws://127.0.0.1:${relay.port}`,
      room_id: 'room-1',
    })
    expect(connector.status().connected_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('sends heartbeat frames and records heartbeat acknowledgements', async () => {
    const relay = await startRelay()
    const { connector } = createConnector(configFor(relay))

    await waitFor(() => connector.status().last_heartbeat_at !== null, 1_500)

    expect(connector.status().last_heartbeat_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('performs E2E handshake and dispatches encrypted JSON-RPC to handler', async () => {
    const relay = await startRelay()
    const { calls, connector } = createConnector(configFor(relay))
    await waitFor(() => connector.status().mode === 'connected')
    const device = await connectDevice(relay)
    const channel = await completeHandshakeWithCapabilities(device, [
      'read_dashboard',
      'send_prompt',
    ])

    device.send(
      JSON.stringify({
        payload: channel.encrypt(
          encodeJson({
            id: 'rpc-1',
            jsonrpc: '2.0',
            method: 'runtime.status',
            params: { verbose: true },
          })
        ),
        type: 'data',
      })
    )

    const response = decodeJson(channel.decrypt(await dataPayload(device)) ?? new Uint8Array()) as {
      id: string
      result: unknown
    }
    expect(response).toMatchObject({
      id: 'rpc-1',
      result: { ok: true, method: 'runtime.status', params: { verbose: true } },
    })
    expect(calls).toEqual([
      {
        capabilities: ['read_dashboard', 'send_prompt'],
        deviceId: 'device-1',
        method: 'runtime.status',
        params: { verbose: true },
      },
    ])
  })

  it('dedupes retried workspace.prompt JSON-RPC requests by request id', async () => {
    const relay = await startRelay()
    const { calls, connector } = createConnector(configFor(relay))
    await waitFor(() => connector.status().mode === 'connected')
    const device = await connectDevice(relay)
    const channel = await completeHandshakeWithCapabilities(device, [
      'read_dashboard',
      'send_prompt',
    ])
    const request = {
      id: 'prompt-rpc-1',
      jsonrpc: '2.0',
      method: 'workspace.prompt',
      params: { text: 'same mobile prompt', workspace_id: 'workspace-1' },
    }

    device.send(JSON.stringify({ payload: channel.encrypt(encodeJson(request)), type: 'data' }))
    const firstResponse = decodeJson(
      channel.decrypt(await dataPayload(device)) ?? new Uint8Array()
    ) as { id: string; result: unknown }
    device.send(JSON.stringify({ payload: channel.encrypt(encodeJson(request)), type: 'data' }))
    const secondResponse = decodeJson(
      channel.decrypt(await dataPayload(device)) ?? new Uint8Array()
    ) as { id: string; result: unknown }

    expect(firstResponse).toEqual(secondResponse)
    expect(calls).toEqual([
      {
        capabilities: ['read_dashboard', 'send_prompt'],
        deviceId: 'device-1',
        method: 'workspace.prompt',
        params: { text: 'same mobile prompt', workspace_id: 'workspace-1' },
      },
    ])
  })

  it('echoes encrypted voice_stream frames without dispatching them as JSON-RPC', async () => {
    const relay = await startRelay()
    const { calls, connector } = createConnector(configFor(relay))
    await waitFor(() => connector.status().mode === 'connected')
    const device = await connectDevice(relay)
    const channel = await completeHandshakeWithCapabilities(device, [
      'read_dashboard',
      'send_prompt',
    ])

    device.send(
      JSON.stringify({
        payload: channel.encrypt(
          encodeJson({
            op: 'chunk',
            payload: 'ping',
            sent_at_ms: 1_234,
            seq: 1,
            stream_id: 'voice-1',
            type: 'voice_stream',
          })
        ),
        type: 'data',
      })
    )

    const voiceResponse = decodeJson(channel.decrypt(await dataPayload(device)) ?? new Uint8Array())
    expect(voiceResponse).toMatchObject({
      op: 'ack',
      sent_at_ms: 1_234,
      seq: 1,
      stream_id: 'voice-1',
      type: 'voice_stream',
    })
    expect(calls).toEqual([])

    device.send(
      JSON.stringify({
        payload: channel.encrypt(
          encodeJson({
            id: 'rpc-after-voice',
            jsonrpc: '2.0',
            method: 'runtime.status',
            params: { after: 'voice_stream' },
          })
        ),
        type: 'data',
      })
    )
    const rpcResponse = decodeJson(channel.decrypt(await dataPayload(device)) ?? new Uint8Array())
    expect(rpcResponse).toMatchObject({
      id: 'rpc-after-voice',
      result: { ok: true, method: 'runtime.status', params: { after: 'voice_stream' } },
    })
    expect(calls).toEqual([
      {
        capabilities: ['read_dashboard', 'send_prompt'],
        deviceId: 'device-1',
        method: 'runtime.status',
        params: { after: 'voice_stream' },
      },
    ])
  })

  it('pushes synthesized audio chunks over voice_stream without dispatching JSON-RPC', async () => {
    const relay = await startRelay()
    const { calls, connector } = createConnectorWithVoiceStreamHandler(
      configFor(relay),
      async (frame, context) => {
        if (frame.op !== 'open' || typeof frame.text !== 'string') return false
        context.send({
          done: false,
          format: 'm4a',
          mime: 'audio/mp4',
          op: 'chunk',
          payload: 'aaaa',
          seq: 1,
          stream_id: frame.stream_id ?? '',
          type: 'voice_stream',
        })
        context.send({
          done: true,
          format: 'm4a',
          mime: 'audio/mp4',
          op: 'chunk',
          payload: 'bbbb',
          seq: 2,
          stream_id: frame.stream_id ?? '',
          type: 'voice_stream',
        })
        return true
      }
    )
    await waitFor(() => connector.status().mode === 'connected')
    const device = await connectDevice(relay)
    const channel = await completeHandshakeWithCapabilities(device, [
      'read_dashboard',
      'send_prompt',
    ])

    const encryptedPayloads: string[] = []
    const collectData = (data: WebSocket.RawData) => {
      const frame = JSON.parse(data.toString()) as { payload?: string; type?: string }
      if (frame.type === 'data' && typeof frame.payload === 'string') {
        encryptedPayloads.push(frame.payload)
      }
    }
    device.on('message', collectData)
    device.send(
      JSON.stringify({
        payload: channel.encrypt(
          encodeJson({
            op: 'open',
            seq: 0,
            stream_id: 'voice-audio',
            text: '你好这是流式测试',
            type: 'voice_stream',
          })
        ),
        type: 'data',
      })
    )

    await waitFor(() => encryptedPayloads.length >= 2)
    device.off('message', collectData)
    const firstChunk = decodeJson(channel.decrypt(encryptedPayloads[0] ?? '') ?? new Uint8Array())
    const secondChunk = decodeJson(channel.decrypt(encryptedPayloads[1] ?? '') ?? new Uint8Array())
    expect(firstChunk).toMatchObject({
      done: false,
      op: 'chunk',
      payload: 'aaaa',
      seq: 1,
      stream_id: 'voice-audio',
      type: 'voice_stream',
    })
    expect(secondChunk).toMatchObject({
      done: true,
      op: 'chunk',
      payload: 'bbbb',
      seq: 2,
      stream_id: 'voice-audio',
      type: 'voice_stream',
    })
    expect(calls).toEqual([])
  })

  it('rejects read-only webrtc_signal frames before invoking the handler', async () => {
    const relay = await startRelay()
    const seen: unknown[] = []
    const { calls, connector } = createConnectorWithWebRtcSignalHandler(
      configFor(relay),
      (frame, context) => {
        seen.push({ capabilities: context.capabilities, deviceId: context.deviceId, frame })
        context.send({
          call_id: frame.call_id,
          kind: 'answer',
          sdp: 'answer-sdp',
          sdp_type: 'answer',
          type: 'webrtc_signal',
        })
        return true
      }
    )
    await waitFor(() => connector.status().mode === 'connected')
    const device = await connectDevice(relay)
    const channel = await completeHandshakeWithCapabilities(device, ['read_dashboard'])

    device.send(
      JSON.stringify({
        payload: channel.encrypt(
          encodeJson({
            call_id: 'call-readonly',
            kind: 'offer',
            sdp: 'offer-sdp',
            sdp_type: 'offer',
            type: 'webrtc_signal',
          })
        ),
        type: 'data',
      })
    )

    const response = decodeJson(channel.decrypt(await dataPayload(device)) ?? new Uint8Array())
    expect(response).toMatchObject({
      call_id: 'call-readonly',
      kind: 'bye',
      type: 'webrtc_signal',
    })
    expect(seen).toEqual([])
    expect(calls).toEqual([])
  })

  it('routes encrypted webrtc_signal frames to the handler without dispatching JSON-RPC', async () => {
    const relay = await startRelay()
    const seen: unknown[] = []
    const { calls, connector } = createConnectorWithWebRtcSignalHandler(
      configFor(relay),
      (frame, context) => {
        seen.push({ capabilities: context.capabilities, deviceId: context.deviceId, frame })
        context.send({
          call_id: frame.call_id,
          kind: 'answer',
          sdp: 'answer-sdp',
          sdp_type: 'answer',
          type: 'webrtc_signal',
        })
        return true
      }
    )
    await waitFor(() => connector.status().mode === 'connected')
    const device = await connectDevice(relay)
    const channel = await completeHandshakeWithCapabilities(device, [
      'read_dashboard',
      'send_prompt',
    ])

    device.send(
      JSON.stringify({
        payload: channel.encrypt(
          encodeJson({
            call_id: 'call-1',
            kind: 'offer',
            sdp: 'offer-sdp',
            sdp_type: 'offer',
            type: 'webrtc_signal',
          })
        ),
        type: 'data',
      })
    )

    const answer = decodeJson(channel.decrypt(await dataPayload(device)) ?? new Uint8Array())
    expect(answer).toMatchObject({
      call_id: 'call-1',
      kind: 'answer',
      sdp: 'answer-sdp',
      sdp_type: 'answer',
      type: 'webrtc_signal',
    })
    expect(seen).toEqual([
      expect.objectContaining({
        capabilities: ['read_dashboard', 'send_prompt'],
        deviceId: 'device-1',
        frame: expect.objectContaining({ call_id: 'call-1', kind: 'offer', sdp: 'offer-sdp' }),
      }),
    ])
    expect(calls).toEqual([])
  })

  it('passes capabilities to voice_stream handlers so read-only devices can be rejected', async () => {
    const relay = await startRelay()
    const { calls, connector } = createConnectorWithVoiceStreamHandler(
      configFor(relay),
      async (frame, context) => {
        if (frame.op !== 'open' || typeof frame.text !== 'string') return false
        if (!context.capabilities.includes('send_prompt')) {
          context.send({
            error: 'missing_mobile_capability: send_prompt',
            op: 'error',
            seq: frame.seq ?? 0,
            stream_id: frame.stream_id ?? '',
            type: 'voice_stream',
          })
          return true
        }
        context.send({
          done: true,
          format: 'm4a',
          mime: 'audio/mp4',
          op: 'chunk',
          payload: 'audio',
          seq: 1,
          stream_id: frame.stream_id ?? '',
          type: 'voice_stream',
        })
        return true
      }
    )
    await waitFor(() => connector.status().mode === 'connected')
    const device = await connectDevice(relay)
    const channel = await completeHandshakeWithCapabilities(device, ['read_dashboard'])

    device.send(
      JSON.stringify({
        payload: channel.encrypt(
          encodeJson({
            op: 'open',
            seq: 0,
            stream_id: 'voice-audio',
            text: '你好这是流式测试',
            type: 'voice_stream',
          })
        ),
        type: 'data',
      })
    )

    const response = decodeJson(channel.decrypt(await dataPayload(device)) ?? new Uint8Array())
    expect(response).toMatchObject({
      error: 'missing_mobile_capability: send_prompt',
      op: 'error',
      stream_id: 'voice-audio',
      type: 'voice_stream',
    })
    expect(calls).toEqual([])
  })

  it('rejects handshake when requested capabilities exceed the device record', async () => {
    const relay = await startRelay()
    const { connector } = createConnector(configFor(relay))
    await waitFor(() => connector.status().mode === 'connected')
    const device = await connectDevice(relay)
    const initiator = createHandshakeInitiator(generateKeyPair())

    device.send(
      JSON.stringify({
        payload: encodeBase64(
          encodeJson({
            capabilities: ['admin_runtime'],
            device_id: 'device-1',
            handshake: initiator.getInitMessage(),
            token: 'device-token',
            type: 'e2ee_hello',
          })
        ),
        type: 'data',
      })
    )

    const error = decodeJson(decodeBase64(await dataPayload(device))) as {
      code: string
      type: string
    }
    expect(error).toEqual({
      code: 'capability_denied',
      type: 'e2ee_error',
    })
  })

  it('returns encrypted JSON-RPC errors when the handler throws', async () => {
    const relay = await startRelay()
    const config = configFor(relay)
    const connector = createRelayConnector(
      config,
      async () => {
        throw new Error('handler failed')
      },
      {
        authenticateDevice: () => ({ capabilities: ['read_dashboard'], id: 'device-1' }),
        heartbeatIntervalMs: 25,
      }
    )
    connectors.push(connector)
    await waitFor(() => connector.status().mode === 'connected')
    const device = await connectDevice(relay)
    const channel = await completeHandshake(device)

    device.send(
      JSON.stringify({
        payload: channel.encrypt(
          encodeJson({ id: 'rpc-error', jsonrpc: '2.0', method: 'runtime.status', params: {} })
        ),
        type: 'data',
      })
    )

    const response = decodeJson(channel.decrypt(await dataPayload(device)) ?? new Uint8Array()) as {
      error: { message: string }
      id: string
    }
    expect(response).toEqual({
      error: { code: -32000, message: 'handler failed' },
      id: 'rpc-error',
      jsonrpc: '2.0',
    })
  })

  it('pushEvent encrypts a no-id event frame to the active device session (M27 Part B)', async () => {
    const relay = await startRelay()
    const { connector } = createConnector(configFor(relay))
    await waitFor(() => connector.status().mode === 'connected')
    const device = await connectDevice(relay)
    const channel = await completeHandshake(device)

    connector.pushEvent('chat_message', { message: { id: 'm1' }, workspace_id: 'ws-1' })

    const event = decodeJson(channel.decrypt(await dataPayload(device)) ?? new Uint8Array()) as {
      id?: string
      kind: string
      payload: { message: { id: string }; workspace_id: string }
      type: string
    }
    // 事件帧：type:'event' + kind + payload，且**无 RPC id**（设备端据此路由到 onEvent 而非当回应）。
    expect(event.type).toBe('event')
    expect(event.kind).toBe('chat_message')
    expect(event.id).toBeUndefined()
    expect(event.payload).toEqual({ message: { id: 'm1' }, workspace_id: 'ws-1' })
  })

  it('pushEvent is a no-op when no device session is active', async () => {
    const relay = await startRelay()
    const { connector } = createConnector(configFor(relay))
    await waitFor(() => connector.status().mode === 'connected')
    // 无握手过的设备 session → 不抛错、不发送（sessions 为空）。
    expect(() => connector.pushEvent('dashboard_update', { workspace_id: 'ws-1' })).not.toThrow()
  })

  it('enters backoff after relay disconnects and reconnects when relay returns', async () => {
    const relay = await startRelay()
    const config = configFor(relay)
    const { connector } = createConnector(config)
    await waitFor(() => connector.status().mode === 'connected')

    await relay.close()
    relayServers.splice(relayServers.indexOf(relay), 1)

    await waitFor(() => ['backoff', 'connecting'].includes(connector.status().mode), 1_000)
    expect(connector.status().last_error).toBeTruthy()
  })
})
