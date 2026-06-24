import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'

import { buildAgentCliInstallPlan, SUPPORTED_AGENT_CLI_PRESETS } from './agent-cli-installer.js'
import { getManualCliPath } from './agent-cli-manual-paths.js'
import type { RuntimeStore } from './runtime-store.js'
import { createSecretStore, SECRET_ENV_KEYS, type SecretEnvKey } from './secret-store.js'
import type { VersionInfoPayload } from './version-service.js'

const LOG_TAIL_MAX_BYTES = 256 * 1024
const EXPORT_LOG_MAX_BYTES = 1024 * 1024
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

interface DiagnosticsInput {
  dataDir: string
  port?: number | undefined
  store: RuntimeStore
  versionInfo: VersionInfoPayload
}

interface LogTail {
  exists: boolean
  lines: string[]
  path: string
}

type CliDetectionPayload = {
  agents: Record<
    string,
    {
      command: string
      install_plan: { args: string[]; command: string; description: string } | null
      installed: boolean
      path: string | null
      preset_id: string
      version: string | null
    }
  >
}

const runtimeLogPath = (dataDir: string, port?: number) =>
  join(dataDir, 'logs', `runtime-${port ?? 0}.log`)

const findReadableRuntimeLogPath = (dataDir: string, port?: number) => {
  const preferred = runtimeLogPath(dataDir, port)
  if (existsSync(preferred)) return preferred
  const logsDir = join(dataDir, 'logs')
  if (!existsSync(logsDir)) return preferred
  const candidates = readdirSync(logsDir)
    .filter((name) => /^runtime-.*\.log$/.test(name))
    .map((name) => join(logsDir, name))
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs)
  return candidates[0] ?? preferred
}

export const loadSecretValues = (dataDir: string): string[] => {
  const store = createSecretStore(dataDir)
  return SECRET_ENV_KEYS.flatMap((key) => [store.get(key), process.env[key]]).filter(
    (value): value is string => typeof value === 'string' && value.length > 0
  )
}

export const redactText = (text: string, secretValues: string[]) => {
  let redacted = text
  for (const secret of [...new Set(secretValues)].sort(
    (left, right) => right.length - left.length
  )) {
    redacted = redacted.split(secret).join('[REDACTED]')
  }
  return redacted
}

const redactJson = <T>(value: T, secretValues: string[]): T => {
  if (secretValues.length === 0) return value
  if (typeof value === 'string') return redactText(value, secretValues) as T
  if (Array.isArray(value)) return value.map((item) => redactJson(item, secretValues)) as T
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, redactJson(entry, secretValues)])
  ) as T
}

const readTailText = (path: string, maxBytes: number) => {
  const stats = statSync(path)
  const start = Math.max(0, stats.size - maxBytes)
  const length = stats.size - start
  const buffer = Buffer.alloc(length)
  const fd = openSync(path, 'r')
  try {
    readSync(fd, buffer, 0, length, start)
  } finally {
    closeSync(fd)
  }
  return buffer.toString('utf8')
}

export const readRuntimeLogTail = (
  dataDir: string,
  port: number | undefined,
  secretValues: string[]
): LogTail => {
  const path = findReadableRuntimeLogPath(dataDir, port)
  if (!existsSync(path)) return { exists: false, lines: [], path }
  const text = redactText(readTailText(path, LOG_TAIL_MAX_BYTES), secretValues)
  return {
    exists: true,
    lines: text.split(/\r?\n/).filter(Boolean).slice(-200),
    path,
  }
}

const serializeCliInstallPlan = (plan: ReturnType<typeof buildAgentCliInstallPlan>) => ({
  command: plan.command,
  install_plan: plan.install,
  installed: plan.installed,
  path: plan.path,
  preset_id: plan.presetId,
  version: plan.version,
})

export const collectCliDetection = (store: RuntimeStore): CliDetectionPayload => ({
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

const parseSystemEvent = (contentJson: string): Record<string, unknown> | null => {
  try {
    const parsed = JSON.parse(contentJson) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    const event = (parsed as Record<string, unknown>).event
    if (event !== 'dispatch_spawn_failed' && event !== 'sentinel_alert') return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

export const collectDiagnosticEvents = (store: RuntimeStore, secretValues: string[]) => {
  const since = Date.now() - SEVEN_DAYS_MS
  const events = store
    .listWorkspaces()
    .flatMap((workspace) =>
      store.listMobileChatMessages(workspace.id, undefined, 100).flatMap((message) => {
        if (message.created_at <= since) return []
        if (message.message_type !== 'system_event') return []
        const payload = parseSystemEvent(message.content_json)
        if (!payload) return []
        return [
          {
            created_at: message.created_at,
            id: message.id,
            payload,
            type: String(payload.event),
            workspace_id: workspace.id,
            workspace_name: workspace.name,
          },
        ]
      })
    )
    .sort((left, right) => left.created_at - right.created_at)
  return redactJson(events, secretValues)
}

export const collectActiveSentinelAlerts = (store: RuntimeStore, secretValues: string[]) =>
  redactJson(
    store.listWorkspaces().flatMap((workspace) =>
      store.listActiveSentinelAlerts(workspace.id).map((alert) => ({
        ...alert,
        workspace_id: workspace.id,
        workspace_name: workspace.name,
      }))
    ),
    secretValues
  )

export const collectConfigSummary = (store: RuntimeStore) => ({
  command_presets: store.settings.listCommandPresets().map((preset) => ({
    args: preset.args,
    command: preset.command,
    display_name: preset.displayName,
    id: preset.id,
    is_builtin: preset.isBuiltin,
  })),
  secrets: Object.entries(store.listPresentSecrets()).reduce(
    (result, [key, present]) => {
      result[key as SecretEnvKey] = { present }
      return result
    },
    {} as Record<SecretEnvKey, { present: boolean }>
  ),
  workspaces: store.listWorkspaces().map((workspace) => ({
    id: workspace.id,
    name: workspace.name,
    worker_count: store.listWorkers(workspace.id).length,
  })),
})

export const collectDiagnostics = (input: DiagnosticsInput) => {
  const secretValues = loadSecretValues(input.dataDir)
  const systemInfo = {
    app_version: input.versionInfo.current_version,
    arch: process.arch,
    data_dir: input.dataDir,
    generated_at: Date.now(),
    log_path: runtimeLogPath(input.dataDir, input.port),
    node_version: process.version,
    platform: process.platform,
    port: input.port ?? 0,
  }
  const secrets = Object.entries(input.store.listPresentSecrets()).reduce(
    (result, [key, present]) => {
      result[key as SecretEnvKey] = { present }
      return result
    },
    {} as Record<SecretEnvKey, { present: boolean }>
  )
  return {
    active_sentinel_alerts: collectActiveSentinelAlerts(input.store, secretValues),
    cli_detection: redactJson(collectCliDetection(input.store), secretValues),
    events: collectDiagnosticEvents(input.store, secretValues),
    generated_at: systemInfo.generated_at,
    log_tail: readRuntimeLogTail(input.dataDir, input.port, secretValues),
    secrets,
    system_info: systemInfo,
  }
}

const padTar = (size: number) => (512 - (size % 512)) % 512

const writeOctal = (header: Buffer, value: number, offset: number, length: number) => {
  const text = value
    .toString(8)
    .padStart(length - 1, '0')
    .slice(-(length - 1))
  header.write(`${text}\0`, offset, length, 'ascii')
}

export const buildTarArchive = (files: Array<{ content: Buffer | string; name: string }>) => {
  const parts: Buffer[] = []
  for (const file of files) {
    const body = Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content, 'utf8')
    const header = Buffer.alloc(512)
    header.write(file.name.slice(0, 100), 0, 100, 'utf8')
    writeOctal(header, 0o644, 100, 8)
    writeOctal(header, 0, 108, 8)
    writeOctal(header, 0, 116, 8)
    writeOctal(header, body.length, 124, 12)
    writeOctal(header, Math.floor(Date.now() / 1000), 136, 12)
    header.fill(' ', 148, 156)
    header.write('0', 156, 1, 'ascii')
    header.write('ustar', 257, 5, 'ascii')
    header.write('00', 263, 2, 'ascii')
    const checksum = [...header].reduce((sum, byte) => sum + byte, 0)
    header.write(checksum.toString(8).padStart(6, '0'), 148, 6, 'ascii')
    header[154] = 0
    header[155] = 32
    parts.push(header, body)
    const padding = padTar(body.length)
    if (padding > 0) parts.push(Buffer.alloc(padding))
  }
  parts.push(Buffer.alloc(1024))
  return Buffer.concat(parts)
}

const readExportLogFiles = (dataDir: string, port: number | undefined, secretValues: string[]) => {
  const logsDir = join(dataDir, 'logs')
  const explicitPath = runtimeLogPath(dataDir, port)
  if (!existsSync(logsDir)) return []
  const paths = new Set(
    readdirSync(logsDir)
      .filter((name) => /^runtime-.*\.log$/.test(name))
      .map((name) => join(logsDir, name))
  )
  paths.add(explicitPath)
  return [...paths]
    .filter((path) => existsSync(path))
    .map((path) => ({
      content: redactText(readTailText(path, EXPORT_LOG_MAX_BYTES), secretValues),
      name: `logs/${basename(path)}`,
    }))
}

export const buildDiagnosticsArchive = (input: DiagnosticsInput) => {
  const secretValues = loadSecretValues(input.dataDir)
  const diagnostics = collectDiagnostics(input)
  const configSummary = redactJson(collectConfigSummary(input.store), secretValues)
  const files: Array<{ content: string; name: string }> = [
    { content: JSON.stringify(diagnostics.system_info, null, 2), name: 'system-info.json' },
    { content: JSON.stringify(diagnostics.cli_detection, null, 2), name: 'cli-detection.json' },
    { content: JSON.stringify(diagnostics.events, null, 2), name: 'events.json' },
    {
      content: JSON.stringify(diagnostics.active_sentinel_alerts, null, 2),
      name: 'active-sentinel-alerts.json',
    },
    { content: JSON.stringify(configSummary, null, 2), name: 'config-summary.json' },
    ...readExportLogFiles(input.dataDir, input.port, secretValues),
  ]
  return buildTarArchive(files)
}
