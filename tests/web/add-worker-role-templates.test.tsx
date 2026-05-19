// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { FormEvent } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { ToastProvider } from '../../web/src/ui/useToast.js'
import { AddWorkerDialog } from '../../web/src/worker/AddWorkerDialog.js'
import { useWorkerComposer } from '../../web/src/worker/useWorkerComposer.js'

const {
  createRoleTemplate,
  deleteRoleTemplate,
  listCommandPresets,
  listRoleTemplates,
  updateRoleTemplate,
} = vi.hoisted(() => ({
  createRoleTemplate: vi.fn(),
  deleteRoleTemplate: vi.fn(),
  listCommandPresets: vi.fn(),
  listRoleTemplates: vi.fn(),
  updateRoleTemplate: vi.fn(),
}))

vi.mock('../../web/src/api.js', async () => {
  const actual =
    await vi.importActual<typeof import('../../web/src/api.js')>('../../web/src/api.js')
  return {
    ...actual,
    createRoleTemplate: (...args: unknown[]) => createRoleTemplate(...args),
    deleteRoleTemplate: (...args: unknown[]) => deleteRoleTemplate(...args),
    listCommandPresets: (...args: unknown[]) => listCommandPresets(...args),
    listRoleTemplates: (...args: unknown[]) => listRoleTemplates(...args),
    updateRoleTemplate: (...args: unknown[]) => updateRoleTemplate(...args),
  }
})

const Harness = () => {
  const composer = useWorkerComposer({
    createWorker: async () => ({ error: null, runId: null }),
    open: true,
  })
  return (
    <ToastProvider>
      <AddWorkerDialog
        commandPresets={composer.commandPresets}
        commandPresetId={composer.commandPresetId}
        creating={composer.creating}
        customTemplates={composer.customTemplates}
        onClose={() => {}}
        onDeleteTemplate={composer.deleteTemplate}
        onNameChange={composer.setWorkerName}
        onPresetChange={composer.setCommandPresetId}
        onRandomName={composer.randomizeWorkerName}
        onRoleChange={composer.setWorkerRole}
        onRoleDescriptionChange={composer.setRoleDescription}
        onRoleDescriptionReset={composer.resetRoleDescription}
        onSaveAsTemplate={composer.saveAsTemplate}
        onStartupCommandChange={composer.setStartupCommand}
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault()
        }}
        onTemplateChange={composer.selectTemplate}
        roleDescription={composer.roleDescription}
        roleDescriptionDefault={composer.roleDescriptionDefault}
        selectedTemplateId={composer.selectedTemplateId}
        startupCommand={composer.startupCommand}
        templateBusy={composer.templateBusy}
        workerName={composer.workerName}
        workerRole={composer.workerRole}
      />
    </ToastProvider>
  )
}

beforeEach(() => {
  listCommandPresets.mockResolvedValue([
    {
      id: 'claude',
      displayName: 'Claude Code',
      command: 'claude',
      args: [],
      available: true,
    },
  ])
  // Each test sets up its own listRoleTemplates response.
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Add Worker dialog: custom role templates', () => {
  test('renders builtin role cards plus all custom role templates', async () => {
    listRoleTemplates.mockResolvedValue([
      {
        id: 'builtin-coder',
        name: 'Coder',
        roleType: 'coder',
        description: 'builtin coder',
        isBuiltin: true,
      },
      {
        id: 'builtin-reviewer',
        name: 'Reviewer',
        roleType: 'reviewer',
        description: 'builtin reviewer',
        isBuiltin: true,
      },
      {
        id: 'builtin-tester',
        name: 'Tester',
        roleType: 'tester',
        description: 'builtin tester',
        isBuiltin: true,
      },
      {
        id: 'tpl-doc',
        name: 'Doc Writer',
        roleType: 'custom',
        description: 'Writes documentation.',
        isBuiltin: false,
      },
      {
        id: 'tpl-translator',
        name: 'Translator',
        roleType: 'custom',
        description: 'Translates content.',
        isBuiltin: false,
      },
    ])

    render(<Harness />)

    expect(screen.getByTestId('role-card-coder')).toBeInTheDocument()
    expect(screen.getByTestId('role-card-reviewer')).toBeInTheDocument()
    expect(screen.getByTestId('role-card-tester')).toBeInTheDocument()
    expect(screen.getByTestId('role-card-custom')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByTestId('role-card-template-tpl-doc')).toBeInTheDocument()
    })
    expect(screen.getByTestId('role-card-template-tpl-translator')).toBeInTheDocument()
  })

  test('clicking a custom template fills the description textarea', async () => {
    listRoleTemplates.mockResolvedValue([
      {
        id: 'tpl-doc',
        name: 'Doc Writer',
        roleType: 'custom',
        description: 'Writes documentation in plain language.',
        isBuiltin: false,
      },
    ])

    render(<Harness />)

    const card = await screen.findByTestId('role-card-template-tpl-doc')
    fireEvent.click(card)

    const textarea = screen.getByTestId('role-instructions-textarea') as HTMLTextAreaElement
    expect(textarea.value).toBe('Writes documentation in plain language.')
  })

  test('only custom template cards expose a delete control', async () => {
    listRoleTemplates.mockResolvedValue([
      {
        id: 'tpl-doc',
        name: 'Doc Writer',
        roleType: 'custom',
        description: 'Writes docs.',
        isBuiltin: false,
      },
    ])

    render(<Harness />)

    await waitFor(() => {
      expect(screen.getByTestId('role-template-delete-tpl-doc')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('role-template-delete-coder')).toBeNull()
    expect(screen.queryByTestId('role-template-delete-reviewer')).toBeNull()
    expect(screen.queryByTestId('role-template-delete-tester')).toBeNull()
    expect(screen.queryByTestId('role-template-delete-custom')).toBeNull()
  })

  test('confirming delete calls deleteRoleTemplate and removes the card', async () => {
    listRoleTemplates.mockResolvedValue([
      {
        id: 'tpl-doc',
        name: 'Doc Writer',
        roleType: 'custom',
        description: 'Writes docs.',
        isBuiltin: false,
      },
    ])
    deleteRoleTemplate.mockResolvedValue(undefined)

    render(<Harness />)

    const deleteBtn = await screen.findByTestId('role-template-delete-tpl-doc')
    fireEvent.click(deleteBtn)

    const confirmAction = await screen.findByTestId('confirm-action')
    fireEvent.click(confirmAction)

    await waitFor(() => {
      expect(deleteRoleTemplate).toHaveBeenCalledWith('tpl-doc')
    })
    await waitFor(() => {
      expect(screen.queryByTestId('role-card-template-tpl-doc')).toBeNull()
    })
  })

  test('save-as-template control only appears on the new-Custom card with non-empty description', async () => {
    listRoleTemplates.mockResolvedValue([])

    render(<Harness />)

    // initially coder is selected, so save-as-template is hidden
    await waitFor(() => {
      expect(screen.getByTestId('role-card-custom')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('role-template-save')).toBeNull()

    fireEvent.click(screen.getByTestId('role-card-custom'))
    const textarea = screen.getByTestId('role-instructions-textarea') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'My custom role.' } })

    expect(screen.getByTestId('role-template-save')).toBeInTheDocument()
  })

  test('saving as template POSTs and surfaces the new card as selected', async () => {
    listRoleTemplates.mockResolvedValue([])
    createRoleTemplate.mockResolvedValue({
      id: 'tpl-new',
      name: 'Doc Writer',
      roleType: 'custom',
      description: 'My custom role.',
      isBuiltin: false,
    })

    render(<Harness />)

    await waitFor(() => {
      expect(screen.getByTestId('role-card-custom')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTestId('role-card-custom'))
    const textarea = screen.getByTestId('role-instructions-textarea') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'My custom role.' } })

    fireEvent.click(screen.getByTestId('role-template-save'))

    const nameInput = await screen.findByTestId('role-template-save-name')
    fireEvent.change(nameInput, { target: { value: 'Doc Writer' } })
    fireEvent.click(screen.getByTestId('role-template-save-confirm'))

    await waitFor(() => {
      expect(createRoleTemplate).toHaveBeenCalledWith({
        name: 'Doc Writer',
        roleType: 'custom',
        description: 'My custom role.',
      })
    })
    await waitFor(() => {
      expect(screen.getByTestId('role-card-template-tpl-new')).toBeInTheDocument()
    })
    // The newly saved template is selected: its delete control is for tpl-new
    // and the save-as-template button should now hide (because a template is
    // selected, not a blank Custom).
    expect(screen.queryByTestId('role-template-save')).toBeNull()
  })

  test('cancelling the inline name prompt does not call createRoleTemplate', async () => {
    listRoleTemplates.mockResolvedValue([])

    render(<Harness />)

    await waitFor(() => {
      expect(screen.getByTestId('role-card-custom')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTestId('role-card-custom'))
    const textarea = screen.getByTestId('role-instructions-textarea') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'My custom role.' } })

    fireEvent.click(screen.getByTestId('role-template-save'))
    await screen.findByTestId('role-template-save-name')
    fireEvent.click(screen.getByTestId('role-template-save-cancel'))

    expect(createRoleTemplate).not.toHaveBeenCalled()
    expect(screen.queryByTestId('role-template-save-name')).toBeNull()
    // The save button comes back so user can retry.
    expect(screen.getByTestId('role-template-save')).toBeInTheDocument()
  })
})
