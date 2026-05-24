import * as Dialog from '@radix-ui/react-dialog'
import { useEffect, useState } from 'react'
import { confirmCockpitDecision, type ParsedDecisions, type PMDecision } from '../../api.js'
import { useI18n } from '../../i18n.js'

const DecisionRow = ({
  autoOpen = false,
  decision,
  draft,
  onAutoOpenConsumed,
  workspaceId,
}: {
  autoOpen?: boolean
  decision: PMDecision
  draft?: boolean
  onAutoOpenConsumed?: () => void
  workspaceId: string
}) => {
  const { t } = useI18n()
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!autoOpen || !draft) return
    setOpen(true)
    onAutoOpenConsumed?.()
  }, [autoOpen, draft, onAutoOpenConsumed])

  const submitConfirm = async () => {
    setSubmitting(true)
    setError(null)
    try {
      await confirmCockpitDecision(workspaceId, decision.filename)
      setOpen(false)
    } catch (confirmError) {
      setError(confirmError instanceof Error ? confirmError.message : String(confirmError))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="rounded border p-3" style={{ borderColor: 'var(--border)' }}>
      <div className="mb-1 flex items-center gap-2 text-ter text-xs">
        {decision.date ? <span>{decision.date}</span> : null}
        <span className="mono truncate">{decision.slug}</span>
        <span className="rounded border px-1.5">{decision.status}</span>
      </div>
      <div className="flex items-start gap-3">
        <p className="min-w-0 flex-1 font-medium text-pri text-sm">{decision.title}</p>
        {draft ? (
          <Dialog.Root open={open} onOpenChange={setOpen}>
            <Dialog.Trigger asChild>
              <button
                className="shrink-0 cursor-pointer rounded px-2 py-1 text-accent text-xs hover:bg-3"
                type="button"
              >
                {t('cockpit.decisions.confirm')}
              </button>
            </Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
              <Dialog.Content
                className="fixed top-1/2 left-1/2 z-50 w-[min(520px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded border p-4 shadow-xl"
                style={{ background: 'var(--bg-1)', borderColor: 'var(--border)' }}
              >
                <Dialog.Title className="font-semibold text-pri text-sm">
                  {t('cockpit.decisions.confirmDialog.title')}
                </Dialog.Title>
                <Dialog.Description className="mt-3 text-sec text-sm leading-5">
                  {decision.title}
                </Dialog.Description>
                <p className="mt-2 text-sec text-xs">{t('cockpit.decisions.confirmDialog.body')}</p>
                {error ? <p className="mt-2 text-sm text-warn">{error}</p> : null}
                <div className="mt-4 flex justify-end gap-2">
                  <Dialog.Close asChild>
                    <button
                      className="cursor-pointer rounded px-3 py-1.5 text-sec text-sm hover:bg-3"
                      type="button"
                    >
                      {t('cockpit.decisions.confirmDialog.cancel')}
                    </button>
                  </Dialog.Close>
                  <button
                    className="cursor-pointer rounded bg-accent px-3 py-1.5 text-sm text-white disabled:opacity-50"
                    disabled={submitting}
                    onClick={submitConfirm}
                    type="button"
                  >
                    {t('cockpit.decisions.confirmDialog.submit')}
                  </button>
                </div>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
        ) : null}
      </div>
    </div>
  )
}

export const DecisionsTab = ({
  decisions,
  pendingActionId,
  onPendingActionConsumed,
  workspaceId,
}: {
  decisions: ParsedDecisions
  onPendingActionConsumed?: () => void
  pendingActionId?: string | null
  workspaceId: string
}) => {
  const { t } = useI18n()
  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-hidden px-5 py-4 lg:grid-cols-2">
      <section className="min-h-0 scroll-y">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="font-medium text-pri text-sm">{t('cockpit.decisions.drafts')}</h3>
          <span className="text-ter text-xs tabular-nums">{decisions.drafts.length}</span>
        </div>
        <div className="space-y-2">
          {decisions.drafts.length ? (
            decisions.drafts.map((decision) => (
              <DecisionRow
                autoOpen={pendingActionId === decision.filename}
                decision={decision}
                draft
                key={decision.filename}
                onAutoOpenConsumed={onPendingActionConsumed}
                workspaceId={workspaceId}
              />
            ))
          ) : (
            <p
              className="rounded border p-3 text-sec text-sm"
              style={{ borderColor: 'var(--border)' }}
            >
              {t('cockpit.decisions.emptyDrafts')}
            </p>
          )}
        </div>
      </section>
      <section className="min-h-0 scroll-y">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="font-medium text-pri text-sm">{t('cockpit.decisions.adopted')}</h3>
          <span className="text-ter text-xs tabular-nums">{decisions.adopted.length}</span>
        </div>
        <div className="space-y-2">
          {decisions.adopted.length ? (
            decisions.adopted.map((decision) => (
              <DecisionRow decision={decision} key={decision.filename} workspaceId={workspaceId} />
            ))
          ) : (
            <p
              className="rounded border p-3 text-sec text-sm"
              style={{ borderColor: 'var(--border)' }}
            >
              {t('cockpit.decisions.emptyAdopted')}
            </p>
          )}
        </div>
      </section>
    </div>
  )
}
