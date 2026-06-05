import { createUuid } from './uuid'

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

// 必须产出**可靠唯一** id（BLOCKING 修复）：id 现在是 outbox 去重键（按 id 去重），id 不唯一会重新制造
// 「同毫秒两条合法消息撞同 id 被静默误删」——正是去重要解的 bug。优先 crypto.randomUUID；RN 入口只
// 保证 getRandomValues（不保证 randomUUID），故次选用 getRandomValues 拼 UUIDv4；再不行带单调 counter。
const randomId = createUuid

const normalizeStatus = (status: unknown): MobileOutboxItemStatus => {
  if (status === 'queued' || status === 'sending' || status === 'failed') return status
  return 'queued'
}

const normalizeAttempts = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0

const normalizeString = (value: unknown) => (typeof value === 'string' ? value : '')

const normalizeObject = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : null

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

// HIGH 修复：按**幂等标识 item.id** 去重，不再用文本 fingerprint(kind:ws:text)。文本去重会把用户
// 连发的两条相同内容的合法消息（"好的"/"好的"）静默丢一条。每次入队 createXxxOutboxItem 生成唯一 id
// （重发 replay 复用原 item、id 不变 → 仍幂等不重复入队）；clientNonce 落地后由 id 承载更强幂等键。
export const enqueueOutboxItem = (state: MobileOutboxState, item: MobileOutboxItem) => {
  if (state.items.some((existing) => existing.id === item.id)) return state
  return { items: [...state.items, item] }
}

export const retryFailedOutboxItems = (state: MobileOutboxState): MobileOutboxState => ({
  items: state.items.map((item) =>
    item.status === 'failed' ? { ...item, lastError: null, status: 'queued' as const } : item
  ),
})

export const clearFailedOutboxItems = (state: MobileOutboxState): MobileOutboxState => ({
  items: state.items.filter((item) => item.status !== 'failed'),
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
      if (items.some((existing) => existing.id === item.id)) continue
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

export interface OutboxFlushFailure {
  error: string
  id: string
}

export interface OutboxFlushOutcome {
  // flush 期间确实发出去（应被移除）的 item id。
  sentIds: string[]
  // 本次 flush 中发送失败的 item（可多条——单条失败不再整队中止，HIGH 修复）。
  failedItems: OutboxFlushFailure[]
}

// 把一次 flush 的结果**函数式合并**回当前 state：只移除确实发出去的 id、标记失败项（含 attempts+1），
// **保留其余所有项**（关键：flush 期间用户并发入队的新 item 不会被覆盖丢失）。修复
// mobile-runtime-context flushOutbox 的 value-set clobber 竞态（CRITICAL：并发消息静默丢失）。
export const applyOutboxFlushResult = (
  state: MobileOutboxState,
  outcome: OutboxFlushOutcome
): MobileOutboxState => {
  const sent = new Set(outcome.sentIds)
  const failedById = new Map(outcome.failedItems.map((failure) => [failure.id, failure.error]))
  return {
    items: state.items
      .filter((item) => !sent.has(item.id))
      .map((item) =>
        failedById.has(item.id)
          ? {
              ...item,
              attempts: item.attempts + 1,
              lastError: failedById.get(item.id) ?? null,
              status: 'failed' as const,
            }
          : item
      ),
  }
}

export const flushOutboxState = async (
  state: MobileOutboxState,
  sendItem: (item: MobileOutboxItem) => Promise<void>
): Promise<{
  failedItems: OutboxFlushFailure[]
  sentCount: number
  sentIds: string[]
  state: MobileOutboxState
}> => {
  let nextState = state
  const sentIds: string[] = []
  const failedItems: OutboxFlushFailure[] = []

  // 只挑 'queued' 项逐条发送。HIGH 修复：单条失败标记 failed 后**继续后续 queued 项**（不再整队 break）；
  // 队头若是历史 'failed' 项也被跳过（不阻塞后面的 queued）。每条处理后状态都不再是 'queued'
  // （成功→移除 / 失败→'failed'），故循环必然收敛、无死循环。
  while (true) {
    const current = nextState.items.find((item) => item.status === 'queued')
    if (!current) break

    nextState = markOutboxItemSending(nextState, current.id)
    try {
      await sendItem(current)
      nextState = removeOutboxItem(nextState, current.id)
      sentIds.push(current.id)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      nextState = markOutboxItemFailed(nextState, current.id, message)
      failedItems.push({ error: message, id: current.id })
    }
  }

  return { failedItems, sentCount: sentIds.length, sentIds, state: nextState }
}

// 并发安全的 flush 编排：对**快照**发送，但通过 `commit` 函数式回写（只删已发 id、标失败项、保留并发新增）。
// context 的 flushOutbox 委托到此，确保「快照发送 + 函数式合并」这条命脉路径被测试覆盖（防 value-set clobber）。
export const flushOutboxConcurrently = async (
  snapshot: MobileOutboxState,
  sendItem: (item: MobileOutboxItem) => Promise<void>,
  commit: (updater: (current: MobileOutboxState) => MobileOutboxState) => void
): Promise<{ sentCount: number }> => {
  const { failedItems, sentCount, sentIds } = await flushOutboxState(snapshot, sendItem)
  commit((current) => applyOutboxFlushResult(current, { failedItems, sentIds }))
  return { sentCount }
}
