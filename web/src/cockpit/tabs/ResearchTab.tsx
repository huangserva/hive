import { ExternalLink } from 'lucide-react'
import { useState } from 'react'

import type { ParsedResearch, PMResearchEntry } from '../../api.js'
import { useI18n } from '../../i18n.js'
import {
  CockpitDocumentViewer,
  type CockpitDocumentViewerDocument,
} from '../CockpitDocumentViewer.js'

const formatMtime = (mtime: string) =>
  new Date(mtime).toLocaleString('sv-SE', { hour12: false }).slice(0, 16)

const docUrl = (workspaceId: string, path: string) =>
  `/api/workspaces/${workspaceId}/cockpit/doc-file?path=${encodeURIComponent(path)}`

const ResearchEntryCard = ({
  entry,
  onOpen,
  workspaceId,
}: {
  entry: PMResearchEntry
  onOpen: (document: CockpitDocumentViewerDocument) => void
  workspaceId: string
}) => {
  const { t } = useI18n()
  const path = `.hive/research/${entry.filename}`
  return (
    <div className="rounded border p-3" style={{ borderColor: 'var(--border)' }}>
      <div className="mb-1 flex items-center gap-2 text-ter text-xs">
        <span>{formatMtime(entry.mtime)}</span>
        <span className="mono truncate">{entry.filename}</span>
        <span className="tabular-nums">
          {t('cockpit.research.lineCount', { count: entry.size })}
        </span>
      </div>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-medium text-pri text-sm">{entry.title}</div>
          <div className="mt-1 text-sec text-xs">{entry.topic}</div>
        </div>
        <button
          aria-label={t('cockpit.openDocument')}
          className="icon-btn h-8 px-2 text-xs"
          disabled={!workspaceId}
          onClick={() =>
            onOpen({ kind: 'markdown', title: entry.title, url: docUrl(workspaceId, path) })
          }
          type="button"
        >
          <ExternalLink size={13} aria-hidden />
          {t('cockpit.openDocument')}
        </button>
      </div>
    </div>
  )
}

export const ResearchTab = ({
  research,
  workspaceId,
}: {
  research: ParsedResearch
  workspaceId: string
}) => {
  const { t } = useI18n()
  const [viewerDocument, setViewerDocument] = useState<CockpitDocumentViewerDocument | null>(null)
  return (
    <div className="scroll-y space-y-4 px-5 py-4">
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-pri text-sm">{t('cockpit.research.title')}</h3>
        <span className="text-ter text-xs tabular-nums">{research.totalCount}</span>
      </div>
      {research.parseError ? (
        <div
          className="rounded border px-3 py-2 text-sm text-warn"
          style={{ borderColor: 'var(--border)' }}
        >
          {t('cockpit.research.parseWarning', { message: research.parseError })}
        </div>
      ) : null}
      <div className="space-y-2">
        {research.entries.length ? (
          research.entries.map((entry) => (
            <ResearchEntryCard
              entry={entry}
              key={entry.filename}
              onOpen={setViewerDocument}
              workspaceId={workspaceId}
            />
          ))
        ) : (
          <p
            className="rounded border p-3 text-sec text-sm"
            style={{ borderColor: 'var(--border)' }}
          >
            {t('cockpit.research.empty')}
          </p>
        )}
      </div>
      <CockpitDocumentViewer document={viewerDocument} onClose={() => setViewerDocument(null)} />
    </div>
  )
}
