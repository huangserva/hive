import * as Dialog from '@radix-ui/react-dialog'
import { Settings } from 'lucide-react'
import { type FormEvent, useEffect, useMemo, useState } from 'react'

import { getThinkingLevelsForPreset } from '../../../src/shared/thinking-levels.js'
import type { TeamListItem } from '../../../src/shared/types.js'
import { useI18n } from '../i18n.js'

const COMMAND_PRESETS = ['claude', 'codex', 'opencode', 'gemini'] as const

interface WorkerSettingsDialogProps {
  busy?: boolean
  onClose: () => void
  onSubmit: (workerId: string, patch: Record<string, unknown>) => void
  worker: TeamListItem | null
}

export const WorkerSettingsDialog = ({
  busy = false,
  onClose,
  onSubmit,
  worker,
}: WorkerSettingsDialogProps) => {
  const { t } = useI18n()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [thinkingLevel, setThinkingLevel] = useState<string>('')
  const [commandPresetId, setCommandPresetId] = useState('')
  const [sentinelMinutes, setSentinelMinutes] = useState<string>('')

  useEffect(() => {
    if (worker) {
      setName(worker.name)
      setDescription(worker.description ?? '')
      setThinkingLevel(worker.thinkingLevel ?? '')
      setCommandPresetId(worker.commandPresetId ?? 'claude')
      const ms = worker.sentinelIntervalMs
      setSentinelMinutes(ms != null ? String(ms / 60000) : '')
    }
  }, [worker])

  const thinkingOptions = useMemo(
    () => getThinkingLevelsForPreset(commandPresetId),
    [commandPresetId]
  )

  if (!worker) return null

  const isSentinel = worker.role === 'sentinel'
  const isRunning = worker.status !== 'stopped'
  const hasChanges = (() => {
    if (name.trim() !== worker.name) return true
    const origDesc = worker.description ?? ''
    if (description !== origDesc) return true
    if (thinkingLevel !== (worker.thinkingLevel ?? '')) return true
    if (commandPresetId !== (worker.commandPresetId ?? 'claude')) return true
    if (isSentinel) {
      const origMs = worker.sentinelIntervalMs
      const origMin = origMs != null ? String(origMs / 60000) : ''
      if (sentinelMinutes !== origMin) return true
    }
    return false
  })()

  const needsRestart =
    isRunning &&
    (thinkingLevel !== (worker.thinkingLevel ?? '') ||
      commandPresetId !== (worker.commandPresetId ?? 'claude'))

  const canSave = hasChanges && name.trim().length > 0 && !busy

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canSave) return
    const patch: Record<string, unknown> = {}
    if (name.trim() !== worker.name) patch.name = name.trim()
    const origDesc = worker.description ?? ''
    if (description !== origDesc) patch.description = description
    if (thinkingLevel !== (worker.thinkingLevel ?? '')) patch.thinking_level = thinkingLevel || null
    if (commandPresetId !== (worker.commandPresetId ?? 'claude'))
      patch.command_preset_id = commandPresetId
    if (isSentinel) {
      const origMs = worker.sentinelIntervalMs
      const origMin = origMs != null ? String(origMs / 60000) : ''
      if (sentinelMinutes !== origMin && sentinelMinutes !== '')
        patch.sentinel_interval_ms = Number(sentinelMinutes) * 60000
    }
    onSubmit(worker.id, patch)
  }

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="app-overlay fixed inset-0 z-40" />
        <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center p-4">
          <Dialog.Content
            data-testid="worker-settings-dialog"
            className="dialog-scale-pop elev-2 pointer-events-auto w-[480px] max-w-full rounded-lg border p-5"
            style={{
              background: 'var(--bg-elevated)',
              borderColor: 'var(--border-bright)',
            }}
          >
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="flex items-start gap-3">
                <div
                  aria-hidden
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded"
                  style={{
                    background: 'color-mix(in oklab, var(--accent) 14%, transparent)',
                    color: 'var(--accent)',
                    border: '1px solid color-mix(in oklab, var(--accent) 30%, transparent)',
                  }}
                >
                  <Settings size={18} />
                </div>
                <div className="min-w-0 flex-1">
                  <Dialog.Title className="text-lg font-semibold text-pri">
                    {t('worker.settings')}
                  </Dialog.Title>
                  <Dialog.Description className="mt-1 text-sm text-ter">
                    {t('worker.settingsDesc')}
                  </Dialog.Description>
                </div>
              </div>

              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium uppercase tracking-wider text-ter">
                  {t('addWorker.name')}
                </span>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={64}
                  className="input"
                  data-testid="worker-settings-name"
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium uppercase tracking-wider text-ter">
                  {t('worker.roleDescription')}
                </span>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  className="input resize-y"
                  data-testid="worker-settings-description"
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium uppercase tracking-wider text-ter">
                  {t('worker.thinkingLevel')}
                </span>
                <select
                  value={thinkingLevel}
                  onChange={(e) => setThinkingLevel(e.target.value)}
                  className="input"
                  data-testid="worker-settings-thinking"
                  disabled={thinkingOptions.length === 0}
                >
                  <option value="">{t('addWorker.thinkingDefault')}</option>
                  {thinkingOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium uppercase tracking-wider text-ter">
                  {t('worker.commandPreset')}
                </span>
                <select
                  value={commandPresetId}
                  onChange={(e) => setCommandPresetId(e.target.value)}
                  className="input"
                  data-testid="worker-settings-preset"
                  disabled={isSentinel}
                >
                  {COMMAND_PRESETS.map((id) => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ))}
                </select>
              </label>

              {isSentinel ? (
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium uppercase tracking-wider text-ter">
                    {t('worker.sentinelInterval')}
                  </span>
                  <input
                    type="number"
                    min={1}
                    value={sentinelMinutes}
                    onChange={(e) => setSentinelMinutes(e.target.value)}
                    className="input"
                    data-testid="worker-settings-interval"
                  />
                </label>
              ) : null}

              {needsRestart ? (
                <p className="text-xs text-yellow-500" data-testid="worker-settings-restart-hint">
                  {t('worker.restartRequired')}
                </p>
              ) : null}

              <div className="flex justify-end gap-2">
                <button type="button" onClick={onClose} className="icon-btn">
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  disabled={!canSave}
                  className="icon-btn icon-btn--primary"
                  data-testid="worker-settings-save"
                >
                  {busy ? t('common.saving') : t('common.save')}
                </button>
              </div>
            </form>
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
