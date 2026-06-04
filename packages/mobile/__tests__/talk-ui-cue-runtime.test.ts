/**
 * @vitest-environment jsdom
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

// @ts-expect-error This test must share the root React instance used by @testing-library/react.
vi.mock('react', async () => await import('../../../node_modules/react/index.js'))
vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }))

type RecordingStatus = {
  canRecord: boolean
  durationMillis: number
  isRecording: boolean
  mediaServicesDidReset: boolean
  metering?: number
  url: string | null
}

const audioMock = vi.hoisted(() => {
  const recorderStatus: RecordingStatus = {
    canRecord: false,
    durationMillis: 0,
    isRecording: false,
    mediaServicesDidReset: false,
    url: null,
  }
  const cuePlayer = {
    pause: vi.fn(),
    play: vi.fn(),
    remove: vi.fn(),
    replace: vi.fn(),
  }
  const playerStatus = {
    didJustFinish: false,
    isLoaded: false,
  }
  const recorder = {
    getStatus: vi.fn(() => recorderStatus),
    prepareToRecordAsync: vi.fn(async () => {
      recorderStatus.canRecord = true
      recorderStatus.url = 'file://recording.m4a'
    }),
    record: vi.fn(() => {
      recorderStatus.isRecording = true
    }),
    stop: vi.fn(async () => {
      recorderStatus.canRecord = false
      recorderStatus.isRecording = false
      recorderStatus.url = 'file://recording.m4a'
    }),
    uri: 'file://recording.m4a',
  }
  return {
    cuePlayer,
    player: {
      pause: vi.fn(),
      play: vi.fn(() => {
        playerStatus.isLoaded = true
        playerStatus.didJustFinish = false
      }),
      remove: vi.fn(),
      replace: vi.fn(),
    },
    playerStatus,
    recorder,
    recorderStatus,
    setAudioModeAsync: vi.fn().mockResolvedValue(undefined),
  }
})

const hapticsMock = vi.hoisted(() => ({
  impactAsync: vi.fn().mockResolvedValue(undefined),
  notificationAsync: vi.fn().mockResolvedValue(undefined),
}))

const runtime = vi.hoisted(() => ({
  chatMessages: [] as Array<{
    content_json: string
    created_at: number
    id: string
    message_type: string
  }>,
  sendPromptToOrchestratorWithOutcome: vi.fn().mockResolvedValue('sent'),
  state: 'connected',
  synthesizeVoice: vi
    .fn()
    .mockResolvedValue({ audio: 'reply-audio', format: 'wav', mime: 'audio/wav' }),
  synthesizeVoiceStream: vi
    .fn()
    .mockResolvedValue({ audio: 'stream-audio', format: 'wav', mime: 'audio/wav' }),
  transcribeVoice: vi.fn().mockResolvedValue('turn on diagnostics'),
}))

vi.mock('expo-audio', () => ({
  RecordingPresets: {
    HIGH_QUALITY: {
      android: {},
      bitRate: 128000,
      extension: '.m4a',
      ios: {},
      numberOfChannels: 2,
      sampleRate: 44100,
      web: {},
    },
  },
  requestRecordingPermissionsAsync: vi.fn().mockResolvedValue({ granted: true }),
  setAudioModeAsync: audioMock.setAudioModeAsync,
  useAudioPlayer: vi.fn((_source: unknown, options?: { updateInterval?: number }) =>
    options?.updateInterval === 100 ? audioMock.player : audioMock.cuePlayer
  ),
  useAudioPlayerStatus: vi.fn(() => audioMock.playerStatus),
  useAudioRecorder: vi.fn(() => audioMock.recorder),
  useAudioRecorderState: vi.fn(() => audioMock.recorderStatus),
  useAudioStream: vi.fn(() => ({
    isStreaming: false,
    stream: { start: vi.fn().mockResolvedValue(undefined), stop: vi.fn() },
  })),
}))

vi.mock('expo-haptics', () => ({
  ImpactFeedbackStyle: { Light: 'light' },
  NotificationFeedbackType: { Warning: 'warning' },
  impactAsync: hapticsMock.impactAsync,
  notificationAsync: hapticsMock.notificationAsync,
}))

vi.mock('expo-file-system', () => ({
  EncodingType: { Base64: 'base64' },
  readAsStringAsync: vi.fn(() => {
    throw new Error('Method readAsStringAsync imported from "expo-file-system" is deprecated')
  }),
}))

vi.mock('expo-file-system/legacy', () => ({
  EncodingType: { Base64: 'base64' },
  readAsStringAsync: vi.fn().mockResolvedValue('audio-base64'),
}))

vi.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name }: { name: string }) => React.createElement('span', { 'data-icon': name }),
}))

vi.mock('react-native', () => {
  const View = ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', null, children)
  const Text = ({ children }: { children?: React.ReactNode }) =>
    React.createElement('span', null, children)
  const Pressable = ({
    children,
    disabled,
    onClick,
    onPress,
  }: {
    children?: React.ReactNode
    disabled?: boolean
    onClick?: () => void
    onPress?: () => void
  }) =>
    React.createElement(
      'button',
      { disabled, onClick: onPress ?? onClick, type: 'button' },
      children
    )
  return {
    ActivityIndicator: () => React.createElement('span', { 'data-testid': 'activity' }),
    Platform: { OS: 'android' },
    Pressable,
    StyleSheet: { create: <T>(styles: T) => styles },
    Text,
    View,
  }
})

vi.mock('../src/components/Screen', () => ({
  Screen: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('main', null, children),
}))

vi.mock('../src/i18n', () => ({
  useT: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}))

vi.mock('../src/api/mobile-runtime-context', () => ({
  useMobileRuntime: () => runtime,
}))

vi.mock('../src/lib/silero-vad-shadow', () => ({
  createSileroVadShadowScorer: vi.fn(() => ({
    score: vi.fn(async () => null),
  })),
}))

const renderTalkTab = async () => {
  const { default: TalkTab } = await import('../app/(tabs)/talk')
  return render(React.createElement(TalkTab))
}

describe('TalkTab cue runtime hardening', () => {
  beforeEach(() => {
    cleanup()
    vi.resetModules()
    vi.unstubAllEnvs()
    runtime.state = 'connected'
    hapticsMock.impactAsync.mockReset()
    hapticsMock.impactAsync.mockResolvedValue(undefined)
    hapticsMock.notificationAsync.mockReset()
    hapticsMock.notificationAsync.mockResolvedValue(undefined)
    audioMock.cuePlayer.pause.mockReset()
    audioMock.cuePlayer.play.mockReset()
    audioMock.cuePlayer.replace.mockReset()
    audioMock.cuePlayer.remove.mockReset()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  test('does not trigger haptics or audio cues when cue flags are disabled', async () => {
    vi.stubEnv('EXPO_PUBLIC_TALK_HAPTICS_ENABLED', '0')
    vi.stubEnv('EXPO_PUBLIC_TALK_AUDIO_CUES_ENABLED', '0')
    await renderTalkTab()

    fireEvent.click(screen.getByText('talk.mode.continuous'))
    await waitFor(() => expect(screen.getByText(/talk.state.listening/)).toBeTruthy())

    expect(hapticsMock.impactAsync).not.toHaveBeenCalled()
    expect(audioMock.cuePlayer.replace).not.toHaveBeenCalled()
    expect(audioMock.cuePlayer.play).not.toHaveBeenCalled()
  })

  test('swallows cue playback and haptic failures without breaking continuous startup', async () => {
    hapticsMock.impactAsync.mockRejectedValue(new Error('haptic unavailable'))
    audioMock.cuePlayer.replace.mockImplementation(() => {
      throw new Error('cue player unavailable')
    })
    await renderTalkTab()

    fireEvent.click(screen.getByText('talk.mode.continuous'))
    await waitFor(() => expect(screen.getByText(/talk.state.listening/)).toBeTruthy())

    expect(hapticsMock.impactAsync).toHaveBeenCalled()
    expect(audioMock.cuePlayer.replace).toHaveBeenCalled()
  })

  test('swallows the second double-haptic impact failure when exiting listening', async () => {
    vi.useFakeTimers()
    hapticsMock.impactAsync
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('second impact unavailable'))
    await renderTalkTab()

    fireEvent.click(screen.getByText('talk.mode.continuous'))
    await act(async () => {})
    fireEvent.click(screen.getByText('talk.continuous.stop'))
    await act(async () => {
      await vi.runOnlyPendingTimersAsync()
    })

    expect(hapticsMock.impactAsync).toHaveBeenCalledTimes(3)
  })
})
