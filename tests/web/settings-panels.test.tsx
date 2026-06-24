// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { ApiKeysPanel } from '../../web/src/settings/ApiKeysPanel.js'
import { CliDetectionPanel } from '../../web/src/settings/CliDetectionPanel.js'

const cliDetectionPayload = {
  agents: {
    claude: {
      command: 'claude',
      install_plan: null,
      installed: true,
      path: '/usr/local/bin/claude',
      preset_id: 'claude',
      version: 'claude 1.2.3',
    },
    codex: {
      command: 'codex',
      install_plan: {
        args: ['install', '-g', '@openai/codex'],
        command: 'npm',
        description: 'Install Codex CLI via npm.',
      },
      installed: false,
      path: null,
      preset_id: 'codex',
      version: null,
    },
    gemini: {
      command: 'gemini',
      install_plan: {
        args: ['install', '-g', '@google/gemini-cli'],
        command: 'npm',
        description: 'Install Gemini CLI via npm.',
      },
      installed: false,
      path: null,
      preset_id: 'gemini',
      version: null,
    },
    opencode: {
      command: 'opencode',
      install_plan: null,
      installed: true,
      path: '/usr/local/bin/opencode',
      preset_id: 'opencode',
      version: null,
    },
  },
}

const secretsPayload = {
  secrets: {
    ANTHROPIC_API_KEY: { present: false },
    ANTHROPIC_AUTH_TOKEN: { present: false },
    GLM_API_KEY: { present: true },
  },
}

let calls: Array<{ body: string | null; method: string; url: string }> = []

const stubFetch = () => {
  calls = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      calls.push({ body: (init?.body as string) ?? null, method, url })
      if (url.includes('/api/settings/cli-detection') && method === 'GET') {
        return new Response(JSON.stringify(cliDetectionPayload), {
          headers: { 'content-type': 'application/json' },
          status: 200,
        })
      }
      if (url.includes('/manual-path') && method === 'PUT') {
        return new Response(
          JSON.stringify({ installed: true, manual_path: '/x', preset_id: 'codex' }),
          { headers: { 'content-type': 'application/json' }, status: 200 }
        )
      }
      if (url.includes('/api/settings/secrets') && method === 'GET') {
        return new Response(JSON.stringify(secretsPayload), {
          headers: { 'content-type': 'application/json' },
          status: 200,
        })
      }
      if (url.includes('/api/settings/secrets') && method === 'POST') {
        return new Response(JSON.stringify({ key: 'ANTHROPIC_API_KEY', present: true }), {
          headers: { 'content-type': 'application/json' },
          status: 200,
        })
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    })
  )
}

beforeEach(() => stubFetch())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('CliDetectionPanel', () => {
  test('renders installed CLIs with path/version and not-installed ones with the install command', async () => {
    render(<CliDetectionPanel />)

    expect(await screen.findByText('Claude Code')).toBeInTheDocument()
    expect(screen.getByText('/usr/local/bin/claude')).toBeInTheDocument()
    expect(screen.getByText('claude 1.2.3')).toBeInTheDocument()
    // Not-installed Codex shows the copy-pasteable install command.
    expect(screen.getByText('npm install -g @openai/codex')).toBeInTheDocument()
    // Summary header: 2 of 4 installed.
    expect(screen.getByText('2 of 4 installed')).toBeInTheDocument()
  })

  test('manual path input PUTs the absolute path for that preset', async () => {
    render(<CliDetectionPanel />)
    await screen.findByText('Codex')

    // Toggle the manual-path input for the Codex row (second of the not-installed),
    // then submit a path.
    const toggles = screen.getAllByText('Point at a path manually')
    fireEvent.click(toggles[1]) // codex row
    const input = screen.getByPlaceholderText('Absolute path to the CLI executable')
    fireEvent.change(input, { target: { value: '/opt/bin/codex' } })
    fireEvent.click(screen.getByRole('button', { name: /set path/i }))

    await waitFor(() => {
      const put = calls.find((call) => call.method === 'PUT')
      expect(put).toBeTruthy()
      expect(put?.url).toContain('/api/settings/cli-detection/codex/manual-path')
      expect(JSON.parse(put?.body ?? '{}')).toEqual({ path: '/opt/bin/codex' })
    })
  })
})

describe('ApiKeysPanel', () => {
  test('shows present/not-set status, the restart notice, and all three whitelisted keys', async () => {
    render(<ApiKeysPanel />)

    expect(await screen.findByText('GLM API Key (glm-5.2)')).toBeInTheDocument()
    expect(screen.getByText('Anthropic API Key')).toBeInTheDocument()
    expect(screen.getByText('Anthropic Auth Token')).toBeInTheDocument()
    // GLM is present, Anthropic keys are not.
    expect(screen.getByText('Configured')).toBeInTheDocument()
    expect(screen.getAllByText('Not set').length).toBe(2)
    expect(screen.getByText(/take effect after you restart the runtime/i)).toBeInTheDocument()
  })

  test('saving a key POSTs {key,value} and never exposes a value field readback', async () => {
    render(<ApiKeysPanel />)
    await screen.findByText('Anthropic API Key')

    // The first "Set" button belongs to the first not-set key (ANTHROPIC_API_KEY).
    fireEvent.click(screen.getAllByRole('button', { name: /^set$/i })[0])
    const input = screen.getByPlaceholderText(/stays on this machine/i)
    expect(input).toHaveAttribute('type', 'password')
    fireEvent.change(input, { target: { value: 'sk-ant-secret' } })
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => {
      const post = calls.find((call) => call.method === 'POST')
      expect(post).toBeTruthy()
      expect(post?.url).toContain('/api/settings/secrets')
      expect(JSON.parse(post?.body ?? '{}')).toEqual({
        key: 'ANTHROPIC_API_KEY',
        value: 'sk-ant-secret',
      })
    })
  })
})
