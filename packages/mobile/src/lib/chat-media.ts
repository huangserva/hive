export interface ChatMediaItem {
  file_id?: string
  filename: string
  mime_type: string
  size?: number
  url: string
}

export interface PendingChatAttachment {
  filename: string
  mimeType: string
  size?: number
  uri: string
}

interface ChatMediaEnvelope {
  attachments?: unknown
  media?: unknown
  media_items?: unknown
  text?: unknown
}

const isChatMediaItem = (value: unknown): value is ChatMediaItem => {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<ChatMediaItem>
  return (
    typeof candidate.filename === 'string' &&
    candidate.filename.trim().length > 0 &&
    typeof candidate.mime_type === 'string' &&
    candidate.mime_type.trim().length > 0 &&
    typeof candidate.url === 'string' &&
    candidate.url.trim().length > 0
  )
}

const normalizeItems = (value: unknown): ChatMediaItem[] => {
  if (Array.isArray(value)) return value.filter(isChatMediaItem)
  if (isChatMediaItem(value)) return [value]
  return []
}

const parseEnvelope = (json: string): ChatMediaEnvelope | null => {
  try {
    const parsed = JSON.parse(json) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as ChatMediaEnvelope
  } catch {
    return null
  }
}

export const extractChatMediaItems = (json: string): ChatMediaItem[] => {
  const parsed = parseEnvelope(json)
  if (!parsed) return []
  const attachments = normalizeItems(parsed.attachments)
  if (attachments.length > 0) return attachments
  const mediaItems = normalizeItems(parsed.media_items)
  if (mediaItems.length > 0) return mediaItems
  return normalizeItems(parsed.media)
}

export const buildChatMediaEnvelopeJson = ({
  attachments,
  text,
}: {
  attachments: PendingChatAttachment[]
  text: string
}) => {
  const media = attachments.map((attachment, index) => ({
    file_id: `local-${index}`,
    filename: attachment.filename,
    mime_type: attachment.mimeType,
    size: attachment.size,
    url: attachment.uri,
  }))
  const normalizedText = text.trim()
  return JSON.stringify({
    attachments: media,
    media: media[0] ?? null,
    text: normalizedText || (media.length > 1 ? `[${media.length} attachments]` : ''),
  })
}
