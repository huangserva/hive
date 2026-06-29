// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { useTerminalImageUpload } from '../../web/src/terminal/useTerminalImageUpload.js'

vi.mock('../../web/src/api.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../web/src/api.js')>()
  return {
    ...actual,
    listTerminalRuns: vi.fn(),
    sendWorkspaceUserInput: vi.fn(),
    uploadWorkspaceImage: vi.fn(),
  }
})

const { listTerminalRuns, sendWorkspaceUserInput, uploadWorkspaceImage } = await import(
  '../../web/src/api.js'
)

afterEach(() => {
  cleanup()
  vi.mocked(listTerminalRuns).mockReset()
  vi.mocked(sendWorkspaceUserInput).mockReset()
  vi.mocked(uploadWorkspaceImage).mockReset()
})

const createContainerRef = () => {
  const node = document.createElement('div')
  document.body.appendChild(node)
  const ref = createRef<HTMLDivElement>()
  ref.current = node
  return ref
}

const dispatchImagePaste = (node: HTMLDivElement, file: File) => {
  const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent
  Object.defineProperty(event, 'clipboardData', {
    value: {
      items: [
        {
          getAsFile: () => file,
          kind: 'file',
          type: file.type,
        },
      ],
    },
  })
  node.dispatchEvent(event)
}

describe('useTerminalImageUpload', () => {
  test('does not upload when the orchestrator run is no longer active', async () => {
    vi.mocked(listTerminalRuns).mockResolvedValue([])
    const onError = vi.fn()
    const ref = createContainerRef()

    renderHook(() =>
      useTerminalImageUpload({
        activeRunId: 'run-gone',
        containerRef: ref,
        enabled: true,
        onError,
        workspaceId: 'workspace-1',
      })
    )

    act(() => {
      dispatchImagePaste(
        ref.current as HTMLDivElement,
        new File(['image bytes'], 'screen.png', { type: 'image/png' })
      )
    })

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith('Orchestrator 终端未运行，请先启动后再上传图片。')
    })
    expect(uploadWorkspaceImage).not.toHaveBeenCalled()
    expect(sendWorkspaceUserInput).not.toHaveBeenCalled()
  })

  test('reports a busy upload instead of silently dropping another image', async () => {
    let resolveUpload:
      | ((value: {
          filename: string
          mime_type: string
          ok: true
          path: string
          size: number
        }) => void)
      | undefined
    vi.mocked(listTerminalRuns).mockResolvedValue([
      {
        agent_id: 'workspace-1:orchestrator',
        agent_name: 'Orchestrator',
        run_id: 'run-1',
        status: 'running',
        terminal_input_profile: 'default',
      },
    ])
    vi.mocked(uploadWorkspaceImage).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveUpload = resolve
        })
    )
    vi.mocked(sendWorkspaceUserInput).mockResolvedValue()
    const onError = vi.fn()
    const ref = createContainerRef()

    renderHook(() =>
      useTerminalImageUpload({
        activeRunId: 'run-1',
        containerRef: ref,
        enabled: true,
        onError,
        workspaceId: 'workspace-1',
      })
    )

    const file = new File(['image bytes'], 'screen.png', { type: 'image/png' })
    act(() => {
      dispatchImagePaste(ref.current as HTMLDivElement, file)
    })
    await waitFor(() => {
      expect(uploadWorkspaceImage).toHaveBeenCalledTimes(1)
    })

    act(() => {
      dispatchImagePaste(ref.current as HTMLDivElement, file)
    })

    expect(onError).toHaveBeenCalledWith('图片上传中，请稍候。')
    resolveUpload?.({
      filename: 'screen.png',
      mime_type: 'image/png',
      ok: true,
      path: '/tmp/uploads/screen.png',
      size: 11,
    })
    await waitFor(() => {
      expect(sendWorkspaceUserInput).toHaveBeenCalledTimes(1)
    })
  })
})
