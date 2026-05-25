import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { useEffect, useState } from 'react'

import { useI18n } from '../i18n.js'

export interface CockpitDocumentViewerDocument {
  kind: 'html' | 'markdown'
  title: string
  url: string
}

interface CockpitDocumentViewerProps {
  document: CockpitDocumentViewerDocument | null
  onClose: () => void
}

export const CockpitDocumentViewer = ({ document, onClose }: CockpitDocumentViewerProps) => {
  const { t } = useI18n()
  const [content, setContent] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!document || document.kind !== 'markdown') {
      setContent('')
      setError(null)
      setLoading(false)
      return
    }

    let cancelled = false
    setContent('')
    setError(null)
    setLoading(true)
    fetch(document.url, { credentials: 'include' })
      .then(async (response) => {
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`.trim())
        return response.text()
      })
      .then((text) => {
        if (cancelled) return
        setContent(text)
      })
      .catch((fetchError) => {
        if (cancelled) return
        setError(fetchError instanceof Error ? fetchError.message : String(fetchError))
      })
      .finally(() => {
        if (cancelled) return
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [document])

  return (
    <Dialog.Root open={Boolean(document)} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content
          className="fixed inset-4 z-50 flex flex-col rounded border shadow-2xl md:inset-8"
          style={{ background: 'var(--bg-1)', borderColor: 'var(--border)' }}
        >
          <header
            className="flex h-12 shrink-0 items-center gap-3 border-b px-4"
            style={{ borderColor: 'var(--border)' }}
          >
            <Dialog.Title className="min-w-0 flex-1 truncate font-semibold text-pri text-sm">
              {document?.title ?? t('cockpit.documentViewer.title')}
            </Dialog.Title>
            <Dialog.Description className="sr-only">
              {t('cockpit.documentViewer.description')}
            </Dialog.Description>
            <Dialog.Close asChild>
              <button
                aria-label={t('cockpit.documentViewer.close')}
                className="icon-btn h-8 w-8"
                type="button"
              >
                <X size={16} aria-hidden />
              </button>
            </Dialog.Close>
          </header>
          <div className="min-h-0 flex-1">
            {document?.kind === 'html' ? (
              <iframe
                className="h-full w-full border-0"
                src={document.url}
                title={document.title}
              />
            ) : null}
            {document?.kind === 'markdown' ? (
              <div className="h-full overflow-auto p-4">
                {loading ? (
                  <p className="text-sec text-sm">{t('cockpit.documentViewer.loading')}</p>
                ) : null}
                {error ? (
                  <p
                    className="rounded border p-3 text-sm text-warn"
                    style={{ borderColor: 'var(--border)' }}
                  >
                    {t('cockpit.documentViewer.error', { message: error })}
                  </p>
                ) : null}
                {!loading && !error ? (
                  <pre className="whitespace-pre-wrap break-words font-mono text-sec text-sm leading-6">
                    {content}
                  </pre>
                ) : null}
              </div>
            ) : null}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
