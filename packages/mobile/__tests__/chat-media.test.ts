import { describe, expect, it } from 'vitest'

import {
  buildChatMediaEnvelopeJson,
  extractChatMediaItems,
  type PendingChatAttachment,
} from '../src/lib/chat-media'

const attachment = (n: number): PendingChatAttachment => ({
  filename: `photo-${n}.jpg`,
  mimeType: 'image/jpeg',
  uri: `file:///local/photo-${n}.jpg`,
})

describe('chat-media multi-image round-trip (#24)', () => {
  it('carries ALL N attachments through the optimistic envelope (N images → N items, no uri loss)', () => {
    const attachments = [attachment(1), attachment(2), attachment(3)]
    const json = buildChatMediaEnvelopeJson({ attachments, text: '' })

    const items = extractChatMediaItems(json)
    expect(items).toHaveLength(3)
    expect(items.map((i) => i.url)).toEqual([
      'file:///local/photo-1.jpg',
      'file:///local/photo-2.jpg',
      'file:///local/photo-3.jpg',
    ])
    expect(items.every((i) => i.mime_type === 'image/jpeg')).toBe(true)
  })

  it('keeps the caption text alongside the attachments', () => {
    const json = buildChatMediaEnvelopeJson({ attachments: [attachment(1)], text: '看这张' })
    expect(JSON.parse(json).text).toBe('看这张')
    expect(extractChatMediaItems(json)).toHaveLength(1)
  })

  it('a single attachment yields exactly one item', () => {
    const json = buildChatMediaEnvelopeJson({ attachments: [attachment(1)], text: '' })
    expect(extractChatMediaItems(json)).toHaveLength(1)
  })

  it('a text-only message has no media items (bubble renders text, not an empty green box)', () => {
    expect(extractChatMediaItems(JSON.stringify({ text: 'hello' }))).toEqual([])
  })

  it('still reads the legacy single `media` shape (back-compat with older messages)', () => {
    const legacy = JSON.stringify({
      media: { filename: 'old.png', mime_type: 'image/png', url: 'file:///old.png' },
      text: '',
    })
    const items = extractChatMediaItems(legacy)
    expect(items).toHaveLength(1)
    expect(items[0]?.url).toBe('file:///old.png')
  })

  it('drops malformed entries instead of rendering empty boxes', () => {
    const mixed = JSON.stringify({
      attachments: [
        { filename: 'ok.jpg', mime_type: 'image/jpeg', url: 'file:///ok.jpg' },
        { filename: 'broken.jpg' }, // missing mime_type + url
      ],
    })
    expect(extractChatMediaItems(mixed)).toHaveLength(1)
  })
})
