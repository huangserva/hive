import { FileText, PanelRightClose } from 'lucide-react'

import type { ParsedPlan } from '../api.js'
import { useI18n } from '../i18n.js'
import { EmptyState } from '../ui/EmptyState.js'
import { Tooltip } from '../ui/Tooltip.js'
import { GoalSection } from './GoalSection.js'
import { MilestoneList } from './MilestoneList.js'
import { PlanHeader } from './PlanHeader.js'
import { RiskList } from './RiskList.js'
import { ScopeSection } from './ScopeSection.js'

type PlanDrawerProps = {
  loaded: boolean
  onClose: () => void
  open: boolean
  plan: ParsedPlan | null
  workspacePath: string | null
}

export const PlanDrawer = ({ loaded, onClose, open, plan, workspacePath }: PlanDrawerProps) => {
  const { t } = useI18n()
  const filePath = workspacePath ? `${workspacePath}/.hive/plan.md` : '.hive/plan.md'
  return (
    <aside
      aria-hidden={!open}
      aria-label={t('plan.drawer.title')}
      className={`drawer absolute top-0 right-0 bottom-0 z-30 flex flex-col border-l shadow-2xl${open ? ' open' : ''}`}
      data-testid="plan-drawer"
      style={{
        background: 'var(--bg-1)',
        borderColor: 'var(--border)',
        maxWidth: 'calc(100vw - 3.5rem)',
        minWidth: 420,
        width: 'min(720px, calc(100vw - 3.5rem))',
      }}
    >
      <header
        className="flex h-12 shrink-0 items-center gap-2 border-b px-5"
        style={{ borderColor: 'var(--border)' }}
      >
        <Tooltip label={<span className="mono text-ter">{filePath}</span>}>
          <span className="cursor-default font-semibold text-pri">{t('plan.drawer.title')}</span>
        </Tooltip>
        <span className="text-ter text-xs">.hive/plan.md</span>
        <div className="flex-1" />
        <Tooltip label={t('plan.drawer.close')}>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('plan.drawer.close')}
            className="icon-btn"
          >
            <PanelRightClose size={14} />
          </button>
        </Tooltip>
      </header>
      {!loaded ? (
        <div className="flex-1 px-5 py-4 text-sec text-sm">{t('plan.drawer.loading')}</div>
      ) : !plan ? (
        <div className="flex flex-1 items-center justify-center px-6">
          <EmptyState
            icon={<FileText size={20} />}
            title={t('plan.drawer.emptyTitle')}
            description={t('plan.drawer.emptyDescription')}
          />
        </div>
      ) : (
        <>
          <PlanHeader plan={plan} />
          <div className="flex-1 scroll-y px-5 py-4">
            {plan.parseError ? (
              <div
                className="mb-4 rounded border px-3 py-2 text-sm"
                style={{
                  background: 'color-mix(in oklab, var(--status-red) 12%, transparent)',
                  borderColor: 'color-mix(in oklab, var(--status-red) 35%, var(--border))',
                  color: 'var(--status-red)',
                }}
              >
                {t('cockpit.plan.parseWarning', { message: plan.parseError })}
              </div>
            ) : null}
            {plan.parseError ? (
              <pre
                className="overflow-auto rounded border bg-2 p-3 text-sec text-xs leading-5"
                style={{ borderColor: 'var(--border)' }}
              >
                {plan.raw}
              </pre>
            ) : (
              <div className="space-y-4">
                <GoalSection goal={plan.goal} />
                <MilestoneList milestones={plan.milestones} />
                <ScopeSection scope={plan.scope} />
                <RiskList risks={plan.risks} />
                {plan.currentPhase ? (
                  <section className="rounded border p-3" style={{ borderColor: 'var(--border)' }}>
                    <h3 className="mb-2 font-medium text-pri text-sm">
                      {t('cockpit.plan.currentPhase')}
                    </h3>
                    <p className="whitespace-pre-wrap text-sec text-sm leading-6">
                      {plan.currentPhase}
                    </p>
                  </section>
                ) : null}
              </div>
            )}
          </div>
        </>
      )}
    </aside>
  )
}
