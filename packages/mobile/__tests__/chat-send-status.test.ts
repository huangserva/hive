import { describe, expect, test } from 'vitest'

import { resolveChatSendOutcome } from '../src/lib/chat-send-status'

describe('resolveChatSendOutcome', () => {
  test('reports sent when the server ack succeeds', () => {
    expect(
      resolveChatSendOutcome({ queued: false, sendSucceeded: true, syncSucceeded: false })
    ).toBe('sent')
  })

  test('reports queued when delivery is deferred but not failed', () => {
    expect(
      resolveChatSendOutcome({ queued: true, sendSucceeded: false, syncSucceeded: false })
    ).toBe('queued')
  })

  test('reports error only when the send genuinely fails', () => {
    expect(
      resolveChatSendOutcome({ queued: false, sendSucceeded: false, syncSucceeded: false })
    ).toBe('error')
  })
})
