import { describe, expect, test, vi } from 'vitest'

import {
  findNextTalkbackReply,
  listPendingTalkbackReplies,
  reduceTalkbackState,
  runTalkbackInput,
  shouldFinishTalkbackReplyRound,
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

  test('legacy reply cursor never replays replies before the last spoken reply', () => {
    const reply = findNextTalkbackReply({
      enabled: true,
      lastSpokenReplyId: 'reply-2',
      messages: [
        {
          content_json: JSON.stringify({ text: 'oldest' }),
          created_at: 1,
          id: 'reply-1',
          message_type: 'orch_reply',
        },
        {
          content_json: JSON.stringify({ text: 'already spoken' }),
          created_at: 2,
          id: 'reply-2',
          message_type: 'orch_reply',
        },
        {
          content_json: JSON.stringify({ text: 'next answer' }),
          created_at: 3,
          id: 'reply-3',
          message_type: 'orch_reply',
        },
      ],
    })

    expect(reply).toEqual({ id: 'reply-3', text: 'next answer' })
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

  test('queues new orchestrator replies in stable order without replaying spoken or in-flight items', () => {
    const replies = listPendingTalkbackReplies({
      activePlaybackReplyId: 'reply-active',
      baselineReplyIds: new Set(['reply-before-prompt']),
      enabled: true,
      inFlightReplyId: 'reply-in-flight',
      messages: [
        {
          content_json: JSON.stringify({ text: 'already here' }),
          created_at: 1,
          id: 'reply-before-prompt',
          message_type: 'orch_reply',
        },
        {
          content_json: JSON.stringify({ text: 'third' }),
          created_at: 5,
          id: 'reply-c',
          message_type: 'orch_reply',
        },
        {
          content_json: JSON.stringify({ text: 'ignore user' }),
          created_at: 2,
          id: 'user-1',
          message_type: 'user_text',
        },
        {
          content_json: JSON.stringify({ text: 'second' }),
          created_at: 4,
          id: 'reply-b',
          message_type: 'orch_reply',
        },
        {
          content_json: JSON.stringify({ text: 'first' }),
          created_at: 3,
          id: 'reply-a',
          message_type: 'orch_reply',
        },
        {
          content_json: JSON.stringify({ text: 'spoken' }),
          created_at: 6,
          id: 'reply-spoken',
          message_type: 'orch_reply',
        },
        {
          content_json: JSON.stringify({ text: 'in flight' }),
          created_at: 7,
          id: 'reply-in-flight',
          message_type: 'orch_reply',
        },
        {
          content_json: JSON.stringify({ text: 'active' }),
          created_at: 8,
          id: 'reply-active',
          message_type: 'orch_reply',
        },
      ],
      spokenReplyIds: new Set(['reply-spoken']),
    })

    expect(replies.map((reply) => reply.id)).toEqual(['reply-a', 'reply-b', 'reply-c'])
    expect(replies.map((reply) => reply.text)).toEqual(['first', 'second', 'third'])
  })

  test('finishes a talkback reply round only after the post-playback quiet window', () => {
    expect(
      shouldFinishTalkbackReplyRound({
        activePlaybackReplyId: null,
        idleTimeoutMs: 3500,
        inFlightReplyId: null,
        lastPlaybackFinishedAtMs: 10_000,
        nowMs: 12_000,
        pendingReplyCount: 0,
      })
    ).toBe(false)

    expect(
      shouldFinishTalkbackReplyRound({
        activePlaybackReplyId: null,
        idleTimeoutMs: 3500,
        inFlightReplyId: null,
        lastPlaybackFinishedAtMs: 10_000,
        nowMs: 13_600,
        pendingReplyCount: 0,
      })
    ).toBe(true)

    expect(
      shouldFinishTalkbackReplyRound({
        activePlaybackReplyId: null,
        idleTimeoutMs: 3500,
        inFlightReplyId: null,
        lastPlaybackFinishedAtMs: 10_000,
        nowMs: 20_000,
        pendingReplyCount: 1,
      })
    ).toBe(false)
  })
})
