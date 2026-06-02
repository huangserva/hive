/**
 * @vitest-environment jsdom
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

// @ts-expect-error This test must share the root React instance used by @testing-library/react.
vi.mock('react', async () => await import('../../../node_modules/react/index.js'))

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
  const recorder = {
    getStatus: vi.fn(() => recorderStatus),
    id: 'recorder-1',
    prepareToRecordAsync: vi.fn(async () => {
      if (recorderStatus.canRecord) {
        throw new Error('AudioRecorder has already been prepared')
      }
      recorderStatus.canRecord = true
      recorderStatus.url = 'file://recording.m4a'
    }),
    record: vi.fn(() => {
      recorderStatus.isRecording = true
    }),
    stop: vi.fn(async () => {
      recorderStatus.isRecording = false
      recorderStatus.canRecord = false
      recorderStatus.url = 'file://recording.m4a'
    }),
    uri: 'file://recording.m4a',
  }
  const playerStatus = {
    didJustFinish: false,
    isLoaded: false,
  }
  const player = {
    pause: vi.fn(),
    play: vi.fn(() => {
      playerStatus.isLoaded = true
      playerStatus.didJustFinish = false
    }),
    remove: vi.fn(),
    replace: vi.fn(),
  }

  return { player, playerStatus, recorder, recorderStatus }
})

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
  setAudioModeAsync: vi.fn().mockResolvedValue(undefined),
  useAudioPlayer: vi.fn(() => audioMock.player),
  useAudioPlayerStatus: vi.fn(() => audioMock.playerStatus),
  useAudioRecorder: vi.fn(() => audioMock.recorder),
  useAudioRecorderState: vi.fn(() => audioMock.recorderStatus),
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

const setRecorderStatus = async (
  view: ReturnType<typeof render>,
  status: Partial<RecordingStatus>
) => {
  await act(async () => {
    Object.assign(audioMock.recorderStatus, status)
    view.rerender(React.createElement(TalkTab))
  })
}

const finishCurrentPhrase = async (view: ReturnType<typeof render>) => {
  await setRecorderStatus(view, { durationMillis: 0, isRecording: true, metering: -40 })
  await setRecorderStatus(view, { durationMillis: 400, isRecording: true, metering: -60 })
  await setRecorderStatus(view, { durationMillis: 1600, isRecording: true, metering: -60 })
}

describe('TalkTab continuous mode behavior', () => {
  beforeEach(() => {
    cleanup()
    Object.assign(audioMock.recorderStatus, {
      canRecord: false,
      durationMillis: 0,
      isRecording: false,
      mediaServicesDidReset: false,
      metering: undefined,
      url: null,
    })
    Object.assign(audioMock.playerStatus, {
      didJustFinish: false,
      isLoaded: false,
    })
    audioMock.recorder.getStatus.mockClear()
    audioMock.recorder.prepareToRecordAsync.mockClear()
    audioMock.recorder.record.mockClear()
    audioMock.recorder.stop.mockClear()
    audioMock.player.pause.mockClear()
    audioMock.player.play.mockClear()
    audioMock.player.remove.mockClear()
    audioMock.player.replace.mockClear()
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
    const view = render(React.createElement(TalkTab))
    fireEvent.click(screen.getByText('talk.mode.continuous'))
    await waitFor(() => expect(audioMock.recorder.prepareToRecordAsync).toHaveBeenCalledTimes(1))

    await finishCurrentPhrase(view)

    await waitFor(() => expect(audioMock.recorder.prepareToRecordAsync).toHaveBeenCalledTimes(2))
    expect(audioMock.recorder.stop).toHaveBeenCalled()
    expect(audioMock.recorder.record).toHaveBeenCalledTimes(2)
  })

  test('push-to-talk records from an already prepared recorder without preparing again', async () => {
    Object.assign(audioMock.recorderStatus, {
      canRecord: true,
      isRecording: false,
      url: 'file://prepared-recording.m4a',
    })
    render(React.createElement(TalkTab))

    fireEvent.mouseDown(screen.getByText('talk.button.hold'))

    await waitFor(() => expect(audioMock.recorder.record).toHaveBeenCalledTimes(1))
    expect(audioMock.recorder.prepareToRecordAsync).not.toHaveBeenCalled()
  })

  test('continuous mode records from an already prepared recorder without preparing again', async () => {
    Object.assign(audioMock.recorderStatus, {
      canRecord: true,
      isRecording: false,
      url: 'file://prepared-recording.m4a',
    })
    render(React.createElement(TalkTab))

    fireEvent.click(screen.getByText('talk.mode.continuous'))

    await waitFor(() => expect(audioMock.recorder.record).toHaveBeenCalledTimes(1))
    expect(audioMock.recorder.prepareToRecordAsync).not.toHaveBeenCalled()
  })

  test('does not prepare a new continuous segment when stopping the previous one fails', async () => {
    audioMock.recorder.stop.mockImplementationOnce(async () => {
      throw new Error('native stop failed')
    })
    const view = render(React.createElement(TalkTab))
    fireEvent.click(screen.getByText('talk.mode.continuous'))
    await waitFor(() => expect(audioMock.recorder.prepareToRecordAsync).toHaveBeenCalledTimes(1))

    await finishCurrentPhrase(view)
    await flush()

    expect(screen.getByText('native stop failed')).toBeTruthy()
    expect(audioMock.recorder.prepareToRecordAsync).toHaveBeenCalledTimes(1)
    expect(audioMock.recorder.record).toHaveBeenCalledTimes(1)
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
    await waitFor(() => expect(audioMock.recorder.prepareToRecordAsync).toHaveBeenCalledTimes(1))
    await finishCurrentPhrase(view)
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
    expect(audioMock.player.replace).toHaveBeenCalledWith({
      uri: 'data:audio/wav;base64,reply-audio',
    })
    expect(audioMock.player.play).toHaveBeenCalled()
    now.mockRestore()
  })

  test('reopens exactly one microphone after playback finishes in continuous mode', async () => {
    const view = render(React.createElement(TalkTab))

    fireEvent.click(screen.getByText('talk.mode.continuous'))
    await waitFor(() => expect(audioMock.recorder.prepareToRecordAsync).toHaveBeenCalledTimes(1))
    await finishCurrentPhrase(view)
    runtime.chatMessages = [
      {
        content_json: JSON.stringify({ text: 'fresh reply' }),
        created_at: 2,
        id: 'fresh-reply',
        message_type: 'orch_reply',
      },
    ]
    view.rerender(React.createElement(TalkTab))
    await waitFor(() => expect(audioMock.player.play).toHaveBeenCalledTimes(1))
    expect(audioMock.recorder.prepareToRecordAsync).toHaveBeenCalledTimes(1)

    await act(async () => {
      Object.assign(audioMock.playerStatus, { didJustFinish: true, isLoaded: true })
      view.rerender(React.createElement(TalkTab))
    })

    await waitFor(() => expect(audioMock.recorder.prepareToRecordAsync).toHaveBeenCalledTimes(2))
    expect(audioMock.recorder.prepareToRecordAsync).not.toHaveBeenCalledTimes(3)
  })
})
