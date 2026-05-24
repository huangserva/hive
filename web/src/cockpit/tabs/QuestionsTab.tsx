import type { ParsedQuestions, PMQuestion, PMQuestionPriority } from '../../api.js'
import { type TranslationKey, useI18n } from '../../i18n.js'

const PRIORITIES: Array<{ key: PMQuestionPriority; labelKey: TranslationKey; tone: string }> = [
  { key: 'high', labelKey: 'cockpit.questions.high', tone: 'var(--status-red)' },
  { key: 'medium', labelKey: 'cockpit.questions.medium', tone: 'var(--status-yellow)' },
  { key: 'low', labelKey: 'cockpit.questions.low', tone: 'var(--text-tertiary)' },
]

const QuestionRow = ({ question }: { question: PMQuestion }) => {
  const { t } = useI18n()
  return (
    <div
      className="flex items-start gap-2 rounded border p-3"
      style={{ borderColor: 'var(--border)' }}
    >
      <span className="mono shrink-0 rounded border px-1.5 py-0.5 text-accent text-xs">
        {question.id}
      </span>
      <p className="min-w-0 flex-1 text-sec text-sm leading-5">{question.text}</p>
      <button
        className="shrink-0 cursor-pointer rounded px-2 py-1 text-accent text-xs hover:bg-3"
        onClick={() => {
          // TODO: wire answer POST in Phase C-2.5.
        }}
        type="button"
      >
        {t('cockpit.questions.answer')}
      </button>
    </div>
  )
}

export const QuestionsTab = ({ questions }: { questions: ParsedQuestions }) => {
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
                items.map((question) => <QuestionRow key={question.id} question={question} />)
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
              <QuestionRow key={question.id} question={question} />
            ))
          ) : (
            <p className="text-sec text-sm">{t('cockpit.questions.answeredEmpty')}</p>
          )}
        </div>
      </section>
    </div>
  )
}
