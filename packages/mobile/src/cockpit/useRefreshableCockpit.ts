import { useCallback, useEffect, useRef, useState } from 'react'

import { useMobileRuntime } from '../api/mobile-runtime-context'
import {
  initialRefreshable,
  onFetchFailure,
  onFetchStart,
  onFetchSuccess,
  type RefreshableState,
} from './refreshable-state'

export interface RefreshableCockpit<T> extends RefreshableState<T> {
  onRefresh: () => void
}

// cockpit 5 个标签页共用的加载 hook：首次 loading、有数据后 refetch 只 refreshing 不清数据、
// 失败保留旧数据。随 context 的 syncRevision（连接成功 / 实时推送会 bump）自动刷新；
// 也随 fetcher 身份变化（切 workspace 时 getCockpit/getWorkspaceTasks 重建）刷新。
// fetcher 失败约定返回 null（context 的 getCockpit/getWorkspaceTasks 内部 catch 后返回 null）。
export function useRefreshableData<T>(fetcher: () => Promise<T | null>): RefreshableCockpit<T> {
  const { syncRevision } = useMobileRuntime()
  const [snap, setSnap] = useState<RefreshableState<T>>(() => initialRefreshable<T>())
  const inFlightRef = useRef(false)

  const run = useCallback(async () => {
    // syncRevision 进 deps：连接成功 / 实时推送 bump 时 run 重建 → 下方 effect 重新拉取。
    void syncRevision
    if (inFlightRef.current) return
    inFlightRef.current = true
    setSnap((current) => onFetchStart(current))
    try {
      const next = await fetcher()
      setSnap((current) =>
        next === null || next === undefined
          ? onFetchFailure(current, 'failed')
          : onFetchSuccess(current, next)
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setSnap((current) => onFetchFailure(current, message))
    } finally {
      inFlightRef.current = false
    }
  }, [fetcher, syncRevision])

  useEffect(() => {
    void run()
  }, [run])

  return { ...snap, onRefresh: run }
}
