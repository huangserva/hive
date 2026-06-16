export type AgentLaunchSource =
  | 'autostart'
  | 'feishu'
  | 'internal'
  | 'mobile'
  | 'relay'
  | 'ui'
  | 'ui_workspace_create'

export const isRemoteAgentLaunchSource = (source: AgentLaunchSource) =>
  source === 'mobile' || source === 'relay' || source === 'feishu'
