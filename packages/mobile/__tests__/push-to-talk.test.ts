import { describe, expect, test, vi } from 'vitest'

import {
  findNextTalkbackReply,
  reduceTalkbackState,
  runTalkbackInput,
} from '../src/lib/push-to-talk'

describe('push-to-talk phase 1 logic', () => {
  test('moves through recording, sending, waiting, speaking, and idle states', () => {
    expect(reduceTalkbackState('idle', { type: 'recordStart' })).toBe('recording')
    expect(reduceTalkbackState('recording', { type: 'recordStop' })).toBe('sending')
    expect(reduceTalkbackState('sending', { type: 'promptQueued' })).toBe(
      'waiting_for_orchestrator'
    )
    expect(reduceTalkbackState('waiting_for_orchestrator', { type: 'replyDetected' })).toBe(
      'speaking'
    )
    expect(reduceTalkbackState('speaking', { type: 'playbackFinished' })).toBe('idle')
  })

  test('keeps a failed recording visible instead of returning to idle silently', () => {
    expect(reduceTalkbackState('recording', { message: 'microphone denied', type: 'failed' })).toBe(
      'error'
    )
  })

  test('transcribes recorded audio and injects the transcript through orchestrator prompt path', async () => {
    const transcribeVoice = vi.fn().mockResolvedValue('check relay status')
    const sendPromptToOrchestratorWithOutcome = vi.fn().mockResolvedValue('sent')

    const outcome = await runTalkbackInput({
      audioBase64: 'base64-audio',
      format: 'm4a',
      sendPromptToOrchestratorWithOutcome,
      transcribeVoice,
    })

    expect(outcome).toEqual({ outcome: 'sent', text: 'check relay status' })
    expect(transcribeVoice).toHaveBeenCalledWith('base64-audio', 'm4a')
    expect(sendPromptToOrchestratorWithOutcome).toHaveBeenCalledWith('check relay status')
  })

  test('does not inject empty transcripts', async () => {
    const sendPromptToOrchestratorWithOutcome = vi.fn()

    await expect(
      runTalkbackInput({
        audioBase64: 'base64-audio',
        format: 'm4a',
        sendPromptToOrchestratorWithOutcome,
        transcribeVoice: vi.fn().mockResolvedValue('   '),
      })
    ).rejects.toThrowError(/no speech/i)
    expect(sendPromptToOrchestratorWithOutcome).not.toHaveBeenCalled()
  })

  test('selects only new orchestrator replies for talkback playback', () => {
    const reply = findNextTalkbackReply({
      enabled: true,
      lastSpokenReplyId: 'reply-1',
      messages: [
        {
          content_json: JSON.stringify({ text: 'first' }),
          created_at: 1,
          id: 'reply-1',
          message_type: 'orch_reply',
        },
        {
          content_json: JSON.stringify({ text: 'ignore user' }),
          created_at: 2,
          id: 'user-1',
          message_type: 'user_text',
        },
        {
          content_json: JSON.stringify({ text: 'new answer' }),
          created_at: 3,
          id: 'reply-2',
          message_type: 'orch_reply',
        },
      ],
    })

    expect(reply).toEqual({ id: 'reply-2', text: 'new answer' })
  })

  test('does not replay replies when talkback mode is disabled', () => {
    expect(
      findNextTalkbackReply({
        enabled: false,
        lastSpokenReplyId: null,
        messages: [
          {
            content_json: JSON.stringify({ text: 'new answer' }),
            created_at: 1,
            id: 'reply-1',
            message_type: 'orch_reply',
          },
        ],
      })
    ).toBeNull()
  })

  test('supports continuous hands-free loop back to listening after playback', () => {
    expect(reduceTalkbackState('idle', { type: 'continuousStart' })).toBe('listening')
    expect(reduceTalkbackState('listening', { type: 'voiceDetected' })).toBe('capturing')
    expect(reduceTalkbackState('capturing', { type: 'silenceDetected' })).toBe('processing')
    expect(reduceTalkbackState('processing', { type: 'replyDetected' })).toBe('speaking')
    expect(
      reduceTalkbackState('speaking', { continueListening: true, type: 'playbackFinished' })
    ).toBe('listening')
  })
})
