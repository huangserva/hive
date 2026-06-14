/**
 * `MessageCard` 的 React.memo 自定义比较器：只在 message 实质字段或 prop 引用
 * 真变化时返回 false（要重渲染）；否则返回 true（跳过渲染）。
 *
 * 治"轮询/incoming 让 allMessages 换新数组身份就整列 MessageCard 重渲染 → 媒体
 * 重 mount 重测高"的 churn——上轮自动滚动修了拽底，本轮把残留的"渲染抖一下"
 * 顺势焊死。
 *
 * 比较器只关心"会影响渲染的字段"：id / message_type / content_json / created_at /
 * pending / queued / error。其它字段（如 workspaceId/direction 是路由分支的元信息）
 * 也加进来以防漏（typing 联合类型里它们都有）。
 *
 * 注意：onApprove/onOpenApproval/onPreviewImage/onPreviewVideo 必须是父组件
 * useCallback 稳定引用——否则比较器会误判"prop 引用变了"必重渲染，memo 等于白搭。
 *
 * **workers 比较收敛**（2026-06-14 钟馗 blocking 焊死）：
 *   dashboard.workers 每次 WS 推送 / refreshDashboard 都新数组引用（见
 *   mobile-runtime-context.tsx:569-580 / :1883-1884），useMemo([dashboard?.workers])
 *   只稳得住 null fallback，稳不住"内容相同新引用"。如果所有 message_type 都比
 *   workers ref，每条 MessageCard 都不等 → 整列重渲 → memo 失效。
 *
 *   只有 `worker_report` 分支真消费 workers（index.tsx:workerReportItems 渲染网格）；
 *   其它 message_type 完全不读 workers，引用变也不影响渲染。比较器随之分流：
 *     - prev/next 任一 message_type === 'worker_report' → 比 workers 引用
 *     - 其它（user_text / orch_reply / system_event / approval_request 等）→ **忽略 workers**
 *   这条收敛是本轮 churn 真治住的命门，反向"无条件比 workers"必触发回归测红。
 */

export interface MessageCardMessageLike {
  id: string
  message_type: string
  content_json: string
  created_at: number
  workspaceId?: string
  direction?: 'inbound' | 'outbound'
  pending?: boolean
  queued?: boolean
  error?: boolean
}

export interface MessageCardPropsForEquality<M extends MessageCardMessageLike> {
  message: M
  onApprove: unknown
  onOpenApproval: unknown
  onPreviewImage: unknown
  onPreviewVideo: unknown
  runtimeHost: string
  token: string
  workers: readonly unknown[]
}

const WORKER_REPORT_TYPE = 'worker_report'

/**
 * 决策表：
 * - message.id 变 → 不等（不同消息了）
 * - message.content_json 变 → 不等（内容更新，比如 worker_report 补字段）
 * - message.message_type 变 → 不等（路由分支变了）
 * - message.created_at 变 → 不等（时间戳是渲染元素之一）
 * - message.pending / queued / error 变 → 不等（footer 图标变）
 * - workspaceId / direction 变 → 不等（路由分支）
 * - runtimeHost / token / 4 个 callback 任一引用变 → 不等
 * - **workers 引用变**：仅在 prev/next 任一 message_type === 'worker_report' 时检查
 *   （其它消息不读 workers，引用变也不影响渲染——见模块头部 workers 比较收敛说明）
 * - 都没变 → 相等，跳过渲染
 */
export const areMessageCardPropsEqual = <M extends MessageCardMessageLike>(
  prev: MessageCardPropsForEquality<M>,
  next: MessageCardPropsForEquality<M>
): boolean => {
  const pm = prev.message
  const nm = next.message
  if (pm.id !== nm.id) return false
  if (pm.message_type !== nm.message_type) return false
  if (pm.content_json !== nm.content_json) return false
  if (pm.created_at !== nm.created_at) return false
  if (pm.pending !== nm.pending) return false
  if (pm.queued !== nm.queued) return false
  if (pm.error !== nm.error) return false
  if (pm.workspaceId !== nm.workspaceId) return false
  if (pm.direction !== nm.direction) return false
  if (prev.runtimeHost !== next.runtimeHost) return false
  if (prev.token !== next.token) return false
  if (prev.onApprove !== next.onApprove) return false
  if (prev.onOpenApproval !== next.onOpenApproval) return false
  if (prev.onPreviewImage !== next.onPreviewImage) return false
  if (prev.onPreviewVideo !== next.onPreviewVideo) return false
  // workers 比较收敛：只 worker_report 才看引用
  const consumesWorkers =
    pm.message_type === WORKER_REPORT_TYPE || nm.message_type === WORKER_REPORT_TYPE
  if (consumesWorkers && prev.workers !== next.workers) return false
  return true
}
