export type MobileOutboxOperationKind = 'approval' | 'dispatch' | 'prompt'
export type MobileOutboxItemStatus = 'failed' | 'queued' | 'sending'

export interface MobileOutboxPromptPayload {
  text: string
}

export interface MobileOutboxDispatchPayload {
  task: string
  workerId: string
}

export interface MobileOutboxApprovalPayload {
  approvalId: string
  decision: 'allow' | 'deny'
}

export interface MobileOutboxBaseItem {
  attempts: number
  createdAt: number
  id: string
  kind: MobileOutboxOperationKind
  lastError?: string | null
  status: MobileOutboxItemStatus
  workspaceId: string
}

export interface MobileOutboxPromptItem extends MobileOutboxBaseItem {
  kind: 'prompt'
  payload: MobileOutboxPromptPayload
}

export interface MobileOutboxDispatchItem extends MobileOutboxBaseItem {
  kind: 'dispatch'
  payload: MobileOutboxDispatchPayload
}

export interface MobileOutboxApprovalItem extends MobileOutboxBaseItem {
  kind: 'approval'
  payload: MobileOutboxApprovalPayload
}

export type MobileOutboxItem =
  | MobileOutboxApprovalItem
  | MobileOutboxDispatchItem
  | MobileOutboxPromptItem

export interface MobileOutboxState {
  items: MobileOutboxItem[]
}

export interface MobileOutboxCounts {
  failedCount: number
  queuedCount: number
  sendingCount: number
}

export const MOBILE_OUTBOX_STORAGE_KEY = 'hippoteam.mobileOutbox'

const randomId = () => globalThis.crypto?.randomUUID?.() ?? `outbox-${Date.now()}`

const normalizeStatus = (status: unknown): MobileOutboxItemStatus => {
  if (status === 'queued' || status === 'sending' || status === 'failed') return status
  return 'queued'
}

const normalizeAttempts = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0

const normalizeString = (value: unknown) => (typeof value === 'string' ? value : '')

const normalizeObject = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : null

const fingerprint = (item: MobileOutboxItem) => {
  if (item.kind === 'prompt') return `${item.kind}:${item.workspaceId}:${item.payload.text}`
  if (item.kind === 'dispatch') {
    return `${item.kind}:${item.workspaceId}:${item.payload.workerId}:${item.payload.task}`
  }
  return `${item.kind}:${item.workspaceId}:${item.payload.approvalId}:${item.payload.decision}`
}

const normalizeItem = (input: unknown): MobileOutboxItem | null => {
  const value = normalizeObject(input)
  if (!value) return null
  const kind = normalizeString(value.kind) as MobileOutboxOperationKind
  const status = normalizeStatus(value.status)
  const workspaceId = normalizeString(value.workspaceId)
  const id = normalizeString(value.id) || randomId()
  const createdAtRaw = value.createdAt
  const createdAt =
    typeof createdAtRaw === 'number' && Number.isFinite(createdAtRaw) ? createdAtRaw : Date.now()
  const attempts = normalizeAttempts(value.attempts)
  const lastErrorRaw = value.lastError
  const lastError = typeof lastErrorRaw === 'string' ? lastErrorRaw : null

  if (!workspaceId || !kind) return null

  if (kind === 'prompt') {
    const payload = normalizeObject(value.payload)
    const text = normalizeString(payload?.text)
    if (!text) return null
    return {
      attempts,
      createdAt,
      id,
      kind,
      lastError,
      payload: { text },
      status,
      workspaceId,
    }
  }

  if (kind === 'dispatch') {
    const payload = normalizeObject(value.payload)
    const task = normalizeString(payload?.task)
    const workerId = normalizeString(payload?.workerId)
    if (!task || !workerId) return null
    return {
      attempts,
      createdAt,
      id,
      kind,
      lastError,
      payload: { task, workerId },
      status,
      workspaceId,
    }
  }

  if (kind === 'approval') {
    const payload = normalizeObject(value.payload)
    const approvalId = normalizeString(payload?.approvalId)
    const decision = normalizeString(payload?.decision) as 'allow' | 'deny'
    if (!approvalId || (decision !== 'allow' && decision !== 'deny')) return null
    return {
      attempts,
      createdAt,
      id,
      kind,
      lastError,
      payload: { approvalId, decision },
      status,
      workspaceId,
    }
  }

  return null
}

export const createMobileOutboxState = (): MobileOutboxState => ({ items: [] })

export const createPromptOutboxItem = (
  input: {
    text: string
    workspaceId: string
  },
  options: { createdAt?: number; id?: string; status?: MobileOutboxItemStatus } = {}
): MobileOutboxPromptItem => ({
  attempts: 0,
  createdAt: options.createdAt ?? Date.now(),
  id: options.id ?? randomId(),
  kind: 'prompt',
  payload: { text: input.text },
  status: options.status ?? 'queued',
  workspaceId: input.workspaceId,
})

export const createDispatchOutboxItem = (
  input: {
    task: string
    workerId: string
    workspaceId: string
  },
  options: { createdAt?: number; id?: string; status?: MobileOutboxItemStatus } = {}
): MobileOutboxDispatchItem => ({
  attempts: 0,
  createdAt: options.createdAt ?? Date.now(),
  id: options.id ?? randomId(),
  kind: 'dispatch',
  payload: { task: input.task, workerId: input.workerId },
  status: options.status ?? 'queued',
  workspaceId: input.workspaceId,
})

export const createApprovalOutboxItem = (
  input: {
    approvalId: string
    decision: 'allow' | 'deny'
    workspaceId: string
  },
  options: { createdAt?: number; id?: string; status?: MobileOutboxItemStatus } = {}
): MobileOutboxApprovalItem => ({
  attempts: 0,
  createdAt: options.createdAt ?? Date.now(),
  id: options.id ?? randomId(),
  kind: 'approval',
  payload: { approvalId: input.approvalId, decision: input.decision },
  status: options.status ?? 'queued',
  workspaceId: input.workspaceId,
})

export const getOutboxCounts = (state: MobileOutboxState): MobileOutboxCounts =>
  state.items.reduce<MobileOutboxCounts>(
    (counts, item) => {
      if (item.status === 'failed') counts.failedCount += 1
      if (item.status === 'queued') counts.queuedCount += 1
      if (item.status === 'sending') counts.sendingCount += 1
      return counts
    },
    { failedCount: 0, queuedCount: 0, sendingCount: 0 }
  )

export const hasQueuedOutboxItems = (state: MobileOutboxState) =>
  state.items.some((item) => item.status === 'queued')

export const enqueueOutboxItem = (state: MobileOutboxState, item: MobileOutboxItem) => {
  const key = fingerprint(item)
  if (state.items.some((existing) => fingerprint(existing) === key)) return state
  return { items: [...state.items, item] }
}

export const retryFailedOutboxItems = (state: MobileOutboxState): MobileOutboxState => ({
  items: state.items.map((item) =>
    item.status === 'failed' ? { ...item, lastError: null, status: 'queued' as const } : item
  ),
})

export const serializeOutboxState = (state: MobileOutboxState) => JSON.stringify(state.items)

export const parseOutboxState = (serialized: string | null): MobileOutboxState => {
  if (!serialized) return createMobileOutboxState()
  try {
    const parsed = JSON.parse(serialized) as unknown
    if (!Array.isArray(parsed)) return createMobileOutboxState()
    const items: MobileOutboxItem[] = []
    for (const entry of parsed) {
      const item = normalizeItem(entry)
      if (!item) continue
      if (item.status === 'sending') {
        items.push({ ...item, status: 'queued' })
        continue
      }
      if (items.some((existing) => fingerprint(existing) === fingerprint(item))) continue
      items.push(item)
    }
    return { items }
  } catch {
    return createMobileOutboxState()
  }
}

export const markOutboxItemSending = (
  state: MobileOutboxState,
  itemId: string
): MobileOutboxState => ({
  items: state.items.map((item) =>
    item.id === itemId
      ? { ...item, attempts: item.attempts + 1, lastError: null, status: 'sending' }
      : item
  ),
})

export const markOutboxItemFailed = (
  state: MobileOutboxState,
  itemId: string,
  error: string
): MobileOutboxState => ({
  items: state.items.map((item) =>
    item.id === itemId
      ? {
          ...item,
          lastError: error,
          status: 'failed',
        }
      : item
  ),
})

export const removeOutboxItem = (state: MobileOutboxState, itemId: string): MobileOutboxState => ({
  items: state.items.filter((item) => item.id !== itemId),
})

export const flushOutboxState = async (
  state: MobileOutboxState,
  sendItem: (item: MobileOutboxItem) => Promise<void>
): Promise<{ sentCount: number; state: MobileOutboxState }> => {
  let nextState = state
  let sentCount = 0

  while (true) {
    const current = nextState.items.find((item) => item.status !== 'sending')
    if (!current) break
    if (current.status === 'failed') break

    nextState = markOutboxItemSending(nextState, current.id)
    try {
      await sendItem(current)
      nextState = removeOutboxItem(nextState, current.id)
      sentCount += 1
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      nextState = markOutboxItemFailed(nextState, current.id, message)
      break
    }
  }

  return { sentCount, state: nextState }
}
