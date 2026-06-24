import { buildDiagnosticsArchive, collectDiagnostics } from './diagnostics-support.js'
import { route, sendJson } from './route-helpers.js'
import type { RouteDefinition } from './route-types.js'
import { requireUiTokenFromRequest } from './ui-auth-helpers.js'

const timestampForFilename = () => new Date().toISOString().replace(/[:.]/g, '-')

export const diagnosticsRoutes: RouteDefinition[] = [
  route(
    'GET',
    '/api/diagnostics',
    async ({ request, response, runtimeInfo, store, versionService }) => {
      requireUiTokenFromRequest(request, store.validateUiToken)
      const versionInfo = await versionService.getVersionInfo()
      sendJson(
        response,
        200,
        collectDiagnostics({
          dataDir: runtimeInfo.dataDir,
          port: runtimeInfo.port,
          store,
          versionInfo,
        })
      )
    }
  ),
  route(
    'GET',
    '/api/diagnostics/export',
    async ({ request, response, runtimeInfo, store, versionService }) => {
      requireUiTokenFromRequest(request, store.validateUiToken)
      const versionInfo = await versionService.getVersionInfo()
      const archive = buildDiagnosticsArchive({
        dataDir: runtimeInfo.dataDir,
        port: runtimeInfo.port,
        store,
        versionInfo,
      })
      response.statusCode = 200
      response.setHeader('content-type', 'application/x-tar')
      response.setHeader(
        'content-disposition',
        `attachment; filename="hive-diagnostics-${timestampForFilename()}.tar"`
      )
      response.end(archive)
    }
  ),
]
