import type { MarketplaceAgentEntry } from '../api.js'

interface MarketplaceAgentCardProps {
  agent: MarketplaceAgentEntry
  selected: boolean
  onSelect: () => void
}

export const MarketplaceAgentCard = ({ agent, selected, onSelect }: MarketplaceAgentCardProps) => (
  <button
    type="button"
    onClick={onSelect}
    data-testid="marketplace-agent-card"
    data-agent-path={agent.path}
    className="flex w-full cursor-pointer flex-col gap-1 rounded-md border px-3 py-2 text-left transition-colors hover:bg-3"
    style={{
      background: selected ? 'var(--bg-3)' : 'var(--bg-elevated)',
      borderColor: selected ? 'var(--border-bright)' : 'var(--border)',
    }}
  >
    <div className="flex items-center gap-2">
      {agent.emoji ? <span className="text-base leading-none">{agent.emoji}</span> : null}
      <span className="text-sm font-medium text-pri">{agent.name}</span>
    </div>
    <p className="line-clamp-2 text-xs text-ter">{agent.description}</p>
  </button>
)
