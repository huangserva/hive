import { buildMilestoneCompletionNudge } from './milestone-completion-nudge.js'
import { parsePlanDoc } from './plan-doc.js'

export interface MilestoneShippedEvent {
  commitHash: string | null
  milestone: string
  title: string
}

interface MilestoneCompletionTriggerOptions {
  getWorkspacePath: (workspaceId: string) => string
  injectNudge: (workspaceId: string, message: string) => void
}

const COMMIT_HASH_RE = /\b[0-9a-f]{7,40}\b/i
const MILESTONE_HEADING_RE = /^###\s+(.+?)\s*$/gm

const extractCommitHash = (text: string): string | null => COMMIT_HASH_RE.exec(text)?.[0] ?? null

const normalizeMilestoneId = (value: string) =>
  value.replace(
    /^m(\d+)([a-z]?)$/i,
    (_match, digits: string, suffix: string) => `M${digits}${suffix.toLowerCase()}`
  )

const extractHeadingByMilestone = (content: string) => {
  const headings = new Map<string, string>()
  for (const match of content.matchAll(MILESTONE_HEADING_RE)) {
    const heading = match[1] ?? ''
    const id = /\b(M\d+(?:\.\d+)?[a-z]?)\b/i.exec(heading)?.[1]
    if (id) headings.set(normalizeMilestoneId(id), heading)
  }
  return headings
}

export function detectNewlyShippedMilestones(
  previousContent: string,
  currentContent: string
): MilestoneShippedEvent[] {
  const previous = new Map(parsePlanDoc(previousContent).milestones.map((item) => [item.id, item]))
  const currentHeadings = extractHeadingByMilestone(currentContent)
  return parsePlanDoc(currentContent)
    .milestones.filter((milestone) => previous.get(milestone.id)?.status !== 'shipped')
    .filter((milestone) => milestone.status === 'shipped')
    .map((milestone) => ({
      commitHash: extractCommitHash(
        `${currentHeadings.get(milestone.id) ?? ''}\n${milestone.body}`
      ),
      milestone: milestone.id,
      title: milestone.title,
    }))
}

export function createMilestoneCompletionTrigger({
  getWorkspacePath,
  injectNudge,
}: MilestoneCompletionTriggerOptions) {
  const previousPlanByWorkspace = new Map<string, string>()
  const nudgedMilestones = new Set<string>()

  return {
    handlePlanUpdated(workspaceId: string, content: string) {
      const previous = previousPlanByWorkspace.get(workspaceId)
      previousPlanByWorkspace.set(workspaceId, content)
      if (previous === undefined) return

      for (const event of detectNewlyShippedMilestones(previous, content)) {
        const key = `${workspaceId}:${event.milestone}`
        if (nudgedMilestones.has(key)) continue
        const workspacePath = getWorkspacePath(workspaceId)
        const nudge = buildMilestoneCompletionNudge(event, workspacePath)
        if (!nudge.message) continue
        nudgedMilestones.add(key)
        injectNudge(workspaceId, nudge.message)
      }
    },
  }
}
