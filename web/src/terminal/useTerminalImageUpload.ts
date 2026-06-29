import { type ChangeEvent, type RefObject, useCallback, useEffect, useRef, useState } from 'react'

import { listTerminalRuns, sendWorkspaceUserInput, uploadWorkspaceImage } from '../api.js'
import { orchestratorAgentId } from './useTerminalRuns.js'

const BUSY_UPLOAD_MESSAGE = '图片上传中，请稍候。'
const ORCHESTRATOR_NOT_RUNNING_MESSAGE = 'Orchestrator 终端未运行，请先启动后再上传图片。'
const READ_IMAGE_PROMPT = '请用 Read 工具打开上方图片查看。'

const blobToBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Failed to read image file'))
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      const [, base64 = ''] = result.split(',', 2)
      if (!base64) {
        reject(new Error('Failed to encode image file'))
        return
      }
      resolve(base64)
    }
    reader.readAsDataURL(blob)
  })

const getImageFileFromItems = (items: DataTransferItemList | undefined): File | null => {
  if (!items) return null
  for (const item of Array.from(items)) {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) continue
    const file = item.getAsFile()
    if (file) return file
  }
  return null
}

const getImageFileFromFiles = (files: FileList | null | undefined): File | null => {
  if (!files) return null
  return Array.from(files).find((file) => file.type.startsWith('image/')) ?? null
}

interface UseTerminalImageUploadInput {
  activeRunId?: string
  containerRef: RefObject<HTMLDivElement | null>
  enabled: boolean
  onError: (message: string) => void
  onUploaded?: () => void
  workspaceId?: string
}

export const useTerminalImageUpload = ({
  activeRunId,
  containerRef,
  enabled,
  onError,
  onUploaded,
  workspaceId,
}: UseTerminalImageUploadInput) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [uploading, setUploading] = useState(false)
  const activeRunIdRef = useRef(activeRunId)
  const enabledRef = useRef(enabled)
  const onErrorRef = useRef(onError)
  const onUploadedRef = useRef(onUploaded)
  const uploadingRef = useRef(uploading)
  const workspaceIdRef = useRef(workspaceId)

  useEffect(() => {
    activeRunIdRef.current = activeRunId
    enabledRef.current = enabled
    onErrorRef.current = onError
    onUploadedRef.current = onUploaded
    uploadingRef.current = uploading
    workspaceIdRef.current = workspaceId
  }, [activeRunId, enabled, onError, onUploaded, uploading, workspaceId])

  const setUploadingState = useCallback((value: boolean) => {
    uploadingRef.current = value
    setUploading(value)
  }, [])

  const assertActiveOrchestratorRun = useCallback(async (resolvedWorkspaceId: string) => {
    const resolvedRunId = activeRunIdRef.current
    if (!resolvedRunId) throw new Error(ORCHESTRATOR_NOT_RUNNING_MESSAGE)
    const runs = await listTerminalRuns(resolvedWorkspaceId)
    const active = runs.some(
      (run) =>
        run.agent_id === orchestratorAgentId(resolvedWorkspaceId) && run.run_id === resolvedRunId
    )
    if (!active) throw new Error(ORCHESTRATOR_NOT_RUNNING_MESSAGE)
  }, [])

  const uploadAndInject = useCallback(
    async (file: File) => {
      const resolvedWorkspaceId = workspaceIdRef.current
      if (!enabledRef.current || !resolvedWorkspaceId) return
      if (uploadingRef.current) {
        onErrorRef.current(BUSY_UPLOAD_MESSAGE)
        return
      }
      setUploadingState(true)
      try {
        await assertActiveOrchestratorRun(resolvedWorkspaceId)
        const uploaded = await uploadWorkspaceImage(resolvedWorkspaceId, {
          data: await blobToBase64(file),
          filename: file.name || 'image',
          mime_type: file.type || 'application/octet-stream',
        })
        await assertActiveOrchestratorRun(resolvedWorkspaceId)
        await sendWorkspaceUserInput(
          resolvedWorkspaceId,
          `[Image: source: ${uploaded.path}]\n${READ_IMAGE_PROMPT}`
        )
        onUploadedRef.current?.()
      } catch (error) {
        onErrorRef.current(error instanceof Error ? error.message : 'Failed to upload image')
      } finally {
        setUploadingState(false)
      }
    },
    [assertActiveOrchestratorRun, setUploadingState]
  )

  useEffect(() => {
    const node = enabled ? containerRef.current : null
    if (!node) return

    const onPaste = (event: ClipboardEvent) => {
      const file = getImageFileFromItems(event.clipboardData?.items)
      if (!file) return
      event.preventDefault()
      void uploadAndInject(file)
    }

    const onDragOver = (event: DragEvent) => {
      if (!getImageFileFromItems(event.dataTransfer?.items)) return
      event.preventDefault()
    }

    const onDrop = (event: DragEvent) => {
      const file =
        getImageFileFromItems(event.dataTransfer?.items) ??
        getImageFileFromFiles(event.dataTransfer?.files)
      if (!file) return
      event.preventDefault()
      void uploadAndInject(file)
    }

    node.addEventListener('paste', onPaste)
    node.addEventListener('dragover', onDragOver)
    node.addEventListener('drop', onDrop)
    return () => {
      node.removeEventListener('paste', onPaste)
      node.removeEventListener('dragover', onDragOver)
      node.removeEventListener('drop', onDrop)
    }
  }, [containerRef, enabled, uploadAndInject])

  const openFilePicker = useCallback(() => {
    if (!enabled || uploading) return
    fileInputRef.current?.click()
  }, [enabled, uploading])

  const onFileInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = getImageFileFromFiles(event.currentTarget.files)
      event.currentTarget.value = ''
      if (file) void uploadAndInject(file)
    },
    [uploadAndInject]
  )

  return { fileInputRef, onFileInputChange, openFilePicker, uploading }
}
