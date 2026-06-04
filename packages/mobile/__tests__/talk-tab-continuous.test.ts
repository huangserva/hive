/**
 * @vitest-environment jsdom
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

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
  const cuePlayer = {
    pause: vi.fn(),
    play: vi.fn(),
    remove: vi.fn(),
    replace: vi.fn(),
  }
  const setAudioModeAsync = vi.fn().mockResolvedValue(undefined)
  const stream = {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
  }

  return {
    lastStreamOptions: null as {
      onBuffer?: (buffer: {
        channels: number
        data: ArrayBuffer
        sampleRate: number
        timestamp: number
      }) => void
    } | null,
    lastRecorderOptions: null as unknown,
    player,
    playerStatus,
    cuePlayer,
    recorder,
    recorderStatus,
    setAudioModeAsync,
    stream,
  }
})

const sileroMock = vi.hoisted(() => ({
  score: vi.fn(async () => null as number | null),
  scores: [] as Array<number | null>,
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
  useAudioRecorder: vi.fn((options: unknown) => {
    audioMock.lastRecorderOptions = options
    return audioMock.recorder
  }),
  useAudioRecorderState: vi.fn(() => audioMock.recorderStatus),
  useAudioStream: vi.fn((options: unknown) => {
    audioMock.lastStreamOptions = options as typeof audioMock.lastStreamOptions
    return { isStreaming: false, stream: audioMock.stream }
  }),
}))

vi.mock('expo-haptics', () => ({
  ImpactFeedbackStyle: { Light: 'light' },
  NotificationFeedbackType: { Warning: 'warning' },
  impactAsync: vi.fn().mockResolvedValue(undefined),
  notificationAsync: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../src/lib/silero-vad-shadow', () => ({
  createSileroVadShadowScorer: vi.fn(() => ({
    score: sileroMock.score,
  })),
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
  synthesizeVoiceStream: vi
    .fn()
    .mockResolvedValue({ audio: 'stream-audio', format: 'wav', mime: 'audio/wav' }),
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
  await setRecorderStatus(view, { durationMillis: 0, isRecording: true, metering: -50 })
  await setRecorderStatus(view, { durationMillis: 400, isRecording: true, metering: -25 })
  await setRecorderStatus(view, { durationMillis: 800, isRecording: true, metering: -50 })
  await setRecorderStatus(view, { durationMillis: 2000, isRecording: true, metering: -50 })
}

const finishNoiseTriggeredPhrase = async (view: ReturnType<typeof render>) => {
  await setRecorderStatus(view, { durationMillis: 0, isRecording: true, metering: -44 })
  await setRecorderStatus(view, { durationMillis: 400, isRecording: true, metering: -29 })
  await setRecorderStatus(view, { durationMillis: 800, isRecording: true, metering: -44 })
  await setRecorderStatus(view, { durationMillis: 2000, isRecording: true, metering: -44 })
}

const deferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, reject, resolve }
}

const int16SileroFrames = (frameCount: number) => {
  const data = new ArrayBuffer(frameCount * 512 * Int16Array.BYTES_PER_ELEMENT)
  const samples = new Int16Array(data)
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = 512
  }
  return data
}

const emitNeuralVadProbabilities = async (
  view: ReturnType<typeof render>,
  probabilities: number[]
) => {
  sileroMock.scores = [...probabilities]
  sileroMock.score.mockImplementation(async () => sileroMock.scores.shift() ?? null)
  await act(async () => {
    audioMock.lastStreamOptions?.onBuffer?.({
      channels: 1,
      data: int16SileroFrames(probabilities.length),
      sampleRate: 16_000,
      timestamp: 0,
    })
  })
  await act(async () => {})
  view.rerender(React.createElement(TalkTab))
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
    audioMock.stream.start.mockClear()
    audioMock.stream.stop.mockClear()
    audioMock.player.pause.mockClear()
    audioMock.player.play.mockClear()
    audioMock.player.remove.mockClear()
    audioMock.player.replace.mockClear()
    audioMock.cuePlayer.pause.mockClear()
    audioMock.cuePlayer.play.mockClear()
    audioMock.cuePlayer.remove.mockClear()
    audioMock.cuePlayer.replace.mockClear()
    audioMock.setAudioModeAsync.mockClear()
    sileroMock.score.mockClear()
    sileroMock.score.mockResolvedValue(null)
    sileroMock.scores = []
    audioMock.lastRecorderOptions = null
    audioMock.lastStreamOptions = null
    vi.unstubAllEnvs()
    runtime.chatMessages = []
    runtime.sendPromptToOrchestratorWithOutcome = vi.fn().mockResolvedValue('sent')
    runtime.state = 'connected'
    runtime.synthesizeVoice = vi
      .fn()
      .mockResolvedValue({ audio: 'reply-audio', format: 'wav', mime: 'audio/wav' })
    runtime.synthesizeVoiceStream = vi
      .fn()
      .mockResolvedValue({ audio: 'stream-audio', format: 'wav', mime: 'audio/wav' })
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

  test('does not render internal voice stream test controls in the production talk UI', () => {
    render(React.createElement(TalkTab))

    expect(screen.queryByText('talk.streamTest.button')).toBeNull()
    expect(screen.queryByText('talk.streamSynthesis.button')).toBeNull()
  })

  test('keeps the neural VAD PCM probe disabled by default', () => {
    render(React.createElement(TalkTab))

    expect(audioMock.lastStreamOptions).toBeNull()
    expect(audioMock.stream.start).not.toHaveBeenCalled()
  })

  test('starts a PCM probe stream in continuous mode when explicitly enabled without changing recording', async () => {
    vi.stubEnv('EXPO_PUBLIC_NEURAL_VAD_PCM_PROBE', '1')
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const view = render(React.createElement(TalkTab))

    fireEvent.click(screen.getByText('talk.mode.continuous'))
    await waitFor(() => expect(audioMock.recorder.prepareToRecordAsync).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(audioMock.stream.start).toHaveBeenCalledTimes(1))

    await act(async () => {
      const data = new ArrayBuffer(4 * Int16Array.BYTES_PER_ELEMENT)
      new Int16Array(data).set([0, 16_384, -16_384, 0])
      audioMock.lastStreamOptions?.onBuffer?.({
        channels: 1,
        data,
        sampleRate: 16_000,
        timestamp: 0,
      })
      view.rerender(React.createElement(TalkTab))
    })

    expect(audioMock.recorder.record).toHaveBeenCalledTimes(1)
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('[PCMDBG] sr=16000Hz ch=1 bytes=8 samples=4 rms=0.354')
    )
    log.mockRestore()
  })

  test('starts the neural VAD shadow stream when shadow mode is explicitly enabled', async () => {
    vi.stubEnv('EXPO_PUBLIC_NEURAL_VAD_SHADOW', '1')
    render(React.createElement(TalkTab))

    fireEvent.click(screen.getByText('talk.mode.continuous'))
    await waitFor(() => expect(audioMock.recorder.prepareToRecordAsync).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(audioMock.stream.start).toHaveBeenCalledTimes(1))

    expect(audioMock.lastStreamOptions).toMatchObject({
      channels: 1,
      encoding: 'int16',
      sampleRate: 16_000,
    })
    expect(audioMock.recorder.record).toHaveBeenCalledTimes(1)
  })

  test('uses neural voice probability to end a continuous segment while volume stays noisy', async () => {
    vi.stubEnv('EXPO_PUBLIC_NEURAL_VAD_SHADOW', '1')
    const view = render(React.createElement(TalkTab))

    fireEvent.click(screen.getByText('talk.mode.continuous'))
    await waitFor(() => expect(audioMock.recorder.prepareToRecordAsync).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(audioMock.stream.start).toHaveBeenCalledTimes(1))

    await emitNeuralVadProbabilities(view, [0.92])
    await waitFor(() => expect(screen.getByText('talk.state.capturing')).toBeTruthy())

    await setRecorderStatus(view, { durationMillis: 800, isRecording: true, metering: -20 })
    await emitNeuralVadProbabilities(
      view,
      Array.from({ length: 30 }, () => 0.04)
    )

    await waitFor(() => expect(runtime.transcribeVoice).toHaveBeenCalledWith('audio-base64', 'm4a'))
    expect(runtime.sendPromptToOrchestratorWithOutcome).toHaveBeenCalledWith(
      'turn on diagnostics',
      { source: 'voice' }
    )
  })

  test('uses uncertain neural probability to end a continuous segment instead of suppressing volume forever', async () => {
    vi.stubEnv('EXPO_PUBLIC_NEURAL_VAD_SHADOW', '1')
    const view = render(React.createElement(TalkTab))

    fireEvent.click(screen.getByText('talk.mode.continuous'))
    await waitFor(() => expect(audioMock.recorder.prepareToRecordAsync).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(audioMock.stream.start).toHaveBeenCalledTimes(1))

    await emitNeuralVadProbabilities(view, [0.92])
    await waitFor(() => expect(screen.getByText('talk.state.capturing')).toBeTruthy())

    await setRecorderStatus(view, { durationMillis: 800, isRecording: true, metering: -20 })
    await emitNeuralVadProbabilities(
      view,
      Array.from({ length: 30 }, () => 0.45)
    )

    await waitFor(() => expect(runtime.transcribeVoice).toHaveBeenCalledWith('audio-base64', 'm4a'))
    expect(runtime.sendPromptToOrchestratorWithOutcome).toHaveBeenCalledWith(
      'turn on diagnostics',
      { source: 'voice' }
    )
  })

  test('uses the Android voice communication recorder source by default', () => {
    render(React.createElement(TalkTab))

    expect(audioMock.lastRecorderOptions).toMatchObject({
      android: { audioSource: 'voice_communication' },
    })
  })

  test('does not use the Android voice communication recorder source when barge-in is explicitly disabled', () => {
    vi.stubEnv('EXPO_PUBLIC_TALKBACK_BARGE_IN_ENABLED', '0')
    render(React.createElement(TalkTab))

    expect(audioMock.lastRecorderOptions).not.toMatchObject({
      android: { audioSource: 'voice_communication' },
    })
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

  test('drops noise-triggered continuous segments before transcription or prompt delivery', async () => {
    const view = render(React.createElement(TalkTab))
    fireEvent.click(screen.getByText('talk.mode.continuous'))
    await waitFor(() => expect(audioMock.recorder.prepareToRecordAsync).toHaveBeenCalledTimes(1))

    await finishNoiseTriggeredPhrase(view)
    await waitFor(() => expect(audioMock.recorder.record).toHaveBeenCalledTimes(2))

    expect(runtime.transcribeVoice).not.toHaveBeenCalled()
    expect(runtime.sendPromptToOrchestratorWithOutcome).not.toHaveBeenCalled()
    expect(screen.queryByText('talk.error.sendFailed')).toBeNull()
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

    expect(runtime.sendPromptToOrchestratorWithOutcome).toHaveBeenCalledWith(
      'turn on diagnostics',
      { source: 'voice' }
    )
    expect(runtime.synthesizeVoiceStream).not.toHaveBeenCalled()
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

    await waitFor(() =>
      expect(runtime.synthesizeVoiceStream).toHaveBeenCalledWith('new answer', {
        voice: 'zh-CN-YunxiNeural',
      })
    )
    expect(runtime.synthesizeVoice).not.toHaveBeenCalled()
    expect(audioMock.player.replace).toHaveBeenCalledWith({
      uri: 'data:audio/wav;base64,stream-audio',
    })
    expect(audioMock.player.play).toHaveBeenCalled()
    now.mockRestore()
  })

  test('keeps the microphone open while speaking in continuous mode when barge-in is enabled', async () => {
    const view = render(React.createElement(TalkTab))

    fireEvent.click(screen.getByText('talk.mode.continuous'))
    await waitFor(() => expect(audioMock.recorder.prepareToRecordAsync).toHaveBeenCalledTimes(1))
    await finishCurrentPhrase(view)
    audioMock.recorder.record.mockClear()
    audioMock.setAudioModeAsync.mockClear()
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
    expect(audioMock.recorder.record).toHaveBeenCalledTimes(1)
    expect(audioMock.recorderStatus.isRecording).toBe(true)
    expect(audioMock.setAudioModeAsync).toHaveBeenCalledWith({
      allowsRecording: true,
      playsInSilentMode: true,
    })
    expect(audioMock.setAudioModeAsync).not.toHaveBeenCalledWith({
      allowsRecording: false,
      playsInSilentMode: true,
    })

    vi.useFakeTimers()
    await act(async () => {
      Object.assign(audioMock.playerStatus, { didJustFinish: true, isLoaded: true })
      view.rerender(React.createElement(TalkTab))
    })
    expect(audioMock.recorder.record).toHaveBeenCalledTimes(1)

    await act(async () => {
      vi.advanceTimersByTime(3499)
    })
    expect(audioMock.recorder.record).toHaveBeenCalledTimes(1)

    await act(async () => {
      vi.advanceTimersByTime(1)
    })
    await act(async () => {})
    expect(audioMock.recorder.record).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  test('uses Xiaoxiao voice for GLM fast replies and Yunxi voice for orchestrator replies', async () => {
    const view = render(React.createElement(TalkTab))

    fireEvent.click(screen.getByText('talk.mode.continuous'))
    await waitFor(() => expect(audioMock.recorder.prepareToRecordAsync).toHaveBeenCalledTimes(1))
    await finishCurrentPhrase(view)
    runtime.chatMessages = [
      {
        content_json: JSON.stringify({
          fast_reply: true,
          source: 'voice_fast_reply',
          text: '好的我先看一下',
        }),
        created_at: 2,
        id: 'fast-reply',
        message_type: 'orch_reply',
      },
    ]
    view.rerender(React.createElement(TalkTab))

    await waitFor(() =>
      expect(runtime.synthesizeVoiceStream).toHaveBeenCalledWith('好的我先看一下', {
        voice: 'zh-CN-XiaoxiaoNeural',
      })
    )

    await act(async () => {
      Object.assign(audioMock.playerStatus, { didJustFinish: true, isLoaded: true })
      view.rerender(React.createElement(TalkTab))
    })
    runtime.chatMessages = [
      ...runtime.chatMessages,
      {
        content_json: JSON.stringify({ text: '正式结果已经完成' }),
        created_at: 3,
        id: 'orch-reply',
        message_type: 'orch_reply',
      },
    ]
    view.rerender(React.createElement(TalkTab))

    await waitFor(() =>
      expect(runtime.synthesizeVoiceStream).toHaveBeenCalledWith('正式结果已经完成', {
        voice: 'zh-CN-YunxiNeural',
      })
    )
  })

  test('keeps the old stop-recorder playback behavior when barge-in is disabled', async () => {
    vi.stubEnv('EXPO_PUBLIC_TALKBACK_BARGE_IN_ENABLED', '0')
    const view = render(React.createElement(TalkTab))

    fireEvent.click(screen.getByText('talk.mode.continuous'))
    await waitFor(() =>
      expect(audioMock.setAudioModeAsync).toHaveBeenCalledWith({
        allowsRecording: true,
        playsInSilentMode: true,
      })
    )
    await finishCurrentPhrase(view)
    audioMock.setAudioModeAsync.mockClear()
    audioMock.recorder.record.mockClear()
    runtime.chatMessages = [
      {
        content_json: JSON.stringify({ text: 'speaker reply' }),
        created_at: 2,
        id: 'speaker-reply',
        message_type: 'orch_reply',
      },
    ]
    view.rerender(React.createElement(TalkTab))

    await waitFor(() =>
      expect(audioMock.setAudioModeAsync).toHaveBeenCalledWith({
        allowsRecording: false,
        playsInSilentMode: true,
      })
    )
    expect(audioMock.setAudioModeAsync.mock.invocationCallOrder.at(-1)).toBeLessThan(
      audioMock.player.play.mock.invocationCallOrder[0]
    )
    expect(audioMock.recorder.record).not.toHaveBeenCalled()

    try {
      vi.useFakeTimers()
      await act(async () => {
        Object.assign(audioMock.playerStatus, { didJustFinish: true, isLoaded: true })
        view.rerender(React.createElement(TalkTab))
      })
      await act(async () => {
        vi.advanceTimersByTime(3500)
      })
      await act(async () => {})

      expect(audioMock.setAudioModeAsync).toHaveBeenCalledWith({
        allowsRecording: true,
        playsInSilentMode: true,
      })
    } finally {
      vi.useRealTimers()
    }
  })

  test('pauses playback and starts capturing when barge-in speech is detected', async () => {
    const view = render(React.createElement(TalkTab))

    fireEvent.click(screen.getByText('talk.mode.continuous'))
    await waitFor(() => expect(audioMock.recorder.prepareToRecordAsync).toHaveBeenCalledTimes(1))
    await finishCurrentPhrase(view)
    runtime.chatMessages = [
      {
        content_json: JSON.stringify({ text: 'interruptible reply' }),
        created_at: 2,
        id: 'barge-reply',
        message_type: 'orch_reply',
      },
    ]
    view.rerender(React.createElement(TalkTab))
    await waitFor(() => expect(audioMock.player.play).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByText('talk.state.speaking')).toBeTruthy())
    audioMock.player.pause.mockClear()
    runtime.transcribeVoice.mockClear()

    await setRecorderStatus(view, { durationMillis: 0, isRecording: true, metering: -50 })
    await setRecorderStatus(view, { durationMillis: 300, isRecording: true, metering: -20 })
    await setRecorderStatus(view, { durationMillis: 600, isRecording: true, metering: -18 })
    await setRecorderStatus(view, { durationMillis: 900, isRecording: true, metering: -17 })

    await waitFor(() => expect(audioMock.player.pause).toHaveBeenCalledTimes(1))
    expect(screen.getByText('talk.state.capturing')).toBeTruthy()

    await setRecorderStatus(view, { durationMillis: 700, isRecording: true, metering: -50 })
    await setRecorderStatus(view, { durationMillis: 1900, isRecording: true, metering: -50 })
    await waitFor(() => expect(runtime.transcribeVoice).toHaveBeenCalledWith('audio-base64', 'm4a'))
  })

  test('does not pause playback for neural barge-in when metering has not arrived yet', async () => {
    vi.stubEnv('EXPO_PUBLIC_NEURAL_VAD_SHADOW', '1')
    const view = render(React.createElement(TalkTab))

    fireEvent.click(screen.getByText('talk.mode.continuous'))
    await waitFor(() => expect(audioMock.recorder.prepareToRecordAsync).toHaveBeenCalledTimes(1))
    await finishCurrentPhrase(view)
    runtime.chatMessages = [
      {
        content_json: JSON.stringify({ text: 'reply with echo risk' }),
        created_at: 2,
        id: 'neural-barge-reply',
        message_type: 'orch_reply',
      },
    ]
    view.rerender(React.createElement(TalkTab))
    await waitFor(() => expect(audioMock.player.play).toHaveBeenCalledTimes(1))
    audioMock.player.pause.mockClear()
    runtime.transcribeVoice.mockClear()

    await setRecorderStatus(view, { durationMillis: 0, isRecording: true, metering: undefined })
    await emitNeuralVadProbabilities(view, [0.95, 0.95, 0.95, 0.95])
    await flush()

    expect(audioMock.player.pause).not.toHaveBeenCalled()
    expect(runtime.transcribeVoice).not.toHaveBeenCalled()
    expect(screen.getByText('talk.state.speaking')).toBeTruthy()
  })

  test('pauses playback for neural barge-in only after metering passes the echo gate', async () => {
    vi.stubEnv('EXPO_PUBLIC_NEURAL_VAD_SHADOW', '1')
    const view = render(React.createElement(TalkTab))

    fireEvent.click(screen.getByText('talk.mode.continuous'))
    await waitFor(() => expect(audioMock.recorder.prepareToRecordAsync).toHaveBeenCalledTimes(1))
    await finishCurrentPhrase(view)
    runtime.chatMessages = [
      {
        content_json: JSON.stringify({ text: 'interruptible neural reply' }),
        created_at: 2,
        id: 'neural-barge-ok-reply',
        message_type: 'orch_reply',
      },
    ]
    view.rerender(React.createElement(TalkTab))
    await waitFor(() => expect(audioMock.player.play).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByText('talk.state.speaking')).toBeTruthy())
    audioMock.player.pause.mockClear()

    await setRecorderStatus(view, { durationMillis: 0, isRecording: true, metering: -18 })
    await emitNeuralVadProbabilities(view, [0.95, 0.95, 0.95, 0.95])

    await waitFor(() => expect(audioMock.player.pause).toHaveBeenCalledTimes(1))
    expect(screen.getByText('talk.state.capturing')).toBeTruthy()
  })

  test('does not interrupt playback for sustained TTS echo while speaking', async () => {
    const view = render(React.createElement(TalkTab))

    fireEvent.click(screen.getByText('talk.mode.continuous'))
    await waitFor(() => expect(audioMock.recorder.prepareToRecordAsync).toHaveBeenCalledTimes(1))
    await finishCurrentPhrase(view)
    runtime.chatMessages = [
      {
        content_json: JSON.stringify({ text: 'echo-safe reply' }),
        created_at: 2,
        id: 'echo-reply',
        message_type: 'orch_reply',
      },
    ]
    view.rerender(React.createElement(TalkTab))
    await waitFor(() => expect(audioMock.player.play).toHaveBeenCalledTimes(1))
    audioMock.player.pause.mockClear()
    runtime.transcribeVoice.mockClear()

    await setRecorderStatus(view, { durationMillis: 0, isRecording: true, metering: -46 })
    await setRecorderStatus(view, { durationMillis: 300, isRecording: true, metering: -24 })
    await setRecorderStatus(view, { durationMillis: 600, isRecording: true, metering: -26 })
    await setRecorderStatus(view, { durationMillis: 900, isRecording: true, metering: -27 })
    await setRecorderStatus(view, { durationMillis: 1200, isRecording: true, metering: -24 })
    await flush()

    expect(audioMock.player.pause).not.toHaveBeenCalled()
    expect(runtime.transcribeVoice).not.toHaveBeenCalled()
    expect(screen.getByText('talk.state.speaking')).toBeTruthy()
  })

  test('does not interrupt playback for a single loud spike while speaking', async () => {
    const view = render(React.createElement(TalkTab))

    fireEvent.click(screen.getByText('talk.mode.continuous'))
    await waitFor(() => expect(audioMock.recorder.prepareToRecordAsync).toHaveBeenCalledTimes(1))
    await finishCurrentPhrase(view)
    runtime.chatMessages = [
      {
        content_json: JSON.stringify({ text: 'spike-safe reply' }),
        created_at: 2,
        id: 'spike-reply',
        message_type: 'orch_reply',
      },
    ]
    view.rerender(React.createElement(TalkTab))
    await waitFor(() => expect(audioMock.player.play).toHaveBeenCalledTimes(1))
    audioMock.player.pause.mockClear()
    runtime.transcribeVoice.mockClear()

    await setRecorderStatus(view, { durationMillis: 0, isRecording: true, metering: -46 })
    await setRecorderStatus(view, { durationMillis: 300, isRecording: true, metering: -15 })
    await setRecorderStatus(view, { durationMillis: 600, isRecording: true, metering: -46 })
    await setRecorderStatus(view, { durationMillis: 900, isRecording: true, metering: -46 })
    await flush()

    expect(audioMock.player.pause).not.toHaveBeenCalled()
    expect(runtime.transcribeVoice).not.toHaveBeenCalled()
    expect(screen.getByText('talk.state.speaking')).toBeTruthy()
  })

  test('speaks every new orchestrator reply while the talk page remains open', async () => {
    const view = render(React.createElement(TalkTab))

    fireEvent.click(screen.getByText('talk.mode.continuous'))
    await waitFor(() => expect(audioMock.recorder.prepareToRecordAsync).toHaveBeenCalledTimes(1))
    await finishCurrentPhrase(view)
    runtime.chatMessages = [
      {
        content_json: JSON.stringify({ text: 'first follow-up' }),
        created_at: 1,
        id: 'follow-up-1',
        message_type: 'orch_reply',
      },
      {
        content_json: JSON.stringify({ text: 'ignore user' }),
        created_at: 2,
        id: 'user-message',
        message_type: 'user',
      },
      {
        content_json: JSON.stringify({ text: 'ignore system' }),
        created_at: 3,
        id: 'system-event',
        message_type: 'system_event',
      },
    ]
    view.rerender(React.createElement(TalkTab))

    await waitFor(() =>
      expect(runtime.synthesizeVoiceStream).toHaveBeenCalledWith('first follow-up', {
        voice: 'zh-CN-YunxiNeural',
      })
    )
    expect(runtime.synthesizeVoiceStream).not.toHaveBeenCalledWith('ignore user')
    expect(runtime.synthesizeVoiceStream).not.toHaveBeenCalledWith('ignore system')

    try {
      vi.useFakeTimers()
      await act(async () => {
        Object.assign(audioMock.playerStatus, { didJustFinish: true, isLoaded: true })
        view.rerender(React.createElement(TalkTab))
      })
      await act(async () => {
        vi.advanceTimersByTime(3500)
      })
      await act(async () => {})
    } finally {
      vi.useRealTimers()
    }
    runtime.chatMessages = [
      ...runtime.chatMessages,
      {
        content_json: JSON.stringify({ text: 'second follow-up' }),
        created_at: 4,
        id: 'follow-up-2',
        message_type: 'orch_reply',
      },
      {
        content_json: JSON.stringify({ text: 'third follow-up' }),
        created_at: 5,
        id: 'follow-up-3',
        message_type: 'orch_reply',
      },
    ]
    view.rerender(React.createElement(TalkTab))

    await waitFor(() =>
      expect(runtime.synthesizeVoiceStream).toHaveBeenCalledWith('second follow-up', {
        voice: 'zh-CN-YunxiNeural',
      })
    )
    await act(async () => {
      Object.assign(audioMock.playerStatus, { didJustFinish: true, isLoaded: true })
      view.rerender(React.createElement(TalkTab))
    })
    await waitFor(() =>
      expect(runtime.synthesizeVoiceStream).toHaveBeenCalledWith('third follow-up', {
        voice: 'zh-CN-YunxiNeural',
      })
    )

    expect(runtime.synthesizeVoiceStream).toHaveBeenCalledTimes(3)
  })

  test('does not speak historical replies that late-load after talkback is enabled', async () => {
    const view = render(React.createElement(TalkTab))

    fireEvent.click(screen.getByText('talk.mode.continuous'))
    await waitFor(() => expect(audioMock.recorder.prepareToRecordAsync).toHaveBeenCalledTimes(1))
    runtime.chatMessages = [
      {
        content_json: JSON.stringify({ text: 'historical answer one' }),
        created_at: 10,
        id: 'history-1',
        message_type: 'orch_reply',
      },
      {
        content_json: JSON.stringify({ text: 'historical answer two' }),
        created_at: 11,
        id: 'history-2',
        message_type: 'orch_reply',
      },
    ]
    view.rerender(React.createElement(TalkTab))
    await flush()

    expect(runtime.synthesizeVoiceStream).not.toHaveBeenCalled()
    expect(audioMock.player.play).not.toHaveBeenCalled()

    runtime.chatMessages = [
      ...runtime.chatMessages,
      {
        content_json: JSON.stringify({ text: 'new live answer' }),
        created_at: 12,
        id: 'live-1',
        message_type: 'orch_reply',
      },
    ]
    view.rerender(React.createElement(TalkTab))

    await waitFor(() =>
      expect(runtime.synthesizeVoiceStream).toHaveBeenCalledWith('new live answer', {
        voice: 'zh-CN-YunxiNeural',
      })
    )
    expect(runtime.synthesizeVoiceStream).not.toHaveBeenCalledWith('historical answer one')
    expect(runtime.synthesizeVoiceStream).not.toHaveBeenCalledWith('historical answer two')
  })

  test('plays multiple orchestrator replies from one turn before reopening the microphone', async () => {
    const view = render(React.createElement(TalkTab))

    fireEvent.click(screen.getByText('talk.mode.continuous'))
    await waitFor(() => expect(audioMock.recorder.prepareToRecordAsync).toHaveBeenCalledTimes(1))
    await finishCurrentPhrase(view)
    runtime.chatMessages = [
      {
        content_json: JSON.stringify({ text: 'first streamed sentence' }),
        created_at: 2,
        id: 'reply-1',
        message_type: 'orch_reply',
      },
      {
        content_json: JSON.stringify({ text: 'second streamed sentence' }),
        created_at: 3,
        id: 'reply-2',
        message_type: 'orch_reply',
      },
    ]
    view.rerender(React.createElement(TalkTab))

    await waitFor(() =>
      expect(runtime.synthesizeVoiceStream).toHaveBeenCalledWith('first streamed sentence', {
        voice: 'zh-CN-YunxiNeural',
      })
    )
    expect(runtime.synthesizeVoice).not.toHaveBeenCalled()
    expect(audioMock.player.replace).toHaveBeenCalledWith({
      uri: 'data:audio/wav;base64,stream-audio',
    })
    expect(audioMock.setAudioModeAsync).toHaveBeenCalledWith({
      allowsRecording: true,
      playsInSilentMode: true,
    })
    expect(audioMock.recorderStatus.isRecording).toBe(true)

    await act(async () => {
      Object.assign(audioMock.playerStatus, { didJustFinish: true, isLoaded: true })
      view.rerender(React.createElement(TalkTab))
    })

    await waitFor(() =>
      expect(runtime.synthesizeVoiceStream).toHaveBeenCalledWith('second streamed sentence', {
        voice: 'zh-CN-YunxiNeural',
      })
    )
    expect(audioMock.recorder.prepareToRecordAsync).toHaveBeenCalledTimes(2)
    expect(audioMock.recorderStatus.isRecording).toBe(true)
  })

  test('drops stale synthesized audio after playback is stopped before synthesis resolves', async () => {
    const synthesized = deferred<{ audio: string; format: string; mime: string }>()
    runtime.synthesizeVoiceStream = vi.fn().mockReturnValue(synthesized.promise)
    const view = render(React.createElement(TalkTab))

    fireEvent.click(screen.getByText('talk.mode.continuous'))
    await waitFor(() => expect(audioMock.recorder.prepareToRecordAsync).toHaveBeenCalledTimes(1))
    await finishCurrentPhrase(view)
    runtime.chatMessages = [
      {
        content_json: JSON.stringify({ text: 'stale reply' }),
        created_at: 2,
        id: 'reply-stale',
        message_type: 'orch_reply',
      },
    ]
    view.rerender(React.createElement(TalkTab))
    await waitFor(() =>
      expect(runtime.synthesizeVoiceStream).toHaveBeenCalledWith('stale reply', {
        voice: 'zh-CN-YunxiNeural',
      })
    )

    fireEvent.click(screen.getByText('talk.stopPlayback'))
    await act(async () => {
      synthesized.resolve({ audio: 'stale-audio', format: 'wav', mime: 'audio/wav' })
      await synthesized.promise
    })
    await flush()

    expect(audioMock.player.replace).not.toHaveBeenCalled()
    expect(audioMock.player.play).not.toHaveBeenCalled()
  })

  test('falls back to legacy synthesis when streamed talkback synthesis is unavailable', async () => {
    runtime.synthesizeVoiceStream = vi.fn().mockResolvedValue(null)
    runtime.synthesizeVoice = vi
      .fn()
      .mockResolvedValue({ audio: 'fallback-audio', format: 'wav', mime: 'audio/wav' })
    const view = render(React.createElement(TalkTab))

    fireEvent.click(screen.getByText('talk.mode.continuous'))
    await waitFor(() => expect(audioMock.recorder.prepareToRecordAsync).toHaveBeenCalledTimes(1))
    await finishCurrentPhrase(view)
    runtime.chatMessages = [
      {
        content_json: JSON.stringify({ text: 'fallback reply' }),
        created_at: 2,
        id: 'reply-fallback',
        message_type: 'orch_reply',
      },
    ]
    view.rerender(React.createElement(TalkTab))

    await waitFor(() =>
      expect(runtime.synthesizeVoiceStream).toHaveBeenCalledWith('fallback reply', {
        voice: 'zh-CN-YunxiNeural',
      })
    )
    await waitFor(() =>
      expect(runtime.synthesizeVoice).toHaveBeenCalledWith('fallback reply', {
        voice: 'zh-CN-YunxiNeural',
      })
    )
    expect(audioMock.player.replace).toHaveBeenCalledWith({
      uri: 'data:audio/wav;base64,fallback-audio',
    })
    expect(audioMock.player.play).toHaveBeenCalled()
  })

  test('stops active talkback playback without replaying the same reply', async () => {
    const view = render(React.createElement(TalkTab))

    fireEvent.mouseDown(screen.getByText('talk.button.hold'))
    await waitFor(() => expect(audioMock.recorder.prepareToRecordAsync).toHaveBeenCalledTimes(1))
    fireEvent.mouseUp(screen.getByText('talk.button.release'))
    await waitFor(() => expect(runtime.sendPromptToOrchestratorWithOutcome).toHaveBeenCalled())
    runtime.chatMessages = [
      {
        content_json: JSON.stringify({ text: 'long reply that needs manual stop' }),
        created_at: 2,
        id: 'manual-stop-reply',
        message_type: 'orch_reply',
      },
    ]
    view.rerender(React.createElement(TalkTab))

    await waitFor(() =>
      expect(runtime.synthesizeVoiceStream).toHaveBeenCalledWith(
        'long reply that needs manual stop',
        {
          voice: 'zh-CN-YunxiNeural',
        }
      )
    )
    await waitFor(() => expect(audioMock.player.play).toHaveBeenCalledTimes(1))
    expect(screen.getByText('talk.state.speaking')).toBeTruthy()
    audioMock.player.pause.mockClear()

    fireEvent.click(screen.getByText('talk.stopPlayback'))
    await flush()
    view.rerender(React.createElement(TalkTab))
    await flush()

    expect(audioMock.player.pause).toHaveBeenCalledTimes(1)
    expect(screen.getByText('talk.state.idle')).toBeTruthy()
    expect(runtime.synthesizeVoiceStream).toHaveBeenCalledTimes(1)
    expect(audioMock.player.play).toHaveBeenCalledTimes(1)
  })
})
