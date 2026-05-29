// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { AppProviders } from '../../web/src/AppProviders.js'
import type { CommandPreset, RoleTemplate } from '../../web/src/api.js'
import type { WorkerActions } from '../../web/src/worker/useWorkerActions.js'
import { useWorkerComposer } from '../../web/src/worker/useWorkerComposer.js'

vi.mock('../../web/src/api.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../web/src/api.js')>()
  return {
    ...actual,
    listCommandPresets: vi.fn(),
    listRoleTemplates: vi.fn(),
  }
})

const { listCommandPresets, listRoleTemplates } = await import('../../web/src/api.js')

const presets: CommandPreset[] = [
  {
    args: [],
    available: true,
    command: 'claude',
    displayName: 'Claude Code',
    id: 'claude',
    thinkingLevels: [],
  },
  {
    args: [],
    available: true,
    command: 'codex',
    displayName: 'Codex',
    id: 'codex',
    thinkingLevels: [],
  },
  {
    args: [],
    available: true,
    command: 'opencode',
    displayName: 'OpenCode',
    id: 'opencode',
    thinkingLevels: [],
  },
]

const templates: RoleTemplate[] = [
  {
    defaultArgs: [],
    defaultCommand: 'claude',
    defaultEnv: {},
    description: '前端专家模板',
    id: 'frontend-expert',
    isBuiltin: true,
    name: '前端专家',
    roleType: 'coder',
  },
]

const createWorker: WorkerActions['createWorker'] = vi.fn(async () => ({
  error: null,
  runId: null,
}))

const ComposerHarness = () => {
  const composer = useWorkerComposer({ createWorker, open: true })
  return (
    <div>
      <output data-testid="selected-preset">{composer.commandPresetId}</output>
      {composer.commandPresets.map((preset) => (
        <button
          key={preset.id}
          type="button"
          onClick={() => composer.setCommandPresetId(preset.id)}
        >
          select {preset.id}
        </button>
      ))}
      {composer.roleTemplates.map((template) => (
        <button
          key={template.id}
          type="button"
          onClick={() => composer.applyRoleTemplate(template)}
        >
          apply {template.id}
        </button>
      ))}
    </div>
  )
}

afterEach(() => {
  cleanup()
  vi.mocked(listCommandPresets).mockReset()
  vi.mocked(listRoleTemplates).mockReset()
  vi.mocked(createWorker).mockClear()
})

describe('useWorkerComposer command preset selection', () => {
  test('keeps an explicitly selected CLI preset when a role template is applied', async () => {
    vi.mocked(listCommandPresets).mockResolvedValue(presets)
    vi.mocked(listRoleTemplates).mockResolvedValue(templates)

    render(
      <AppProviders>
        <ComposerHarness />
      </AppProviders>
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'select codex' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'apply frontend-expert' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'select codex' }))
    expect(screen.getByTestId('selected-preset')).toHaveTextContent('codex')

    fireEvent.click(screen.getByRole('button', { name: 'apply frontend-expert' }))

    expect(screen.getByTestId('selected-preset')).toHaveTextContent('codex')
  })
})
