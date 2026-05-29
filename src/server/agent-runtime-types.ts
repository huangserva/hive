import type { AgentRunSnapshot } from './agent-manager.js'

export interface LiveAgentRun extends AgentRunSnapshot {
  startedAt: number
  // 首次落库的结束时间；终态后复用它，避免后续 syncPersistedRun 反复把 endedAt 刷成当前时间（bug #1）。
  endedAt?: number
  // stop 已发起但 PTY 尚未退出的标记；置位后该 run 不再算活跃，使紧随其后的 start 跳过去重正常 spawn（bug #7）。
  stopRequested?: boolean
}
