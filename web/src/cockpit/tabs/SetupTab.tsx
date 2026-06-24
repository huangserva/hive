import { useI18n } from '../../i18n.js'
import { ApiKeysPanel } from '../../settings/ApiKeysPanel.js'
import { CliDetectionPanel } from '../../settings/CliDetectionPanel.js'

// Cockpit "Setup" tab — environment & secrets. Lets the user re-check installed
// agent CLIs, point at a manual CLI path, and manage API keys after onboarding.
// Workspace-independent (reads its own settings endpoints), so it ignores cockpit
// data entirely.
export const SetupTab = () => {
  const { t } = useI18n()
  return (
    <div className="scroll-y space-y-5 px-5 py-4">
      <header>
        <h2 className="font-semibold text-pri text-sm">{t('settings.title')}</h2>
        <p className="mt-1 text-sec text-xs">{t('settings.subtitle')}</p>
      </header>
      <CliDetectionPanel />
      <ApiKeysPanel />
    </div>
  )
}
