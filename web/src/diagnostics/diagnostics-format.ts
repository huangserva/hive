// Pure helpers for the diagnostics tab. Kept out of the React component so the
// event/severity rendering logic can be unit-tested without a DOM.

import type { DiagnosticsEvent } from '../api.js'

const asString = (value: unknown): string => (typeof value === 'string' ? value : '')

// The most actionable diagnostic — "another machine's codex isn't on PATH". The
// dispatch_spawn_failed system_event carries the worker, the resolved command,
// the PATH it was spawned with, and the spawn error.
export interface SpawnFailureView {
  command: string
  error: string
  path: string
  taskSummary: string
  worker: string
}

export const describeSpawnFailure = (payload: Record<string, unknown>): SpawnFailureView => ({
  command: asString(payload.command),
  error: asString(payload.error),
  path: asString(payload.path),
  taskSummary: asString(payload.task_summary),
  worker: asString(payload.worker) || asString(payload.worker_id) || 'unknown',
})

export const isSpawnFailureEvent = (event: DiagnosticsEvent): boolean =>
  event.type === 'dispatch_spawn_failed'

// Map a sentinel tier to a status color CSS var (shared with the rest of the UI).
export const sentinelTierAccent = (tier: 'critical' | 'info' | 'warn'): string => {
  if (tier === 'critical') return 'var(--status-red)'
  if (tier === 'warn') return 'var(--status-yellow)'
  return 'var(--accent)'
}

// "darwin arm64 · v1.2.3 · :4010" one-liner for the env header.
export const formatPlatformLine = (input: {
  appVersion: string
  arch: string
  platform: string
  port: number
}): string => `${input.platform} ${input.arch} · ${input.appVersion} · :${input.port}`
