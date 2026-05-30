import { Ionicons } from '@expo/vector-icons'
import { useLocalSearchParams, useRouter } from 'expo-router'
import type { ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

import type { ChatMessage } from '../src/api/client'
import { useMobileRuntime } from '../src/api/mobile-runtime-context'
import { Screen } from '../src/components/Screen'
import { type TFunction, useT } from '../src/i18n'
import { colors, radius, spacing } from '../src/theme'

interface ApprovalPayload {
  action?: string
  approval_id?: string
  branch?: string
  description?: string
  reason?: string
  risk?: string
  target_worker?: {
    description?: string
    name?: string
  }
  workspace?: string
}

interface ResolvedApprovalPayload {
  action: string | null
  approval_id: string | null
  branch: string | null
  description: string | null
  reason: string | null
  risk: string | null
  target_worker: {
    description: string
    name: string
  } | null
  workspace: string | null
}

const parseApprovalPayload = (message: ChatMessage | undefined): ResolvedApprovalPayload => {
  const empty: ResolvedApprovalPayload = {
    action: null,
    approval_id: null,
    branch: null,
    description: null,
    reason: null,
    risk: null,
    target_worker: null,
    workspace: null,
  }
  if (!message) return empty
  const parsed = parseJsonObject(message.content_json) as ApprovalPayload
  const workerName = firstString(parsed.target_worker?.name)
  const workerDescription = firstString(parsed.target_worker?.description)
  return {
    action: firstString(parsed.action) ?? null,
    approval_id: firstString(parsed.approval_id) ?? null,
    branch: firstString(parsed.branch) ?? null,
    description: firstString(parsed.description, parsed.reason) ?? null,
    reason: firstString(parsed.reason) ?? null,
    risk: firstString(parsed.risk) ?? null,
    target_worker:
      workerName || workerDescription
        ? {
            description: workerDescription ?? '',
            name: workerName ?? 'Worker',
          }
        : null,
    workspace: firstString(parsed.workspace) ?? null,
  }
}

export default function ApprovalCenter() {
  const { approvalId } = useLocalSearchParams<{ approvalId?: string }>()
  const router = useRouter()
  const t = useT()
  const { approveRequest, chatMessages, fetchChatMessages, state } = useMobileRuntime()
  const [submitting, setSubmitting] = useState<'allow' | 'deny' | null>(null)

  const approvalMessage = useMemo(
    () =>
      chatMessages
        .filter((message) => message.message_type === 'approval_request')
        .find((message) => {
          if (!approvalId) return true
          try {
            return (JSON.parse(message.content_json) as ApprovalPayload).approval_id === approvalId
          } catch {
            return false
          }
        }),
    [approvalId, chatMessages]
  )
  const approval = useMemo(() => parseApprovalPayload(approvalMessage), [approvalMessage])
  const processedApprovals = useMemo(
    () =>
      chatMessages
        .filter((message) => message.message_type === 'system_event')
        .map(parseProcessedApproval)
        .filter((item): item is ProcessedApproval => item !== null),
    [chatMessages]
  )
  const pendingCount = chatMessages.filter(
    (message) => message.message_type === 'approval_request'
  ).length

  useEffect(() => {
    if (!approvalId) return
    void fetchChatMessages({ resetSince: true })
  }, [approvalId, fetchChatMessages])

  const decide = async (decision: 'allow' | 'deny') => {
    if (!approval.approval_id) return
    setSubmitting(decision)
    const ok = await approveRequest(approval.approval_id, decision)
    setSubmitting(null)
    const queued = !ok && state !== 'connected'
    Alert.alert(
      ok
        ? t('chat.approval.recorded')
        : queued
          ? t('outbox.queuedTitle')
          : t('chat.approval.failed'),
      ok ? decisionLabel(decision, t) : queued ? t('outbox.queued') : ''
    )
    if (ok || queued) router.back()
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.back}>
            <Ionicons color={colors.textSoft} name="chevron-back" size={22} />
          </Pressable>
          <Text style={styles.title}>{t('chat.approval.center')}</Text>
          <View style={styles.filterButton}>
            <Ionicons color={colors.textSoft} name="filter-outline" size={17} />
            <Text style={styles.filterText}>{t('common.filter')}</Text>
            {pendingCount > 0 ? (
              <View style={styles.countBadge}>
                <Text style={styles.countText}>{pendingCount}</Text>
              </View>
            ) : null}
          </View>
        </View>

        <View style={styles.approvalCard}>
          <View style={styles.cardTop}>
            <View style={styles.highRiskBadge}>
              <Ionicons color={colors.error} name="warning-outline" size={18} />
              <Text style={styles.highRiskText}>
                {approval.risk
                  ? `${titleCase(approval.risk)} Risk`
                  : t('chat.approval.needsReview')}
              </Text>
            </View>
            <View style={styles.requestedRow}>
              <Text style={styles.requestedText}>
                {approvalMessage
                  ? formatRelativeTime(approvalMessage.created_at)
                  : t('chat.approval.noRequest')}
              </Text>
              <View style={styles.requestDot} />
            </View>
          </View>

          <Divider />
          <Section label={t('chat.approval.section.action')}>
            <Text style={styles.actionTitle}>{approval.action ?? t('chat.approval.required')}</Text>
            {approval.description ? (
              <Text style={styles.actionDescription}>{approval.description}</Text>
            ) : null}
          </Section>

          {approval.target_worker ? (
            <>
              <Divider />
              <Section label={t('chat.approval.section.targetWorker')}>
                <View style={styles.workerRow}>
                  <Avatar name={approval.target_worker.name} />
                  <View style={styles.workerCopy}>
                    <Text style={styles.workerName}>{approval.target_worker.name}</Text>
                    {approval.target_worker.description ? (
                      <Text style={styles.workerDescription}>
                        {approval.target_worker.description}
                      </Text>
                    ) : null}
                  </View>
                  <Ionicons color={colors.muted} name="chevron-forward" size={22} />
                </View>
              </Section>
            </>
          ) : null}

          {approval.workspace || approval.branch ? (
            <>
              <Divider />
              <Section label={t('chat.approval.section.workspace')}>
                <View style={styles.workspaceRow}>
                  <View style={styles.branchIcon}>
                    <Ionicons color={colors.accent} name="git-branch-outline" size={28} />
                  </View>
                  <View style={styles.workerCopy}>
                    {approval.workspace ? (
                      <Text style={styles.workerName}>{approval.workspace}</Text>
                    ) : null}
                    {approval.branch ? (
                      <Text style={styles.workerDescription}>{approval.branch}</Text>
                    ) : null}
                  </View>
                  <Ionicons color={colors.muted} name="chevron-forward" size={22} />
                </View>
              </Section>
            </>
          ) : null}

          {approval.reason ? (
            <>
              <Divider />
              <Section label={t('chat.approval.section.reason')}>
                <Text style={styles.reasonText}>{approval.reason}</Text>
              </Section>
            </>
          ) : null}

          {approval.risk ? (
            <>
              <Divider />
              <View style={styles.riskRow}>
                <RiskTag
                  color={colors.error}
                  icon="warning-outline"
                  label={titleCase(approval.risk)}
                />
              </View>
            </>
          ) : null}

          <View style={styles.actionRow}>
            <Pressable
              accessibilityRole="button"
              disabled={submitting !== null || !approval.approval_id}
              onPress={() => void decide('deny')}
              style={styles.denyButton}
            >
              <Ionicons color={colors.error} name="shield-outline" size={22} />
              <Text style={styles.denyText}>
                {submitting === 'deny' ? t('chat.approval.denying') : t('chat.approval.deny')}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={submitting !== null || !approval.approval_id}
              onPress={() => void decide('allow')}
              style={styles.allowButton}
            >
              <Ionicons color={colors.text} name="shield-checkmark-outline" size={22} />
              <Text style={styles.allowText}>
                {submitting === 'allow' ? t('chat.approval.allowing') : t('chat.approval.allow')}
              </Text>
            </Pressable>
          </View>
        </View>

        {processedApprovals.length > 0 ? (
          <>
            <Text style={styles.recentTitle}>{t('chat.approval.recent')}</Text>
            {processedApprovals.map((item) => (
              <ProcessedItem item={item} key={`${item.approval_id}-${item.status}`} />
            ))}
          </>
        ) : null}
      </ScrollView>
    </Screen>
  )
}

const decisionLabel = (decision: 'allow' | 'deny', t: TFunction) =>
  decision === 'allow' ? t('chat.approval.allowed') : t('chat.approval.denied')

const parseJsonObject = (json: string): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(json) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

const firstString = (...values: unknown[]) =>
  values
    .find((value): value is string => typeof value === 'string' && value.trim().length > 0)
    ?.trim()

const titleCase = (value: string) =>
  value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1).toLowerCase()}`)
    .join(' ')

const formatRelativeTime = (timestamp: number) => {
  const diffMs = Date.now() - timestamp
  const diffMinutes = Math.max(0, Math.floor(diffMs / 60000))
  if (diffMinutes < 1) return 'Just now'
  if (diffMinutes < 60) return `${diffMinutes}m ago`
  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  return `${Math.floor(diffHours / 24)}d ago`
}

interface ProcessedApproval {
  approval_id: string
  description: string | null
  status: string
  time: string
  tone: 'error' | 'success'
  workspace: string | null
}

const parseProcessedApproval = (message: ChatMessage): ProcessedApproval | null => {
  const parsed = parseJsonObject(message.content_json)
  const approvalId = firstString(parsed.approval_id, parsed.approvalId)
  const decision = firstString(parsed.decision, parsed.status)
  if (!approvalId || !decision) return null
  const normalized = decision.toLowerCase()
  const allowed = normalized === 'allow' || normalized === 'allowed' || normalized === 'approved'
  const denied = normalized === 'deny' || normalized === 'denied' || normalized === 'rejected'
  if (!allowed && !denied) return null
  return {
    approval_id: approvalId,
    description:
      firstString(parsed.action, parsed.description, parsed.text, parsed.summary) ?? null,
    status: allowed ? 'Approved' : 'Denied',
    time: formatRelativeTime(message.created_at),
    tone: allowed ? 'success' : 'error',
    workspace: firstString(parsed.workspace) ?? null,
  }
}

const Divider = () => <View style={styles.divider} />

const Section = ({ children, label }: { children: ReactNode; label: string }) => (
  <View style={styles.section}>
    <Text style={styles.sectionLabel}>{label}</Text>
    {children}
  </View>
)

const Avatar = ({ name }: { name: string }) => (
  <View style={styles.avatar}>
    <Text style={styles.avatarText}>{name.slice(0, 1).toUpperCase()}</Text>
    <View style={styles.avatarOnline} />
  </View>
)

const RiskTag = ({
  color,
  icon,
  label,
}: {
  color: string
  icon?: keyof typeof Ionicons.glyphMap
  label: string
}) => (
  <View style={styles.riskTag}>
    {icon ? <Ionicons color={color} name={icon} size={18} /> : null}
    <Text style={[styles.riskTagText, { color }]}>{label}</Text>
  </View>
)

const ProcessedItem = ({ item }: { item: ProcessedApproval }) => {
  const color = item.tone === 'success' ? colors.success : colors.error
  return (
    <View style={styles.processedCard}>
      <View style={styles.processedTop}>
        <View style={styles.processedStatus}>
          <Ionicons color={color} name="checkmark-circle-outline" size={20} />
          <Text style={[styles.processedStatusText, { color }]}>{item.status}</Text>
        </View>
        <Text style={styles.processedTime}>{item.time}</Text>
      </View>
      {item.description ? <Text style={styles.workerDescription}>{item.description}</Text> : null}
      {item.workspace ? (
        <>
          <Divider />
          <View style={styles.processedBottom}>
            <View style={styles.workspaceMini}>
              <Ionicons color={colors.accent} name="folder-outline" size={23} />
              <Text style={styles.workspaceMiniTitle}>{item.workspace}</Text>
            </View>
          </View>
        </>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  actionDescription: {
    color: colors.textSoft,
    fontSize: 16,
    lineHeight: 23,
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  actionTitle: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '900',
  },
  allowButton: {
    alignItems: 'center',
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    flex: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'center',
    paddingVertical: 15,
  },
  allowText: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '900',
  },
  approvalCard: {
    backgroundColor: 'rgba(22, 27, 34, 0.88)',
    borderColor: colors.error,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.md,
  },
  avatar: {
    alignItems: 'center',
    backgroundColor: colors.cardElevated,
    borderColor: colors.borderMuted,
    borderRadius: 999,
    borderWidth: 1,
    height: 52,
    justifyContent: 'center',
    width: 52,
  },
  avatarOnline: {
    backgroundColor: colors.success,
    borderColor: colors.card,
    borderRadius: 999,
    borderWidth: 2,
    bottom: 1,
    height: 14,
    position: 'absolute',
    right: 1,
    width: 14,
  },
  avatarText: {
    color: colors.text,
    fontSize: 21,
    fontWeight: '900',
  },
  back: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.borderMuted,
    borderRadius: 999,
    borderWidth: 1,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  branchIcon: {
    alignItems: 'center',
    height: 52,
    justifyContent: 'center',
    width: 52,
  },
  cardTop: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  countBadge: {
    alignItems: 'center',
    backgroundColor: colors.cardElevated,
    borderRadius: 999,
    height: 24,
    justifyContent: 'center',
    width: 24,
  },
  countText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '900',
  },
  denyButton: {
    alignItems: 'center',
    backgroundColor: colors.cardElevated,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'center',
    paddingVertical: 15,
  },
  denyText: {
    color: colors.error,
    fontSize: 17,
    fontWeight: '900',
  },
  divider: {
    backgroundColor: colors.borderMuted,
    height: 1,
    marginVertical: spacing.md,
  },
  filterButton: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.borderMuted,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 9,
  },
  filterText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '800',
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  highRiskBadge: {
    alignItems: 'center',
    backgroundColor: colors.errorSoft,
    borderRadius: 999,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
  },
  highRiskText: {
    color: colors.error,
    fontSize: 17,
    fontWeight: '900',
  },
  processedBottom: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  processedCard: {
    backgroundColor: colors.card,
    borderColor: colors.borderMuted,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  processedStatus: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  processedStatusText: {
    fontSize: 15,
    fontWeight: '900',
  },
  processedTime: {
    color: colors.textSoft,
    fontSize: 14,
  },
  processedTop: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  reasonText: {
    color: colors.textSoft,
    fontSize: 16,
    lineHeight: 25,
  },
  recentTitle: {
    color: colors.textSoft,
    fontSize: 20,
    fontWeight: '900',
    marginTop: spacing.md,
  },
  requestDot: {
    backgroundColor: colors.error,
    borderRadius: 999,
    height: 7,
    width: 7,
  },
  requestedRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  requestedText: {
    color: colors.muted,
    fontSize: 15,
  },
  riskLevel: {
    borderLeftColor: colors.borderMuted,
    borderLeftWidth: 1,
    paddingLeft: spacing.md,
  },
  riskRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  riskTag: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 5,
  },
  riskTagText: {
    fontSize: 14,
    fontWeight: '800',
  },
  scroll: {
    gap: spacing.md,
    paddingBottom: spacing.lg,
  },
  section: {
    gap: 7,
  },
  sectionLabel: {
    color: colors.muted,
    fontSize: 15,
  },
  title: {
    color: colors.text,
    flex: 1,
    fontSize: 28,
    fontWeight: '900',
  },
  workerCopy: {
    flex: 1,
    gap: 5,
  },
  workerDescription: {
    color: colors.muted,
    fontSize: 15,
  },
  workerName: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '900',
  },
  workerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  workspaceMini: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: spacing.sm,
  },
  workspaceMiniTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '800',
  },
  workspaceRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
})
