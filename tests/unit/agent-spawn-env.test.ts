import { afterEach, describe, expect, test, vi } from 'vitest'

import { createAgentSpawnEnv } from '../../src/server/agent-manager.js'
import { CLAUDE_WORKFLOW_ANTHROPIC_BASE_URL } from '../../src/server/role-templates.js'

describe('agent spawn env', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  test('strips nested Claude Code markers while preserving agent runtime env', () => {
    const env = createAgentSpawnEnv({
      AI_AGENT: 'claude',
      ANTHROPIC_API_KEY: 'sk-ant-test',
      CLAUDECODE: '1',
      CLAUDE_CODE_ENTRYPOINT: 'cli',
      CLAUDE_CODE_EXECPATH: '/Applications/Claude.app',
      CLAUDE_CODE_SESSION_ID: 'outer-session',
      CLAUDE_EFFORT: 'high',
      CLAUDE_CODE_MAX_OUTPUT_TOKENS: '4096',
      CLAUDE_CODE_OAUTH_TOKEN: 'oauth-token',
      CLAUDE_CODE_USE_BEDROCK: '1',
      CLAUDE_PROJECTS_ROOT: '/tmp/claude-projects',
      CODEX_HOME: '/tmp/codex',
      HIVE_AGENT_ID: 'worker-1',
      HIVE_PORT: '4010',
      PATH: '/tmp/bin',
    })

    expect(env.CLAUDECODE).toBeUndefined()
    expect(env.CLAUDE_CODE_ENTRYPOINT).toBeUndefined()
    expect(env.CLAUDE_CODE_EXECPATH).toBeUndefined()
    expect(env.CLAUDE_CODE_SESSION_ID).toBeUndefined()
    expect(env.CLAUDE_EFFORT).toBeUndefined()
    expect(env.AI_AGENT).toBeUndefined()
    expect(env.CLAUDE_CODE_MAX_OUTPUT_TOKENS).toBe('4096')
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('oauth-token')
    expect(env.CLAUDE_CODE_USE_BEDROCK).toBe('1')
    expect(env.HIVE_AGENT_ID).toBe('worker-1')
    expect(env.HIVE_PORT).toBe('4010')
    expect(env.PATH).toBe('/tmp/bin')
    expect(env.CODEX_HOME).toBe('/tmp/codex')
    expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-test')
    expect(env.CLAUDE_PROJECTS_ROOT).toBe('/tmp/claude-projects')
  })

  test('strips nested markers inherited from the Hive process env', () => {
    vi.stubEnv('CLAUDECODE', '1')
    vi.stubEnv('CLAUDE_CODE_SESSION_ID', 'outer-session')
    vi.stubEnv('CLAUDE_CODE_OAUTH_TOKEN', 'oauth-token-from-parent')
    vi.stubEnv('HIVE_PARENT_ENV_CHECK', 'kept')
    vi.stubEnv('RELAY_AUTH_TOKEN', 'relay-secret')

    const env = createAgentSpawnEnv(
      { HIVE_AGENT_ID: 'worker-process-env' },
      { providerFamily: 'claude' }
    )

    expect(env.CLAUDECODE).toBeUndefined()
    expect(env.CLAUDE_CODE_SESSION_ID).toBeUndefined()
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('oauth-token-from-parent')
    expect(env.HIVE_PARENT_ENV_CHECK).toBeUndefined()
    expect(env.RELAY_AUTH_TOKEN).toBeUndefined()
    expect(env.HIVE_AGENT_ID).toBe('worker-process-env')
  })

  test('injects GLM_API_KEY as Anthropic auth token only when workflow flag authorizes it', () => {
    vi.stubEnv('GLM_API_KEY', 'glm-secret')
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-real-anthropic')

    const workflowEnv = createAgentSpawnEnv(
      {
        ANTHROPIC_BASE_URL: CLAUDE_WORKFLOW_ANTHROPIC_BASE_URL,
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'glm-5.2',
        HIVE_AGENT_ID: 'workflow-worker',
        HIVE_WORKFLOW_ALLOWED: '1',
      },
      { providerFamily: 'claude', workflowAllowed: true }
    )
    const ordinaryEnv = createAgentSpawnEnv(
      {
        ANTHROPIC_BASE_URL: CLAUDE_WORKFLOW_ANTHROPIC_BASE_URL,
        HIVE_AGENT_ID: 'ordinary-worker',
      },
      { providerFamily: 'claude' }
    )

    expect(workflowEnv.ANTHROPIC_AUTH_TOKEN).toBe('glm-secret')
    expect(workflowEnv.ANTHROPIC_API_KEY).toBeUndefined()
    expect(workflowEnv.GLM_API_KEY).toBeUndefined()
    expect(ordinaryEnv.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
    expect(ordinaryEnv.GLM_API_KEY).toBeUndefined()
  })

  test('keeps only the selected provider auth keys from the Hive process env', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'anthropic-secret')
    vi.stubEnv('CLAUDE_CODE_OAUTH_TOKEN', 'claude-oauth-token')
    vi.stubEnv('OPENAI_API_KEY', 'openai-secret')
    vi.stubEnv('GEMINI_API_KEY', 'gemini-secret')
    vi.stubEnv('OPENROUTER_API_KEY', 'openrouter-secret')
    vi.stubEnv('DATABASE_URL', 'postgres://secret')
    vi.stubEnv('HIVE_AGENT_TOKEN', 'parent-agent-token')

    const claudeEnv = createAgentSpawnEnv(
      { HIVE_AGENT_ID: 'claude-worker' },
      { providerFamily: 'claude' }
    )
    const codexEnv = createAgentSpawnEnv(
      { HIVE_AGENT_ID: 'codex-worker' },
      { providerFamily: 'codex' }
    )
    const geminiEnv = createAgentSpawnEnv(
      { HIVE_AGENT_ID: 'gemini-worker' },
      { providerFamily: 'gemini' }
    )
    const openCodeEnv = createAgentSpawnEnv(
      { HIVE_AGENT_ID: 'opencode-worker' },
      { providerFamily: 'opencode' }
    )
    const customEnv = createAgentSpawnEnv(
      { HIVE_AGENT_ID: 'custom-worker' },
      { providerFamily: 'custom' }
    )

    expect(claudeEnv.ANTHROPIC_API_KEY).toBe('anthropic-secret')
    expect(claudeEnv.CLAUDE_CODE_OAUTH_TOKEN).toBe('claude-oauth-token')
    expect(claudeEnv.OPENAI_API_KEY).toBeUndefined()
    expect(claudeEnv.GEMINI_API_KEY).toBeUndefined()
    expect(claudeEnv.DATABASE_URL).toBeUndefined()

    expect(codexEnv.OPENAI_API_KEY).toBe('openai-secret')
    expect(codexEnv.ANTHROPIC_API_KEY).toBeUndefined()
    expect(codexEnv.GEMINI_API_KEY).toBeUndefined()
    expect(codexEnv.DATABASE_URL).toBeUndefined()
    expect(codexEnv.HIVE_AGENT_TOKEN).toBeUndefined()

    expect(geminiEnv.GEMINI_API_KEY).toBe('gemini-secret')
    expect(geminiEnv.OPENAI_API_KEY).toBeUndefined()

    expect(openCodeEnv.ANTHROPIC_API_KEY).toBe('anthropic-secret')
    expect(openCodeEnv.OPENAI_API_KEY).toBe('openai-secret')
    expect(openCodeEnv.GEMINI_API_KEY).toBe('gemini-secret')
    expect(openCodeEnv.OPENROUTER_API_KEY).toBe('openrouter-secret')
    expect(openCodeEnv.DATABASE_URL).toBeUndefined()

    expect(customEnv.ANTHROPIC_API_KEY).toBeUndefined()
    expect(customEnv.OPENAI_API_KEY).toBeUndefined()
    expect(customEnv.GEMINI_API_KEY).toBeUndefined()
  })

  test('claude scope + CLAUDE_CODE_USE_BEDROCK=1 → AWS_* 鉴权 env 才放行', () => {
    // Bedrock 模式真的需要 AWS keys；非 Bedrock 模式让 AWS_* 经普通 claude worker
    // 一刀放行会扩大攻击面（普通 worker 拿到 AWS_SECRET_ACCESS_KEY 可去碰 hippo 的
    // 其他 AWS 资源）。impl 把 BEDROCK_PARENT_ENV_KEYS 钉成"flag 触发才挂"，本测验证。
    vi.stubEnv('AWS_ACCESS_KEY_ID', 'AKIA-host')
    vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'aws-secret-host')
    vi.stubEnv('AWS_SESSION_TOKEN', 'aws-sess-host')
    vi.stubEnv('AWS_REGION', 'us-east-1')

    // 不设 CLAUDE_CODE_USE_BEDROCK → AWS_* 全 strip
    const ordinaryClaudeEnv = createAgentSpawnEnv(
      { HIVE_AGENT_ID: 'claude-worker' },
      { providerFamily: 'claude' }
    )
    expect(ordinaryClaudeEnv.AWS_ACCESS_KEY_ID).toBeUndefined()
    expect(ordinaryClaudeEnv.AWS_SECRET_ACCESS_KEY).toBeUndefined()
    expect(ordinaryClaudeEnv.AWS_SESSION_TOKEN).toBeUndefined()
    expect(ordinaryClaudeEnv.AWS_REGION).toBeUndefined()

    // 设 CLAUDE_CODE_USE_BEDROCK=1 → AWS_* 放行
    vi.stubEnv('CLAUDE_CODE_USE_BEDROCK', '1')
    const bedrockClaudeEnv = createAgentSpawnEnv(
      { HIVE_AGENT_ID: 'claude-bedrock-worker' },
      { providerFamily: 'claude' }
    )
    expect(bedrockClaudeEnv.AWS_ACCESS_KEY_ID).toBe('AKIA-host')
    expect(bedrockClaudeEnv.AWS_SECRET_ACCESS_KEY).toBe('aws-secret-host')
    expect(bedrockClaudeEnv.AWS_SESSION_TOKEN).toBe('aws-sess-host')
    expect(bedrockClaudeEnv.AWS_REGION).toBe('us-east-1')

    // 非 claude 家族即便有 BEDROCK flag 也不放 AWS_*（防 codex/gemini worker 越权）
    const codexEnv = createAgentSpawnEnv(
      { HIVE_AGENT_ID: 'codex-worker' },
      { providerFamily: 'codex' }
    )
    expect(codexEnv.AWS_ACCESS_KEY_ID).toBeUndefined()
    expect(codexEnv.AWS_SECRET_ACCESS_KEY).toBeUndefined()
  })

  test('claude scope + CLAUDE_CODE_USE_VERTEX=1 → GCP Vertex 鉴权 env 才放行', () => {
    vi.stubEnv('GOOGLE_CLOUD_PROJECT', 'hippo-vertex-proj')
    vi.stubEnv('GOOGLE_CLOUD_LOCATION', 'us-central1')
    vi.stubEnv('GOOGLE_APPLICATION_CREDENTIALS', '/Users/hippo/gcp.json')
    vi.stubEnv('CLOUD_ML_REGION', 'us-central1')

    const ordinaryEnv = createAgentSpawnEnv(
      { HIVE_AGENT_ID: 'claude-worker' },
      { providerFamily: 'claude' }
    )
    expect(ordinaryEnv.GOOGLE_CLOUD_PROJECT).toBeUndefined()
    expect(ordinaryEnv.GOOGLE_CLOUD_LOCATION).toBeUndefined()
    expect(ordinaryEnv.GOOGLE_APPLICATION_CREDENTIALS).toBeUndefined()
    expect(ordinaryEnv.CLOUD_ML_REGION).toBeUndefined()

    vi.stubEnv('CLAUDE_CODE_USE_VERTEX', '1')
    const vertexEnv = createAgentSpawnEnv(
      { HIVE_AGENT_ID: 'claude-vertex-worker' },
      { providerFamily: 'claude' }
    )
    expect(vertexEnv.GOOGLE_CLOUD_PROJECT).toBe('hippo-vertex-proj')
    expect(vertexEnv.GOOGLE_CLOUD_LOCATION).toBe('us-central1')
    expect(vertexEnv.GOOGLE_APPLICATION_CREDENTIALS).toBe('/Users/hippo/gcp.json')
    expect(vertexEnv.CLOUD_ML_REGION).toBe('us-central1')
  })

  test('**核心命门**：workflowAllowed=true + 非 GLM base URL → 父进程真 Anthropic 凭据被 strip（钟馗 round 2 抓的真泄漏）', () => {
    // 真实场景：workflow worker launch config 漏迁移、user 误改 ANTHROPIC_BASE_URL 指
    // 真 Anthropic 端，scope.workflowAllowed=true、HIVE_WORKFLOW_ALLOWED='1' 全在，
    // 但 ANTHROPIC_BASE_URL ≠ GLM URL。旧实现把 `delete env.ANTHROPIC_API_KEY` 关进
    // GLM route 分支内 → 进不去那个分支 → 父进程真 Anthropic key 留在 workflow worker
    // env 里（越权 + 可能被 worker 拿去打真 Anthropic 端）。
    //
    // 焊死方法：把 strip 从 GLM 分支提到外层 workflowAllowed 守卫，所有 workflow worker
    // 一律 strip ANTHROPIC_API_KEY，独立于 GLM 注入路径。
    //
    // 反向验证：把 `delete env.ANTHROPIC_API_KEY` 改回只在 GLM 分支里 → 本测试必红。
    vi.stubEnv('GLM_API_KEY', 'glm-secret')
    // 关键：stub 父进程真 ANTHROPIC_API_KEY；createScopedParentEnv 的 claude allowlist
    // 会把它复制进 env。本断言才能真红绿——否则旧测试因父就没 ANTHROPIC_API_KEY
    // 子 expect toBeUndefined 是 trivially pass，bug 被遮住。
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-real-anthropic-host')

    const env = createAgentSpawnEnv(
      {
        ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
        HIVE_AGENT_ID: 'misconfigured-workflow',
        HIVE_WORKFLOW_ALLOWED: '1',
      },
      { providerFamily: 'claude', workflowAllowed: true }
    )

    // 非 GLM URL → 不该合成 ANTHROPIC_AUTH_TOKEN（防拿 GLM key 打真 Anthropic 端 401）
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
    // 命门：父进程真 Anthropic key 必须被 strip，无论 base URL 是否 GLM
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
    // GLM_API_KEY 不在任何 allowlist → strip
    expect(env.GLM_API_KEY).toBeUndefined()
  })

  test('对照：非 workflow 的普通 claude worker 仍能继承父 ANTHROPIC_API_KEY（确认没把正常鉴权一起误删）', () => {
    // 跟上一条形成对照：workflow worker 必 strip，普通 worker 必继承。
    // 防"修过头"——一刀切 strip 会把普通 claude 工蜂的鉴权打掉。
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-real-anthropic-host')

    const env = createAgentSpawnEnv(
      {
        HIVE_AGENT_ID: 'ordinary-claude-worker',
      },
      { providerFamily: 'claude' } // 注意：无 workflowAllowed
    )

    // 普通 claude worker 必须继承父 ANTHROPIC_API_KEY，否则鉴权破
    expect(env.ANTHROPIC_API_KEY).toBe('sk-real-anthropic-host')
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
  })

  test('inputEnv 永远 override：caller 显式注入的字段不被 allowlist 挡（PATH/HIVE_AGENT_TOKEN 等）', () => {
    // bootstrap 把 PATH 拼成 HIVE_BIN_DIR + 原 PATH 灌进 inputEnv，必须穿透到 worker。
    // 各 HIVE_* 路由也是 inputEnv 注入。allowlist 只过滤 process.env 继承部分，
    // inputEnv 永远 override（caller 已审过）。
    vi.stubEnv('PATH', '/system/bin')

    const env = createAgentSpawnEnv(
      {
        PATH: '/opt/hive/bin:/system/bin',
        HIVE_PORT: '4010',
        HIVE_AGENT_ID: 'worker-1',
        HIVE_AGENT_TOKEN: 'tok-from-bootstrap',
        HIVE_WORKSPACE_ROOT: '/Users/hippo/code',
        // inputEnv 塞个 allowlist 之外的 key（来自 launch config 的 defaultEnv）
        CUSTOM_DECLARED_KEY: 'declared-by-caller',
      },
      { providerFamily: 'codex' }
    )

    expect(env.PATH).toBe('/opt/hive/bin:/system/bin')
    expect(env.HIVE_PORT).toBe('4010')
    expect(env.HIVE_AGENT_ID).toBe('worker-1')
    expect(env.HIVE_AGENT_TOKEN).toBe('tok-from-bootstrap')
    expect(env.HIVE_WORKSPACE_ROOT).toBe('/Users/hippo/code')
    expect(env.CUSTOM_DECLARED_KEY).toBe('declared-by-caller')
  })

  test('nested Claude markers strip 在所有 providerFamily 模式下生效（防 PTY 内套 PTY 跑 claude 时 outer session 串台）', () => {
    vi.stubEnv('AI_AGENT', 'claude')
    vi.stubEnv('CLAUDECODE', '1')
    vi.stubEnv('CLAUDE_CODE_ENTRYPOINT', 'cli')
    vi.stubEnv('CLAUDE_CODE_EXECPATH', '/Applications/Claude.app')
    vi.stubEnv('CLAUDE_CODE_SESSION_ID', 'outer-session')
    vi.stubEnv('CLAUDE_EFFORT', 'high')

    for (const family of ['claude', 'codex', 'gemini', 'opencode', 'custom'] as const) {
      const env = createAgentSpawnEnv(
        { HIVE_AGENT_ID: `${family}-worker` },
        { providerFamily: family }
      )
      expect(env.AI_AGENT, `${family} family AI_AGENT`).toBeUndefined()
      expect(env.CLAUDECODE, `${family} family CLAUDECODE`).toBeUndefined()
      expect(env.CLAUDE_CODE_ENTRYPOINT, `${family} family CLAUDE_CODE_ENTRYPOINT`).toBeUndefined()
      expect(env.CLAUDE_CODE_EXECPATH, `${family} family CLAUDE_CODE_EXECPATH`).toBeUndefined()
      expect(env.CLAUDE_CODE_SESSION_ID, `${family} family CLAUDE_CODE_SESSION_ID`).toBeUndefined()
      expect(env.CLAUDE_EFFORT, `${family} family CLAUDE_EFFORT`).toBeUndefined()
    }
  })

  test('POSIX 基线穿透：HOME/SHELL/LANG/LC_*/TMPDIR/USER 不被 allowlist 挡', () => {
    // 这些 env 是 shell 工具链 / locale / 临时目录的基础，任一 family（甚至 custom）
    // 都必须放行；只 claude family 收紧 AWS_*。
    vi.stubEnv('HOME', '/Users/hippo')
    vi.stubEnv('SHELL', '/bin/zsh')
    vi.stubEnv('LANG', 'en_US.UTF-8')
    vi.stubEnv('LC_ALL', 'en_US.UTF-8')
    vi.stubEnv('LC_CTYPE', 'en_US.UTF-8')
    vi.stubEnv('TMPDIR', '/var/folders/tmp')
    vi.stubEnv('USER', 'hippo')
    vi.stubEnv('LOGNAME', 'hippo')

    for (const family of ['claude', 'codex', 'gemini', 'opencode', 'custom'] as const) {
      const env = createAgentSpawnEnv(
        { HIVE_AGENT_ID: `${family}-worker` },
        { providerFamily: family }
      )
      expect(env.HOME, `${family} family HOME`).toBe('/Users/hippo')
      expect(env.SHELL, `${family} family SHELL`).toBe('/bin/zsh')
      expect(env.LANG, `${family} family LANG`).toBe('en_US.UTF-8')
      expect(env.LC_ALL, `${family} family LC_ALL`).toBe('en_US.UTF-8')
      expect(env.LC_CTYPE, `${family} family LC_CTYPE`).toBe('en_US.UTF-8')
      expect(env.TMPDIR, `${family} family TMPDIR`).toBe('/var/folders/tmp')
      expect(env.USER, `${family} family USER`).toBe('hippo')
      expect(env.LOGNAME, `${family} family LOGNAME`).toBe('hippo')
    }
  })

  test('preserves outbound proxy env without leaking nested markers or Anthropic endpoint credentials', () => {
    vi.stubEnv('HTTPS_PROXY', 'http://127.0.0.1:7890')
    vi.stubEnv('https_proxy', 'http://127.0.0.1:7891')
    vi.stubEnv('HTTP_PROXY', 'http://127.0.0.1:7892')
    vi.stubEnv('ALL_PROXY', 'socks5://127.0.0.1:7893')
    vi.stubEnv('NO_PROXY', 'localhost,127.0.0.1')
    vi.stubEnv('CLAUDECODE', '1')
    vi.stubEnv('CLAUDE_CODE_SESSION_ID', 'outer-session')
    vi.stubEnv('ANTHROPIC_BASE_URL', 'https://api.anthropic.com')
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'anthropic-auth-token')

    const env = createAgentSpawnEnv(
      { HIVE_AGENT_ID: 'codex-proxy-worker' },
      { providerFamily: 'codex' }
    )

    expect(env.HTTPS_PROXY).toBe('http://127.0.0.1:7890')
    expect(env.https_proxy).toBe('http://127.0.0.1:7891')
    expect(env.HTTP_PROXY).toBe('http://127.0.0.1:7892')
    expect(env.ALL_PROXY).toBe('socks5://127.0.0.1:7893')
    expect(env.NO_PROXY).toBe('localhost,127.0.0.1')
    expect(env.CLAUDECODE).toBeUndefined()
    expect(env.CLAUDE_CODE_SESSION_ID).toBeUndefined()
    expect(env.ANTHROPIC_BASE_URL).toBeUndefined()
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
  })
})
