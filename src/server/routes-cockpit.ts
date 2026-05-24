import { parseCockpit } from './cockpit-doc.js'
import { getRequiredParam, route, sendJson } from './route-helpers.js'
import type { RouteDefinition } from './route-types.js'
import { requireUiTokenFromRequest } from './ui-auth-helpers.js'

export const cockpitRoutes: RouteDefinition[] = [
  route('GET', '/api/workspaces/:workspaceId/cockpit', ({ params, request, response, store }) => {
    const workspaceId = getRequiredParam(
      response,
      params,
      'workspaceId',
      'Workspace id is required'
    )
    if (!workspaceId) return

    requireUiTokenFromRequest(request, store.validateUiToken)

    const workspace = store.getWorkspaceSnapshot(workspaceId)
    sendJson(response, 200, parseCockpit(workspace.summary.path))
  }),
]
