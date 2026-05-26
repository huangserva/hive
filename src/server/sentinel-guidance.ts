import type { AgentSummary, WorkspaceSummary } from '../shared/types.js'

export interface SentinelOrphanedDispatch {
  dispatchId: string
  minutesAgo: number
  workerName: string
}

export const SENTINEL_RULES = [
  'Sentinel worker rules:',
  '- Observe only. Do not edit files, run destructive commands, dispatch work, or notify the user.',
  '- Read heartbeat snapshots as signals, not as orders to mutate state.',
  '- If you find drift, stale PM docs, blocked work, failing git hygiene, or inconsistent runtime state, report it to the Orchestrator with `team report`.',
  '- Use `team status` only for short connectivity/status updates.',
  '- Do not use `team send`, `team cancel`, `team approve`, or `team feishu reply`.',
  '- Keep reports concise and actionable: finding, evidence, suggested next action.',
]

export const buildSentinelStartupInstructions = ({
  agent,
  workspace,
}: {
  agent: AgentSummary
  workspace: WorkspaceSummary
}) =>
  [
    'Sentinel operating mode:',
    `- Workspace: ${workspace.name}`,
    `- Sentinel agent: ${agent.name}`,
    '- Your job is periodic consistency inspection.',
    '- You will receive heartbeat payloads containing Cockpit summary and git summary.',
    '- You only report findings to the Orchestrator; you never modify files or dispatch workers.',
  ].join('\n')

export const buildSentinelHeartbeatPayload = ({
  archiveAuditFindings = [],
  cockpitSummary,
  crossWorkspaceDriftFindings = [],
  gitSummary,
  orphanedDispatches = [],
  workspace,
}: {
  archiveAuditFindings?: string[]
  cockpitSummary: string
  crossWorkspaceDriftFindings?: string[]
  gitSummary: string
  orphanedDispatches?: SentinelOrphanedDispatch[]
  workspace: WorkspaceSummary
}) =>
  [
    '[Hive 系统消息：sentinel heartbeat]',
    `workspace_id=${workspace.id}`,
    `workspace_name=${workspace.name}`,
    `workspace_path=${workspace.path}`,
    '',
    'Cockpit snapshot:',
    cockpitSummary,
    '',
    'Git summary:',
    gitSummary,
    '',
    ...(orphanedDispatches.length > 0
      ? [
          'Orphaned dispatches (worker stopped but dispatch still open):',
          ...orphanedDispatches.map(
            (dispatch) =>
              `- ${dispatch.workerName}: dispatch ${dispatch.dispatchId}, submitted ${dispatch.minutesAgo} min ago`
          ),
          '',
        ]
      : []),
    ...(archiveAuditFindings.length > 0
      ? ['[Hive 系统消息：archive audit]', ...archiveAuditFindings.map((item) => `- ${item}`), '']
      : []),
    ...(crossWorkspaceDriftFindings.length > 0
      ? [
          '[Hive 系统消息：cross-workspace drift]',
          ...crossWorkspaceDriftFindings.map((item) => `- ${item}`),
          '',
        ]
      : []),
    '请巡检状态一致性。如果发现 drift、阻塞或风险，用 team report 汇报给 Orchestrator；没有发现问题则继续等待下一次 heartbeat。',
  ].join('\n')
