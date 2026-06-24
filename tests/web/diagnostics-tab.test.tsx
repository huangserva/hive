// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { DiagnosticsTab } from '../../web/src/cockpit/tabs/DiagnosticsTab.js'

const diagnosticsPayload = {
  active_sentinel_alerts: [
    {
      detail: '关羽 has not reported in 12 minutes.',
      ruleId: 'R2',
      suggestedAction: 'Check the worker terminal.',
      tier: 'warn',
      title: 'Report overdue',
      workspace_name: 'hive-serva',
    },
  ],
  cli_detection: {
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
        install_plan: { args: ['install', '-g', '@openai/codex'], command: 'npm', description: '' },
        installed: false,
        path: null,
        preset_id: 'codex',
        version: null,
      },
      gemini: {
        command: 'gemini',
        install_plan: null,
        installed: true,
        path: '/usr/local/bin/gemini',
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
  },
  events: [
    {
      created_at: 1_768_900_000_000,
      id: 'evt-1',
      payload: {
        command: '/opt/homebrew/bin/codex',
        error: 'spawn codex ENOENT',
        event: 'dispatch_spawn_failed',
        path: '/usr/bin:/bin',
        task_summary: 'Implement the diagnostics tab',
        worker: '关羽',
        worker_id: 'worker-a',
      },
      type: 'dispatch_spawn_failed',
      workspace_id: 'ws-1',
      workspace_name: 'hive-serva',
    },
  ],
  generated_at: 1_768_900_100_000,
  log_tail: {
    exists: true,
    lines: ['[info] runtime started', '[error] spawn codex ENOENT'],
    path: '/Users/x/.config/hive/logs/runtime-4010.log',
  },
  secrets: {
    ANTHROPIC_API_KEY: { present: false },
    ANTHROPIC_AUTH_TOKEN: { present: false },
    GLM_API_KEY: { present: true },
  },
  system_info: {
    app_version: 'v1.4.0',
    arch: 'arm64',
    data_dir: '/Users/x/.config/hive',
    generated_at: 1_768_900_100_000,
    log_path: '/Users/x/.config/hive/logs/runtime-4010.log',
    node_version: 'v22.1.0',
    platform: 'darwin',
    port: 4010,
  },
}

let exportCalls = 0

const stubFetch = () => {
  exportCalls = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/diagnostics/export')) {
        exportCalls += 1
        return new Response('tar-bytes', {
          headers: {
            'content-disposition': 'attachment; filename="hive-diagnostics-2026.tar"',
            'content-type': 'application/x-tar',
          },
          status: 200,
        })
      }
      if (url.includes('/api/diagnostics')) {
        return new Response(JSON.stringify(diagnosticsPayload), {
          headers: { 'content-type': 'application/json' },
          status: 200,
        })
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    })
  )
}

beforeEach(() => {
  stubFetch()
  // jsdom does not implement object URLs / blob downloads — stub them.
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => 'blob:mock'),
    revokeObjectURL: vi.fn(),
  })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('DiagnosticsTab', () => {
  test('renders env info, CLI/secret status, spawn failure detail, sentinel alert and log tail', async () => {
    render(<DiagnosticsTab />)

    expect(await screen.findByText('darwin arm64 · v1.4.0 · :4010')).toBeInTheDocument()
    expect(screen.getByText('/Users/x/.config/hive')).toBeInTheDocument()
    // CLI status row.
    expect(screen.getByText('Codex')).toBeInTheDocument()
    // The spawn-failure card surfaces worker + command + PATH (the key signal).
    expect(screen.getByText('关羽')).toBeInTheDocument()
    expect(screen.getByText('/opt/homebrew/bin/codex')).toBeInTheDocument()
    expect(screen.getByText('spawn codex ENOENT')).toBeInTheDocument()
    expect(screen.getByText('/usr/bin:/bin')).toBeInTheDocument()
    // Sentinel alert.
    expect(screen.getByText('Report overdue')).toBeInTheDocument()
    // Raw log tail.
    expect(screen.getByText(/runtime started/)).toBeInTheDocument()
  })

  test('export button downloads the diagnostics bundle through the UI session', async () => {
    render(<DiagnosticsTab />)
    await screen.findByText('darwin arm64 · v1.4.0 · :4010')

    fireEvent.click(screen.getByRole('button', { name: /export diagnostics bundle/i }))

    await waitFor(() => expect(exportCalls).toBe(1))
    expect(screen.getByText(/keys are redacted — safe to send to us/i)).toBeInTheDocument()
  })
})
