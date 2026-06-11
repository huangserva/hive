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

export interface PickedMediaAssetInput {
  base64?: null | string
  fileName?: null | string
  mimeType?: null | string
  type?: null | string
  uri: string
}

export interface StagedChatAttachment extends PendingChatAttachment {
  base64: string
}

export const CHAT_VIDEO_UPLOAD_LIMIT_BYTES = 100 * 1024 * 1024

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

const normalizeMimeType = (mimeType: string | undefined) => mimeType?.trim().toLowerCase() ?? ''

export const isChatMediaImage = (media: Pick<ChatMediaItem, 'mime_type'> | null | undefined) =>
  normalizeMimeType(media?.mime_type).startsWith('image/')

export const isChatMediaVideo = (media: Pick<ChatMediaItem, 'mime_type'> | null | undefined) =>
  normalizeMimeType(media?.mime_type).startsWith('video/')

export const isPickedMediaVideo = (asset: PickedMediaAssetInput) =>
  asset.type === 'video' || normalizeMimeType(asset.mimeType).startsWith('video/')

export const isPickedVideoOverLimit = (
  asset: PickedMediaAssetInput,
  size: number | null | undefined,
  limitBytes = CHAT_VIDEO_UPLOAD_LIMIT_BYTES
) => isPickedMediaVideo(asset) && typeof size === 'number' && size > limitBytes

export const normalizePickedMediaAttachment = async (
  asset: PickedMediaAssetInput,
  readBase64: (uri: string) => Promise<string>
): Promise<StagedChatAttachment> => {
  const isVideo = isPickedMediaVideo(asset)
  const fallbackExt = isVideo ? 'mp4' : 'jpg'
  return {
    base64: asset.base64 ?? (await readBase64(asset.uri)),
    filename: asset.fileName ?? `media_${Date.now()}.${fallbackExt}`,
    mimeType: asset.mimeType ?? (isVideo ? 'video/mp4' : 'image/jpeg'),
    uri: asset.uri,
  }
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
