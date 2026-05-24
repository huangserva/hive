import * as Dialog from '@radix-ui/react-dialog'
import { Gauge, PanelRightClose } from 'lucide-react'
import { useState } from 'react'

import type { ParsedCockpit } from '../api.js'
import { useI18n } from '../i18n.js'
import { EmptyState } from '../ui/EmptyState.js'
import { Tooltip } from '../ui/Tooltip.js'
import { ActionBar } from './ActionBar.js'
import { type CockpitTab, CockpitTabs } from './CockpitTabs.js'
import { ArchiveTab } from './tabs/ArchiveTab.js'
import { BaselineTab } from './tabs/BaselineTab.js'
import { DecisionsTab } from './tabs/DecisionsTab.js'
import { IdeasTab } from './tabs/IdeasTab.js'
import { PlanTab } from './tabs/PlanTab.js'
import { QuestionsTab } from './tabs/QuestionsTab.js'
import { ResearchTab } from './tabs/ResearchTab.js'
import { TasksTab } from './tabs/TasksTab.js'

type CockpitDrawerProps = {
  cockpit: ParsedCockpit | null
  error: string | null
  isConnected: boolean
  onClose: () => void
  open: boolean
  workspacePath: string | null
}

const renderTab = (cockpit: ParsedCockpit, activeTab: CockpitTab) => {
  if (activeTab === 'plan') return <PlanTab plan={cockpit.plan} />
  if (activeTab === 'tasks') return <TasksTab tasks={cockpit.tasks} />
  if (activeTab === 'questions') return <QuestionsTab questions={cockpit.questions} />
  if (activeTab === 'ideas') return <IdeasTab ideas={cockpit.ideas} />
  if (activeTab === 'decisions') return <DecisionsTab decisions={cockpit.decisions} />
  if (activeTab === 'research') return <ResearchTab research={cockpit.research} />
  if (activeTab === 'baseline') return <BaselineTab baseline={cockpit.baseline} />
  return <ArchiveTab archive={cockpit.archive} />
}

export const CockpitDrawer = ({
  cockpit,
  error,
  isConnected,
  onClose,
  open,
  workspacePath,
}: CockpitDrawerProps) => {
  const [activeTab, setActiveTab] = useState<CockpitTab>('plan')
  const { t } = useI18n()
  const filePath = workspacePath ? `${workspacePath}/.hive/` : '.hive/'

  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <Dialog.Portal>
        <Dialog.Content
          aria-label={t('cockpit.title')}
          className="fixed top-0 right-0 bottom-0 z-40 flex flex-col border-l shadow-2xl"
          data-testid="cockpit-drawer"
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
              <Dialog.Title className="cursor-default font-semibold text-pri">
                {t('cockpit.title')}
              </Dialog.Title>
            </Tooltip>
            <span className="text-ter text-xs">{t('cockpit.subtitle')}</span>
            <span
              className="rounded-full px-2 py-0.5 text-[10px]"
              style={{
                background: isConnected ? 'var(--bg-3)' : 'transparent',
                color: isConnected ? 'var(--accent)' : 'var(--text-tertiary)',
              }}
            >
              {isConnected ? t('cockpit.connection.live') : t('cockpit.connection.loading')}
            </span>
            <div className="flex-1" />
            <Tooltip label={t('cockpit.close')}>
              <button
                type="button"
                onClick={onClose}
                aria-label={t('cockpit.close')}
                className="icon-btn"
              >
                <PanelRightClose size={14} />
              </button>
            </Tooltip>
          </header>
          <CockpitTabs activeTab={activeTab} cockpit={cockpit} onChange={setActiveTab} />
          <div className="min-h-0 flex-1 overflow-y-auto">
            {error ? (
              <div className="p-5 text-sm text-warn">{error}</div>
            ) : !cockpit ? (
              <div className="flex h-full items-center justify-center px-6">
                <EmptyState
                  icon={<Gauge size={20} />}
                  title={t('cockpit.loading')}
                  description={t('cockpit.loadingDescription')}
                />
              </div>
            ) : (
              renderTab(cockpit, activeTab)
            )}
          </div>
          <ActionBar actions={cockpit?.aiActions ?? []} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
