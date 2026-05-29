import type { CommandPresetCapabilities as CommandPresetCapabilitiesType } from '../../../src/shared/types.js'

const featureLabels: Record<string, string> = {
  browser_e2e: 'Browser E2E',
  mcp: 'MCP',
  session_capture: 'Capture',
  session_resume: 'Resume',
  terminal_input_profile: 'Terminal profile',
  thinking_levels: 'Thinking',
}

const riskTone: Record<string, string> = {
  high: 'border-red-500/30 bg-red-500/10 text-red-300',
  moderate: 'border-yellow-500/30 bg-yellow-500/10 text-yellow-300',
  unknown: 'border-border bg-3 text-ter',
}

const unattendedLabel = (value: CommandPresetCapabilitiesType['unattended']) => {
  if (value === true) return 'Unattended'
  if (value === false) return 'Supervised'
  return null
}

export const CommandPresetCapabilities = ({
  capabilities,
  maxFeatures = 4,
}: {
  capabilities?: CommandPresetCapabilitiesType | null
  maxFeatures?: number
}) => {
  if (!capabilities) return null

  const featureChips = capabilities.features.slice(0, maxFeatures)
  const hiddenFeatureCount = capabilities.features.length - featureChips.length
  const unattended = unattendedLabel(capabilities.unattended)

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5" data-testid="preset-capabilities">
      {capabilities.mode !== 'unknown' ? (
        <span className="rounded border border-border bg-2 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ter">
          {capabilities.mode.replace(/_/gu, ' ')}
        </span>
      ) : null}
      {capabilities.riskTier !== 'unknown' ? (
        <span
          className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${riskTone[capabilities.riskTier] ?? riskTone.unknown}`}
        >
          {capabilities.riskTier} risk
        </span>
      ) : null}
      {unattended ? (
        <span className="rounded border border-purple-500/30 bg-purple-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-purple-300">
          {unattended}
        </span>
      ) : null}
      {featureChips.map((feature) => (
        <span
          key={feature}
          className="rounded border border-border bg-3 px-1.5 py-0.5 text-[10px] font-medium text-sec"
        >
          {featureLabels[feature] ?? feature.replace(/_/gu, ' ')}
        </span>
      ))}
      {hiddenFeatureCount > 0 ? (
        <span className="rounded border border-border bg-3 px-1.5 py-0.5 text-[10px] font-medium text-ter">
          +{hiddenFeatureCount}
        </span>
      ) : null}
    </div>
  )
}
