import * as Dialog from '@radix-ui/react-dialog'
import { Feather, LoaderCircle, Trash2, X } from 'lucide-react'
import { type FormEvent, useEffect, useState } from 'react'

import type { WorkspaceSummary } from '../../../src/shared/types.js'
import {
  bindFeishuChat,
  type FeishuBinding,
  type FeishuTransportStatus,
  fetchFeishuTransportStatus,
  listFeishuBindings,
  unbindFeishuChat,
} from '../api.js'

type WorkspaceSettingsProps = {
  onClose: () => void
  open: boolean
  workspace: WorkspaceSummary | null
}

const STATUS_LABEL: Record<FeishuTransportStatus['status'], string> = {
  connected: 'Connected',
  disabled: 'Not configured',
  disconnected: 'Reconnecting',
  error: 'Error',
}

const STATUS_TONE: Record<FeishuTransportStatus['status'], string> = {
  connected: 'pill--green',
  disabled: 'pill--neutral',
  disconnected: 'pill--orange',
  error: 'pill--red',
}

const FieldLabel = ({ children }: { children: React.ReactNode }) => (
  <span className="text-xs font-medium uppercase tracking-wider text-ter">{children}</span>
)

export const WorkspaceSettings = ({ onClose, open, workspace }: WorkspaceSettingsProps) => {
  const [bindings, setBindings] = useState<FeishuBinding[]>([])
  const [chatId, setChatId] = useState('')
  const [chatName, setChatName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<FeishuTransportStatus>({ status: 'disabled' })

  useEffect(() => {
    if (!open || !workspace) return
    let cancelled = false
    setError(null)
    setLoading(true)
    Promise.all([fetchFeishuTransportStatus(), listFeishuBindings(workspace.id)])
      .then(([nextStatus, nextBindings]) => {
        if (cancelled) return
        setStatus(nextStatus)
        setBindings(nextBindings)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, workspace])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!workspace || saving) return
    setSaving(true)
    setError(null)
    bindFeishuChat({
      chatId,
      chatName: chatName.trim() || null,
      workspaceId: workspace.id,
    })
      .then((binding) => {
        setBindings((current) => [
          binding,
          ...current.filter((item) => item.chatId !== binding.chatId),
        ])
        setChatId('')
        setChatName('')
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setSaving(false))
  }

  const unbind = (binding: FeishuBinding) => {
    setError(null)
    void unbindFeishuChat(binding.chatId)
      .then(() => {
        setBindings((current) => current.filter((item) => item.chatId !== binding.chatId))
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
  }

  if (!workspace) return null

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="app-overlay fixed inset-0 z-40" />
        <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center p-4">
          <Dialog.Content
            className="dialog-scale-pop elev-2 pointer-events-auto flex w-[560px] max-w-full flex-col rounded-lg border"
            style={{
              background: 'var(--bg-elevated)',
              borderColor: 'var(--border-bright)',
            }}
          >
            <div
              className="flex items-center gap-3 border-b px-5 py-4"
              style={{ borderColor: 'var(--border)' }}
            >
              <div
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded"
                style={{
                  background: 'color-mix(in oklab, var(--accent) 12%, transparent)',
                  color: 'var(--accent)',
                }}
              >
                <Feather size={18} aria-hidden />
              </div>
              <div className="min-w-0 flex-1">
                <Dialog.Title className="text-lg font-semibold text-pri">
                  Feishu Integration
                </Dialog.Title>
                <Dialog.Description className="truncate text-xs text-ter">
                  {workspace.name}
                </Dialog.Description>
              </div>
              <button type="button" className="icon-btn h-8 px-2" onClick={onClose}>
                <X size={14} aria-hidden />
              </button>
            </div>

            <div className="flex flex-col gap-5 px-5 py-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <span className={`pill ${STATUS_TONE[status.status]}`}>
                    {STATUS_LABEL[status.status]}
                  </span>
                  {status.appId ? (
                    <code className="mono text-xs text-ter">{status.appId}</code>
                  ) : null}
                </div>
                {loading ? <LoaderCircle size={14} className="animate-spin text-ter" /> : null}
              </div>

              {status.status === 'disabled' ? (
                <div
                  className="rounded border px-3 py-2 text-sm text-ter"
                  style={{ borderColor: 'var(--border)' }}
                >
                  Configure ~/.config/hive/feishu.json and restart Hive
                </div>
              ) : null}

              {error ? (
                <div
                  className="rounded border px-3 py-2 text-sm"
                  style={{
                    background: 'color-mix(in oklab, var(--status-red) 8%, transparent)',
                    borderColor: 'color-mix(in oklab, var(--status-red) 25%, transparent)',
                    color: 'var(--status-red)',
                  }}
                >
                  {error}
                </div>
              ) : null}

              <section className="flex flex-col gap-2">
                <FieldLabel>Bound chats</FieldLabel>
                {bindings.length === 0 ? (
                  <div
                    className="rounded border px-3 py-3 text-sm text-ter"
                    style={{ borderColor: 'var(--border)' }}
                  >
                    No Feishu chats bound to this workspace.
                  </div>
                ) : (
                  <div
                    className="flex flex-col overflow-hidden rounded border"
                    style={{ borderColor: 'var(--border)' }}
                  >
                    {bindings.map((binding) => (
                      <div
                        key={binding.chatId}
                        className="flex items-center gap-3 border-b px-3 py-2 last:border-b-0"
                        style={{ borderColor: 'var(--border)' }}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="mono truncate text-sm text-pri">{binding.chatId}</div>
                          {binding.chatName ? (
                            <div className="truncate text-xs text-ter">{binding.chatName}</div>
                          ) : null}
                        </div>
                        <button
                          type="button"
                          className="icon-btn icon-btn--danger h-8 px-2"
                          onClick={() => unbind(binding)}
                        >
                          <Trash2 size={13} aria-hidden />
                          Unbind
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <form onSubmit={submit} className="grid grid-cols-[1fr_1fr_auto] items-end gap-3">
                <label className="flex min-w-0 flex-col gap-2">
                  <FieldLabel>chat_id</FieldLabel>
                  <input
                    className="input mono"
                    placeholder="oc_xxx"
                    value={chatId}
                    onChange={(event) => setChatId(event.target.value)}
                  />
                </label>
                <label className="flex min-w-0 flex-col gap-2">
                  <FieldLabel>chat_name</FieldLabel>
                  <input
                    className="input"
                    placeholder="Optional"
                    value={chatName}
                    onChange={(event) => setChatName(event.target.value)}
                  />
                </label>
                <button
                  type="submit"
                  className="icon-btn icon-btn--primary h-9"
                  disabled={saving || !chatId.trim()}
                >
                  {saving ? 'Binding...' : 'Bind'}
                </button>
              </form>
            </div>
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
