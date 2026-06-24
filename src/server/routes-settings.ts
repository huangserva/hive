import { isAbsolute } from 'node:path'

import { getThinkingLevelsForPreset } from '../shared/thinking-levels.js'
import { buildAgentCliInstallPlan, SUPPORTED_AGENT_CLI_PRESETS } from './agent-cli-installer.js'
import { getManualCliPath, setManualCliPath } from './agent-cli-manual-paths.js'
import { resolveCommandPath } from './agent-command-resolver.js'
import { getSerializedCommandPresetCapabilities } from './command-preset-capabilities.js'
import { BadRequestError } from './http-errors.js'
import {
  catalogEntryToRoleTemplateInput,
  findMarketplaceCatalogEntry,
  MARKETPLACE_CATALOG_ENTRIES,
} from './marketplace-catalog.js'
import { getRequiredParam, readJsonBody, route, sendJson } from './route-helpers.js'
import type { RouteDefinition } from './route-types.js'
import { isSecretEnvKey, SECRET_ENV_KEYS } from './secret-store.js'
import type { SessionIdCaptureConfig } from './session-capture.js'
import { requireUiTokenFromRequest } from './ui-auth-helpers.js'

type CommandPresetBody = {
  display_name: string
  command: string
  args: string[]
  env: Record<string, string>
  resume_args_template: string | null
  session_id_capture: SessionIdCaptureConfig | null
  yolo_args_template: string[] | null
}

type RoleTemplateBody = {
  name: string
  role_type: 'orchestrator' | 'coder' | 'reviewer' | 'tester' | 'custom' | 'sentinel'
  description: string
  default_command: string
  default_args: string[]
  default_env: Record<string, string>
}

type SecretBody = {
  key?: unknown
  value?: unknown
}

type ManualCliPathBody = {
  path?: unknown
}

export const serializeCommandPreset = (preset: {
  id: string
  displayName: string
  command: string
  args: string[]
  env: Record<string, string>
  resumeArgsTemplate: string | null
  sessionIdCapture: SessionIdCaptureConfig | null
  yoloArgsTemplate: string[] | null
  isBuiltin: boolean
}) => {
  let available = false
  try {
    if (preset.command.trim()) {
      resolveCommandPath(preset.command, process.cwd(), { ...process.env, ...preset.env })
      available = true
    }
  } catch {
    available = false
  }

  return {
    id: preset.id,
    display_name: preset.displayName,
    command: preset.command,
    args: preset.args,
    env: preset.env,
    resume_args_template: preset.resumeArgsTemplate,
    session_id_capture: preset.sessionIdCapture,
    yolo_args_template: preset.yoloArgsTemplate,
    is_builtin: preset.isBuiltin,
    thinking_levels: getThinkingLevelsForPreset(preset.id),
    capabilities: getSerializedCommandPresetCapabilities(preset.id),
    available,
  }
}

const serializeRoleTemplate = (template: {
  id: string
  name: string
  roleType: string
  description: string
  defaultCommand: string
  defaultArgs: string[]
  defaultEnv: Record<string, string>
  isBuiltin: boolean
}) => ({
  id: template.id,
  name: template.name,
  role_type: template.roleType,
  description: template.description,
  default_command: template.defaultCommand,
  default_args: template.defaultArgs,
  default_env: template.defaultEnv,
  is_builtin: template.isBuiltin,
})

const readCommandPresetBody = async (
  request: Parameters<RouteDefinition['handler']>[0]['request']
) => {
  const body = await readJsonBody<Partial<CommandPresetBody>>(request)
  return {
    displayName: body.display_name ?? '',
    command: body.command ?? '',
    args: body.args ?? [],
    env: body.env ?? {},
    resumeArgsTemplate: body.resume_args_template ?? null,
    sessionIdCapture: body.session_id_capture ?? null,
    yoloArgsTemplate: body.yolo_args_template ?? null,
  }
}

const readRoleTemplateBody = async (
  request: Parameters<RouteDefinition['handler']>[0]['request']
) => {
  const body = await readJsonBody<Partial<RoleTemplateBody>>(request)
  return {
    name: body.name ?? '',
    roleType: body.role_type ?? 'custom',
    description: body.description ?? '',
    defaultCommand: body.default_command ?? '',
    defaultArgs: body.default_args ?? [],
    defaultEnv: body.default_env ?? {},
  }
}

const serializeCliInstallPlan = (plan: ReturnType<typeof buildAgentCliInstallPlan>) => ({
  command: plan.command,
  installed: plan.installed,
  install_plan: plan.install,
  path: plan.path,
  preset_id: plan.presetId,
  version: plan.version,
})

export const settingsRoutes: RouteDefinition[] = [
  route('GET', '/api/settings/cli-detection', ({ request, response, store }) => {
    requireUiTokenFromRequest(request, store.validateUiToken)
    sendJson(response, 200, {
      agents: Object.fromEntries(
        SUPPORTED_AGENT_CLI_PRESETS.map((presetId) => {
          const preset = store.settings.getCommandPreset(presetId)
          const manualPath = getManualCliPath(store.settings, presetId)
          const plan = buildAgentCliInstallPlan(presetId, {
            commandOverride: manualPath ?? preset?.command ?? null,
            env: preset?.env ? { ...process.env, ...preset.env } : process.env,
          })
          return [presetId, serializeCliInstallPlan(plan)]
        })
      ),
    })
  }),
  route(
    'PUT',
    '/api/settings/cli-detection/:presetId/manual-path',
    async ({ params, request, response, store }) => {
      requireUiTokenFromRequest(request, store.validateUiToken)
      const presetId = getRequiredParam(response, params, 'presetId', 'Preset id is required')
      if (!presetId) return
      if (
        !SUPPORTED_AGENT_CLI_PRESETS.includes(
          presetId as (typeof SUPPORTED_AGENT_CLI_PRESETS)[number]
        )
      ) {
        throw new BadRequestError(`Unsupported CLI preset: ${presetId}`)
      }
      const body = await readJsonBody<ManualCliPathBody>(request)
      if (typeof body.path !== 'string' || !body.path.trim()) {
        throw new BadRequestError('path must be a non-empty string')
      }
      const manualPath = body.path.trim()
      if (!isAbsolute(manualPath)) throw new BadRequestError('path must be absolute')
      try {
        resolveCommandPath(manualPath, process.cwd(), process.env)
      } catch {
        throw new BadRequestError(`CLI path is not executable: ${manualPath}`)
      }
      setManualCliPath(store.settings, presetId, manualPath)
      sendJson(response, 200, {
        installed: true,
        manual_path: manualPath,
        preset_id: presetId,
      })
    }
  ),
  route('GET', '/api/settings/secrets', ({ request, response, store }) => {
    requireUiTokenFromRequest(request, store.validateUiToken)
    const present = store.listPresentSecrets()
    sendJson(response, 200, {
      secrets: SECRET_ENV_KEYS.reduce(
        (result, key) => {
          result[key] = { present: present[key] }
          return result
        },
        {} as Record<(typeof SECRET_ENV_KEYS)[number], { present: boolean }>
      ),
    })
  }),
  route('POST', '/api/settings/secrets', async ({ request, response, store }) => {
    requireUiTokenFromRequest(request, store.validateUiToken)
    const body = await readJsonBody<SecretBody>(request)
    if (!isSecretEnvKey(body.key)) throw new BadRequestError('unsupported secret key')
    if (typeof body.value !== 'string' || body.value.length === 0) {
      throw new BadRequestError('secret value is required')
    }
    store.setSecret(body.key, body.value)
    sendJson(response, 200, { key: body.key, present: true })
  }),
  route('GET', '/api/settings/command-presets', ({ request, response, store }) => {
    requireUiTokenFromRequest(request, store.validateUiToken)
    sendJson(response, 200, store.settings.listCommandPresets().map(serializeCommandPreset))
  }),
  route('POST', '/api/settings/command-presets', async ({ request, response, store }) => {
    requireUiTokenFromRequest(request, store.validateUiToken)
    sendJson(
      response,
      201,
      serializeCommandPreset(
        store.settings.createCommandPreset(await readCommandPresetBody(request))
      )
    )
  }),
  route(
    'PATCH',
    '/api/settings/command-presets/:presetId',
    async ({ params, request, response, store }) => {
      requireUiTokenFromRequest(request, store.validateUiToken)
      const presetId = getRequiredParam(response, params, 'presetId', 'Preset id is required')
      if (!presetId) return
      const current = store.settings.listCommandPresets().find((preset) => preset.id === presetId)
      if (!current) throw new Error(`Command preset not found: ${presetId}`)
      const next = { ...current, ...(await readCommandPresetBody(request)) }
      sendJson(
        response,
        200,
        serializeCommandPreset(store.settings.updateCommandPreset(presetId, next))
      )
    }
  ),
  route(
    'DELETE',
    '/api/settings/command-presets/:presetId',
    ({ params, request, response, store }) => {
      requireUiTokenFromRequest(request, store.validateUiToken)
      const presetId = getRequiredParam(response, params, 'presetId', 'Preset id is required')
      if (!presetId) return
      store.settings.deleteCommandPreset(presetId)
      response.statusCode = 204
      response.end()
    }
  ),
  route('GET', '/api/settings/role-templates', ({ request, response, store }) => {
    requireUiTokenFromRequest(request, store.validateUiToken)
    sendJson(response, 200, store.settings.listRoleTemplates().map(serializeRoleTemplate))
  }),
  route('POST', '/api/settings/role-templates', async ({ request, response, store }) => {
    requireUiTokenFromRequest(request, store.validateUiToken)
    sendJson(
      response,
      201,
      serializeRoleTemplate(store.settings.createRoleTemplate(await readRoleTemplateBody(request)))
    )
  }),
  route(
    'PATCH',
    '/api/settings/role-templates/:templateId',
    async ({ params, request, response, store }) => {
      requireUiTokenFromRequest(request, store.validateUiToken)
      const templateId = getRequiredParam(response, params, 'templateId', 'Template id is required')
      if (!templateId) return
      const current = store.settings
        .listRoleTemplates()
        .find((template) => template.id === templateId)
      if (!current) throw new Error(`Role template not found: ${templateId}`)
      const next = { ...current, ...(await readRoleTemplateBody(request)) }
      sendJson(
        response,
        200,
        serializeRoleTemplate(store.settings.updateRoleTemplate(templateId, next))
      )
    }
  ),
  route(
    'DELETE',
    '/api/settings/role-templates/:templateId',
    ({ params, request, response, store }) => {
      requireUiTokenFromRequest(request, store.validateUiToken)
      const templateId = getRequiredParam(response, params, 'templateId', 'Template id is required')
      if (!templateId) return
      store.settings.deleteRoleTemplate(templateId)
      response.statusCode = 204
      response.end()
    }
  ),
  route('GET', '/api/settings/marketplace/catalog', ({ request, response, store }) => {
    requireUiTokenFromRequest(request, store.validateUiToken)
    sendJson(
      response,
      200,
      MARKETPLACE_CATALOG_ENTRIES.map((entry) => ({
        slug: entry.slug,
        name: entry.name,
        role_type: entry.roleType,
        tagline: entry.tagline,
        description: entry.description,
        default_command: entry.defaultCommand,
        default_args: entry.defaultArgs,
        default_env: entry.defaultEnv,
        source: entry.source,
      }))
    )
  }),
  route('POST', '/api/settings/marketplace/import', async ({ request, response, store }) => {
    requireUiTokenFromRequest(request, store.validateUiToken)
    const body = await readJsonBody<{ slug?: unknown; override_name?: unknown }>(request)
    const slug = typeof body.slug === 'string' ? body.slug.trim() : ''
    if (!slug) throw new BadRequestError('slug is required')
    const entry = findMarketplaceCatalogEntry(slug)
    if (!entry) throw new BadRequestError(`Unknown catalog slug: ${slug}`)
    const overrideName =
      typeof body.override_name === 'string' && body.override_name.trim()
        ? body.override_name.trim()
        : undefined
    const input = catalogEntryToRoleTemplateInput(entry, overrideName)
    const created = store.settings.createRoleTemplate(input)
    sendJson(response, 201, {
      slug: entry.slug,
      template: serializeRoleTemplate(created),
    })
  }),
  route('GET', '/api/settings/app-state/:key', ({ params, request, response, store }) => {
    requireUiTokenFromRequest(request, store.validateUiToken)
    const key = getRequiredParam(response, params, 'key', 'App state key is required')
    if (!key) return
    sendJson(response, 200, store.settings.getAppState(key) ?? { key, value: null })
  }),
  route('PUT', '/api/settings/app-state/:key', async ({ params, request, response, store }) => {
    requireUiTokenFromRequest(request, store.validateUiToken)
    const key = getRequiredParam(response, params, 'key', 'App state key is required')
    if (!key) return
    const body = await readJsonBody<{ value: string | null }>(request)
    store.settings.setAppState(key, body.value)
    response.statusCode = 204
    response.end()
  }),
]
