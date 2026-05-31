import type { MobileDashboardWorker, MobileWorkspaceTask } from './client'

export const getRelevantDispatchHistory = (
  dispatches: MobileWorkspaceTask[] | null | undefined,
  worker: Pick<MobileDashboardWorker, 'id' | 'name'> | null,
  isOrchestrator: boolean
) => {
  if (isOrchestrator || !worker) return []
  const workerName = worker.name.trim()
  return (
    dispatches?.filter((dispatch) => {
      if (dispatch.worker_id) return dispatch.worker_id === worker.id
      return dispatch.worker_name.trim() === workerName
    }) ?? []
  )
}
