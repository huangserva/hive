import { describe, expect, test, vi } from 'vitest'

vi.mock('react-native', () => {
  const component = (name: string) => name
  return {
    ActivityIndicator: component('ActivityIndicator'),
    Alert: { alert: vi.fn() },
    Dimensions: { get: () => ({ height: 800, width: 400 }) },
    FlatList: component('FlatList'),
    Image: component('Image'),
    Keyboard: {
      addListener: () => ({ remove: vi.fn() }),
    },
    KeyboardAvoidingView: component('KeyboardAvoidingView'),
    Modal: component('Modal'),
    Platform: {
      OS: 'ios',
      select: <T>(values: { default: T; ios?: T }) => values.ios ?? values.default,
    },
    Pressable: component('Pressable'),
    ScrollView: component('ScrollView'),
    StyleSheet: { create: <T>(styles: T) => styles },
    Switch: component('Switch'),
    Text: component('Text'),
    TextInput: component('TextInput'),
    View: component('View'),
  }
})

vi.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }))
vi.mock('expo-camera', () => ({
  CameraView: 'CameraView',
  useCameraPermissions: () => [{ granted: true }, vi.fn()],
}))
vi.mock('expo-clipboard', () => ({ setStringAsync: vi.fn() }))
vi.mock('expo-constants', () => ({ default: { expoConfig: {} } }))
vi.mock('expo-document-picker', () => ({ getDocumentAsync: vi.fn() }))
vi.mock('expo-file-system', () => ({ readAsStringAsync: vi.fn() }))
vi.mock('expo-image-manipulator', () => ({
  manipulateAsync: vi.fn(),
  SaveFormat: { PNG: 'png' },
}))
vi.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: vi.fn(),
  requestMediaLibraryPermissionsAsync: vi.fn(),
}))
vi.mock('expo-router', () => ({
  useFocusEffect: vi.fn(),
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock('../src/api/mobile-runtime-context', () => ({ useMobileRuntime: vi.fn() }))
vi.mock('../src/components/ConnectionModeBanner', () => ({
  ConnectionModeBadge: 'ConnectionModeBadge',
}))
vi.mock('../src/components/Screen', () => ({ Screen: 'Screen' }))
vi.mock('../src/i18n', () => ({
  useLanguage: () => ({ language: 'en', setLanguage: vi.fn() }),
  useT: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}))

import {
  buildMarkdownSegments,
  buildUploadedMediaPrompt,
  normalizeUploadedMediaResult,
} from '../app/(tabs)/index'
import { applyScannedConnectionQrFlow } from '../app/(tabs)/settings'

describe('mobile chat and settings cluster B regressions', () => {
  test('builds an orchestrator prompt with uploaded media URLs, not filename-only placeholders', () => {
    expect(
      buildUploadedMediaPrompt(
        [
          {
            filename: 'photo.jpg',
            file_id: 'file-1',
            url: 'http://127.0.0.1:4010/api/mobile/media/file-1',
          },
        ],
        'please inspect'
      )
    ).toContain('http://127.0.0.1:4010/api/mobile/media/file-1')
  })

  test('treats null upload results as failures before sending the prompt', () => {
    expect(() => normalizeUploadedMediaResult({ filename: 'photo.jpg' }, null)).toThrowError(
      /upload failed/i
    )
  })

  test('parses fenced code blocks as code segments and preserves inline backticks inside them', () => {
    expect(buildMarkdownSegments('before\n```ts\nconst x = `value`\n```\nafter')).toEqual([
      { text: 'before', type: 'paragraph' },
      { language: 'ts', text: 'const x = `value`', type: 'code' },
      { text: 'after', type: 'paragraph' },
    ])
  })

  test('connects a scanned relay QR with the newly configured relay config, never the old one', async () => {
    const oldConfig = {
      capabilities: ['read_runtime'],
      daemon_public_key: 'old-daemon',
      device_id: 'old-device',
      device_keypair: { publicKey: 'old-public', secretKey: 'old-secret' },
      relay_auth_token: 'old-auth',
      relay_url: 'wss://old-relay.example.test',
      room_id: 'old-room',
    }
    const newConfig = {
      capabilities: ['read_runtime'],
      daemon_public_key: 'new-daemon',
      device_id: 'new-device',
      device_keypair: { publicKey: 'new-public', secretKey: 'new-secret' },
      relay_auth_token: 'new-auth',
      relay_url: 'wss://new-relay.example.test',
      room_id: 'new-room',
    }
    const connect = vi.fn().mockResolvedValue(true)

    await applyScannedConnectionQrFlow(
      {
        host: '10.0.0.2:4010',
        relay: {
          capabilities: ['read_runtime'],
          daemon_public_key: 'new-daemon',
          device_id: 'new-device',
          relay_auth_token: 'new-auth',
          relay_url: 'wss://new-relay.example.test',
          room_id: 'new-room',
        },
        token: 'new-token',
      },
      {
        configureRelay: vi.fn().mockResolvedValue(newConfig),
        connect,
        onConnected: vi.fn(),
        onRelayConfigureFailed: vi.fn(),
        relayConfig: oldConfig,
        setDraftHost: vi.fn(),
        setDraftToken: vi.fn(),
        setHost: vi.fn(),
        setScanLocked: vi.fn(),
        setScannerOpen: vi.fn(),
        setToken: vi.fn(),
      }
    )

    expect(connect).toHaveBeenCalledTimes(1)
    expect(connect).toHaveBeenCalledWith('10.0.0.2:4010', 'new-token', newConfig)
    expect(connect).not.toHaveBeenCalledWith('10.0.0.2:4010', 'new-token', oldConfig)
  })

  test('does not connect when scanned relay configuration fails to persist', async () => {
    const connect = vi.fn()
    const onRelayConfigureFailed = vi.fn()

    await applyScannedConnectionQrFlow(
      {
        host: '10.0.0.2:4010',
        relay: {
          capabilities: ['read_runtime'],
          daemon_public_key: 'new-daemon',
          device_id: 'new-device',
          relay_auth_token: 'new-auth',
          relay_url: 'wss://new-relay.example.test',
          room_id: 'new-room',
        },
        token: 'new-token',
      },
      {
        configureRelay: vi.fn().mockRejectedValue(new Error('secure store failed')),
        connect,
        onConnected: vi.fn(),
        onRelayConfigureFailed,
        relayConfig: null,
        setDraftHost: vi.fn(),
        setDraftToken: vi.fn(),
        setHost: vi.fn(),
        setScanLocked: vi.fn(),
        setScannerOpen: vi.fn(),
        setToken: vi.fn(),
      }
    )

    expect(connect).not.toHaveBeenCalled()
    expect(onRelayConfigureFailed).toHaveBeenCalledOnce()
  })
})
