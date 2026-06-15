import type { TeamListItem, TeamListItemPayload } from '../shared/types.js'
import { serializeCommandPresetCapabilities } from './command-preset-capabilities.js'

export const serializeTeamListItem = ({
  capabilities,
  commandPresetId,
  description,
  id,
  lastPtyLine,
  name,
  pendingTaskCount,
  role,
  sentinelIntervalMs,
  status,
  thinkingLevel,
  workflowAllowed,
}: TeamListItem): TeamListItemPayload => ({
  id,
  name,
  description: description ?? null,
  role,
  status,
  pending_task_count: pendingTaskCount,
  last_pty_line: lastPtyLine ?? null,
  command_preset_id: commandPresetId ?? null,
  capabilities: capabilities ? serializeCommandPresetCapabilities(capabilities) : null,
  thinking_level: thinkingLevel ?? null,
  sentinel_interval_ms: sentinelIntervalMs ?? null,
  workflow_allowed: workflowAllowed === true,
})
