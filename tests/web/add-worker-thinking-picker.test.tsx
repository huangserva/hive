// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { AppProviders } from '../../web/src/AppProviders.js'
import type { CommandPreset } from '../../web/src/api.js'
import { AddWorkerDialog } from '../../web/src/worker/AddWorkerDialog.js'

const presets: CommandPreset[] = [
  {
    args: [],
    available: true,
    command: 'claude',
    displayName: 'Claude Code (CC)',
    id: 'claude',
    thinkingLevels: [
      { label: 'Low', value: 'low' },
      { label: 'High', value: 'high' },
    ],
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

const renderDialog = (
  overrides: Partial<{
    commandPresetId: string
    thinkingLevel: string
    onThinkingLevelChange: (value: string) => void
  }> = {}
) => {
  const onThinkingLevelChange = overrides.onThinkingLevelChange ?? vi.fn()
  render(
    <AppProviders>
      <AddWorkerDialog
        commandPresets={presets}
        commandPresetId={overrides.commandPresetId ?? 'claude'}
        onClose={() => {}}
        onNameChange={() => {}}
        onPresetChange={() => {}}
        onRandomName={() => {}}
        onRoleDescriptionChange={() => {}}
        onRoleDescriptionReset={() => {}}
        onRoleChange={() => {}}
        onStartupCommandChange={() => {}}
        onSubmit={(event) => event.preventDefault()}
        onThinkingLevelChange={onThinkingLevelChange}
        roleDescription="You are a Coder"
        roleDescriptionDefault="You are a Coder"
        startupCommand=""
        thinkingLevel={overrides.thinkingLevel ?? ''}
        workerName="Alice"
        workerRole="coder"
      />
    </AppProviders>
  )
  return { onThinkingLevelChange }
}

afterEach(() => {
  cleanup()
})

describe('Add Worker thinking level picker', () => {
  test('shows thinking picker only when the selected preset supports levels', () => {
    renderDialog({ commandPresetId: 'claude' })

    expect(screen.getByLabelText('Thinking level')).toBeInTheDocument()
    expect(
      within(screen.getByLabelText('Thinking level')).getByRole('option', { name: 'High' })
    ).toBeInTheDocument()
  })

  test('hides thinking picker for unsupported presets with no saved value', () => {
    renderDialog({ commandPresetId: 'opencode' })

    expect(screen.queryByLabelText('Thinking level')).toBeNull()
  })

  test('keeps an orphan thinking value visible and lets the user clear it', () => {
    const onThinkingLevelChange = vi.fn()
    renderDialog({ commandPresetId: 'opencode', onThinkingLevelChange, thinkingLevel: 'high' })

    const picker = screen.getByLabelText('Thinking level') as HTMLSelectElement
    expect(picker).toHaveValue('')
    expect(within(picker).getByRole('option', { name: 'unset' })).toBeInTheDocument()

    fireEvent.change(picker, { target: { value: '' } })

    expect(onThinkingLevelChange).toHaveBeenCalledWith('')
  })
})
