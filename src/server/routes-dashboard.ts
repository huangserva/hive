import { type DispatchRecord, isActiveDispatchStatus } from './dispatch-ledger-store.js'
import { route, sendJson } from './route-helpers.js'
import type { RouteDefinition } from './route-types.js'
import { requireUiTokenFromRequest } from './ui-auth-helpers.js'

const DAY_MS = 24 * 60 * 60 * 1000
const DASHBOARD_DISPATCH_LIMIT = 100_000

const dispatchActivityAt = (dispatch: DispatchRecord) =>
  Math.max(
    dispatch.createdAt,
    dispatch.deliveredAt ?? 0,
    dispatch.submittedAt ?? 0,
    dispatch.reportedAt ?? 0
  )

export const dashboardRoutes: RouteDefinition[] = [
  route('GET', '/api/ui/dashboard', ({ request, response, store }) => {
    requireUiTokenFromRequest(request, store.validateUiToken)

    const now = Date.now()
    const recentCutoff = now - DAY_MS
    const dashboard = store.listWorkspaces().map((workspace) => {
      const workers = store.listWorkers(workspace.id)
      const dispatches = store.listDispatches(workspace.id, {
        limit: DASHBOARD_DISPATCH_LIMIT,
      })
      const lastDispatchActivity = dispatches.reduce<number | null>((latest, dispatch) => {
        const activityAt = dispatchActivityAt(dispatch)
        return latest === null || activityAt > latest ? activityAt : latest
      }, null)

      return {
        activeWorkerCount: workers.filter((worker) => worker.status !== 'stopped').length,
        cwd: workspace.path,
        id: workspace.id,
        lastActivityAt: lastDispatchActivity,
        name: workspace.name,
        openDispatchCount: dispatches.filter((dispatch) => isActiveDispatchStatus(dispatch.status))
          .length,
        recentDispatchCount: dispatches.filter((dispatch) => dispatch.createdAt >= recentCutoff)
          .length,
        workerCount: workers.length,
      }
    })

    sendJson(response, 200, dashboard)
  }),
]
