import { existsSync, readFileSync, statSync } from 'node:fs'
import { resolve, sep } from 'node:path'

import { parseCockpit } from './cockpit-doc.js'
import { BadRequestError, NotFoundError } from './http-errors.js'
import { openWorkspaceFile } from './open-file.js'
import { confirmDecisionInFile } from './pm-decisions-doc.js'
import { type IdeaPromoteTarget, promoteIdeaInFile } from './pm-ideas-doc.js'
import { answerQuestionInFile } from './pm-questions-doc.js'
import { getRequiredParam, readJsonBody, route, sendJson } from './route-helpers.js'
import type { RouteDefinition } from './route-types.js'
import { requireUiTokenFromRequest } from './ui-auth-helpers.js'

interface AnswerQuestionBody {
  answer?: unknown
}

interface PromoteIdeaBody {
  target?: unknown
}

interface OpenFileBody {
  path?: unknown
}

const REPORTS_PATH_PREFIX = '.hive/reports/'
const DOC_PATH_PREFIXES = ['.hive/baseline/', '.hive/research/', '.hive/decisions/'] as const

const isInside = (root: string, candidate: string) => {
  const relative = candidate.slice(root.length)
  return candidate === root || relative.startsWith(sep)
}

const hasParentTraversal = (requestedPath: string) =>
  requestedPath.split(/[\\/]+/).some((segment) => segment === '..')

const readWorkspaceReportHtml = (workspacePath: string, requestedPath: string) => {
  const trimmed = requestedPath.trim()
  if (!trimmed) throw new BadRequestError('path must not be empty')
  if (!trimmed.toLowerCase().endsWith('.html')) {
    throw new BadRequestError('report path must be an .html file')
  }
  if (!trimmed.startsWith(REPORTS_PATH_PREFIX)) {
    throw new BadRequestError('report path must stay inside .hive/reports')
  }

  const workspaceRoot = resolve(workspacePath)
  const reportsRoot = resolve(workspaceRoot, '.hive', 'reports')
  const candidate = resolve(workspaceRoot, trimmed)
  if (!isInside(reportsRoot, candidate)) {
    throw new BadRequestError('report path must stay inside .hive/reports')
  }
  if (!existsSync(candidate) || !statSync(candidate).isFile()) {
    throw new NotFoundError(`Report not found: ${requestedPath}`)
  }

  return readFileSync(candidate, 'utf8')
}

const readWorkspaceCockpitMarkdown = (workspacePath: string, requestedPath: string) => {
  const trimmed = requestedPath.trim()
  if (!trimmed) throw new BadRequestError('path must not be empty')
  if (!trimmed.toLowerCase().endsWith('.md')) {
    throw new BadRequestError('doc path must be a .md file')
  }
  const matchedPrefix = DOC_PATH_PREFIXES.find((prefix) => trimmed.startsWith(prefix))
  if (!matchedPrefix) {
    throw new BadRequestError(
      'doc path must be under .hive/baseline, .hive/research, or .hive/decisions'
    )
  }
  if (hasParentTraversal(trimmed)) {
    throw new BadRequestError('doc path must stay inside its allowed .hive directory')
  }

  const workspaceRoot = resolve(workspacePath)
  const allowedRoot = resolve(workspaceRoot, matchedPrefix)
  const candidate = resolve(workspaceRoot, trimmed)
  if (!isInside(allowedRoot, candidate)) {
    throw new BadRequestError('doc path must stay inside its allowed .hive directory')
  }
  if (!existsSync(candidate) || !statSync(candidate).isFile()) {
    throw new NotFoundError(`Document not found: ${requestedPath}`)
  }

  return readFileSync(candidate, 'utf8')
}

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
  route(
    'GET',
    '/api/workspaces/:workspaceId/cockpit/report-file',
    ({ params, request, response, store }) => {
      const workspaceId = getRequiredParam(
        response,
        params,
        'workspaceId',
        'Workspace id is required'
      )
      if (!workspaceId) return

      requireUiTokenFromRequest(request, store.validateUiToken)
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      const reportPath = url.searchParams.get('path')
      if (!reportPath) throw new BadRequestError('path is required')

      const workspace = store.getWorkspaceSnapshot(workspaceId)
      const html = readWorkspaceReportHtml(workspace.summary.path, reportPath)
      response.statusCode = 200
      response.setHeader('content-type', 'text/html; charset=utf-8')
      response.end(html)
    }
  ),
  route(
    'GET',
    '/api/workspaces/:workspaceId/cockpit/doc-file',
    ({ params, request, response, store }) => {
      const workspaceId = getRequiredParam(
        response,
        params,
        'workspaceId',
        'Workspace id is required'
      )
      if (!workspaceId) return

      requireUiTokenFromRequest(request, store.validateUiToken)
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      const docPath = url.searchParams.get('path')
      if (!docPath) throw new BadRequestError('path is required')

      const workspace = store.getWorkspaceSnapshot(workspaceId)
      const markdown = readWorkspaceCockpitMarkdown(workspace.summary.path, docPath)
      response.statusCode = 200
      response.setHeader('content-type', 'text/plain; charset=utf-8')
      response.end(markdown)
    }
  ),
  route(
    'POST',
    '/api/workspaces/:workspaceId/cockpit/questions/:questionId/answer',
    async ({ logger, params, request, response, store }) => {
      const workspaceId = getRequiredParam(
        response,
        params,
        'workspaceId',
        'Workspace id is required'
      )
      const questionId = getRequiredParam(response, params, 'questionId', 'Question id is required')
      if (!workspaceId || !questionId) return

      requireUiTokenFromRequest(request, store.validateUiToken)
      const body = await readJsonBody<AnswerQuestionBody>(request)
      if (typeof body.answer !== 'string') throw new BadRequestError('answer must be a string')

      const workspace = store.getWorkspaceSnapshot(workspaceId)
      answerQuestionInFile(workspace.summary.path, questionId, body.answer)
      try {
        store.notifyQuestionAnswered(workspaceId, questionId, body.answer)
      } catch (error) {
        logger?.warn(`cockpit question answer nudge failed question_id=${questionId}`, error)
      }
      sendJson(response, 200, { ok: true })
    }
  ),
  route(
    'POST',
    '/api/workspaces/:workspaceId/cockpit/ideas/:ideaId/promote',
    async ({ params, request, response, store }) => {
      const workspaceId = getRequiredParam(
        response,
        params,
        'workspaceId',
        'Workspace id is required'
      )
      const ideaId = getRequiredParam(response, params, 'ideaId', 'Idea id is required')
      if (!workspaceId || !ideaId) return

      requireUiTokenFromRequest(request, store.validateUiToken)
      const body = await readJsonBody<PromoteIdeaBody>(request)
      const target = body.target ?? 'question'
      if (target !== 'plan' && target !== 'adr' && target !== 'question') {
        throw new BadRequestError('target must be plan, adr, or question')
      }

      const workspace = store.getWorkspaceSnapshot(workspaceId)
      promoteIdeaInFile(workspace.summary.path, ideaId, target as IdeaPromoteTarget)
      sendJson(response, 200, { ok: true })
    }
  ),
  route(
    'POST',
    '/api/workspaces/:workspaceId/cockpit/decisions/:decisionId/confirm',
    async ({ params, request, response, store }) => {
      const workspaceId = getRequiredParam(
        response,
        params,
        'workspaceId',
        'Workspace id is required'
      )
      const decisionId = getRequiredParam(response, params, 'decisionId', 'Decision id is required')
      if (!workspaceId || !decisionId) return

      requireUiTokenFromRequest(request, store.validateUiToken)
      await readJsonBody<Record<string, never>>(request)

      const workspace = store.getWorkspaceSnapshot(workspaceId)
      const result = confirmDecisionInFile(workspace.summary.path, decisionId)
      sendJson(response, 200, { ok: true, ...result })
    }
  ),
  route(
    'POST',
    '/api/workspaces/:workspaceId/open-file',
    async ({ params, request, response, store }) => {
      const workspaceId = getRequiredParam(
        response,
        params,
        'workspaceId',
        'Workspace id is required'
      )
      if (!workspaceId) return

      requireUiTokenFromRequest(request, store.validateUiToken)
      const body = await readJsonBody<OpenFileBody>(request)
      if (typeof body.path !== 'string') throw new BadRequestError('path must be a string')

      const workspace = store.getWorkspaceSnapshot(workspaceId)
      await openWorkspaceFile(workspace.summary.path, body.path)
      sendJson(response, 200, { ok: true })
    }
  ),
]
