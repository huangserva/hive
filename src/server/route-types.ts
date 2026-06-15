import type { IncomingMessage, ServerResponse } from 'node:http'

import type { WorkerRole } from '../shared/types.js'
import type { FeishuOutboundTransport } from './feishu-transport.js'
import type { PickFolderResponse } from './fs-pick-folder.js'
import type { HiveLogger } from './logger.js'
import type { MobilePushService } from './mobile-push.js'
import type { RelayConnectorHandle } from './relay-connector.js'
import type { RuntimeStore } from './runtime-store.js'
import type { TasksFileService } from './tasks-file.js'
import type { VersionService } from './version-service.js'

export interface SendTaskBody {
  hive_port?: string
  project_id: string
  from_agent_id: string
  token?: string
  to: string
  text: string
}

export interface ReportTaskBody {
  dispatch_id?: string
  project_id: string
  from_agent_id: string
  token?: string
  result: string
  status?: string
  artifacts?: unknown[]
}

export interface CancelTaskBody {
  dispatch_id?: string
  project_id: string
  from_agent_id: string
  token?: string
  reason?: string
}

export interface CreateWorkspaceBody {
  path: string
  name: string
  /** Default true. When false, skip orchestrator PTY spawn after creation. */
  autostart_orchestrator?: boolean
  /** Optional command preset to use for the initial orchestrator launch. */
  command_preset_id?: string | null
  /** Optional full startup command. When set, this overrides command_preset_id. */
  startup_command?: string | null
}

export interface CreateWorkerBody {
  autostart?: boolean
  command_preset_id?: string | null
  description?: string
  name: string
  role: WorkerRole
  /** Optional role template id. Used to apply server-side template defaults. */
  role_template_id?: string | null
  /** Optional full startup command. When set, this overrides command_preset_id. */
  startup_command?: string | null
  /** Optional preset-native reasoning / effort override. */
  thinking_level?: string | null
}

export interface UserInputBody {
  text: string
}

export interface ConfigureAgentLaunchBody {
  command: string
  args?: string[]
  command_preset_id?: string | null
}

export interface RouteContext {
  feishuTransport?: FeishuOutboundTransport | null
  mobilePushService?: MobilePushService | null
  relayConnector?: RelayConnectorHandle | null
  webRtcRuntime?: {
    getActiveWorkspaceCallIds?: (workspaceId: string) => string[]
    hasActiveWorkspaceCall: (workspaceId: string) => boolean
  }
  logger: HiveLogger | undefined
  request: IncomingMessage
  response: ServerResponse
  store: RuntimeStore
  tasksFileService: TasksFileService
  pickFolderService: () => Promise<PickFolderResponse>
  runtimeInfo: RuntimeInfo
  versionService: VersionService
  params: Record<string, string>
}

export interface RouteDefinition {
  method: string
  path: string
  handler: (context: RouteContext) => Promise<void> | void
}

export type { WorkerRole }

export interface RuntimeInfo {
  dataDir: string
  port?: number
}
