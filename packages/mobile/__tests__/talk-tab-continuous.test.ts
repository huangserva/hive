/**
 * @vitest-environment jsdom
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

// @ts-expect-error This test must share the root React instance used by @testing-library/react.
vi.mock('react', async () => await import('../../../node_modules/react/index.js'))

type RecordingStatus = {
  durationMillis: number
  metering?: number
}

const audioMock = vi.hoisted(() => {
  class MockRecording {
    onStatus: ((status: RecordingStatus) => void) | null = null
    stopAndUnloadAsync = vi.fn().mockResolvedValue(undefined)
    getURI = vi.fn(() => `file://recording-${mockRecordings.length}.m4a`)
    setProgressUpdateInterval = vi.fn().mockResolvedValue(undefined)
    setOnRecordingStatusUpdate = vi.fn((callback: (status: RecordingStatus) => void) => {
      this.onStatus = callback
    })
  }

  const mockRecordings: MockRecording[] = []
  const mockSounds: Array<{
    onStatus: ((status: { didJustFinish: boolean; isLoaded: boolean }) => void) | null
    setOnPlaybackStatusUpdate: ReturnType<typeof vi.fn>
    unloadAsync: ReturnType<typeof vi.fn>
  }> = []
  const createAsync = vi.fn(async () => {
    const recording = new MockRecording()
    mockRecordings.push(recording)
    return { recording }
  })
  const soundCreateAsync = vi.fn(async () => {
    const sound = {
      onStatus: null as ((status: { didJustFinish: boolean; isLoaded: boolean }) => void) | null,
      setOnPlaybackStatusUpdate: vi.fn(
        (callback: (status: { didJustFinish: boolean; isLoaded: boolean }) => void) => {
          sound.onStatus = callback
        }
      ),
      unloadAsync: vi.fn().mockResolvedValue(undefined),
    }
    mockSounds.push(sound)
    return { sound }
  })

  return { createAsync, mockRecordings, mockSounds, soundCreateAsync }
})

vi.mock('expo-av', () => ({
  Audio: {
    Recording: {
      createAsync: audioMock.createAsync,
    },
    RecordingOptionsPresets: {
      HIGH_QUALITY: {
        android: {},
        ios: {},
        web: {},
      },
    },
    Sound: {
      createAsync: audioMock.soundCreateAsync,
    },
    requestPermissionsAsync: vi.fn().mockResolvedValue({ granted: true }),
    setAudioModeAsync: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock('expo-file-system', () => ({
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
    onMouseDown,
    onMouseUp,
    onPress,
    onPressIn,
    onPressOut,
  }: {
    children?: React.ReactNode
    disabled?: boolean
    onClick?: () => void
    onMouseDown?: () => void
    onMouseUp?: () => void
    onPress?: () => void
    onPressIn?: () => void
    onPressOut?: () => void
  }) =>
    React.createElement(
      'button',
      {
        disabled,
        onClick: onPress ?? onClick,
        onMouseDown: onPressIn ?? onMouseDown,
        onMouseUp: onPressOut ?? onMouseUp,
        type: 'button',
      },
      children
    )
  return {
    ActivityIndicator: () => React.createElement('span', { 'data-testid': 'activity' }),
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

const runtime = {
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
  transcribeVoice: vi.fn().mockResolvedValue('turn on diagnostics'),
}

vi.mock('../src/api/mobile-runtime-context', () => ({
  useMobileRuntime: () => runtime,
}))

import TalkTab from '../app/(tabs)/talk'

const flush = () => act(async () => {})

const startContinuousMode = async () => {
  render(React.createElement(TalkTab))
  fireEvent.click(screen.getByText('talk.mode.continuous'))
  await waitFor(() => expect(audioMock.createAsync).toHaveBeenCalledTimes(1))
}

const finishCurrentPhrase = async () => {
  const recording = audioMock.mockRecordings.at(-1)
  expect(recording).toBeDefined()
  await act(async () => {
    recording?.onStatus?.({ durationMillis: 0, metering: -40 })
    recording?.onStatus?.({ durationMillis: 400, metering: -60 })
    recording?.onStatus?.({ durationMillis: 1600, metering: -60 })
  })
}

describe('TalkTab continuous mode behavior', () => {
  beforeEach(() => {
    cleanup()
    audioMock.mockRecordings.length = 0
    audioMock.mockSounds.length = 0
    audioMock.createAsync.mockClear()
    audioMock.soundCreateAsync.mockClear()
    runtime.chatMessages = []
    runtime.sendPromptToOrchestratorWithOutcome = vi.fn().mockResolvedValue('sent')
    runtime.state = 'connected'
    runtime.synthesizeVoice = vi
      .fn()
      .mockResolvedValue({ audio: 'reply-audio', format: 'wav', mime: 'audio/wav' })
    runtime.transcribeVoice = vi.fn().mockResolvedValue('turn on diagnostics')
  })

  test('reopens the microphone after a continuous segment fails to transcribe', async () => {
    runtime.transcribeVoice = vi.fn().mockRejectedValue(new Error('stt failed'))
    await startContinuousMode()

    await finishCurrentPhrase()

    await waitFor(() => expect(audioMock.createAsync).toHaveBeenCalledTimes(2))
    expect(audioMock.mockRecordings[0]?.stopAndUnloadAsync).toHaveBeenCalled()
    expect(audioMock.mockRecordings[1]?.setOnRecordingStatusUpdate).toHaveBeenCalled()
  })

  test('ignores historical late-loaded replies but speaks this turn new reply across clock skew', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(100_000)
    const view = render(React.createElement(TalkTab))
    runtime.chatMessages = [
      {
        content_json: JSON.stringify({ text: 'old answer' }),
        created_at: 1,
        id: 'old-reply',
        message_type: 'orch_reply',
      },
    ]
    view.rerender(React.createElement(TalkTab))

    fireEvent.click(screen.getByText('talk.mode.continuous'))
    await waitFor(() => expect(audioMock.createAsync).toHaveBeenCalledTimes(1))
    await finishCurrentPhrase()
    await flush()

    expect(runtime.sendPromptToOrchestratorWithOutcome).toHaveBeenCalledWith('turn on diagnostics')
    expect(runtime.synthesizeVoice).not.toHaveBeenCalled()

    runtime.chatMessages = [
      ...runtime.chatMessages,
      {
        content_json: JSON.stringify({ text: 'new answer' }),
        created_at: 90_000,
        id: 'new-reply',
        message_type: 'orch_reply',
      },
    ]
    view.rerender(React.createElement(TalkTab))

    await waitFor(() => expect(runtime.synthesizeVoice).toHaveBeenCalledWith('new answer'))
    now.mockRestore()
  })

  test('reopens exactly one microphone after playback finishes in continuous mode', async () => {
    const view = render(React.createElement(TalkTab))

    fireEvent.click(screen.getByText('talk.mode.continuous'))
    await waitFor(() => expect(audioMock.createAsync).toHaveBeenCalledTimes(1))
    await finishCurrentPhrase()
    runtime.chatMessages = [
      {
        content_json: JSON.stringify({ text: 'fresh reply' }),
        created_at: 2,
        id: 'fresh-reply',
        message_type: 'orch_reply',
      },
    ]
    view.rerender(React.createElement(TalkTab))
    await waitFor(() => expect(audioMock.soundCreateAsync).toHaveBeenCalledTimes(1))
    expect(audioMock.createAsync).toHaveBeenCalledTimes(1)

    await act(async () => {
      audioMock.mockSounds[0]?.onStatus?.({ didJustFinish: true, isLoaded: true })
    })

    await waitFor(() => expect(audioMock.createAsync).toHaveBeenCalledTimes(2))
    expect(audioMock.createAsync).not.toHaveBeenCalledTimes(3)
  })
})
