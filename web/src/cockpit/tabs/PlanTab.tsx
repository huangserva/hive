import type { ParsedPlan } from '../../api.js'
import { useI18n } from '../../i18n.js'
import { GoalSection } from '../../plan/GoalSection.js'
import { MilestoneList } from '../../plan/MilestoneList.js'
import { PlanHeader } from '../../plan/PlanHeader.js'
import { RiskList } from '../../plan/RiskList.js'
import { ScopeSection } from '../../plan/ScopeSection.js'

export const PlanTab = ({ plan }: { plan: ParsedPlan }) => {
  const { t } = useI18n()
  return (
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
  )
}
