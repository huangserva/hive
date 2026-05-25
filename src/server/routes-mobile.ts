import { join } from 'node:path'

import { parseCockpit } from './cockpit-doc.js'
import { requireMobileTokenFromRequest } from './mobile-auth.js'
import { getRequiredParam, route, sendJson } from './route-helpers.js'
import type { RouteDefinition } from './route-types.js'
import { enrichTeamList } from './team-list-enrichment.js'

const activeMilestone = (cockpit: ReturnType<typeof parseCockpit>) =>
  cockpit.plan.milestones.find((milestone) => milestone.status === 'in_progress') ??
  cockpit.plan.milestones.find((milestone) => milestone.status === 'open') ??
  null

const activeMilestoneLabel = (milestone: NonNullable<ReturnType<typeof activeMilestone>>) => {
  const title = milestone.title.replace(
    /\s*·\s*(in_progress|open|proposed|blocked|shipped)\s*$/i,
    ''
  )
  return title.startsWith(milestone.id) ? title : `${milestone.id} · ${title}`
}

export const buildMobileDashboard = (
  store: Parameters<RouteDefinition['handler']>[0]['store'],
  workspaceId: string
) => {
  const workspace = store.getWorkspaceSnapshot(workspaceId)
  const cockpit = parseCockpit(workspace.summary.path)
  const milestone = activeMilestone(cockpit)
  const workers = enrichTeamList(workspaceId, store, store.listWorkers(workspaceId)).map(
    (worker) => ({
      id: worker.id,
      name: worker.name,
      preset: worker.commandPresetId ?? null,
      role: worker.role,
      status: worker.status,
    })
  )
  const runs = store.listTerminalRuns(workspaceId).map((run) => ({
    agent_name: run.agent_name,
    id: run.run_id,
    started_at: null,
    status: run.status,
  }))

  return {
    cockpit: {
      ai_actions_count: cockpit.aiActions.length,
      baseline_stale: cockpit.baseline.staleHint !== null,
      high_ai_actions: cockpit.aiActions.filter((action) => action.priority === 'high').length,
      open_questions:
        cockpit.questions.high.length +
        cockpit.questions.medium.length +
        cockpit.questions.low.length,
    },
    generated_at: new Date().toISOString(),
    plan: {
      active_milestone: milestone ? activeMilestoneLabel(milestone) : null,
      current_phase: cockpit.plan.currentPhase ?? cockpit.plan.frontmatter.current_phase ?? null,
    },
    runs,
    tasks: {
      total_done: cockpit.tasks.totalDone,
      total_open: cockpit.tasks.totalOpen,
    },
    workers,
    workspace: workspace.summary,
  }
}

const pairedHost = (requestHost: string | string[] | undefined) => {
  const host = Array.isArray(requestHost) ? requestHost[0] : requestHost
  if (!host) return '127.0.0.1'
  try {
    const parsed = new URL(`http://${host}`)
    return parsed.hostname || '127.0.0.1'
  } catch {
    return '127.0.0.1'
  }
}

export const mobileRoutes: RouteDefinition[] = [
  route('GET', '/api/mobile/pair', ({ request, response, runtimeInfo, store }) => {
    const device = store.ensureMobileAccessToken()
    sendJson(response, 200, {
      host: pairedHost(request.headers.host),
      port: runtimeInfo.port ?? request.socket.localPort ?? 0,
      token: device.token,
    })
  }),
  route(
    'GET',
    '/api/mobile/runtime/status',
    async ({ request, response, runtimeInfo, store, versionService }) => {
      requireMobileTokenFromRequest(request, store.validateMobileToken)
      const version = await versionService.getVersionInfo()
      sendJson(response, 200, {
        port: runtimeInfo.port ?? 0,
        pid: process.pid,
        cwd: process.cwd(),
        log_path: join(runtimeInfo.dataDir, 'logs', `runtime-${runtimeInfo.port ?? 0}.log`),
        db_path: join(runtimeInfo.dataDir, 'runtime.sqlite'),
        version: version.current_version,
      })
    }
  ),
  route('GET', '/api/mobile/workspaces', ({ request, response, store }) => {
    requireMobileTokenFromRequest(request, store.validateMobileToken)
    sendJson(response, 200, store.listWorkspaces())
  }),
  route(
    'GET',
    '/api/mobile/workspaces/:workspaceId/dashboard',
    ({ params, request, response, store }) => {
      requireMobileTokenFromRequest(request, store.validateMobileToken)
      const workspaceId = getRequiredParam(
        response,
        params,
        'workspaceId',
        'Workspace id is required'
      )
      if (!workspaceId) return
      sendJson(response, 200, buildMobileDashboard(store, workspaceId))
    }
  ),
]
