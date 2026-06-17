import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const REQUIRED_ENV_KEYS = [
  'HIVE_PORT',
  'HIVE_PROJECT_ID',
  'HIVE_AGENT_ID',
  'HIVE_AGENT_TOKEN',
] as const

type HiveEnvKey = (typeof REQUIRED_ENV_KEYS)[number]

interface HiveEnv {
  HIVE_PORT: string
  HIVE_PROJECT_ID: string
  HIVE_AGENT_ID: string
  HIVE_AGENT_TOKEN: string
}

export const TEAM_USAGE = [
  'Usage:',
  '  team list',
  '  team send <worker-name> "<task>"',
  '  team cancel --dispatch <dispatch-id> "<reason>"',
  '  team recover <dispatch-id>',
  '  team abandon <dispatch-id> --confirm-worker-stopped',
  '  team approve "<action>" [--risk high|medium] [--target <worker-name>] [--chat <chat_id>]',
  '  team mobile-reply "<text>"',
  '  team mobile-send-media --file <path> [--text "<caption>"]',
  '  team feishu reply "<text>"',
  '  team feishu reply [--chat <chat_id>] [--message-id <message_id>] "<text>"',
  '  team feishu reply [--chat <chat_id>] [--message-id <message_id>] --file <path> ["<caption>"]   # M44: 出站视频/图片/文件',
  '  team report "<result>" [--dispatch <dispatch-id>] [--artifact <path>]',
  '  team report --stdin [--dispatch <dispatch-id>] [--artifact <path>]',
  '  team report (...same as above) --reviews <coder-dispatch-id> --verdict accepted|rejected|waived --reason "..."  # M43 reviewer 主路径',
  '  team accept <coder-dispatch-id> --reason "<must reference reviewer dispatch_id>" [--verdict accepted|waived]  # M43 PM 旁路',
  '  team status "<current status>" [--artifact <path>]',
  '  team status --stdin [--artifact <path>]',
  '',
  'Flags can appear in any order. Use --stdin to pipe long bodies and avoid shell-escaping issues.',
  "Use a quoted heredoc (<<'EOF') so $vars, backticks, and command substitutions stay literal:",
  "  team report --stdin --dispatch <id> <<'EOF'",
  '  ... long report ...',
  '  EOF',
  '',
  'For role rules, workflow, and recovery instructions, see .hive/PROTOCOL.md',
].join('\n')

const getHiveEnv = (): HiveEnv => {
  const values = Object.fromEntries(
    REQUIRED_ENV_KEYS.map((key) => [key, process.env[key]])
  ) as Partial<Record<HiveEnvKey, string>>

  if (REQUIRED_ENV_KEYS.some((key) => !values[key])) {
    throw new Error('Missing required Hive environment variables')
  }

  return values as HiveEnv
}

const getBaseUrl = (env: HiveEnv) => `http://127.0.0.1:${env.HIVE_PORT}`

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const describeFetchError = (baseUrl: string, error: unknown) => {
  const cause =
    error instanceof Error && error.cause instanceof Error ? ` (${error.cause.message})` : ''
  const message = error instanceof Error ? error.message : String(error)
  return `Failed to reach Hive runtime at ${baseUrl}: ${message}${cause}. Check HIVE_PORT and make sure the Hive runtime is still running.`
}

const fetchRuntime = async (baseUrl: string, path: string, init: RequestInit) => {
  try {
    return await fetch(`${baseUrl}${path}`, init)
  } catch (error) {
    throw new Error(describeFetchError(baseUrl, error))
  }
}

const readHttpErrorDetail = async (response: Response) => {
  const text = await response.text().catch(() => '')
  const trimmed = text.trim()
  if (!trimmed) return ''

  try {
    const body = JSON.parse(trimmed) as { error?: unknown }
    if (typeof body.error === 'string' && body.error.trim()) {
      return body.error.trim()
    }
  } catch {
    // Non-JSON responses still carry useful diagnostics in their text body.
  }

  return trimmed
}

const throwHttpError = async (response: Response): Promise<never> => {
  const detail = await readHttpErrorDetail(response)
  throw new Error(
    detail
      ? `Request failed with status ${response.status}: ${detail}`
      : `Request failed with status ${response.status}`
  )
}

const postJson = async (baseUrl: string, path: string, body: unknown) => {
  const response = await fetchRuntime(baseUrl, path, {
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  })

  if (!response.ok) {
    await throwHttpError(response)
  }

  return response
}

interface TeamReportResponse {
  dispatch_id: string | null
  forward_error?: string | null
  forwarded?: boolean
  ok: true
}

const assertForwardedToOrchestrator = (payload: TeamReportResponse, message: string) => {
  if (payload.forwarded === false && payload.forward_error) {
    throw new Error(`${message}: ${payload.forward_error}`)
  }
}

const REPORT_USAGE =
  'Usage: team report (<result> | --stdin) [--dispatch <dispatch-id>] [--artifact <path>]'
const STATUS_USAGE = 'Usage: team status (<current status> | --stdin) [--artifact <path>]'
export const APPROVE_USAGE =
  'Usage: team approve "<action>" [--risk high|medium] [--target <worker-name>] [--chat <chat_id>]'
export const CANCEL_USAGE = 'Usage: team cancel --dispatch <dispatch-id> <reason>'
export const RECOVER_USAGE = 'Usage: team recover <dispatch-id>'
export const ABANDON_USAGE = 'Usage: team abandon <dispatch-id> --confirm-worker-stopped'
export const FEISHU_REPLY_USAGE =
  'Usage: team feishu reply [--chat <chat_id>] [--message-id <message_id>] [--file <path>] (<text> | <caption> | omit when --file given)'

const usageFor = (command: string) => (command === 'status' ? STATUS_USAGE : REPORT_USAGE)

const withUsage = (message: string, command: string) => `${message}\n\n${usageFor(command)}`

export interface ParsedReportArgs {
  artifacts: string[]
  dispatchId: string | undefined
  result: string | null
  useStdin: boolean
  // M43 accept-gate reviewer 主路径选项；只 report 命令使用，status 命令不支持。
  reviewsDispatchId?: string
  verdict?: 'accepted' | 'rejected' | 'waived'
  verdictReason?: string
}

export interface ParsedAcceptArgs {
  dispatchId: string
  reason: string
  verdict: 'accepted' | 'waived'
}

export const ACCEPT_USAGE =
  'Usage: team accept <coder-dispatch-id> --reason "<must reference reviewer dispatch_id>" [--verdict accepted|waived]'

export const parseAcceptArgs = (args: string[]): ParsedAcceptArgs => {
  const positionals: string[] = []
  let reason: string | undefined
  let verdict: 'accepted' | 'waived' = 'accepted'
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === undefined) continue
    if (arg === '--reason') {
      const next = args[index + 1]
      if (next === undefined) {
        throw new Error(`--reason requires a value\n\n${ACCEPT_USAGE}`)
      }
      reason = next
      index += 1
      continue
    }
    if (arg === '--verdict') {
      const next = args[index + 1]
      if (next !== 'accepted' && next !== 'waived') {
        throw new Error(`--verdict must be accepted or waived\n\n${ACCEPT_USAGE}`)
      }
      verdict = next
      index += 1
      continue
    }
    if (arg.startsWith('--')) {
      throw new Error(`Unknown argument: ${arg}\n\n${ACCEPT_USAGE}`)
    }
    positionals.push(arg)
  }
  if (positionals.length !== 1 || !positionals[0]?.trim()) {
    throw new Error(`Missing <coder-dispatch-id>\n\n${ACCEPT_USAGE}`)
  }
  if (!reason?.trim()) {
    throw new Error(`Missing --reason\n\n${ACCEPT_USAGE}`)
  }
  return { dispatchId: positionals[0].trim(), reason: reason.trim(), verdict }
}

export interface ParsedFeishuReplyArgs {
  chatId: string | undefined
  /** M44: 出站媒体路径（可选）；存在时 text 当作 caption（可空）。 */
  file: string | undefined
  messageId: string | undefined
  text: string
}

export interface ParsedApproveArgs {
  action: string
  chatId: string | undefined
  risk: 'high' | 'medium'
  target: string | null
}

export interface ParsedCancelArgs {
  dispatchId: string
  reason: string
}

export interface ParsedRecoverArgs {
  dispatchId: string
}

export interface ParsedAbandonArgs {
  confirmWorkerStopped: boolean
  dispatchId: string
}

export const parseApproveArgs = (args: string[]): ParsedApproveArgs => {
  const positionals: string[] = []
  let chatId: string | undefined
  let risk: 'high' | 'medium' = 'high'
  let target: string | null = null

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === undefined) continue

    if (arg === '--chat') {
      const next = args[index + 1]
      if (next === undefined || next.startsWith('--')) {
        throw new Error(`--chat requires a value\n\n${APPROVE_USAGE}`)
      }
      chatId = next
      index += 1
      continue
    }

    if (arg === '--risk') {
      const next = args[index + 1]
      if (next !== 'high' && next !== 'medium') {
        throw new Error(`--risk must be high or medium\n\n${APPROVE_USAGE}`)
      }
      risk = next
      index += 1
      continue
    }

    if (arg === '--target') {
      const next = args[index + 1]
      if (next === undefined || next.startsWith('--')) {
        throw new Error(`--target requires a value\n\n${APPROVE_USAGE}`)
      }
      target = next
      index += 1
      continue
    }

    if (arg.startsWith('--')) {
      throw new Error(`Unknown argument: ${arg}\n\n${APPROVE_USAGE}`)
    }

    positionals.push(arg)
  }

  const action = positionals.join(' ').trim()
  if (!action) {
    throw new Error(`Missing <action>\n\n${APPROVE_USAGE}`)
  }

  return { action, chatId, risk, target }
}

export const parseCancelArgs = (args: string[]): ParsedCancelArgs => {
  const positionals: string[] = []
  let dispatchId: string | undefined

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === undefined) continue

    if (arg === '--dispatch') {
      const next = args[index + 1]
      if (next === undefined || next.startsWith('--')) {
        throw new Error(`--dispatch requires a value\n\n${CANCEL_USAGE}`)
      }
      dispatchId = next
      index += 1
      continue
    }

    if (arg.startsWith('--')) {
      throw new Error(`Unknown argument: ${arg}\n\n${CANCEL_USAGE}`)
    }

    positionals.push(arg)
  }

  if (!dispatchId) {
    throw new Error(`Missing --dispatch <dispatch-id>\n\n${CANCEL_USAGE}`)
  }

  const reason = positionals.join(' ').trim()
  if (!reason) {
    throw new Error(`Missing <reason>\n\n${CANCEL_USAGE}`)
  }

  return { dispatchId, reason }
}

export const parseRecoverArgs = (args: string[]): ParsedRecoverArgs => {
  if (args.length !== 1 || !args[0]?.trim() || args[0].startsWith('--')) {
    throw new Error(RECOVER_USAGE)
  }
  return { dispatchId: args[0].trim() }
}

export const parseAbandonArgs = (args: string[]): ParsedAbandonArgs => {
  const positionals: string[] = []
  let confirmWorkerStopped = false
  for (const arg of args) {
    if (arg === '--confirm-worker-stopped') {
      confirmWorkerStopped = true
      continue
    }
    if (arg.startsWith('--')) {
      throw new Error(`Unknown argument: ${arg}\n\n${ABANDON_USAGE}`)
    }
    positionals.push(arg)
  }
  if (positionals.length !== 1 || !positionals[0]?.trim()) {
    throw new Error(`Missing <dispatch-id>\n\n${ABANDON_USAGE}`)
  }
  if (!confirmWorkerStopped) {
    throw new Error(`Missing --confirm-worker-stopped\n\n${ABANDON_USAGE}`)
  }
  return { confirmWorkerStopped, dispatchId: positionals[0].trim() }
}

export const MOBILE_SEND_MEDIA_USAGE =
  'Usage: team mobile-send-media --file <path> [--text "<caption>"]'

export const parseMobileSendMediaArgs = (args: string[]) => {
  let file: string | undefined
  let text: string | undefined
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === undefined) continue
    if (arg === '--file') {
      const next = args[index + 1]
      if (next === undefined || next.startsWith('--')) {
        throw new Error(`--file requires a value\n\n${MOBILE_SEND_MEDIA_USAGE}`)
      }
      file = next
      index += 1
      continue
    }
    if (arg === '--text') {
      const next = args[index + 1]
      if (next === undefined) {
        throw new Error(`--text requires a value\n\n${MOBILE_SEND_MEDIA_USAGE}`)
      }
      text = next
      index += 1
      continue
    }
    if (arg.startsWith('--')) {
      throw new Error(`Unknown argument: ${arg}\n\n${MOBILE_SEND_MEDIA_USAGE}`)
    }
    throw new Error(`Unexpected positional argument: ${arg}\n\n${MOBILE_SEND_MEDIA_USAGE}`)
  }
  if (!file?.trim()) {
    throw new Error(`Missing --file <path>\n\n${MOBILE_SEND_MEDIA_USAGE}`)
  }
  return { file: file.trim(), ...(text !== undefined ? { text } : {}) }
}

const parseMobileReplyArgs = (args: string[]) => {
  const textParts: string[] = []
  let voiceLatencyTurnId: string | undefined
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === undefined) continue
    if (arg === '--voice-latency-turn-id') {
      const value = args[index + 1]
      if (!value)
        throw new Error('Usage: team mobile-reply [--voice-latency-turn-id <turn-id>] "<text>"')
      voiceLatencyTurnId = value
      index += 1
      continue
    }
    textParts.push(arg)
  }
  return {
    text: textParts.join(' ').trim(),
    ...(voiceLatencyTurnId ? { voiceLatencyTurnId } : {}),
  }
}

export const parseFeishuReplyArgs = (args: string[]): ParsedFeishuReplyArgs => {
  const positionals: string[] = []
  let chatId: string | undefined
  let messageId: string | undefined
  let file: string | undefined

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === undefined) continue

    if (arg === '--chat') {
      const next = args[index + 1]
      if (next === undefined || next.startsWith('--')) {
        throw new Error(`--chat requires a value\n\n${FEISHU_REPLY_USAGE}`)
      }
      chatId = next
      index += 1
      continue
    }

    if (arg === '--message-id') {
      const next = args[index + 1]
      if (next === undefined || next.startsWith('--')) {
        throw new Error(`--message-id requires a value\n\n${FEISHU_REPLY_USAGE}`)
      }
      messageId = next
      index += 1
      continue
    }

    // M44: --file <path>（媒体出站）；文件给了之后 positional text 当 caption（可空）。
    if (arg === '--file') {
      const next = args[index + 1]
      if (next === undefined || next.startsWith('--')) {
        throw new Error(`--file requires a value\n\n${FEISHU_REPLY_USAGE}`)
      }
      file = next
      index += 1
      continue
    }

    if (arg.startsWith('--')) {
      throw new Error(`Unknown argument: ${arg}\n\n${FEISHU_REPLY_USAGE}`)
    }

    positionals.push(arg)
  }

  const text = positionals.join(' ').trim()
  // M44: --file 没给时 text 必填（旧契约）；--file 给了时 text 是 caption，可空（飞书会只发媒体）。
  if (!file && !text) {
    throw new Error(`Missing <text>\n\n${FEISHU_REPLY_USAGE}`)
  }

  return { chatId, file, messageId, text }
}

export const parseReportArgs = (args: string[], command = 'report'): ParsedReportArgs => {
  const positionals: string[] = []
  const artifacts: string[] = []
  let dispatchId: string | undefined
  let useStdin = false
  let reviewsDispatchId: string | undefined
  let verdict: 'accepted' | 'rejected' | 'waived' | undefined
  let verdictReason: string | undefined

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === undefined) continue

    // Backward-compatible no-op: reports are interpreted from their text.
    if (arg === '--success' || arg === '--failed') continue

    if (arg === '--stdin') {
      useStdin = true
      continue
    }

    if (arg === '--artifact') {
      const next = args[index + 1]
      if (next === undefined || next.startsWith('--')) {
        throw new Error(withUsage('--artifact requires a value', command))
      }
      artifacts.push(next)
      index += 1
      continue
    }

    if (arg === '--reviews') {
      if (command === 'status') {
        throw new Error(withUsage('team status does not accept --reviews', command))
      }
      const next = args[index + 1]
      if (next === undefined || next.startsWith('--')) {
        throw new Error(withUsage('--reviews requires a coder dispatch_id', command))
      }
      reviewsDispatchId = next
      index += 1
      continue
    }

    if (arg === '--verdict') {
      if (command === 'status') {
        throw new Error(withUsage('team status does not accept --verdict', command))
      }
      const next = args[index + 1]
      if (next !== 'accepted' && next !== 'rejected' && next !== 'waived') {
        throw new Error(withUsage('--verdict must be accepted | rejected | waived', command))
      }
      verdict = next
      index += 1
      continue
    }

    if (arg === '--reason') {
      if (command === 'status') {
        throw new Error(withUsage('team status does not accept --reason', command))
      }
      const next = args[index + 1]
      if (next === undefined) {
        throw new Error(withUsage('--reason requires a value', command))
      }
      verdictReason = next
      index += 1
      continue
    }

    if (arg === '--dispatch') {
      if (command === 'status') {
        throw new Error(
          withUsage(
            'team status does not accept --dispatch; use team report for assigned work',
            command
          )
        )
      }
      const next = args[index + 1]
      if (next === undefined || next.startsWith('--')) {
        throw new Error(withUsage('--dispatch requires a value', command))
      }
      dispatchId = next
      index += 1
      continue
    }

    if (arg.startsWith('--')) {
      throw new Error(withUsage(`Unknown argument: ${arg}`, command))
    }

    positionals.push(arg)
  }

  if (useStdin && positionals.length > 0) {
    throw new Error(
      withUsage(
        '--stdin is mutually exclusive with a positional argument; pass the body on stdin or as an argument, not both',
        command
      )
    )
  }

  if (!useStdin && positionals.length === 0) {
    const label = command === 'status' ? '<current status>' : '<result>'
    throw new Error(withUsage(`Missing ${label} (or pass --stdin to read it from stdin)`, command))
  }
  if (positionals.length > 1) {
    const label = command === 'status' ? 'status' : 'result'
    throw new Error(
      withUsage(
        `Expected exactly one ${label} positional, got ${positionals.length}: ${positionals
          .map((value) => JSON.stringify(value))
          .join(', ')}`,
        command
      )
    )
  }

  // M43: --reviews 与 --verdict 必须配对，独缺一个就拒（指引正确用法）。
  if ((reviewsDispatchId === undefined) !== (verdict === undefined)) {
    throw new Error(withUsage('--reviews and --verdict must be used together', command))
  }
  if (verdict !== undefined && !verdictReason?.trim()) {
    throw new Error(withUsage('--verdict requires --reason', command))
  }
  return {
    result: useStdin ? null : (positionals[0] ?? null),
    artifacts,
    dispatchId,
    useStdin,
    ...(reviewsDispatchId !== undefined ? { reviewsDispatchId } : {}),
    ...(verdict !== undefined ? { verdict } : {}),
    ...(verdictReason !== undefined ? { verdictReason } : {}),
  }
}

export const readStdinToString = async (command = 'report'): Promise<string> => {
  if (process.stdin.isTTY) {
    throw new Error(
      withUsage(
        '--stdin requires piped input, but stdin is a TTY. Did you forget to pipe content in?',
        command
      )
    )
  }
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  const content = Buffer.concat(chunks).toString('utf8')
  if (!content.trim()) {
    throw new Error(withUsage('--stdin received empty input', command))
  }
  return content
}

export const runTeamCommand = async (argv: string[]) => {
  const [command, ...args] = argv

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    console.log(TEAM_USAGE)
    return
  }

  if (command === 'list') {
    const env = getHiveEnv()
    const baseUrl = getBaseUrl(env)
    const response = await fetchRuntime(baseUrl, `/api/workspaces/${env.HIVE_PROJECT_ID}/team`, {
      method: 'GET',
      headers: {
        'x-hive-agent-id': env.HIVE_AGENT_ID,
        'x-hive-agent-token': env.HIVE_AGENT_TOKEN,
      },
    })

    if (!response.ok) {
      await throwHttpError(response)
    }

    console.log(JSON.stringify(await response.json()))
    return
  }

  if (command === 'send') {
    const [workerName, ...taskParts] = args
    const task = taskParts.join(' ').trim()
    if (!workerName || !task || uuidPattern.test(workerName)) {
      throw new Error('Usage: team send <worker-name> <task>')
    }

    const env = getHiveEnv()
    const baseUrl = getBaseUrl(env)
    const response = await postJson(baseUrl, '/api/team/send', {
      hive_port: env.HIVE_PORT,
      project_id: env.HIVE_PROJECT_ID,
      from_agent_id: env.HIVE_AGENT_ID,
      token: env.HIVE_AGENT_TOKEN,
      to: workerName,
      text: task,
    })
    console.log(JSON.stringify(await response.json()))
    return
  }

  if (command === 'cancel') {
    const cancel = parseCancelArgs(args)
    const env = getHiveEnv()
    const baseUrl = getBaseUrl(env)
    const response = await postJson(baseUrl, '/api/team/cancel', {
      dispatch_id: cancel.dispatchId,
      project_id: env.HIVE_PROJECT_ID,
      from_agent_id: env.HIVE_AGENT_ID,
      token: env.HIVE_AGENT_TOKEN,
      reason: cancel.reason,
    })
    const payload = (await response.json()) as TeamReportResponse
    assertForwardedToOrchestrator(
      payload,
      'Hive recorded the cancellation, but could not deliver it to Orchestrator in real time'
    )
    return
  }

  if (command === 'recover') {
    const recover = parseRecoverArgs(args)
    const env = getHiveEnv()
    const baseUrl = getBaseUrl(env)
    const response = await postJson(baseUrl, '/api/team/recover', {
      dispatch_id: recover.dispatchId,
      project_id: env.HIVE_PROJECT_ID,
      from_agent_id: env.HIVE_AGENT_ID,
      token: env.HIVE_AGENT_TOKEN,
    })
    console.log(JSON.stringify(await response.json()))
    return
  }

  if (command === 'abandon') {
    const abandon = parseAbandonArgs(args)
    const env = getHiveEnv()
    const baseUrl = getBaseUrl(env)
    const response = await postJson(baseUrl, '/api/team/abandon', {
      confirm_worker_stopped: abandon.confirmWorkerStopped,
      dispatch_id: abandon.dispatchId,
      project_id: env.HIVE_PROJECT_ID,
      from_agent_id: env.HIVE_AGENT_ID,
      token: env.HIVE_AGENT_TOKEN,
    })
    console.log(JSON.stringify(await response.json()))
    return
  }

  if (command === 'approve') {
    const approval = parseApproveArgs(args)
    const env = getHiveEnv()
    const baseUrl = getBaseUrl(env)
    const response = await fetchRuntime(baseUrl, '/internal/feishu/approval-request', {
      body: JSON.stringify({
        action: approval.action,
        ...(approval.chatId ? { chatId: approval.chatId } : {}),
        risk: approval.risk,
        target: approval.target,
        workspaceId: env.HIVE_PROJECT_ID,
      }),
      headers: {
        authorization: `Bearer ${env.HIVE_AGENT_TOKEN}`,
        'content-type': 'application/json',
        'x-hive-agent-id': env.HIVE_AGENT_ID,
      },
      method: 'POST',
    })

    if (!response.ok) {
      await throwHttpError(response)
    }
    const payload = (await response.json()) as { approval_id?: unknown }
    if (typeof payload.approval_id !== 'string') {
      throw new Error('approval response missing approval_id')
    }
    console.log(payload.approval_id)
    return
  }

  if (command === 'mobile-send-media') {
    const parsed = parseMobileSendMediaArgs(args)
    const env = getHiveEnv()
    const baseUrl = getBaseUrl(env)
    const response = await postJson(baseUrl, '/api/team/mobile-send-media', {
      file: parsed.file,
      from_agent_id: env.HIVE_AGENT_ID,
      project_id: env.HIVE_PROJECT_ID,
      token: env.HIVE_AGENT_TOKEN,
      ...(parsed.text !== undefined ? { text: parsed.text } : {}),
    })
    if (!response.ok) {
      await throwHttpError(response)
    }
    return
  }

  if (command === 'mobile-reply') {
    const reply = parseMobileReplyArgs(args)
    if (!reply.text) {
      throw new Error('Usage: team mobile-reply "<text>"')
    }
    const env = getHiveEnv()
    const baseUrl = getBaseUrl(env)
    const response = await postJson(baseUrl, '/api/team/mobile-reply', {
      from_agent_id: env.HIVE_AGENT_ID,
      project_id: env.HIVE_PROJECT_ID,
      text: reply.text,
      token: env.HIVE_AGENT_TOKEN,
      ...(reply.voiceLatencyTurnId ? { voice_latency_turn_id: reply.voiceLatencyTurnId } : {}),
    })
    if (!response.ok) {
      await throwHttpError(response)
    }
    return
  }

  if (command === 'feishu') {
    const [subcommand, ...subcommandArgs] = args
    if (subcommand !== 'reply') {
      throw new Error(FEISHU_REPLY_USAGE)
    }

    const reply = parseFeishuReplyArgs(subcommandArgs)
    const env = getHiveEnv()
    const baseUrl = getBaseUrl(env)
    const response = await fetchRuntime(baseUrl, '/internal/feishu/outbound', {
      body: JSON.stringify({
        ...(reply.chatId ? { chatId: reply.chatId } : {}),
        ...(reply.messageId ? { messageId: reply.messageId } : {}),
        // M44: --file 透传；text 当 caption（飞书侧紧跟一条 text 发出）。
        ...(reply.file ? { file: reply.file } : {}),
        // 普通 text 路径仍 require text；媒体路径 text 可为空字符串（caption 选填）。
        text: reply.text,
      }),
      headers: {
        authorization: `Bearer ${env.HIVE_AGENT_TOKEN}`,
        'content-type': 'application/json',
        'x-hive-agent-id': env.HIVE_AGENT_ID,
      },
      method: 'POST',
    })

    if (!response.ok) {
      await throwHttpError(response)
    }
    return
  }

  if (command === 'status') {
    const report = parseReportArgs(args, 'status')
    const body = report.useStdin ? await readStdinToString('status') : (report.result ?? '')

    const env = getHiveEnv()
    const baseUrl = getBaseUrl(env)
    const response = await postJson(baseUrl, '/api/team/status', {
      project_id: env.HIVE_PROJECT_ID,
      from_agent_id: env.HIVE_AGENT_ID,
      token: env.HIVE_AGENT_TOKEN,
      result: body,
      artifacts: report.artifacts,
    })
    const payload = (await response.json()) as TeamReportResponse
    assertForwardedToOrchestrator(
      payload,
      'Hive recorded the status update, but could not deliver it to Orchestrator in real time'
    )
    return
  }

  if (command === 'report') {
    const report = parseReportArgs(args)
    const body = report.useStdin ? await readStdinToString('report') : (report.result ?? '')

    const env = getHiveEnv()
    const baseUrl = getBaseUrl(env)
    const response = await postJson(baseUrl, '/api/team/report', {
      ...(report.dispatchId ? { dispatch_id: report.dispatchId } : {}),
      project_id: env.HIVE_PROJECT_ID,
      from_agent_id: env.HIVE_AGENT_ID,
      token: env.HIVE_AGENT_TOKEN,
      result: body,
      artifacts: report.artifacts,
      ...(report.reviewsDispatchId ? { reviews_dispatch_id: report.reviewsDispatchId } : {}),
      ...(report.verdict ? { verdict: report.verdict } : {}),
      ...(report.verdictReason ? { verdict_reason: report.verdictReason } : {}),
    })
    const payload = (await response.json()) as TeamReportResponse
    assertForwardedToOrchestrator(
      payload,
      'Hive recorded the report, but could not deliver it to Orchestrator in real time'
    )
    return
  }

  if (command === 'accept') {
    const accept = parseAcceptArgs(args)
    const env = getHiveEnv()
    const baseUrl = getBaseUrl(env)
    await postJson(baseUrl, '/api/team/accept', {
      project_id: env.HIVE_PROJECT_ID,
      from_agent_id: env.HIVE_AGENT_ID,
      token: env.HIVE_AGENT_TOKEN,
      dispatch_id: accept.dispatchId,
      reason: accept.reason,
      verdict: accept.verdict,
    })
    return
  }

  throw new Error('Unsupported team command')
}

const isMainModule = process.argv[1]
  ? fileURLToPath(import.meta.url) === realpathSync(process.argv[1])
  : false

if (isMainModule) {
  void runTeamCommand(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
