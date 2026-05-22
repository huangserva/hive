import * as Dialog from '@radix-ui/react-dialog'
import { useMemo, useState } from 'react'

import type { MarketplaceAgentEntry } from '../api.js'
import { useI18n } from '../i18n.js'
import { MarketplaceAgentCard } from './MarketplaceAgentCard.js'
import { MarketplaceAgentPreview } from './MarketplaceAgentPreview.js'
import { MarketplaceCategoryTree } from './MarketplaceCategoryTree.js'
import { useMarketplace } from './useMarketplace.js'

interface MarketplaceDrawerProps {
  open: boolean
  onClose: () => void
  onImport: (detail: { name: string; description: string }) => void
}

export const MarketplaceDrawer = ({ open, onClose, onImport }: MarketplaceDrawerProps) => {
  const { t, language } = useI18n()
  const { manifestState, loadAgent } = useMarketplace(language, open)
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [selectedAgent, setSelectedAgent] = useState<MarketplaceAgentEntry | null>(null)
  const [query, setQuery] = useState('')

  const handleOpenChange = (next: boolean) => {
    if (!next) onClose()
  }

  const manifest = manifestState.data

  const categoryCounts = useMemo(() => {
    if (!manifest) return {}
    const counts: Record<string, number> = {}
    for (const agent of manifest.agents) {
      counts[agent.category] = (counts[agent.category] ?? 0) + 1
    }
    return counts
  }, [manifest])

  const filteredAgents = useMemo(() => {
    if (!manifest) return []
    const lower = query.trim().toLowerCase()
    return manifest.agents.filter((agent) => {
      if (selectedCategory && agent.category !== selectedCategory) return false
      if (!lower) return true
      return (
        agent.name.toLowerCase().includes(lower) || agent.description.toLowerCase().includes(lower)
      )
    })
  }, [manifest, query, selectedCategory])

  const handleImport = (detail: { name: string; description: string }) => {
    onImport(detail)
    setSelectedAgent(null)
    onClose()
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          data-testid="marketplace-overlay"
          className="app-overlay fixed inset-0 z-40"
        />
        <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center p-4">
          <Dialog.Content
            data-testid="marketplace-content"
            className="dialog-scale-pop elev-2 pointer-events-auto flex max-h-[calc(100vh-32px)] w-[1100px] max-w-full flex-col rounded-lg border"
            style={{
              background: 'var(--bg-elevated)',
              borderColor: 'var(--border-bright)',
            }}
          >
            <header
              className="flex shrink-0 items-center justify-between gap-4 border-b px-5 py-3"
              style={{ borderColor: 'var(--border)' }}
            >
              <div className="flex flex-col gap-0.5">
                <Dialog.Title className="text-base font-semibold text-pri">
                  {t('marketplace.title')}
                </Dialog.Title>
                <Dialog.Description className="text-xs text-ter">
                  {manifest ? t('marketplace.sourceLabel', { repo: manifest.source.repo }) : ' '}
                </Dialog.Description>
              </div>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('marketplace.searchPlaceholder')}
                data-testid="marketplace-search"
                className="w-72 rounded border px-3 py-1.5 text-sm text-pri outline-none focus:border-bright"
                style={{
                  background: 'var(--bg-2)',
                  borderColor: 'var(--border)',
                }}
              />
            </header>
            <div
              className="grid min-h-0 flex-1 grid-cols-[180px_minmax(0,1fr)_380px] divide-x"
              style={{ borderColor: 'var(--border)' }}
            >
              <aside className="min-h-0 overflow-y-auto px-3 py-3">
                {manifest ? (
                  <MarketplaceCategoryTree
                    categories={manifest.categories}
                    selected={selectedCategory}
                    onSelect={(category) => {
                      setSelectedCategory(category)
                      setSelectedAgent(null)
                    }}
                    counts={categoryCounts}
                  />
                ) : null}
              </aside>
              <section
                className="min-h-0 overflow-y-auto px-3 py-3"
                data-testid="marketplace-agent-grid"
              >
                {manifestState.status === 'loading' ? <p className="text-sm text-ter">…</p> : null}
                {manifestState.status === 'error' ? (
                  <p className="text-sm text-ter">
                    {t('marketplace.loadFailed')}: {manifestState.error}
                  </p>
                ) : null}
                {manifestState.status === 'loaded' && filteredAgents.length === 0 ? (
                  <p className="text-sm text-ter">{t('marketplace.empty')}</p>
                ) : null}
                <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
                  {filteredAgents.map((agent) => (
                    <MarketplaceAgentCard
                      key={agent.path}
                      agent={agent}
                      selected={selectedAgent?.path === agent.path}
                      onSelect={() => setSelectedAgent(agent)}
                    />
                  ))}
                </div>
              </section>
              <section className="min-h-0">
                {selectedAgent && manifest ? (
                  <MarketplaceAgentPreview
                    agent={selectedAgent}
                    sourceRepo={manifest.source.repo}
                    loadAgent={loadAgent}
                    onImport={handleImport}
                  />
                ) : (
                  <div className="flex h-full items-center justify-center px-4 text-sm text-ter">
                    —
                  </div>
                )}
              </section>
            </div>
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
