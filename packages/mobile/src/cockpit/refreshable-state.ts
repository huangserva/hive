// 纯状态机：cockpit 各标签页统一的"下拉刷新 + loading + 保留旧数据"加载语义。
// 抽成纯函数便于单测（不依赖 React renderer）。useRefreshableData hook 只是把它接到 useState/effect。
export interface RefreshableState<T> {
  data: T | null
  // 是否曾经成功拿到过数据：决定 refetch 时是 loading(首次) 还是 refreshing(保留旧数据)。
  hasData: boolean
  // 首次加载（还没有任何数据）→ 居中转圈，不是空白。
  loading: boolean
  // 已有数据时的 refetch（syncRevision 变 / 下拉 / 实时推送）→ 顶部 RefreshControl 转圈，不清数据。
  refreshing: boolean
  error: string | null
}

export const initialRefreshable = <T>(): RefreshableState<T> => ({
  data: null,
  error: null,
  hasData: false,
  loading: true,
  refreshing: false,
})

// 开始一次拉取：有数据 → refreshing，没数据 → loading；error 暂留到结果出来再决定。
export const onFetchStart = <T>(state: RefreshableState<T>): RefreshableState<T> => ({
  ...state,
  loading: !state.hasData,
  refreshing: state.hasData,
})

// 成功：更新数据、标记 hasData、清 error、停转圈。
export const onFetchSuccess = <T>(_state: RefreshableState<T>, data: T): RefreshableState<T> => ({
  data,
  error: null,
  hasData: true,
  loading: false,
  refreshing: false,
})

// 失败：**保留旧数据**（绝不清空成白屏），只记 error、停转圈。
export const onFetchFailure = <T>(
  state: RefreshableState<T>,
  error: string
): RefreshableState<T> => ({
  ...state,
  error,
  loading: false,
  refreshing: false,
})
