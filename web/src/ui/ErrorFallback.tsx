import { AlertTriangle } from 'lucide-react'
import { useState } from 'react'

// Recoverable error panels rendered by ErrorBoundary. Deliberately
// self-contained — no i18n / context hooks — because a boundary must keep
// working even when a provider (i18n, runtime context) is the thing that threw.
// Text is bilingual-short so it reads for the user without a translation layer.

const copyErrorDetails = (error: Error) => {
  const detail = `${error.name}: ${error.message}\n\n${error.stack ?? ''}`
  void navigator.clipboard?.writeText(detail).catch(() => {})
}

export const AppErrorFallback = ({ error, reset }: { error: Error; reset: () => void }) => {
  const [copied, setCopied] = useState(false)
  return (
    <div
      role="alert"
      style={{
        alignItems: 'center',
        background: 'var(--bg-1, #0d1117)',
        color: 'var(--text-primary, #e6edf3)',
        display: 'flex',
        inset: 0,
        justifyContent: 'center',
        padding: 24,
        position: 'fixed',
      }}
    >
      <div style={{ maxWidth: 460, textAlign: 'center' }}>
        <div
          style={{ color: 'var(--status-red, #f85149)', display: 'flex', justifyContent: 'center' }}
        >
          <AlertTriangle size={36} />
        </div>
        <h1 style={{ fontSize: 18, fontWeight: 600, margin: '14px 0 6px' }}>
          界面出错了 · Something went wrong
        </h1>
        <p style={{ color: 'var(--text-secondary, #8b949e)', fontSize: 13, margin: '0 0 6px' }}>
          页面遇到一个错误，但没有崩溃。可以重试恢复，或重新加载界面。
        </p>
        <p
          style={{
            background: 'var(--bg-2, #161b22)',
            border: '1px solid var(--border, #30363d)',
            borderRadius: 6,
            color: 'var(--text-secondary, #8b949e)',
            fontFamily: 'ui-monospace, monospace',
            fontSize: 11.5,
            margin: '12px 0',
            overflow: 'auto',
            padding: '8px 10px',
            textAlign: 'left',
            wordBreak: 'break-word',
          }}
        >
          {error.message || String(error)}
        </p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
          <button className="icon-btn icon-btn--primary" onClick={reset} type="button">
            重试 · Retry
          </button>
          <button className="icon-btn" onClick={() => window.location.reload()} type="button">
            重新加载 · Reload
          </button>
          <button
            className="icon-btn"
            onClick={() => {
              copyErrorDetails(error)
              setCopied(true)
            }}
            type="button"
          >
            {copied ? '已复制 · Copied' : '复制详情 · Copy'}
          </button>
        </div>
      </div>
    </div>
  )
}

export const InlineErrorFallback = ({
  error,
  reset,
  title,
}: {
  error: Error
  reset: () => void
  title?: string
}) => (
  <div
    role="alert"
    style={{
      alignItems: 'flex-start',
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      margin: 16,
      padding: 16,
    }}
  >
    <div style={{ alignItems: 'center', display: 'flex', gap: 8 }}>
      <AlertTriangle size={16} style={{ color: 'var(--status-red, #f85149)' }} />
      <span style={{ color: 'var(--text-primary, #e6edf3)', fontSize: 13, fontWeight: 600 }}>
        {title ?? '此面板加载失败 · This panel failed to load'}
      </span>
    </div>
    <p
      style={{
        color: 'var(--text-secondary, #8b949e)',
        fontFamily: 'ui-monospace, monospace',
        fontSize: 11.5,
        margin: 0,
        wordBreak: 'break-word',
      }}
    >
      {error.message || String(error)}
    </p>
    <button className="icon-btn" onClick={reset} type="button">
      重试 · Retry
    </button>
  </div>
)
