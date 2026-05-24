import * as Dialog from '@radix-ui/react-dialog'
import { useEffect, useState } from 'react'
import {
  type ParsedIdeas,
  type PMIdea,
  type PromoteIdeaTarget,
  promoteCockpitIdea,
} from '../../api.js'
import { useI18n } from '../../i18n.js'

const IdeaRow = ({
  autoOpen = false,
  idea,
  onAutoOpenConsumed,
  promoted,
  workspaceId,
}: {
  autoOpen?: boolean
  idea: PMIdea
  onAutoOpenConsumed?: () => void
  promoted?: boolean
  workspaceId: string
}) => {
  const { t } = useI18n()
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [target, setTarget] = useState<PromoteIdeaTarget>('question')

  useEffect(() => {
    if (!autoOpen || promoted) return
    setOpen(true)
    onAutoOpenConsumed?.()
  }, [autoOpen, onAutoOpenConsumed, promoted])

  const submitPromote = async () => {
    setSubmitting(true)
    setError(null)
    try {
      await promoteCockpitIdea(workspaceId, idea.id, target)
      setOpen(false)
    } catch (promoteError) {
      setError(promoteError instanceof Error ? promoteError.message : String(promoteError))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="rounded border p-3" style={{ borderColor: 'var(--border)' }}>
      <div className="mb-1 flex items-center gap-2 text-ter text-xs">
        <span className="mono">{idea.id}</span>
        {idea.addedAt ? <span>{idea.addedAt}</span> : null}
        {promoted ? <span>{t('cockpit.ideas.promotedBadge')}</span> : null}
      </div>
      <div className="flex items-start gap-3">
        <p className="min-w-0 flex-1 text-sec text-sm leading-5">{idea.text}</p>
        {!promoted ? (
          <Dialog.Root open={open} onOpenChange={setOpen}>
            <Dialog.Trigger asChild>
              <button
                className="shrink-0 cursor-pointer rounded px-2 py-1 text-accent text-xs hover:bg-3"
                type="button"
              >
                {t('cockpit.ideas.promote')}
              </button>
            </Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
              <Dialog.Content
                className="fixed top-1/2 left-1/2 z-50 w-[min(520px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded border p-4 shadow-xl"
                style={{ background: 'var(--bg-1)', borderColor: 'var(--border)' }}
              >
                <Dialog.Title className="font-semibold text-pri text-sm">
                  {t('cockpit.ideas.promoteDialog.title')}
                </Dialog.Title>
                <Dialog.Description className="mt-3 text-sec text-sm leading-5">
                  {idea.text}
                </Dialog.Description>
                <label className="mt-3 block text-sec text-xs">
                  <span>{t('cockpit.ideas.promoteDialog.target')}</span>
                  <select
                    className="mt-1 w-full rounded border bg-transparent p-2 text-pri text-sm outline-none focus:border-accent"
                    onChange={(event) => setTarget(event.target.value as PromoteIdeaTarget)}
                    style={{ borderColor: 'var(--border)' }}
                    value={target}
                  >
                    <option value="question">{t('cockpit.ideas.promoteDialog.question')}</option>
                    <option value="plan">{t('cockpit.ideas.promoteDialog.plan')}</option>
                    <option value="adr">{t('cockpit.ideas.promoteDialog.adr')}</option>
                  </select>
                </label>
                {error ? <p className="mt-2 text-sm text-warn">{error}</p> : null}
                <div className="mt-4 flex justify-end gap-2">
                  <Dialog.Close asChild>
                    <button
                      className="cursor-pointer rounded px-3 py-1.5 text-sec text-sm hover:bg-3"
                      type="button"
                    >
                      {t('cockpit.ideas.promoteDialog.cancel')}
                    </button>
                  </Dialog.Close>
                  <button
                    className="cursor-pointer rounded bg-accent px-3 py-1.5 text-sm text-white disabled:opacity-50"
                    disabled={submitting}
                    onClick={submitPromote}
                    type="button"
                  >
                    {t('cockpit.ideas.promoteDialog.submit')}
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

export const IdeasTab = ({
  ideas,
  pendingActionId,
  onPendingActionConsumed,
  workspaceId,
}: {
  ideas: ParsedIdeas
  onPendingActionConsumed?: () => void
  pendingActionId?: string | null
  workspaceId: string
}) => {
  const { t } = useI18n()
  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-hidden px-5 py-4 lg:grid-cols-2">
      <section className="min-h-0 scroll-y">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="font-medium text-pri text-sm">{t('cockpit.ideas.inbox')}</h3>
          <span className="text-ter text-xs tabular-nums">{ideas.inbox.length}</span>
        </div>
        <div className="space-y-2">
          {ideas.inbox.length ? (
            ideas.inbox.map((idea) => (
              <IdeaRow
                autoOpen={pendingActionId === idea.id}
                idea={idea}
                key={idea.id}
                onAutoOpenConsumed={onPendingActionConsumed}
                workspaceId={workspaceId}
              />
            ))
          ) : (
            <p
              className="rounded border p-3 text-sec text-sm"
              style={{ borderColor: 'var(--border)' }}
            >
              {t('cockpit.ideas.emptyInbox')}
            </p>
          )}
        </div>
      </section>
      <section className="min-h-0 scroll-y">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="font-medium text-pri text-sm">{t('cockpit.ideas.promoted')}</h3>
          <span className="text-ter text-xs tabular-nums">{ideas.promoted.length}</span>
        </div>
        <div className="space-y-2">
          {ideas.promoted.length ? (
            ideas.promoted.map((idea) => (
              <IdeaRow idea={idea} key={idea.id} promoted workspaceId={workspaceId} />
            ))
          ) : (
            <p
              className="rounded border p-3 text-sec text-sm"
              style={{ borderColor: 'var(--border)' }}
            >
              {t('cockpit.ideas.emptyPromoted')}
            </p>
          )}
        </div>
      </section>
    </div>
  )
}
