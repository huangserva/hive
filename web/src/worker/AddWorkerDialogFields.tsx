import { Check, ChevronDown, RotateCcw, Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'

import type { WorkerRole } from '../../../src/shared/types.js'
import type { CommandPreset, RoleTemplate } from '../api.js'
import { useI18n } from '../i18n.js'
import { Confirm } from '../ui/Confirm.js'
import { RoleAvatar } from './RoleAvatar.js'

interface RoleCardSpec {
  value: WorkerRole
  dashed?: boolean
}

const ROLE_CARDS: RoleCardSpec[] = [
  { value: 'coder' },
  { value: 'reviewer' },
  { value: 'tester' },
  { value: 'custom', dashed: true },
]

const roleLabelKey = (role: WorkerRole) =>
  `role.${role}` as 'role.coder' | 'role.custom' | 'role.reviewer' | 'role.tester'

export const SectionLabel = ({ children }: { children: ReactNode }) => (
  <span className="text-sm font-medium text-sec">{children}</span>
)

const RoleCard = ({
  active,
  spec,
  onSelect,
}: {
  active: boolean
  spec: RoleCardSpec
  onSelect: () => void
}) => {
  const { t } = useI18n()
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      data-testid={`role-card-${spec.value}`}
      className={`selectable-card${spec.dashed ? ' selectable-card--dashed' : ''} flex items-center gap-3 px-3 py-2`}
    >
      <RoleAvatar role={spec.value} size={20} />
      <span className="flex-1 text-left text-base font-medium text-pri">
        {t(roleLabelKey(spec.value))}
      </span>
      {active ? <Check size={14} className="shrink-0 text-accent" aria-hidden /> : null}
    </button>
  )
}

const CustomTemplateCard = ({
  active,
  template,
  onSelect,
  onDelete,
}: {
  active: boolean
  template: RoleTemplate
  onSelect: () => void
  onDelete: () => void
}) => {
  const { t } = useI18n()
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={active}
        data-testid={`role-card-template-${template.id}`}
        className="selectable-card flex w-full items-center gap-3 px-3 py-2 pr-9"
      >
        <RoleAvatar role={template.roleType} size={20} />
        <span className="min-w-0 flex-1 truncate text-left text-base font-medium text-pri">
          {template.name}
        </span>
        {active ? <Check size={14} className="shrink-0 text-accent" aria-hidden /> : null}
      </button>
      <button
        type="button"
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          onDelete()
        }}
        aria-label={t('addWorker.templateDeleteAria', { name: template.name })}
        data-testid={`role-template-delete-${template.id}`}
        className="absolute right-1 top-1/2 -translate-y-1/2 flex h-6 w-6 items-center justify-center rounded text-ter transition-colors hover:bg-3 hover:text-pri"
      >
        <Trash2 size={14} aria-hidden />
      </button>
    </div>
  )
}

export const RolePicker = ({
  customTemplates,
  onDeleteTemplate,
  onRoleChange,
  onTemplateChange,
  selectedTemplateId,
  workerRole,
}: {
  customTemplates: RoleTemplate[]
  onDeleteTemplate: (templateId: string) => Promise<void> | void
  onRoleChange: (value: WorkerRole) => void
  onTemplateChange: (templateId: string) => void
  selectedTemplateId: string | null
  workerRole: WorkerRole
}) => (
  <div className="flex flex-col gap-2">
    <RolePickerInner
      customTemplates={customTemplates}
      onDeleteTemplate={onDeleteTemplate}
      onRoleChange={onRoleChange}
      onTemplateChange={onTemplateChange}
      selectedTemplateId={selectedTemplateId}
      workerRole={workerRole}
    />
  </div>
)

const RolePickerInner = ({
  customTemplates,
  onDeleteTemplate,
  onRoleChange,
  onTemplateChange,
  selectedTemplateId,
  workerRole,
}: {
  customTemplates: RoleTemplate[]
  onDeleteTemplate: (templateId: string) => Promise<void> | void
  onRoleChange: (value: WorkerRole) => void
  onTemplateChange: (templateId: string) => void
  selectedTemplateId: string | null
  workerRole: WorkerRole
}) => {
  const { t } = useI18n()
  const [deletingTemplate, setDeletingTemplate] = useState<RoleTemplate | null>(null)
  // The Custom card is active only when no specific template is selected.
  const customCardActive = workerRole === 'custom' && !selectedTemplateId
  return (
    <>
      <SectionLabel>{t('addWorker.role')}</SectionLabel>
      <div className="grid grid-cols-2 gap-2">
        {ROLE_CARDS.map((spec) =>
          spec.value === 'custom' ? (
            <RoleCard
              key={spec.value}
              active={customCardActive}
              spec={spec}
              onSelect={() => onRoleChange('custom')}
            />
          ) : (
            <RoleCard
              key={spec.value}
              active={workerRole === spec.value && !selectedTemplateId}
              spec={spec}
              onSelect={() => onRoleChange(spec.value)}
            />
          )
        )}
        {customTemplates.map((template) => (
          <CustomTemplateCard
            key={template.id}
            active={selectedTemplateId === template.id}
            template={template}
            onSelect={() => onTemplateChange(template.id)}
            onDelete={() => setDeletingTemplate(template)}
          />
        ))}
      </div>
      <Confirm
        open={deletingTemplate !== null}
        onOpenChange={(open) => {
          if (!open) setDeletingTemplate(null)
        }}
        title={t('addWorker.templateDeleteTitle')}
        description={
          deletingTemplate
            ? t('addWorker.templateDeleteConfirm', { name: deletingTemplate.name })
            : ''
        }
        confirmLabel={t('addWorker.templateDeleteConfirmLabel')}
        confirmKind="danger"
        onConfirm={() => {
          if (!deletingTemplate) return
          const id = deletingTemplate.id
          setDeletingTemplate(null)
          void onDeleteTemplate(id)
        }}
      />
    </>
  )
}

export const RoleInstructionsField = ({
  canSaveAsTemplate,
  modified,
  onChange,
  onReset,
  onSaveAsTemplate,
  roleDescription,
  templateBusy,
  workerRole,
}: {
  canSaveAsTemplate: boolean
  modified: boolean
  onChange: (value: string) => void
  onReset: () => void
  onSaveAsTemplate: (name: string) => Promise<void> | void
  roleDescription: string
  templateBusy: boolean
  workerRole: WorkerRole
}) => {
  const { t } = useI18n()
  const [instructionsOpen, setInstructionsOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [templateName, setTemplateName] = useState('')
  useEffect(() => {
    if (workerRole === 'custom' || modified) setInstructionsOpen(true)
  }, [modified, workerRole])
  useEffect(() => {
    if (!canSaveAsTemplate) {
      setSaving(false)
      setTemplateName('')
    }
  }, [canSaveAsTemplate])

  return (
    <details
      open={instructionsOpen}
      onToggle={(event) => setInstructionsOpen((event.currentTarget as HTMLDetailsElement).open)}
      className="group flex flex-col gap-2"
    >
      <summary className="flex cursor-pointer select-none items-center justify-between gap-2 list-none">
        <span className="flex items-center gap-1.5">
          <ChevronDown
            size={12}
            aria-hidden
            className="-rotate-90 text-ter transition-transform duration-150 group-open:rotate-0"
          />
          <SectionLabel>{t('addWorker.roleInstructions')}</SectionLabel>
          {modified ? (
            <span className="text-sm text-ter">
              · {t('addWorker.modifiedFrom', { role: t(roleLabelKey(workerRole)) })}
            </span>
          ) : null}
        </span>
        {modified ? (
          <button
            type="button"
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-ter transition-colors hover:bg-3 hover:text-sec"
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              onReset()
            }}
          >
            <RotateCcw size={12} aria-hidden />
            {t('addWorker.reset')}
          </button>
        ) : null}
      </summary>
      <textarea
        aria-label="Role instructions"
        id="add-worker-role-instructions"
        value={roleDescription}
        rows={5}
        onChange={(event) => onChange(event.currentTarget.value)}
        placeholder={workerRole === 'custom' ? t('addWorker.customPlaceholder') : undefined}
        title={t('addWorker.roleInstructionsTitle')}
        className="input mono resize-y text-sm"
        style={{ minHeight: 150 }}
        data-testid="role-instructions-textarea"
      />
      {canSaveAsTemplate && !saving ? (
        <button
          type="button"
          data-testid="role-template-save"
          onClick={() => setSaving(true)}
          className="self-start rounded px-2 py-1 text-xs text-sec transition-colors hover:bg-3 hover:text-pri"
        >
          {t('addWorker.saveAsTemplate')}
        </button>
      ) : null}
      {canSaveAsTemplate && saving ? (
        <div className="flex items-center gap-2">
          <input
            // biome-ignore lint/a11y/noAutofocus: opt-in inline prompt; focus the new field so the user can type immediately
            autoFocus
            value={templateName}
            onChange={(event) => setTemplateName(event.currentTarget.value)}
            placeholder={t('addWorker.templateNamePlaceholder')}
            data-testid="role-template-save-name"
            className="input flex-1 text-sm"
          />
          <button
            type="button"
            disabled={templateBusy || !templateName.trim()}
            data-testid="role-template-save-confirm"
            onClick={async () => {
              const name = templateName.trim()
              if (!name) return
              try {
                await onSaveAsTemplate(name)
                setSaving(false)
                setTemplateName('')
              } catch {
                // Error is surfaced by the composer; leave the prompt open so
                // the user can correct the name and retry.
              }
            }}
            className="icon-btn icon-btn--primary text-xs"
          >
            {t('addWorker.templateSaveConfirm')}
          </button>
          <button
            type="button"
            data-testid="role-template-save-cancel"
            onClick={() => {
              setSaving(false)
              setTemplateName('')
            }}
            className="icon-btn text-xs"
          >
            {t('common.cancel')}
          </button>
        </div>
      ) : null}
    </details>
  )
}

const AgentChip = ({
  active,
  command,
  displayName,
  notFound = false,
  testId,
  onSelect,
}: {
  active: boolean
  command: string
  displayName: string
  notFound?: boolean
  testId: string
  onSelect: () => void
}) => {
  const { t } = useI18n()
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      data-testid={testId}
      className="selectable-card flex items-center justify-between gap-2 px-3 py-2"
    >
      <span className="flex min-w-0 flex-col items-start gap-0.5">
        <span className="truncate text-base font-medium text-pri">{displayName}</span>
        <span className="mono truncate text-xs text-ter">
          {command}
          {notFound ? ` · ${t('addWorker.agentNotFound')}` : ''}
        </span>
      </span>
      {active ? <Check size={14} className="shrink-0 text-accent" aria-hidden /> : null}
    </button>
  )
}

const PresetAgentChip = ({
  active,
  preset,
  onSelect,
}: {
  active: boolean
  preset: CommandPreset
  onSelect: () => void
}) => (
  <AgentChip
    active={active}
    command={preset.command}
    displayName={preset.displayName}
    notFound={preset.available === false}
    testId={`agent-radio-${preset.id}`}
    onSelect={onSelect}
  />
)

export const AgentCliPicker = ({
  commandPresetId,
  commandPresets,
  onPresetChange,
}: {
  commandPresetId: string
  commandPresets: CommandPreset[]
  onPresetChange: (value: string) => void
}) => (
  <AgentCliPickerInner
    commandPresetId={commandPresetId}
    commandPresets={commandPresets}
    onPresetChange={onPresetChange}
  />
)

const AgentCliPickerInner = ({
  commandPresetId,
  commandPresets,
  onPresetChange,
}: {
  commandPresetId: string
  commandPresets: CommandPreset[]
  onPresetChange: (value: string) => void
}) => {
  const { t } = useI18n()
  return (
    <div className="flex flex-col gap-2">
      <SectionLabel>{t('addWorker.agentCli')}</SectionLabel>
      {commandPresets.length === 0 ? (
        <div className="text-sm text-ter">{t('addWorker.loadingPresets')}</div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {commandPresets.map((preset) => (
            <PresetAgentChip
              key={preset.id}
              active={commandPresetId === preset.id}
              preset={preset}
              onSelect={() => onPresetChange(preset.id)}
            />
          ))}
          <AgentChip
            active={commandPresetId === ''}
            command={t('addWorker.genericCommand')}
            displayName={t('addWorker.genericAgent')}
            testId="agent-radio-generic"
            onSelect={() => onPresetChange('')}
          />
        </div>
      )}
    </div>
  )
}

export const StartupCommandField = ({
  onChange,
  value,
}: {
  onChange: (value: string) => void
  value: string
}) => {
  const { t } = useI18n()
  const clean = value.trim()
  return (
    <details className="group flex flex-col gap-2">
      <summary className="flex cursor-pointer select-none items-center justify-between gap-2 list-none">
        <span className="flex min-w-0 items-center gap-1.5">
          <ChevronDown
            size={12}
            aria-hidden
            className="-rotate-90 shrink-0 text-ter transition-transform duration-150 group-open:rotate-0"
          />
          <SectionLabel>{t('addWorker.startupCommand')}</SectionLabel>
          {clean ? (
            <span className="truncate text-sm text-ter">· {t('addWorker.startupOverrides')}</span>
          ) : null}
        </span>
      </summary>
      <div
        className="flex flex-col gap-2 rounded border bg-2 p-3"
        style={{ borderColor: 'var(--border)' }}
      >
        <input
          aria-label="Startup command"
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
          placeholder="qwen --model qwen3-coder"
          className="input mono text-sm"
          spellCheck={false}
        />
        <p className="text-sm leading-5 text-ter">
          {t('addWorker.startupHelp', { example: 'claude --resume <session-id>' })}
        </p>
      </div>
    </details>
  )
}
