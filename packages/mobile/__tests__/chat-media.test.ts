import { describe, expect, it } from 'vitest'

import {
  buildChatMediaEnvelopeJson,
  CHAT_VIDEO_UPLOAD_LIMIT_BYTES,
  extractChatMediaItems,
  isChatMediaImage,
  isChatMediaVideo,
  isPickedVideoOverLimit,
  normalizePickedMediaAttachment,
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

  it('classifies video attachments separately from images and generic files', () => {
    expect(
      isChatMediaVideo({ filename: 'clip.mp4', mime_type: 'video/mp4', url: 'file:///clip.mp4' })
    ).toBe(true)
    expect(
      isChatMediaImage({ filename: 'clip.mp4', mime_type: 'video/mp4', url: 'file:///clip.mp4' })
    ).toBe(false)
    expect(
      isChatMediaVideo({ filename: 'photo.jpg', mime_type: 'image/jpeg', url: 'file:///photo.jpg' })
    ).toBe(false)
  })

  it('preserves picked video mime through the optimistic media envelope', () => {
    const json = buildChatMediaEnvelopeJson({
      attachments: [
        {
          filename: 'demo.mp4',
          mimeType: 'video/mp4',
          uri: 'file:///local/demo.mp4',
        },
      ],
      text: '看这个视频',
    })

    const [item] = extractChatMediaItems(json)
    expect(item?.filename).toBe('demo.mp4')
    expect(item?.mime_type).toBe('video/mp4')
    expect(isChatMediaVideo(item)).toBe(true)
  })

  it('keeps picked videos uploadable when ImagePicker does not provide base64 inline', async () => {
    const readUris: string[] = []
    const staged = await normalizePickedMediaAttachment(
      {
        fileName: 'library.mov',
        mimeType: 'video/quicktime',
        type: 'video',
        uri: 'file:///library.mov',
      },
      async (uri) => {
        readUris.push(uri)
        return 'video-base64'
      }
    )

    expect(readUris).toEqual(['file:///library.mov'])
    expect(staged).toEqual({
      base64: 'video-base64',
      filename: 'library.mov',
      mimeType: 'video/quicktime',
      uri: 'file:///library.mov',
    })
  })

  it('keeps picked images on the inline-base64 path without reading the file again', async () => {
    const staged = await normalizePickedMediaAttachment(
      {
        base64: 'image-base64',
        type: 'image',
        uri: 'file:///camera-roll/photo',
      },
      async () => {
        throw new Error('image with inline base64 should not be read from disk')
      }
    )

    expect(staged.base64).toBe('image-base64')
    expect(staged.filename).toMatch(/^media_\d+\.jpg$/u)
    expect(staged.mimeType).toBe('image/jpeg')
    expect(staged.uri).toBe('file:///camera-roll/photo')
  })

  it('flags only videos over 100MB before base64 reading', () => {
    expect(
      isPickedVideoOverLimit(
        { mimeType: 'video/mp4', type: 'video', uri: 'file:///large.mp4' },
        CHAT_VIDEO_UPLOAD_LIMIT_BYTES + 1
      )
    ).toBe(true)
    expect(
      isPickedVideoOverLimit(
        { mimeType: 'video/mp4', type: 'video', uri: 'file:///limit.mp4' },
        CHAT_VIDEO_UPLOAD_LIMIT_BYTES
      )
    ).toBe(false)
    expect(
      isPickedVideoOverLimit(
        { mimeType: 'image/jpeg', type: 'image', uri: 'file:///large.jpg' },
        CHAT_VIDEO_UPLOAD_LIMIT_BYTES + 1
      )
    ).toBe(false)
  })
})
