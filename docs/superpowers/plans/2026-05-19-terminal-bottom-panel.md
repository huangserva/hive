# Terminal Bottom Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move worker + workspace-shell terminals from modal/dialog overlays into a docked, resizable, VSCode-tab-style bottom panel that lives inside the right column of `WorkspaceDetail` (under `WorkersPane`). Orchestrator terminal stays in the left pane unchanged.

**Architecture:**
- Right column becomes a vertical flex split: `WorkersPane` (top) + new `TerminalBottomPanel` (bottom). A new horizontal splitter drives the height. The panel auto-hides when no tabs are open.
- Tabs are a unified list mixing worker tabs (`worker:<workerId>`) and shell tabs (`shell:<runId>`). The portal slot mechanism (`worker-pty-${runId}` / `shell-pty-${runId}`) is unchanged — only the slot's host moves from `WorkerModal`/`WorkspaceShellDialog` into the panel's tab content area.
- `WorkerModal`, `useWorkerModalResize`, `WorkspaceShellDialog` are deleted; `WorkspaceDetail` shrinks accordingly.
- Tab list and active tab persist per-workspace; panel height persists globally. All localStorage I/O wrapped in try/catch (matches existing `usePaneSplit` / `useWorkerModalResize` patterns).

**Tech Stack:**
- React 19 + Vite 6
- Tailwind v4 design tokens (`var(--bg-1)`, `var(--bg-2)`, `var(--border)`, `var(--accent)`, etc.)
- `lucide-react` icons (already used: `Terminal`, `X`, `Plus`)
- Vitest + `@testing-library/react` + `jsdom` for tests
- localStorage for persistence
- Existing `xterm` + portal indirection via `TerminalView.tsx` (no changes needed)

**Repo:** `/Users/admin/code/hive-private-release` (branch `release-1.1.0`). Public mirror at `/Users/admin/code/hive` not touched.

---

## File Structure

**Create:**
- `web/src/terminal/useTerminalPanelHeight.ts` — height + collapsed-state hook (localStorage; matches `usePaneSplit` shape)
- `web/src/terminal/useTerminalPanelTabs.ts` — tab list assembly + active tab + per-workspace persistence
- `web/src/terminal/TerminalTabs.tsx` — VSCode-style tab strip (active = top accent line, hover-revealed ×, "+" for new shell)
- `web/src/terminal/TerminalBottomPanel.tsx` — panel chrome: horizontal splitter + tabs + content area with the portal slot div
- `tests/web/use-terminal-panel-height.test.ts`
- `tests/web/use-terminal-panel-tabs.test.ts`
- `tests/web/terminal-bottom-panel.test.tsx`
- `tests/web/terminal-tabs.test.tsx`

**Modify:**
- `web/src/WorkspaceDetail.tsx` — remove `WorkerModal`/`WorkspaceShellDialog` usage, mount `TerminalBottomPanel` inside the right column
- `web/src/worker/WorkersPane.tsx` — the right column wrapper grows a sibling slot for the panel (we keep `WorkersPane` itself focused on its own content; the splitter + panel live in `WorkspaceDetail`)
- `web/src/i18n.tsx` — drop modal-only keys, add panel-only keys
- `web/src/AppWorkspaceContent.tsx` — no logic change but verify still mounts `WorkspaceTerminalPanels` (the portal source) once
- `tests/web/worker-flow.test.tsx` — update from "modal opens" assertions to "panel tab activates"
- `package.json` — `test:windows` list updates (drop deleted, add new)

**Delete:**
- `web/src/worker/WorkerModal.tsx`
- `web/src/worker/useWorkerModalResize.ts`
- `web/src/terminal/WorkspaceShellDialog.tsx`
- `tests/web/worker-modal.test.tsx`
- `tests/web/workspace-shell-dialog.test.tsx`

---

## Tab Model

```ts
// In useTerminalPanelTabs.ts
export type TerminalTabKind = 'worker' | 'shell'

export type TerminalTab =
  | { id: string; kind: 'worker'; workerId: string; runId: string | null; label: string }
  | { id: string; kind: 'shell'; runId: string; label: string }

// id encoding: `worker:<workerId>` or `shell:<runId>`
```

Why this shape: callers (`TerminalTabs`, `TerminalBottomPanel`) only need `id`, `label`, `kind`, and a render-time `runId` to pick the portal slot. Stable id lets us survive PTY restarts (worker tab keeps id `worker:<workerId>` across stop/start cycles).

---

## Persistence Keys

- `hive.terminal-panel.height` — number (pixels). Global; default = floor(viewport.height * 0.35), min 160, max viewport.height − 160.
- `hive.terminal-panel.collapsed` — `"1"` or `"0"`. Global; default `"0"`.
- `hive.terminal-panel.tabs.<workspaceId>` — JSON array of tab id strings (e.g., `["worker:abc", "shell:run-x"]`). Per-workspace; default `[]`.
- `hive.terminal-panel.active.<workspaceId>` — tab id string or empty. Per-workspace; default `""`.

All reads wrapped in `try/catch` returning the default. All writes wrapped in `try/catch` (silent failure on quota / private browsing).

---

### Task 1: `useTerminalPanelHeight` hook + tests

**Files:**
- Create: `web/src/terminal/useTerminalPanelHeight.ts`
- Test: `tests/web/use-terminal-panel-height.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  TERMINAL_PANEL_MIN_HEIGHT,
  useTerminalPanelHeight,
} from '../../web/src/terminal/useTerminalPanelHeight.js'

const HEIGHT_KEY = 'hive.terminal-panel.height'
const COLLAPSED_KEY = 'hive.terminal-panel.collapsed'

beforeEach(() => {
  window.localStorage.clear()
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 })
})

afterEach(() => {
  window.localStorage.clear()
})

describe('useTerminalPanelHeight', () => {
  test('uses viewport-based default on first read', () => {
    const { result } = renderHook(() => useTerminalPanelHeight())
    expect(result.current.height).toBe(Math.floor(900 * 0.35))
    expect(result.current.collapsed).toBe(false)
  })

  test('clamps stored height below minimum back up to min', () => {
    window.localStorage.setItem(HEIGHT_KEY, '40')
    const { result } = renderHook(() => useTerminalPanelHeight())
    expect(result.current.height).toBe(TERMINAL_PANEL_MIN_HEIGHT)
  })

  test('persists height changes to localStorage', () => {
    const { result } = renderHook(() => useTerminalPanelHeight())
    act(() => result.current.setHeight(420))
    expect(window.localStorage.getItem(HEIGHT_KEY)).toBe('420')
  })

  test('toggling collapsed persists', () => {
    const { result } = renderHook(() => useTerminalPanelHeight())
    act(() => result.current.setCollapsed(true))
    expect(window.localStorage.getItem(COLLAPSED_KEY)).toBe('1')
    expect(result.current.collapsed).toBe(true)
  })

  test('beginDrag stores body cursor/userSelect and restores on pointerup', () => {
    const { result } = renderHook(() => useTerminalPanelHeight())
    document.body.style.userSelect = 'text'
    document.body.style.cursor = 'auto'
    act(() => {
      const event = new PointerEvent('pointerdown', { clientY: 500, bubbles: true })
      result.current.beginDrag(event as unknown as React.PointerEvent<HTMLDivElement>)
    })
    expect(document.body.style.cursor).toBe('ns-resize')
    act(() => {
      document.dispatchEvent(new PointerEvent('pointerup'))
    })
    expect(document.body.style.cursor).toBe('auto')
    expect(document.body.style.userSelect).toBe('text')
  })
})
```

- [ ] **Step 2: Run the failing test**

```bash
cd /Users/admin/code/hive-private-release && pnpm exec vitest run tests/web/use-terminal-panel-height.test.ts
```
Expected: FAIL — module `useTerminalPanelHeight` does not resolve.

- [ ] **Step 3: Implement the hook**

```ts
// web/src/terminal/useTerminalPanelHeight.ts
import { type PointerEvent as ReactPointerEvent, useCallback, useEffect, useState } from 'react'

const HEIGHT_KEY = 'hive.terminal-panel.height'
const COLLAPSED_KEY = 'hive.terminal-panel.collapsed'

export const TERMINAL_PANEL_MIN_HEIGHT = 160
const DEFAULT_RATIO = 0.35
const BOTTOM_SAFE_AREA = 160

const clampHeight = (value: number): number => {
  const viewport = typeof window !== 'undefined' ? window.innerHeight : 800
  const maxHeight = Math.max(TERMINAL_PANEL_MIN_HEIGHT, viewport - BOTTOM_SAFE_AREA)
  return Math.min(Math.max(value, TERMINAL_PANEL_MIN_HEIGHT), maxHeight)
}

const computeDefaultHeight = (): number => {
  const viewport = typeof window !== 'undefined' ? window.innerHeight : 800
  return clampHeight(Math.floor(viewport * DEFAULT_RATIO))
}

const readStoredHeight = (): number => {
  try {
    const raw = window.localStorage.getItem(HEIGHT_KEY)
    if (!raw) return computeDefaultHeight()
    const parsed = Number.parseInt(raw, 10)
    return Number.isFinite(parsed) ? clampHeight(parsed) : computeDefaultHeight()
  } catch {
    return computeDefaultHeight()
  }
}

const readStoredCollapsed = (): boolean => {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * Drives the horizontal splitter on top of the bottom terminal panel inside
 * the right column. Height is persisted globally so layout sticks across
 * reloads regardless of workspace. Collapsed is a global preference for the
 * panel itself, not per-workspace.
 */
export const useTerminalPanelHeight = () => {
  const [height, setHeightRaw] = useState<number>(() => readStoredHeight())
  const [collapsed, setCollapsedRaw] = useState<boolean>(() => readStoredCollapsed())
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    try {
      window.localStorage.setItem(HEIGHT_KEY, String(Math.round(height)))
    } catch {
      // quota / private browsing — silently keep in-memory value
    }
  }, [height])

  useEffect(() => {
    try {
      window.localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0')
    } catch {
      // ignored
    }
  }, [collapsed])

  useEffect(() => {
    const handleResize = () => setHeightRaw((h) => clampHeight(h))
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const setHeight = useCallback((next: number) => setHeightRaw(clampHeight(next)), [])
  const setCollapsed = useCallback((next: boolean) => setCollapsedRaw(next), [])

  const beginDrag = useCallback(
    (startEvent: ReactPointerEvent<HTMLDivElement>) => {
      startEvent.preventDefault()
      const startY = startEvent.clientY
      let startHeight = height
      setHeightRaw((current) => {
        startHeight = current
        return current
      })
      setDragging(true)

      const previousCursor = document.body.style.cursor
      const previousUserSelect = document.body.style.userSelect
      document.body.style.cursor = 'ns-resize'
      document.body.style.userSelect = 'none'

      const handleMove = (ev: PointerEvent) => {
        // Dragging UP grows the panel; deltaY is negative when moving up.
        const delta = ev.clientY - startY
        setHeightRaw(clampHeight(startHeight - delta))
      }
      const handleUp = () => {
        setDragging(false)
        document.body.style.cursor = previousCursor
        document.body.style.userSelect = previousUserSelect
        document.removeEventListener('pointermove', handleMove)
        document.removeEventListener('pointerup', handleUp)
        document.removeEventListener('pointercancel', handleUp)
      }
      document.addEventListener('pointermove', handleMove)
      document.addEventListener('pointerup', handleUp)
      document.addEventListener('pointercancel', handleUp)
    },
    [height]
  )

  return { height, collapsed, dragging, setHeight, setCollapsed, beginDrag }
}
```

- [ ] **Step 4: Run tests — verify pass**

```bash
cd /Users/admin/code/hive-private-release && pnpm exec vitest run tests/web/use-terminal-panel-height.test.ts
```
Expected: PASS, 5/5.

- [ ] **Step 5: Commit**

```bash
cd /Users/admin/code/hive-private-release
git add web/src/terminal/useTerminalPanelHeight.ts tests/web/use-terminal-panel-height.test.ts
git commit -m "Add useTerminalPanelHeight hook for bottom-panel resize state"
```

---

### Task 2: `useTerminalPanelTabs` hook + tests

**Files:**
- Create: `web/src/terminal/useTerminalPanelTabs.ts`
- Test: `tests/web/use-terminal-panel-tabs.test.ts`

The hook owns:
- The ordered tab list for the current workspace (persisted per-workspace).
- The active tab id (persisted per-workspace).
- Methods: `openWorkerTab(workerId)`, `openShellTab(runId)`, `closeTab(tabId)`, `setActive(tabId)`.
- Read inputs: `workspaceId`, `workers: TeamListItem[]`, `terminalRuns: TerminalRunSummary[]`, `isWorkspaceShellRun: (run, wsId) => boolean`.

It derives a render-ready `tabs: TerminalTab[]` by joining stored tab ids with current `workers` / `terminalRuns`. Worker tabs whose worker has been deleted are dropped on next render. Shell tabs whose run has disappeared are dropped on next render. The active tab id falls back to the first surviving tab.

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import type { TerminalRunSummary } from '../../web/src/api.js'
import {
  type TerminalTab,
  useTerminalPanelTabs,
} from '../../web/src/terminal/useTerminalPanelTabs.js'

const WORKSPACE_ID = 'ws-1'
const TABS_KEY = `hive.terminal-panel.tabs.${WORKSPACE_ID}`
const ACTIVE_KEY = `hive.terminal-panel.active.${WORKSPACE_ID}`

const buildRun = (overrides: Partial<TerminalRunSummary> = {}): TerminalRunSummary => ({
  agent_id: 'worker-a',
  agent_name: 'Alice',
  run_id: 'run-a',
  status: 'running',
  ...overrides,
})

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  window.localStorage.clear()
})

describe('useTerminalPanelTabs', () => {
  test('starts with no tabs and no active id', () => {
    const { result } = renderHook(() =>
      useTerminalPanelTabs({ workspaceId: WORKSPACE_ID, workers: [], terminalRuns: [] })
    )
    expect(result.current.tabs).toEqual([])
    expect(result.current.activeId).toBeNull()
  })

  test('openWorkerTab adds, persists, and activates the worker tab', () => {
    const workers = [
      { id: 'worker-a', name: 'Alice', role: 'coder' as const, status: 'idle' as const, pendingTaskCount: 0 },
    ]
    const { result } = renderHook(() =>
      useTerminalPanelTabs({ workspaceId: WORKSPACE_ID, workers, terminalRuns: [] })
    )
    act(() => result.current.openWorkerTab('worker-a'))
    expect(result.current.tabs.map((t) => t.id)).toEqual(['worker:worker-a'])
    expect(result.current.activeId).toBe('worker:worker-a')
    expect(JSON.parse(window.localStorage.getItem(TABS_KEY) ?? '[]')).toEqual(['worker:worker-a'])
    expect(window.localStorage.getItem(ACTIVE_KEY)).toBe('worker:worker-a')
  })

  test('openShellTab adds, persists, and activates the shell tab', () => {
    const run = buildRun({ agent_id: `${WORKSPACE_ID}:shell`, run_id: 'run-shell', agent_name: 'shell' })
    const { result } = renderHook(() =>
      useTerminalPanelTabs({ workspaceId: WORKSPACE_ID, workers: [], terminalRuns: [run] })
    )
    act(() => result.current.openShellTab('run-shell'))
    expect(result.current.tabs.map((t) => t.id)).toEqual(['shell:run-shell'])
    expect(result.current.activeId).toBe('shell:run-shell')
  })

  test('closeTab removes and reactivates a neighbor', () => {
    const workers = [
      { id: 'worker-a', name: 'Alice', role: 'coder' as const, status: 'idle' as const, pendingTaskCount: 0 },
      { id: 'worker-b', name: 'Bob', role: 'coder' as const, status: 'idle' as const, pendingTaskCount: 0 },
    ]
    const { result } = renderHook(() =>
      useTerminalPanelTabs({ workspaceId: WORKSPACE_ID, workers, terminalRuns: [] })
    )
    act(() => result.current.openWorkerTab('worker-a'))
    act(() => result.current.openWorkerTab('worker-b'))
    expect(result.current.activeId).toBe('worker:worker-b')
    act(() => result.current.closeTab('worker:worker-b'))
    expect(result.current.tabs.map((t) => t.id)).toEqual(['worker:worker-a'])
    expect(result.current.activeId).toBe('worker:worker-a')
  })

  test('opening an already-open tab just reactivates it (no duplicate)', () => {
    const workers = [
      { id: 'worker-a', name: 'Alice', role: 'coder' as const, status: 'idle' as const, pendingTaskCount: 0 },
      { id: 'worker-b', name: 'Bob', role: 'coder' as const, status: 'idle' as const, pendingTaskCount: 0 },
    ]
    const { result } = renderHook(() =>
      useTerminalPanelTabs({ workspaceId: WORKSPACE_ID, workers, terminalRuns: [] })
    )
    act(() => result.current.openWorkerTab('worker-a'))
    act(() => result.current.openWorkerTab('worker-b'))
    act(() => result.current.openWorkerTab('worker-a'))
    expect(result.current.tabs.map((t) => t.id)).toEqual(['worker:worker-a', 'worker:worker-b'])
    expect(result.current.activeId).toBe('worker:worker-a')
  })

  test('worker tab disappears when worker is removed from workers prop', () => {
    const workers = [
      { id: 'worker-a', name: 'Alice', role: 'coder' as const, status: 'idle' as const, pendingTaskCount: 0 },
    ]
    const { rerender, result } = renderHook(
      ({ ws }: { ws: typeof workers }) =>
        useTerminalPanelTabs({ workspaceId: WORKSPACE_ID, workers: ws, terminalRuns: [] }),
      { initialProps: { ws: workers } }
    )
    act(() => result.current.openWorkerTab('worker-a'))
    expect(result.current.tabs).toHaveLength(1)
    rerender({ ws: [] })
    expect(result.current.tabs).toEqual([])
    expect(result.current.activeId).toBeNull()
  })

  test('switching workspaceId loads that workspace’s persisted tab list', () => {
    window.localStorage.setItem('hive.terminal-panel.tabs.ws-2', JSON.stringify(['worker:zzz']))
    window.localStorage.setItem('hive.terminal-panel.active.ws-2', 'worker:zzz')
    const workers = [
      { id: 'zzz', name: 'Zed', role: 'coder' as const, status: 'idle' as const, pendingTaskCount: 0 },
    ]
    const { rerender, result } = renderHook(
      ({ wsId }: { wsId: string }) =>
        useTerminalPanelTabs({ workspaceId: wsId, workers, terminalRuns: [] }),
      { initialProps: { wsId: WORKSPACE_ID } }
    )
    expect(result.current.tabs).toEqual([])
    rerender({ wsId: 'ws-2' })
    expect(result.current.tabs.map((t: TerminalTab) => t.id)).toEqual(['worker:zzz'])
    expect(result.current.activeId).toBe('worker:zzz')
  })

  test('cold load with empty workers/runs preserves stored tab ids (no gc wipe)', () => {
    // Repro: workspace switch leaves `workers`/`terminalRuns` momentarily
    // empty (poll latency). The gc effect must NOT fire — otherwise stored
    // ids get filtered to [] and the persistence effect overwrites
    // localStorage with [], silently destroying the user's tab list.
    window.localStorage.setItem(TABS_KEY, JSON.stringify(['worker:a', 'shell:run-x']))
    window.localStorage.setItem(ACTIVE_KEY, 'shell:run-x')
    renderHook(() =>
      useTerminalPanelTabs({ workspaceId: WORKSPACE_ID, workers: [], terminalRuns: [] })
    )
    // Tabs derive to [] because workers/runs are empty, but localStorage
    // must not be rewritten to [].
    expect(window.localStorage.getItem(TABS_KEY)).toBe(
      JSON.stringify(['worker:a', 'shell:run-x'])
    )
    expect(window.localStorage.getItem(ACTIVE_KEY)).toBe('shell:run-x')
  })
})
```

- [ ] **Step 2: Run the failing test**

```bash
cd /Users/admin/code/hive-private-release && pnpm exec vitest run tests/web/use-terminal-panel-tabs.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement the hook**

```ts
// web/src/terminal/useTerminalPanelTabs.ts
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { TeamListItem } from '../../../src/shared/types.js'
import type { TerminalRunSummary } from '../api.js'
import { isWorkspaceShellRun } from '../api.js'
import { findRunByAgentId } from './useTerminalRuns.js'

export type TerminalTab =
  | { id: string; kind: 'worker'; workerId: string; runId: string | null; label: string }
  | { id: string; kind: 'shell'; runId: string; label: string }

const tabsKey = (workspaceId: string) => `hive.terminal-panel.tabs.${workspaceId}`
const activeKey = (workspaceId: string) => `hive.terminal-panel.active.${workspaceId}`

const workerTabId = (workerId: string) => `worker:${workerId}`
const shellTabId = (runId: string) => `shell:${runId}`

const readStoredIds = (key: string): string[] => {
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string') : []
  } catch {
    return []
  }
}

const readStoredActive = (key: string): string => {
  try {
    return window.localStorage.getItem(key) ?? ''
  } catch {
    return ''
  }
}

const writeStored = (key: string, value: string): void => {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // ignored
  }
}

type Params = {
  workspaceId: string
  workers: TeamListItem[]
  terminalRuns: TerminalRunSummary[]
}

/**
 * Owns the bottom-panel tab list + active tab per workspace.
 *
 * The stored state is just an ordered list of tab ids (e.g. `worker:abc` /
 * `shell:run-x`) — display data is re-derived each render from `workers` /
 * `terminalRuns` so a deleted worker or a stopped shell automatically drops
 * its tab. Persistence is per-workspace; switching workspaces swaps the
 * loaded list without touching localStorage for the others.
 */
export const useTerminalPanelTabs = ({ workspaceId, workers, terminalRuns }: Params) => {
  const [orderedIds, setOrderedIds] = useState<string[]>(() => readStoredIds(tabsKey(workspaceId)))
  const [activeId, setActiveIdRaw] = useState<string | null>(() => {
    const stored = readStoredActive(activeKey(workspaceId))
    return stored.length > 0 ? stored : null
  })
  // Latest-orderedIds ref so callbacks can compute next state synchronously
  // (avoids nested setState-in-updater patterns flagged by the reviewer).
  const orderedIdsRef = useRef(orderedIds)
  orderedIdsRef.current = orderedIds
  // Reload from localStorage when switching workspaces.
  const lastWorkspaceRef = useRef<string>(workspaceId)

  useEffect(() => {
    if (lastWorkspaceRef.current === workspaceId) return
    lastWorkspaceRef.current = workspaceId
    setOrderedIds(readStoredIds(tabsKey(workspaceId)))
    const stored = readStoredActive(activeKey(workspaceId))
    setActiveIdRaw(stored.length > 0 ? stored : null)
  }, [workspaceId])

  // The reviewer flagged a silent data-loss bug: on workspace switch the
  // poll-driven workers/runs arrive a tick AFTER the stored ids reload, so
  // `tabs` derives to [] for one render, the gc effect filters orderedIds
  // to [], and the persistence effect writes [] back to localStorage. We
  // gate BOTH the gc and the persistence on `dataLoaded` — true once we
  // observe a non-empty snapshot for this workspaceId, or once the user
  // explicitly opens a tab.
  const dataLoadedRef = useRef(false)
  // Reset on workspace switch. workers/terminalRuns are deliberately excluded
  // from the deps because we want this effect to "zero out" the gate exactly
  // when the workspace id flips — the next effect below promotes the gate
  // back to true once data arrives for the new workspace.
  // biome-ignore lint/correctness/useExhaustiveDependencies: workspace-switch reset is intentional
  useEffect(() => {
    dataLoadedRef.current = workers.length > 0 || terminalRuns.length > 0
  }, [workspaceId])
  // Promote the gate to true as soon as workers/runs deliver any data for
  // the current workspace. This effect (not a render-time ref mutation)
  // avoids the StrictMode double-render anti-pattern flagged by review.
  useEffect(() => {
    if (workers.length > 0 || terminalRuns.length > 0) dataLoadedRef.current = true
  }, [workers, terminalRuns])

  useEffect(() => {
    if (!dataLoadedRef.current) return
    writeStored(tabsKey(workspaceId), JSON.stringify(orderedIds))
  }, [orderedIds, workspaceId])

  useEffect(() => {
    if (!dataLoadedRef.current) return
    writeStored(activeKey(workspaceId), activeId ?? '')
  }, [activeId, workspaceId])

  const workerById = useMemo(
    () => new Map(workers.map((w) => [w.id, w] as const)),
    [workers]
  )
  const shellRunById = useMemo(() => {
    const map = new Map<string, TerminalRunSummary>()
    for (const run of terminalRuns) {
      if (isWorkspaceShellRun(run, workspaceId)) map.set(run.run_id, run)
    }
    return map
  }, [terminalRuns, workspaceId])

  const tabs = useMemo<TerminalTab[]>(() => {
    const out: TerminalTab[] = []
    for (const id of orderedIds) {
      if (id.startsWith('worker:')) {
        const workerId = id.slice('worker:'.length)
        const worker = workerById.get(workerId)
        if (!worker) continue
        const run = findRunByAgentId(terminalRuns, worker.id)
        out.push({
          id,
          kind: 'worker',
          workerId,
          runId: run?.run_id ?? null,
          label: worker.name,
        })
      } else if (id.startsWith('shell:')) {
        const runId = id.slice('shell:'.length)
        const run = shellRunById.get(runId)
        if (!run) continue
        out.push({ id, kind: 'shell', runId, label: run.agent_name })
      }
    }
    return out
  }, [orderedIds, workerById, shellRunById, terminalRuns])

  // GC ids whose referent is gone — only after we've observed at least one
  // populated snapshot for this workspace. Empty workers/runs is treated as
  // "still loading", not "everything was deleted".
  //
  // Survivors are computed inside the setOrderedIds updater from the latest
  // workerById/shellRunById, not from a `tabs` closure. The closure form
  // races with the workspace-switch setOrderedIds: when both fire in the
  // same cycle, the updater would see the new orderedIds but a stale
  // `surviving` set built from the previous tabs render, and would filter
  // everything out.
  useEffect(() => {
    if (!dataLoadedRef.current) return
    setOrderedIds((current) => {
      const next = current.filter((id) => {
        if (id.startsWith('worker:')) return workerById.has(id.slice('worker:'.length))
        if (id.startsWith('shell:')) return shellRunById.has(id.slice('shell:'.length))
        return false
      })
      return next.length === current.length ? current : next
    })
  }, [workerById, shellRunById])

  // Reactivate something if active points to a dead tab.
  useEffect(() => {
    if (!dataLoadedRef.current) return
    if (activeId && tabs.some((tab) => tab.id === activeId)) return
    setActiveIdRaw(tabs[0]?.id ?? null)
  }, [activeId, tabs])

  const openWorkerTab = useCallback((workerId: string) => {
    // User action also counts as "data loaded" — they explicitly want a tab.
    dataLoadedRef.current = true
    const id = workerTabId(workerId)
    setOrderedIds((current) => (current.includes(id) ? current : [...current, id]))
    setActiveIdRaw(id)
  }, [])

  const openShellTab = useCallback((runId: string) => {
    dataLoadedRef.current = true
    const id = shellTabId(runId)
    setOrderedIds((current) => (current.includes(id) ? current : [...current, id]))
    setActiveIdRaw(id)
  }, [])

  const closeTab = useCallback((tabId: string) => {
    const before = orderedIdsRef.current
    const next = before.filter((id) => id !== tabId)
    if (next.length === before.length) return
    setOrderedIds(next)
    setActiveIdRaw((activeNow) => {
      if (activeNow !== tabId) return activeNow
      const idx = before.indexOf(tabId)
      return next[idx] ?? next[idx - 1] ?? next[0] ?? null
    })
  }, [])

  const setActive = useCallback((tabId: string) => setActiveIdRaw(tabId), [])

  return { tabs, activeId, openWorkerTab, openShellTab, closeTab, setActive }
}
```

- [ ] **Step 4: Run tests — verify pass**

```bash
cd /Users/admin/code/hive-private-release && pnpm exec vitest run tests/web/use-terminal-panel-tabs.test.ts
```
Expected: PASS, 7/7.

- [ ] **Step 5: Commit**

```bash
cd /Users/admin/code/hive-private-release
git add web/src/terminal/useTerminalPanelTabs.ts tests/web/use-terminal-panel-tabs.test.ts
git commit -m "Add useTerminalPanelTabs hook for unified worker+shell tab state"
```

---

### Task 3: `TerminalTabs` component + tests

**Files:**
- Create: `web/src/terminal/TerminalTabs.tsx`
- Test: `tests/web/terminal-tabs.test.tsx`

VSCode-style tab strip. Active tab: top 2px accent line (`var(--accent)`) + foreground text + `var(--bg-1)` background. Inactive: muted text + `var(--bg-2)` background. Hover: text brightens, close × becomes visible. Active tab × always visible. Horizontal scroll on overflow. Trailing "+" button for new shell tab. Right-edge cluster for collapse and "minimize/maximize panel" if added later.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'

import type { TerminalTab } from '../../web/src/terminal/useTerminalPanelTabs.js'
import { TerminalTabs } from '../../web/src/terminal/TerminalTabs.js'

afterEach(() => cleanup())

const buildWorkerTab = (overrides: Partial<TerminalTab> = {}): TerminalTab => ({
  id: 'worker:w1',
  kind: 'worker',
  workerId: 'w1',
  runId: 'run-1',
  label: 'Alice',
  ...overrides,
}) as TerminalTab

const buildShellTab = (overrides: Partial<TerminalTab> = {}): TerminalTab => ({
  id: 'shell:run-x',
  kind: 'shell',
  runId: 'run-x',
  label: 'shell',
  ...overrides,
}) as TerminalTab

describe('TerminalTabs', () => {
  test('clicking a tab fires onSelect with its id', () => {
    const onSelect = vi.fn()
    render(
      <TerminalTabs
        tabs={[buildWorkerTab(), buildShellTab()]}
        activeId="worker:w1"
        onSelect={onSelect}
        onClose={vi.fn()}
        onNewShell={vi.fn()}
        newShellPending={false}
      />
    )
    fireEvent.click(screen.getByTestId('terminal-tab-shell:run-x'))
    expect(onSelect).toHaveBeenCalledWith('shell:run-x')
  })

  test('close button on the active tab fires onClose without bubbling to onSelect', () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()
    render(
      <TerminalTabs
        tabs={[buildWorkerTab()]}
        activeId="worker:w1"
        onSelect={onSelect}
        onClose={onClose}
        onNewShell={vi.fn()}
        newShellPending={false}
      />
    )
    fireEvent.click(screen.getByTestId('terminal-tab-close-worker:w1'))
    expect(onClose).toHaveBeenCalledWith('worker:w1')
    expect(onSelect).not.toHaveBeenCalled()
  })

  test('new-shell button fires onNewShell', () => {
    const onNewShell = vi.fn()
    render(
      <TerminalTabs
        tabs={[]}
        activeId={null}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        onNewShell={onNewShell}
        newShellPending={false}
      />
    )
    fireEvent.click(screen.getByTestId('terminal-tab-new-shell'))
    expect(onNewShell).toHaveBeenCalledTimes(1)
  })

  test('active tab marks aria-selected and exposes the active accent rail', () => {
    render(
      <TerminalTabs
        tabs={[buildWorkerTab(), buildShellTab()]}
        activeId="shell:run-x"
        onSelect={vi.fn()}
        onClose={vi.fn()}
        onNewShell={vi.fn()}
        newShellPending={false}
      />
    )
    expect(screen.getByTestId('terminal-tab-worker:w1').getAttribute('aria-selected')).toBe('false')
    const active = screen.getByTestId('terminal-tab-shell:run-x')
    expect(active.getAttribute('aria-selected')).toBe('true')
    expect(active.querySelector('[data-tab-accent]')).not.toBeNull()
  })

  test('close button is a sibling of the select button (no nested <button> in <button>)', () => {
    // Regression: an earlier draft nested the close <button> inside the tab
    // <button>, which is invalid HTML and breaks layout in real browsers.
    // Assert the structural shape: close button's parent is the tab wrapper,
    // not the select button.
    render(
      <TerminalTabs
        tabs={[buildWorkerTab()]}
        activeId="worker:w1"
        onSelect={vi.fn()}
        onClose={vi.fn()}
        onNewShell={vi.fn()}
        newShellPending={false}
      />
    )
    const closeBtn = screen.getByTestId('terminal-tab-close-worker:w1')
    const selectBtn = screen.getByTestId('terminal-tab-select-worker:w1')
    expect(closeBtn.parentElement).toBe(selectBtn.parentElement)
    expect(closeBtn.parentElement?.tagName).toBe('DIV')
    // And no button descends from another button anywhere in the tab.
    expect(selectBtn.querySelector('button')).toBeNull()
  })
})
```

- [ ] **Step 2: Run the failing test**

```bash
cd /Users/admin/code/hive-private-release && pnpm exec vitest run tests/web/terminal-tabs.test.tsx
```
Expected: FAIL.

- [ ] **Step 3: Implement the component**

```tsx
// web/src/terminal/TerminalTabs.tsx
import { LoaderCircle, Plus, Terminal as TerminalIcon, X } from 'lucide-react'
import type { MouseEvent as ReactMouseEvent } from 'react'

import { useI18n } from '../i18n.js'
import { Tooltip } from '../ui/Tooltip.js'
import type { TerminalTab } from './useTerminalPanelTabs.js'

type TerminalTabsProps = {
  tabs: readonly TerminalTab[]
  activeId: string | null
  onSelect: (tabId: string) => void
  onClose: (tabId: string) => void
  onNewShell: () => void
  newShellPending: boolean
}

/**
 * VSCode-style tab strip. Active tab carries a 2px top accent rail in
 * `var(--accent)` + the surface background of the content area, so the tab
 * visually merges with the terminal content beneath it. Inactive tabs sit on
 * a slightly darker `var(--bg-2)` strip.
 *
 * Structure: each tab is a wrapper `<div role="tab">` containing a
 * tab-select `<button>` and a sibling close `<button>`. Buttons-inside-buttons
 * is invalid HTML — browsers hoist the inner button out and break the layout —
 * so we mirror the `WorkspaceShellDialog` pattern of two sibling buttons in a
 * group `<div>`. The wrapper `<div>` carries the `role="tab"` + `aria-selected`
 * + the data-testid the panel tests assert on.
 */
export const TerminalTabs = ({
  tabs,
  activeId,
  onSelect,
  onClose,
  onNewShell,
  newShellPending,
}: TerminalTabsProps) => {
  const { t } = useI18n()
  return (
    <div
      role="tablist"
      aria-label={t('terminalPanel.tablistAria')}
      className="scrollbar-thin flex h-9 min-h-9 w-full items-stretch overflow-x-auto"
      style={{ background: 'var(--bg-2)', borderBottom: '1px solid var(--border)' }}
      data-testid="terminal-tab-strip"
    >
      {tabs.map((tab) => {
        const selected = tab.id === activeId
        const closeAria = t('terminalPanel.closeTab', { name: tab.label })
        const handleClose = (event: ReactMouseEvent<HTMLButtonElement>) => {
          event.stopPropagation()
          onClose(tab.id)
        }
        return (
          // biome-ignore lint/a11y/useFocusableInteractive: the inner select <button> is the focus target; the wrapper carries role="tab" only as a screen-reader grouping for the two sibling buttons
          // biome-ignore lint/a11y/useKeyWithClickEvents: the inner select <button> handles keyboard activation
          <div
            key={tab.id}
            role="tab"
            aria-selected={selected}
            data-testid={`terminal-tab-${tab.id}`}
            onClick={() => onSelect(tab.id)}
            className="group relative flex max-w-[200px] shrink-0 cursor-pointer items-center gap-1.5 border-r text-xs"
            style={{
              background: selected ? 'var(--bg-1)' : 'transparent',
              borderRightColor: 'var(--border)',
              color: selected ? 'var(--text-primary)' : 'var(--text-secondary)',
            }}
          >
            {selected ? (
              <span
                data-tab-accent
                aria-hidden
                className="pointer-events-none absolute top-0 right-0 left-0 h-0.5"
                style={{ background: 'var(--accent)' }}
              />
            ) : null}
            <button
              type="button"
              data-testid={`terminal-tab-select-${tab.id}`}
              onClick={(event) => {
                // Stop the wrapper-div's onClick from re-firing onSelect.
                event.stopPropagation()
                onSelect(tab.id)
              }}
              className="flex min-w-0 flex-1 items-center gap-1.5 py-2 pr-1 pl-3 text-left"
              style={{ color: 'inherit' }}
            >
              <TerminalIcon size={12} aria-hidden />
              <span className="truncate">{tab.label}</span>
            </button>
            <Tooltip label={closeAria}>
              <button
                type="button"
                aria-label={closeAria}
                data-testid={`terminal-tab-close-${tab.id}`}
                onClick={handleClose}
                className={`mr-1 rounded p-0.5 transition ${selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                style={{ color: 'var(--text-secondary)' }}
              >
                <X size={12} aria-hidden />
              </button>
            </Tooltip>
          </div>
        )
      })}
      <div className="flex flex-1 items-center justify-end px-2">
        <Tooltip label={t('terminalPanel.newShell')}>
          <button
            type="button"
            aria-label={t('terminalPanel.newShell')}
            data-testid="terminal-tab-new-shell"
            onClick={onNewShell}
            disabled={newShellPending}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded border text-sec transition hover:text-pri disabled:opacity-50"
            style={{ borderColor: 'var(--border)', background: 'var(--bg-1)' }}
          >
            {newShellPending ? (
              <LoaderCircle size={12} className="animate-spin" aria-hidden />
            ) : (
              <Plus size={12} aria-hidden />
            )}
          </button>
        </Tooltip>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Add the i18n keys this component reads**

Edit `web/src/i18n.tsx`. Find the English `terminalPanels.aria` line; below it, insert:

```
  'terminalPanel.tablistAria': 'Workspace terminal tabs',
  'terminalPanel.closeTab': 'Close {name}',
  'terminalPanel.newShell': 'New shell',
```

Find the Chinese `terminalPanels.aria` line; below it, insert:

```
  'terminalPanel.tablistAria': 'Workspace 终端标签',
  'terminalPanel.closeTab': '关闭 {name}',
  'terminalPanel.newShell': '新建 shell',
```

Add the same three keys to the `TranslationKey` union type if it is enumerated (search the file for existing `terminalPanels.aria` placement — follow the pattern there).

- [ ] **Step 5: Run tests — verify pass**

```bash
cd /Users/admin/code/hive-private-release && pnpm exec vitest run tests/web/terminal-tabs.test.tsx
```
Expected: PASS, 4/4.

- [ ] **Step 6: Commit**

```bash
cd /Users/admin/code/hive-private-release
git add web/src/terminal/TerminalTabs.tsx tests/web/terminal-tabs.test.tsx web/src/i18n.tsx
git commit -m "Add TerminalTabs component for VSCode-style bottom panel tab strip"
```

---

### Task 4: `TerminalBottomPanel` component + tests

**Files:**
- Create: `web/src/terminal/TerminalBottomPanel.tsx`
- Test: `tests/web/terminal-bottom-panel.test.tsx`

The panel composes everything: tabs on top, resize handle above the tabs, content area below. The content area renders **one** portal slot div for the active tab — `worker-pty-${runId}` if it's a worker tab with a runId, `shell-pty-${runId}` if it's a shell tab. When no active tab has a runId (worker tab whose worker is stopped), an empty state is shown.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'

import type { TerminalTab } from '../../web/src/terminal/useTerminalPanelTabs.js'
import { TerminalBottomPanel } from '../../web/src/terminal/TerminalBottomPanel.js'

afterEach(() => {
  cleanup()
  window.localStorage.clear()
})

const workerTab: TerminalTab = {
  id: 'worker:w1',
  kind: 'worker',
  workerId: 'w1',
  runId: 'run-1',
  label: 'Alice',
}
const shellTab: TerminalTab = { id: 'shell:run-s', kind: 'shell', runId: 'run-s', label: 'shell' }

describe('TerminalBottomPanel', () => {
  test('renders the worker-pty portal slot for an active worker tab with a runId', () => {
    render(
      <TerminalBottomPanel
        tabs={[workerTab]}
        activeId="worker:w1"
        onSelect={vi.fn()}
        onClose={vi.fn()}
        onNewShell={vi.fn()}
        newShellPending={false}
        onStartWorker={vi.fn()}
        startingWorkerId={null}
      />
    )
    const slot = document.getElementById('worker-pty-run-1')
    expect(slot).not.toBeNull()
    expect(slot?.getAttribute('data-pty-slot')).toBe('worker')
  })

  test('renders the shell-pty portal slot for an active shell tab', () => {
    render(
      <TerminalBottomPanel
        tabs={[shellTab]}
        activeId="shell:run-s"
        onSelect={vi.fn()}
        onClose={vi.fn()}
        onNewShell={vi.fn()}
        newShellPending={false}
        onStartWorker={vi.fn()}
        startingWorkerId={null}
      />
    )
    const slot = document.getElementById('shell-pty-run-s')
    expect(slot).not.toBeNull()
    expect(slot?.getAttribute('data-pty-slot')).toBe('shell')
  })

  test('shows the stopped-worker empty state when the active worker tab has no runId', () => {
    const stoppedWorkerTab: TerminalTab = { ...workerTab, runId: null }
    render(
      <TerminalBottomPanel
        tabs={[stoppedWorkerTab]}
        activeId="worker:w1"
        onSelect={vi.fn()}
        onClose={vi.fn()}
        onNewShell={vi.fn()}
        newShellPending={false}
        onStartWorker={vi.fn()}
        startingWorkerId={null}
      />
    )
    expect(document.querySelector('[data-pty-slot]')).toBeNull()
    expect(screen.getByTestId('terminal-panel-stopped-worker')).toBeInTheDocument()
  })

  test('stopped-worker empty state surfaces a Start button that fires onStartWorker(workerId)', () => {
    const stoppedWorkerTab: TerminalTab = { ...workerTab, runId: null }
    const onStartWorker = vi.fn()
    render(
      <TerminalBottomPanel
        tabs={[stoppedWorkerTab]}
        activeId="worker:w1"
        onSelect={vi.fn()}
        onClose={vi.fn()}
        onNewShell={vi.fn()}
        newShellPending={false}
        onStartWorker={onStartWorker}
        startingWorkerId={null}
      />
    )
    fireEvent.click(screen.getByTestId('terminal-panel-start-worker'))
    expect(onStartWorker).toHaveBeenCalledWith('w1')
  })

  test('panel renders nothing when tab list is empty', () => {
    const { container } = render(
      <TerminalBottomPanel
        tabs={[]}
        activeId={null}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        onNewShell={vi.fn()}
        newShellPending={false}
        onStartWorker={vi.fn()}
        startingWorkerId={null}
      />
    )
    expect(container.firstChild).toBeNull()
  })

  test('resize handle is keyboard-focusable and exposes role separator', () => {
    render(
      <TerminalBottomPanel
        tabs={[workerTab]}
        activeId="worker:w1"
        onSelect={vi.fn()}
        onClose={vi.fn()}
        onNewShell={vi.fn()}
        newShellPending={false}
        onStartWorker={vi.fn()}
        startingWorkerId={null}
      />
    )
    const handle = screen.getByTestId('terminal-panel-resize-handle')
    expect(handle.getAttribute('role')).toBe('separator')
    expect(handle.getAttribute('aria-orientation')).toBe('horizontal')
  })

  test('pointerdown on resize handle does not throw', () => {
    render(
      <TerminalBottomPanel
        tabs={[workerTab]}
        activeId="worker:w1"
        onSelect={vi.fn()}
        onClose={vi.fn()}
        onNewShell={vi.fn()}
        newShellPending={false}
        onStartWorker={vi.fn()}
        startingWorkerId={null}
      />
    )
    const handle = screen.getByTestId('terminal-panel-resize-handle')
    expect(() => fireEvent.pointerDown(handle, { clientY: 400 })).not.toThrow()
  })
})
```

- [ ] **Step 2: Run the failing test**

```bash
cd /Users/admin/code/hive-private-release && pnpm exec vitest run tests/web/terminal-bottom-panel.test.tsx
```
Expected: FAIL.

- [ ] **Step 3: Implement the panel**

```tsx
// web/src/terminal/TerminalBottomPanel.tsx
import { LoaderCircle, Play, Terminal as TerminalIcon } from 'lucide-react'

import { useI18n } from '../i18n.js'
import { TerminalTabs } from './TerminalTabs.js'
import { TERMINAL_PANEL_MIN_HEIGHT, useTerminalPanelHeight } from './useTerminalPanelHeight.js'
import type { TerminalTab } from './useTerminalPanelTabs.js'

type TerminalBottomPanelProps = {
  tabs: readonly TerminalTab[]
  activeId: string | null
  onSelect: (tabId: string) => void
  onClose: (tabId: string) => void
  onNewShell: () => void
  newShellPending: boolean
  onStartWorker: (workerId: string) => void
  startingWorkerId: string | null
}

const findTab = (tabs: readonly TerminalTab[], id: string | null): TerminalTab | null => {
  if (!id) return null
  return tabs.find((tab) => tab.id === id) ?? null
}

/**
 * Bottom-docked terminal panel. Renders one portal slot div for the active
 * tab's PTY (worker-pty-${runId} / shell-pty-${runId}). The xterm itself is
 * mounted by WorkspaceTerminalPanels at app root and re-parents into the
 * visible slot via the existing TerminalView portal indirection — so
 * switching tabs is "DOM slot toggle", not "xterm re-init".
 */
export const TerminalBottomPanel = ({
  tabs,
  activeId,
  onSelect,
  onClose,
  onNewShell,
  newShellPending,
  onStartWorker,
  startingWorkerId,
}: TerminalBottomPanelProps) => {
  const { t } = useI18n()
  const resize = useTerminalPanelHeight()
  if (tabs.length === 0) return null
  const active = findTab(tabs, activeId) ?? tabs[0] ?? null
  return (
    <div
      data-testid="terminal-bottom-panel"
      className="relative flex shrink-0 flex-col"
      style={{
        height: resize.height,
        background: 'var(--bg-1)',
        borderTop: '1px solid var(--border)',
      }}
    >
      {/* biome-ignore lint/a11y/useSemanticElements: separator role on a div is the canonical resize handle */}
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label={t('terminalPanel.resizeAria')}
        aria-valuemin={TERMINAL_PANEL_MIN_HEIGHT}
        aria-valuenow={Math.round(resize.height)}
        className="absolute top-0 right-0 left-0 z-10 h-2 -translate-y-1 cursor-ns-resize"
        tabIndex={-1}
        data-resizing={resize.dragging || undefined}
        data-testid="terminal-panel-resize-handle"
        onPointerDown={resize.beginDrag}
      />
      <TerminalTabs
        tabs={tabs}
        activeId={active?.id ?? null}
        onSelect={onSelect}
        onClose={onClose}
        onNewShell={onNewShell}
        newShellPending={newShellPending}
      />
      <div className="min-h-0 flex-1" style={{ background: 'var(--bg-crust)' }}>
        {active ? (
          <ActiveTabBody
            tab={active}
            onStartWorker={onStartWorker}
            startingWorkerId={startingWorkerId}
          />
        ) : null}
      </div>
    </div>
  )
}

type ActiveTabBodyProps = {
  tab: TerminalTab
  onStartWorker: (workerId: string) => void
  startingWorkerId: string | null
}

const ActiveTabBody = ({ tab, onStartWorker, startingWorkerId }: ActiveTabBodyProps) => {
  const { t } = useI18n()
  if (tab.kind === 'worker') {
    if (!tab.runId) {
      const starting = startingWorkerId === tab.workerId
      return (
        <div
          className="flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-center text-xs text-ter"
          data-testid="terminal-panel-stopped-worker"
        >
          <span className="flex items-center gap-2">
            <TerminalIcon size={14} aria-hidden />
            {t('terminalPanel.workerStopped', { name: tab.label })}
          </span>
          <button
            type="button"
            onClick={() => onStartWorker(tab.workerId)}
            disabled={starting}
            className="icon-btn icon-btn--primary"
            data-testid="terminal-panel-start-worker"
          >
            {starting ? (
              <LoaderCircle size={12} className="animate-spin" aria-hidden />
            ) : (
              <Play size={12} aria-hidden />
            )}
            {starting ? t('common.starting') : t('common.start')}
          </button>
        </div>
      )
    }
    return (
      <div
        id={`worker-pty-${tab.runId}`}
        className="flex h-full w-full"
        data-pty-slot="worker"
        data-testid={`terminal-panel-slot-worker-${tab.workerId}`}
      />
    )
  }
  return (
    <div
      id={`shell-pty-${tab.runId}`}
      className="flex h-full w-full"
      data-pty-slot="shell"
      data-testid={`terminal-panel-slot-shell-${tab.runId}`}
    />
  )
}
```

- [ ] **Step 4: Add the i18n keys this component reads**

Edit `web/src/i18n.tsx` and add to both the English and Chinese map sections:

English (near other `terminalPanel.*` keys added in Task 3):
```
  'terminalPanel.resizeAria': 'Resize terminal panel height',
  'terminalPanel.workerStopped': '{name} is stopped — start the member to attach a terminal.',
```

Chinese:
```
  'terminalPanel.resizeAria': '调整终端面板高度',
  'terminalPanel.workerStopped': '{name} 已停止——启动该成员后会自动连接终端。',
```

- [ ] **Step 5: Run tests — verify pass**

```bash
cd /Users/admin/code/hive-private-release && pnpm exec vitest run tests/web/terminal-bottom-panel.test.tsx
```
Expected: PASS, 6/6.

- [ ] **Step 6: Commit**

```bash
cd /Users/admin/code/hive-private-release
git add web/src/terminal/TerminalBottomPanel.tsx tests/web/terminal-bottom-panel.test.tsx web/src/i18n.tsx
git commit -m "Add TerminalBottomPanel composing tabs, resize, and portal slots"
```

---

### Task 5: Wire `TerminalBottomPanel` into `WorkspaceDetail` (right column)

**Files:**
- Modify: `web/src/WorkspaceDetail.tsx`

This task adds the panel **alongside** the existing `WorkerModal` and `WorkspaceShellDialog`. Both UIs are functional during this transition so tests stay green. The next tasks remove the old surfaces.

- [ ] **Step 1: Stop and restart the dev server so HMR sees new files cleanly**

```bash
# In the existing background bash for `tsx src/cli/hive.ts --port 3001`: send SIGTERM, then restart.
# (Tester runs this manually outside the plan — only included for context.)
```

- [ ] **Step 2: Modify `WorkspaceDetail.tsx` to mount the panel**

Replace the right-side `<WorkersPane ... />` in the JSX with a vertical flex container holding the pane plus the panel.

Imports — add at top:
```ts
import { TerminalBottomPanel } from './terminal/TerminalBottomPanel.js'
import { useTerminalPanelTabs } from './terminal/useTerminalPanelTabs.js'
```

Inside the component, after the `usePaneSplit()` line, add:
```ts
  const panelTabs = useTerminalPanelTabs({
    workspaceId: workspace?.id ?? '',
    workers,
    terminalRuns,
  })
```

Replace this fragment (currently at the end of `<div ref={split.containerRef} ...>`):
```tsx
        <WorkersPane
          onAddWorkerClick={() => setComposerOpen(true)}
          onDeleteWorker={handleDeleteWorker}
          onOpenShellTerminal={openShell}
          onOpenWorker={(worker) => setActiveWorkerId(worker.id)}
          onRenameWorker={handleRenameWorker}
          onStartWorker={handleStartWorker}
          startingWorkerId={startingWorkerId}
          terminalRuns={terminalRuns}
          workers={workers}
        />
```

with:

```tsx
        <div className="flex min-w-0 flex-1 flex-col">
          <WorkersPane
            onAddWorkerClick={() => setComposerOpen(true)}
            onDeleteWorker={handleDeleteWorker}
            onOpenShellTerminal={openShell}
            onOpenWorker={(worker) => {
              setActiveWorkerId(worker.id)
              panelTabs.openWorkerTab(worker.id)
            }}
            onRenameWorker={handleRenameWorker}
            onStartWorker={handleStartWorker}
            startingWorkerId={startingWorkerId}
            terminalRuns={terminalRuns}
            workers={workers}
          />
          <TerminalBottomPanel
            tabs={panelTabs.tabs}
            activeId={panelTabs.activeId}
            onSelect={panelTabs.setActive}
            onClose={(tabId) => {
              if (tabId.startsWith('shell:')) {
                const runId = tabId.slice('shell:'.length)
                closeShellTab(runId)
              }
              panelTabs.closeTab(tabId)
            }}
            onNewShell={() => {
              startShell()
              setShellOpen(false)
            }}
            newShellPending={shellStarting}
            onStartWorker={(workerId) => {
              const worker = workers.find((w) => w.id === workerId)
              if (worker) handleStartWorker(worker)
            }}
            startingWorkerId={startingWorkerId}
          />
        </div>
```

Also: modify `startShell` to register the freshly started shell as a panel tab **synchronously** in its `.then` — DO NOT introduce a `useEffect([shellRunId])` to react to the state change. The reviewer flagged that pattern: closing a shell tab clears `shellRunId` to the fallback id, and the effect would re-open the fallback's tab as side-effect of an unrelated state shuffle. Synchronous registration in the `.then` keeps shell-tab lifecycle on the single timeline of "API succeeded → tab appears":

```tsx
  const startShell = () => {
    setShellError(null)
    setShellStarting(true)
    void startWorkspaceShell(workspace.id)
      .then((run) => {
        setShellRunId(run.run_id)
        panelTabs.openShellTab(run.run_id)
      })
      .catch((error) => {
        setShellError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => setShellStarting(false))
  }
```

If `workers` is captured stale in `onStartWorker`'s closure, wrap the callback in `useCallback` keyed on `workers` — but TS will accept the simpler inline form because `WorkspaceDetail` re-renders on every `workers` prop change, so the closure refreshes.

- [ ] **Step 3: Smoke test in dev server**

Manual: open `http://127.0.0.1:3001`, click a worker — the WorkerModal still opens (we haven't removed it), but a tab also appears in the new bottom panel under WorkersPane. Drag the resize handle up/down — height changes. Reload — height persists.

- [ ] **Step 4: Run the full test suite**

```bash
cd /Users/admin/code/hive-private-release && pnpm exec vitest run
```
Expected: PASS for everything. Existing worker-modal tests still pass because we didn't touch `WorkerModal`.

- [ ] **Step 5: Commit**

```bash
cd /Users/admin/code/hive-private-release
git add web/src/WorkspaceDetail.tsx
git commit -m "Mount TerminalBottomPanel inside the right column alongside legacy modal/dialog"
```

---

### Task 6: Remove `WorkerModal` from `WorkspaceDetail`

**Files:**
- Modify: `web/src/WorkspaceDetail.tsx`

`WorkerModal` no longer renders. The panel tab fully owns the worker terminal surface. Worker-card click already triggers `panelTabs.openWorkerTab(worker.id)` (from Task 5), so just delete the modal mount and its supporting state.

- [ ] **Step 1: Delete `activeWorkerId` state**

In `WorkspaceDetail.tsx`, remove these lines (and any `useState` for `activeWorkerId`):
```ts
  const [activeWorkerId, setActiveWorkerId] = useState<string | null>(null)
  const activeWorker: TeamListItem | null =
    workers.find((worker) => worker.id === activeWorkerId) ?? null
  useEffect(() => {
    if (activeWorkerId && !activeWorker) setActiveWorkerId(null)
  }, [activeWorkerId, activeWorker])
```

Also remove `const activeWorkerRun = activeWorker ? findRunByAgentId(terminalRuns, activeWorker.id) : undefined`.

- [ ] **Step 2: Update the WorkerCard click in the right column**

The click handler set in Task 5 currently calls both `setActiveWorkerId` and `panelTabs.openWorkerTab`. Drop the `setActiveWorkerId` call:

```tsx
            onOpenWorker={(worker) => panelTabs.openWorkerTab(worker.id)}
```

- [ ] **Step 3: Delete the WorkerModal JSX block**

Remove the block that currently reads:
```tsx
      {activeWorker ? (
        <WorkerModal
          onClose={() => setActiveWorkerId(null)}
          onStart={handleStartWorker}
          runId={activeWorkerRun?.run_id ?? null}
          startError={startWorkerError}
          starting={startingWorkerId === activeWorker.id}
          worker={activeWorker}
        />
      ) : null}
```

Then drop the `import { WorkerModal } from './worker/WorkerModal.js'` line.

- [ ] **Step 4: Surface `startWorkerError` via toast**

Removing the modal removed the only consumer of `startWorkerError`. Without a new surface, start failures are silently swallowed. Add an effect mirroring `deleteWorkerError`'s pattern — place it directly after the `deleteWorkerError` toast effect:

```tsx
  // Start failures no longer have a modal banner to display them — surface
  // via toast to keep parity with delete-error feedback.
  useEffect(() => {
    if (startWorkerError) toast.show({ kind: 'error', message: startWorkerError })
  }, [startWorkerError, toast])
```

- [ ] **Step 5: Update or delete `worker-modal.test.tsx`**

This test directly imports `WorkerModal`, so it must be deleted in Task 9. For now, leave it — it'll still pass since the module exists.

- [ ] **Step 6: Run the dev server and smoke**

Click worker — modal does NOT appear; panel tab appears (or activates) and shows that worker's xterm via the portal slot.

- [ ] **Step 7: Run test suite**

```bash
cd /Users/admin/code/hive-private-release && pnpm exec vitest run
```
Expected: `worker-flow.test.tsx` may now fail on assertions about the modal opening. That's OK — we fix it in Task 9.

- [ ] **Step 8: Commit**

```bash
cd /Users/admin/code/hive-private-release
git add web/src/WorkspaceDetail.tsx
git commit -m "Remove WorkerModal mount; panel tab owns worker terminal surface"
```

---

### Task 7: Remove `WorkspaceShellDialog`

**Files:**
- Modify: `web/src/WorkspaceDetail.tsx`

The bottom panel + shell tabs replace the dialog entirely.

- [ ] **Step 1: Delete shell-dialog state and effects**

Remove:
```ts
  const [shellOpen, setShellOpen] = useState(false)
```

Update the workspace-id reset effect to drop `setShellOpen(false)`.

**Also**: Task 5 wired the panel's `onNewShell={() => { startShell(); setShellOpen(false) }}` — that `setShellOpen(false)` call now references undefined state. Edit the `onNewShell` to drop the call:

```tsx
            onNewShell={startShell}
```

Update `openShell` so it just starts a fresh shell (the panel auto-shows the new tab via `panelTabs.openShellTab` inside `startShell`'s `.then`):
```ts
  const openShell = () => {
    if (shellRuns.length === 0 && !shellStarting) startShell()
  }
```

The "existing shells, none active" fallback is also dropped because `panelTabs.activeId` is now the single source of truth for the visible shell — if the user explicitly clicks the "Terminal" header button while shells exist, the more natural behaviour is "start a new one" (matching VSCode), so always-start is the correct branch.

- [ ] **Step 2: Delete the `<WorkspaceShellDialog />` JSX block**

Remove the trailing block:
```tsx
      <WorkspaceShellDialog
        activeRunId={activeShellRunId}
        error={shellError}
        ...
      />
```

Drop the import `import { WorkspaceShellDialog } from './terminal/WorkspaceShellDialog.js'`.

- [ ] **Step 3: Update `WorkersPane` shell-button copy**

In `WorkersPane`, the shell trigger button currently labelled "Terminal" with tooltip "Open workspace terminal" now needs to mean "start a new shell". The wording is still accurate. No copy change needed. Verify the test for the shell button (`tests/web/workers-pane.test.tsx` if it exists) still passes.

- [ ] **Step 4: Smoke test**

Click the "Terminal" button in WorkersPane header — a new shell tab appears in the bottom panel and becomes active. Close it via the tab × — the PTY closes (existing `closeShellTab` runs the API).

- [ ] **Step 5: Run test suite**

```bash
cd /Users/admin/code/hive-private-release && pnpm exec vitest run
```
Expected: `workspace-shell-dialog.test.tsx` may now fail — that test imports the deleted-target dialog. Acceptable; we delete that test in Task 8.

- [ ] **Step 6: Commit**

```bash
cd /Users/admin/code/hive-private-release
git add web/src/WorkspaceDetail.tsx
git commit -m "Remove WorkspaceShellDialog mount; shell tabs live in bottom panel"
```

---

### Task 8: Delete dead files (`WorkerModal`, `useWorkerModalResize`, `WorkspaceShellDialog`)

**Files:**
- Delete: `web/src/worker/WorkerModal.tsx`
- Delete: `web/src/worker/useWorkerModalResize.ts`
- Delete: `web/src/terminal/WorkspaceShellDialog.tsx`
- Delete: `tests/web/worker-modal.test.tsx`
- Delete: `tests/web/workspace-shell-dialog.test.tsx`

- [ ] **Step 1: Verify no remaining imports**

```bash
cd /Users/admin/code/hive-private-release
grep -rn "WorkerModal\|useWorkerModalResize\|WorkspaceShellDialog" web/ src/ tests/ \
  | grep -v "^.*node_modules" \
  | grep -v ".test.tsx:" \
  | head -20
```
Expected output: empty (or only the test files we're about to delete).

- [ ] **Step 2: Delete the files**

```bash
cd /Users/admin/code/hive-private-release
git rm web/src/worker/WorkerModal.tsx \
       web/src/worker/useWorkerModalResize.ts \
       web/src/terminal/WorkspaceShellDialog.tsx \
       tests/web/worker-modal.test.tsx \
       tests/web/workspace-shell-dialog.test.tsx
```

- [ ] **Step 3: Remove now-unused i18n keys**

Edit `web/src/i18n.tsx`. `TranslationKey` is defined as `keyof typeof enMessages` (line 351), and `zhMessages` is typed `Record<TranslationKey, string>`. **The two maps must be edited within the same commit/working-tree state** — if `enMessages` loses a key first, `zhMessages` immediately fails the type check, and vice-versa. Do NOT run `pnpm exec tsc` between sub-steps; only at the end.

Delete these keys from BOTH `enMessages` and `zhMessages`:
- `worker.detail`
- `worker.widthResize`
- `shellTerminal.subtitle` (was only referenced from the dialog's Description)
- `shellTerminal.openAria` (referenced from `WorkersPane` shell button — verify with grep before deleting)
- `shellTerminal.title` (only referenced from the dialog's title/aria-label — verify with grep before deleting)

For each candidate, before editing run:
```bash
grep -rn "'KEY_HERE'\\|\"KEY_HERE\"" web/ src/
```
If the key still appears outside of `i18n.tsx`, keep it.

- [ ] **Step 4: Run typecheck and tests**

```bash
cd /Users/admin/code/hive-private-release
pnpm exec tsc --noEmit -p tsconfig.json
pnpm exec vitest run
```
Expected: typecheck clean, tests pass except `worker-flow.test.tsx` (still asserts modal opening — fixed in Task 9).

- [ ] **Step 5: Commit**

```bash
cd /Users/admin/code/hive-private-release
git add -A
git commit -m "Delete WorkerModal, useWorkerModalResize, WorkspaceShellDialog and their tests"
```

---

### Task 9: Update `worker-flow.test.tsx` for panel-tab semantics

**Files:**
- Modify: `tests/web/worker-flow.test.tsx`

The current test file does **not** use a `worker-modal` testid (reviewer-verified). It asserts the modal via three patterns we have to rewrite:

1. `await screen.findByRole('dialog', { name: 'Alice' })` — dialog opens when card is clicked
2. `fireEvent.click(screen.getByLabelText('Close worker detail'))` — modal close button
3. `expect(within(modal).getByText(/PTY stopped|not started/)).toBeInTheDocument()` — stopped-worker empty-state text
4. `fireEvent.click(within(modal).getAllByRole('button', { name: /Start/ })[0])` — start button inside modal

After migration, all three change.

- [ ] **Step 1: Read the current test to confirm sites**

```bash
cd /Users/admin/code/hive-private-release
grep -n "dialog.*name:\\|getByLabelText.*Close worker\\|PTY stopped\\|name: /Start/\\|querySelector.*worker-pty" tests/web/worker-flow.test.tsx
```

Expected hits: lines around 209, 214, 211/417/448 (worker-pty), 415 (dialog Immediate), 443 (dialog Bob), 444 (PTY stopped), 445 (Start).

- [ ] **Step 2: Test 1 — "Add Worker dialog creates a card…"**

Find the block starting `// Verify clicking the card opens the modal and the PTY portal mounts.`

Replace:
```ts
    // Verify clicking the card opens the modal and the PTY portal mounts.
    fireEvent.click(card)
    await screen.findByRole('dialog', { name: 'Alice' })
    await waitFor(() => {
      expect(document.querySelector('[id^="worker-pty-"]')).not.toBeNull()
    })
    // Close modal — control actions (Stop/Restart/Delete) live on the card now.
    fireEvent.click(screen.getByLabelText('Close worker detail'))
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Alice' })).toBeNull()
    })
```

With:
```ts
    // Verify clicking the card opens a tab in the bottom panel and the PTY
    // portal mounts inside the panel slot.
    fireEvent.click(card)
    const panel = await screen.findByTestId('terminal-bottom-panel')
    expect(within(panel).getByTestId(/^terminal-tab-worker:/)).toBeInTheDocument()
    await waitFor(() => {
      expect(document.querySelector('[id^="worker-pty-"]')).not.toBeNull()
    })
    // Close the tab via its × — the tab disappears, panel collapses when last
    // tab closes. (PTY keeps running; worker lifecycle is on the card cluster.)
    const closeBtn = within(panel).getByTestId(/^terminal-tab-close-worker:/)
    fireEvent.click(closeBtn)
    await waitFor(() => {
      expect(screen.queryByTestId('terminal-bottom-panel')).toBeNull()
    })
```

- [ ] **Step 3: Test 2 — "new member opens with its PTY before terminal-runs polling catches up"**

Find:
```ts
    const modal = await screen.findByRole('dialog', { name: 'Immediate' })
    expect(within(modal).queryByTestId('worker-start-empty')).toBeNull()
    expect(document.querySelector('[id^="worker-pty-"]')).not.toBeNull()
```

Replace with:
```ts
    const panel = await screen.findByTestId('terminal-bottom-panel')
    expect(within(panel).getByTestId(/^terminal-tab-worker:/)).toBeInTheDocument()
    // Stopped-worker empty state would render `terminal-panel-stopped-worker` —
    // assert it's NOT there (optimistic-runs gave us a runId immediately).
    expect(screen.queryByTestId('terminal-panel-stopped-worker')).toBeNull()
    expect(document.querySelector('[id^="worker-pty-"]')).not.toBeNull()
```

- [ ] **Step 4: Test 3 — "stopped worker can be started from the detail modal after reload"**

The test's name still says "detail modal"; rename it to reflect the panel surface, and switch the assertions.

Find:
```ts
  test('stopped worker can be started from the detail modal after reload', async () => {
```

Rename to:
```ts
  test('stopped worker can be started from the panel tab after reload', async () => {
```

Then find:
```ts
    const modal = await screen.findByRole('dialog', { name: 'Bob' })
    expect(within(modal).getByText(/PTY stopped|not started/)).toBeInTheDocument()
    fireEvent.click(within(modal).getAllByRole('button', { name: /Start/ })[0] as HTMLElement)
```

Replace with:
```ts
    const panel = await screen.findByTestId('terminal-bottom-panel')
    const stopped = within(panel).getByTestId('terminal-panel-stopped-worker')
    expect(stopped).toBeInTheDocument()
    fireEvent.click(within(stopped).getByTestId('terminal-panel-start-worker'))
```

- [ ] **Step 5: Verify no surviving modal-era references**

```bash
cd /Users/admin/code/hive-private-release
grep -n "findByRole.*dialog\\|Close worker detail\\|PTY stopped\\|worker-start-empty" tests/web/worker-flow.test.tsx
```
Expected: empty (or only matches inside non-applicable comments).

- [ ] **Step 6: Run the test**

```bash
cd /Users/admin/code/hive-private-release && pnpm exec vitest run tests/web/worker-flow.test.tsx
```
Expected: PASS, all 7 tests.

- [ ] **Step 7: Commit**

```bash
cd /Users/admin/code/hive-private-release
git add tests/web/worker-flow.test.tsx
git commit -m "Update worker-flow test for bottom panel tab semantics"
```

---

### Task 10: Update `package.json` test:windows list

**Files:**
- Modify: `package.json`

The `test:windows` script enumerates an allowlist of cross-platform-safe tests. Drop the deleted ones and add the new ones.

- [ ] **Step 1: Open `package.json`**

Read the `test:windows` script entry. Find these tokens to remove (if present):
- `tests/web/worker-modal.test.tsx` — none, but verify
- `tests/web/workspace-shell-dialog.test.tsx` — none, but verify

Find these tokens to add (if applicable to the platform — these are pure jsdom, so yes):
- `tests/web/use-terminal-panel-height.test.ts`
- `tests/web/use-terminal-panel-tabs.test.ts`
- `tests/web/terminal-tabs.test.tsx`
- `tests/web/terminal-bottom-panel.test.tsx`

- [ ] **Step 2: Edit `package.json`**

In the `test:windows` value, append the four new tests (matching the existing single-line space-separated style). Do not split lines.

- [ ] **Step 3: Verify the script parses**

```bash
cd /Users/admin/code/hive-private-release && node -e "console.log(require('./package.json').scripts['test:windows'])" | head
```
Expected: the script string includes the four new file paths.

- [ ] **Step 4: Commit**

```bash
cd /Users/admin/code/hive-private-release
git add package.json
git commit -m "Add new terminal-panel tests to test:windows allowlist"
```

---

### Task 11: Polish — close-tab keyboard shortcut + tab-strip overflow

**Files:**
- Modify: `web/src/terminal/TerminalBottomPanel.tsx`
- Modify: `tests/web/terminal-bottom-panel.test.tsx`

Add a `Cmd+W` / `Ctrl+W` listener inside the panel that closes the active tab when the panel is focused. This matches user expectation for tabbed terminal UIs. (Browser-level `Cmd+W` close-tab gating is already handled by `useBeforeUnloadGuard` — this shortcut never reaches the browser when the panel handles it first.)

- [ ] **Step 1: Add a failing test**

In `tests/web/terminal-bottom-panel.test.tsx`, add:

```ts
test('Cmd+W on the panel container closes the active tab', () => {
  const onClose = vi.fn()
  render(
    <TerminalBottomPanel
      tabs={[workerTab]}
      activeId="worker:w1"
      onSelect={vi.fn()}
      onClose={onClose}
      onNewShell={vi.fn()}
      newShellPending={false}
    />
  )
  const panel = screen.getByTestId('terminal-bottom-panel')
  fireEvent.keyDown(panel, { key: 'w', metaKey: true })
  expect(onClose).toHaveBeenCalledWith('worker:w1')
})
```

- [ ] **Step 2: Run the failing test**

```bash
cd /Users/admin/code/hive-private-release && pnpm exec vitest run tests/web/terminal-bottom-panel.test.tsx
```
Expected: FAIL — no key handler yet.

- [ ] **Step 3: Implement**

In `TerminalBottomPanel.tsx`, add `tabIndex={-1}` and an `onKeyDown` to the outer `<div data-testid="terminal-bottom-panel">`. Biome's `lint/a11y/noStaticElementInteractions` rule flags interactive handlers on plain `<div>` — suppress with a single-line comment above the element, mirroring the existing `useSemanticElements` suppression on the resize separator:

```tsx
    // biome-ignore lint/a11y/noStaticElementInteractions: panel container hosts a Cmd+W keyboard shortcut for closing the active terminal tab
    <div
      data-testid="terminal-bottom-panel"
      ...
      tabIndex={-1}
      onKeyDown={(event) => {
        if (
          (event.metaKey || event.ctrlKey) &&
          !event.altKey &&
          !event.shiftKey &&
          event.key.toLowerCase() === 'w' &&
          activeId
        ) {
          event.preventDefault()
          onClose(activeId)
        }
      }}
    >
```

- [ ] **Step 4: Run the test**

```bash
cd /Users/admin/code/hive-private-release && pnpm exec vitest run tests/web/terminal-bottom-panel.test.tsx
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/admin/code/hive-private-release
git add web/src/terminal/TerminalBottomPanel.tsx tests/web/terminal-bottom-panel.test.tsx
git commit -m "Bind Cmd+W inside the terminal panel to close the active tab"
```

---

### Task 12: Final QA — full test pass + manual smoke + screenshot review

**Files:** none (operational task)

- [ ] **Step 1: Run the full suite**

```bash
cd /Users/admin/code/hive-private-release && pnpm exec vitest run
```
Expected: 100% pass.

- [ ] **Step 2: Run linter**

```bash
cd /Users/admin/code/hive-private-release && pnpm check
```
Expected: clean.

- [ ] **Step 3: Manual smoke matrix**

Open `http://127.0.0.1:3001`. Verify:
- Right column shows WorkersPane full-height while no tabs are open.
- Click worker A → tab `Alice` appears, panel slides up to default height; xterm visible.
- Click worker B → tab `Bob` appears, becomes active; A stays in the strip.
- Click A's tab → switches back; xterm content for A is intact (no replay needed because xterm DOM was re-parented, not destroyed).
- Click "Terminal" button in WorkersPane header → new shell tab appears, becomes active.
- Drag the splitter (horizontal bar above the tabs) up — panel grows, WorkersPane shrinks. Drag past min — clamped.
- Drag the existing left/right splitter — orchestrator pane width changes; the bottom panel obeys the new right-column width.
- Close all tabs → panel disappears, WorkersPane takes full height again.
- Reload → tab list + active tab + height all persisted per-workspace.
- Switch workspace via sidebar → loaded workspace shows its own tab list (or empty).

- [ ] **Step 4: Subagent visual review**

(Driver dispatches an opus subagent to look at the diff for tab-strip styling vs. the VSCode screenshot the user supplied. Report any pixel-level drift.)

- [ ] **Step 5: Tag PR-ready commit**

```bash
cd /Users/admin/code/hive-private-release
git log --oneline -15
```
The series should be a clean sequence of ~10 commits, no merge conflicts.

- [ ] **Step 6: Final commit (changelog + release notes)**

Append a `CHANGELOG.md` entry under the next-release heading (private repo convention):

```
- Replaced the Worker detail modal and Workspace shell dialog with a docked,
  resizable, VSCode-style terminal panel inside the right column. Worker tabs
  and shell tabs share the strip; height + tab list persist per-workspace.
```

```bash
git add CHANGELOG.md
git commit -m "Note terminal bottom panel in CHANGELOG"
```

---

## Out of Scope (Defer)

- Drag-to-reorder tabs.
- Detach-to-window (popping a tab out of the panel).
- Tab context menu (rename / pin / split).
- Search across all tab buffers.
- Persisting xterm scrollback across reloads beyond what the existing terminal mirror already does.
- Embedding the orchestrator terminal as a tab — explicit user decision (2026-05-19).
