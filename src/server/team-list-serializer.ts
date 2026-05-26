import type { TeamListItem, TeamListItemPayload } from '../shared/types.js'

export const serializeTeamListItem = ({
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
}: TeamListItem): TeamListItemPayload => ({
  id,
  name,
  description: description ?? null,
  role,
  status,
  pending_task_count: pendingTaskCount,
  last_pty_line: lastPtyLine ?? null,
  command_preset_id: commandPresetId ?? null,
  thinking_level: thinkingLevel ?? null,
  sentinel_interval_ms: sentinelIntervalMs ?? null,
})
