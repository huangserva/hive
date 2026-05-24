import * as Dialog from '@radix-ui/react-dialog'
import { useEffect, useState } from 'react'
import type { ParsedQuestions, PMQuestion, PMQuestionPriority } from '../../api.js'
import { answerCockpitQuestion } from '../../api.js'
import { type TranslationKey, useI18n } from '../../i18n.js'

const PRIORITIES: Array<{ key: PMQuestionPriority; labelKey: TranslationKey; tone: string }> = [
  { key: 'high', labelKey: 'cockpit.questions.high', tone: 'var(--status-red)' },
  { key: 'medium', labelKey: 'cockpit.questions.medium', tone: 'var(--status-yellow)' },
  { key: 'low', labelKey: 'cockpit.questions.low', tone: 'var(--text-tertiary)' },
]

const QuestionRow = ({
  canAnswer = true,
  autoOpen = false,
  onAutoOpenConsumed,
  question,
  workspaceId,
}: {
  autoOpen?: boolean
  canAnswer?: boolean
  onAutoOpenConsumed?: () => void
  question: PMQuestion
  workspaceId: string
}) => {
  const { t } = useI18n()
  const [answer, setAnswer] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!autoOpen || !canAnswer) return
    setOpen(true)
    onAutoOpenConsumed?.()
  }, [autoOpen, canAnswer, onAutoOpenConsumed])

  const submitAnswer = async () => {
    setSubmitting(true)
    setError(null)
    try {
      await answerCockpitQuestion(workspaceId, question.id, answer)
      setOpen(false)
      setAnswer('')
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="flex items-start gap-2 rounded border p-3"
      style={{ borderColor: 'var(--border)' }}
    >
      <span className="mono shrink-0 rounded border px-1.5 py-0.5 text-accent text-xs">
        {question.id}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sec text-sm leading-5">{question.text}</p>
        {question.answer ? <p className="mt-1 text-ter text-xs">{question.answer}</p> : null}
      </div>
      {canAnswer ? (
        <Dialog.Root open={open} onOpenChange={setOpen}>
          <Dialog.Trigger asChild>
            <button
              className="shrink-0 cursor-pointer rounded px-2 py-1 text-accent text-xs hover:bg-3"
              type="button"
            >
              {t('cockpit.questions.answer')}
            </button>
          </Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
            <Dialog.Content
              className="fixed top-1/2 left-1/2 z-50 w-[min(520px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded border p-4 shadow-xl"
              style={{ background: 'var(--bg-1)', borderColor: 'var(--border)' }}
            >
              <Dialog.Title className="font-semibold text-pri text-sm">
                {t('cockpit.questions.answerDialog.title')}
              </Dialog.Title>
              <Dialog.Description className="mt-3 text-sec text-sm leading-5">
                {question.text}
              </Dialog.Description>
              <textarea
                className="mt-3 min-h-28 w-full resize-y rounded border bg-transparent p-2 text-pri text-sm outline-none focus:border-accent"
                onChange={(event) => setAnswer(event.target.value)}
                placeholder={t('cockpit.questions.answerDialog.placeholder')}
                value={answer}
                style={{ borderColor: 'var(--border)' }}
              />
              {error ? <p className="mt-2 text-sm text-warn">{error}</p> : null}
              <div className="mt-4 flex justify-end gap-2">
                <Dialog.Close asChild>
                  <button
                    className="cursor-pointer rounded px-3 py-1.5 text-sec text-sm hover:bg-3"
                    type="button"
                  >
                    {t('cockpit.questions.answerDialog.cancel')}
                  </button>
                </Dialog.Close>
                <button
                  className="cursor-pointer rounded bg-accent px-3 py-1.5 text-sm text-white disabled:opacity-50"
                  disabled={submitting || !answer.trim()}
                  onClick={submitAnswer}
                  type="button"
                >
                  {t('cockpit.questions.answerDialog.submit')}
                </button>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      ) : null}
    </div>
  )
}

export const QuestionsTab = ({
  onPendingActionConsumed,
  pendingActionId,
  questions,
  workspaceId,
}: {
  onPendingActionConsumed?: () => void
  pendingActionId?: string | null
  questions: ParsedQuestions
  workspaceId: string
}) => {
  const { t } = useI18n()
  return (
    <div className="scroll-y space-y-4 px-5 py-4">
      {questions.parseError ? (
        <div
          className="rounded border px-3 py-2 text-sm text-warn"
          style={{ borderColor: 'var(--border)' }}
        >
          {t('cockpit.questions.parseWarning', { message: questions.parseError })}
        </div>
      ) : null}
      {PRIORITIES.map(({ key, labelKey, tone }) => {
        const items = questions[key]
        return (
          <details
            className="rounded border"
            key={key}
            open={items.length > 0}
            style={{ borderColor: 'var(--border)' }}
          >
            <summary className="cursor-pointer px-3 py-2 font-medium text-pri text-sm">
              <span style={{ color: tone }}>{t(labelKey)}</span>
              <span className="ml-2 text-ter text-xs tabular-nums">{items.length}</span>
            </summary>
            <div className="space-y-2 px-3 pb-3">
              {items.length ? (
                items.map((question) => (
                  <QuestionRow
                    autoOpen={pendingActionId === question.id}
                    key={question.id}
                    onAutoOpenConsumed={onPendingActionConsumed}
                    question={question}
                    workspaceId={workspaceId}
                  />
                ))
              ) : (
                <p className="text-sec text-sm">{t('cockpit.questions.empty')}</p>
              )}
            </div>
          </details>
        )
      })}
      <section className="rounded border p-3" style={{ borderColor: 'var(--border)' }}>
        <div className="mb-2 font-medium text-pri text-sm">{t('cockpit.questions.answered')}</div>
        <div className="space-y-2">
          {questions.answered.length ? (
            questions.answered.map((question) => (
              <QuestionRow
                canAnswer={false}
                key={question.id}
                question={question}
                workspaceId={workspaceId}
              />
            ))
          ) : (
            <p className="text-sec text-sm">{t('cockpit.questions.answeredEmpty')}</p>
          )}
        </div>
      </section>
    </div>
  )
}
