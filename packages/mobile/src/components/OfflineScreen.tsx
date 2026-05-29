import { Ionicons } from '@expo/vector-icons'
import type { ComponentProps } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

import { colors, radius, spacing } from '../theme'

type IconName = ComponentProps<typeof Ionicons>['name']

interface OfflineScreenProps {
  connectionMode: string
  error: string | null
  host: string
  lastSeenLabel?: string
  networkLabel?: string
  onOpenSettings: () => void
  onRetry: () => void
}

export const OfflineScreen = ({
  connectionMode,
  error,
  host,
  lastSeenLabel,
  networkLabel,
  onOpenSettings,
  onRetry,
}: OfflineScreenProps) => (
  <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
    <View style={styles.header}>
      <View>
        <Text style={styles.title}>Offline</Text>
        <Text style={styles.subtitle}>Unable to reach HippoTeam Orchestrator</Text>
      </View>
      <View style={styles.disconnectedPill}>
        <View style={styles.redDot} />
        <Text style={styles.disconnectedText}>Disconnected</Text>
      </View>
    </View>

    <View style={styles.heroWrap}>
      <View style={styles.heroOuter}>
        <View style={styles.heroInner}>
          <Ionicons color={colors.error} name="cloud-offline-outline" size={58} />
        </View>
        <View style={styles.alertBadge}>
          <Ionicons color={colors.background} name="alert" size={22} />
        </View>
      </View>
      <Text style={styles.offlineTitle}>You're offline</Text>
      <Text style={styles.offlineCopy}>
        We can't connect to the orchestrator. Please check your connection.
      </Text>
      {lastSeenLabel ? (
        <View style={styles.lastSeenRow}>
          <Ionicons color={colors.muted} name="time-outline" size={18} />
          <Text style={styles.lastSeenText}>{lastSeenLabel}</Text>
        </View>
      ) : null}
    </View>

    <View style={styles.actionRow}>
      <Pressable accessibilityRole="button" onPress={onRetry} style={styles.retryButton}>
        <Ionicons color={colors.text} name="refresh-outline" size={20} />
        <Text style={styles.retryText}>Retry</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={onOpenSettings} style={styles.settingsButton}>
        <Ionicons color={colors.textSoft} name="settings-outline" size={20} />
        <Text style={styles.settingsText}>Open Settings</Text>
      </Pressable>
    </View>

    <View style={styles.warningCard}>
      <View style={styles.warningTitleRow}>
        <Ionicons color={colors.warning} name="warning-outline" size={24} />
        <Text style={styles.warningTitle}>Orchestrator not running</Text>
      </View>
      <Text style={styles.warningCopy}>
        The orchestrator service doesn't appear to be running on your machine.
      </Text>
      <View style={styles.warningHintRow}>
        <Ionicons color={colors.muted} name="desktop-outline" size={20} />
        <Text style={styles.warningHint}>
          Please start HippoTeam Orchestrator on your desktop and try again.
        </Text>
        <Ionicons color={colors.muted} name="chevron-forward" size={20} />
      </View>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>

    <Text style={styles.sectionTitle}>Connection Details</Text>
    <View style={styles.detailsCard}>
      <DetailRow
        icon="git-network-outline"
        label="Connection Mode"
        value={modeLabel(connectionMode)}
      />
      <DetailRow icon="server-outline" label="Endpoint" value={host || 'Not configured'} />
      {networkLabel ? (
        <DetailRow icon="wifi-outline" label="Network" tone="success" value={networkLabel} />
      ) : null}
      <DetailRow
        icon="hardware-chip-outline"
        label="Orchestrator Status"
        tone="error"
        value="Unavailable"
      />
    </View>
  </ScrollView>
)

const modeLabel = (mode: string) => {
  if (mode === 'relay') return 'Relay'
  if (mode === 'lan') return 'LAN'
  return 'Disconnected'
}

const DetailRow = ({
  icon,
  label,
  tone = 'muted',
  value,
}: {
  icon: IconName
  label: string
  tone?: 'accent' | 'error' | 'muted' | 'success'
  value: string
}) => {
  const valueColor =
    tone === 'accent'
      ? colors.accent
      : tone === 'error'
        ? colors.error
        : tone === 'success'
          ? colors.success
          : colors.textSoft
  return (
    <View style={styles.detailRow}>
      <Ionicons color={colors.muted} name={icon} size={21} />
      <Text style={styles.detailLabel}>{label}</Text>
      <Text numberOfLines={1} style={[styles.detailValue, { color: valueColor }]}>
        {value}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  actionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  alertBadge: {
    alignItems: 'center',
    backgroundColor: colors.error,
    borderRadius: 999,
    bottom: 20,
    height: 44,
    justifyContent: 'center',
    position: 'absolute',
    right: 6,
    width: 44,
  },
  detailLabel: {
    color: colors.muted,
    flex: 1,
    fontSize: 15,
  },
  detailRow: {
    alignItems: 'center',
    borderBottomColor: colors.borderMuted,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingVertical: 14,
  },
  detailValue: {
    flexShrink: 1,
    fontSize: 15,
    fontWeight: '800',
    textAlign: 'right',
  },
  detailsCard: {
    backgroundColor: colors.card,
    borderColor: colors.borderMuted,
    borderRadius: radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
    paddingHorizontal: spacing.md,
  },
  disconnectedPill: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.borderMuted,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: 13,
    paddingVertical: 9,
  },
  disconnectedText: {
    color: colors.error,
    fontSize: 14,
    fontWeight: '800',
  },
  errorText: {
    color: colors.error,
    fontSize: 13,
    lineHeight: 18,
  },
  header: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  heroInner: {
    alignItems: 'center',
    backgroundColor: colors.cardElevated,
    borderColor: colors.border,
    borderRadius: 80,
    borderWidth: 8,
    height: 150,
    justifyContent: 'center',
    width: 150,
  },
  heroOuter: {
    alignItems: 'center',
    backgroundColor: 'rgba(248, 81, 73, 0.08)',
    borderColor: 'rgba(248, 81, 73, 0.5)',
    borderRadius: 96,
    borderWidth: 2,
    height: 186,
    justifyContent: 'center',
    width: 186,
  },
  heroWrap: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: spacing.md,
  },
  lastSeenRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  lastSeenText: {
    color: colors.muted,
    fontSize: 15,
    fontWeight: '700',
  },
  offlineCopy: {
    color: colors.muted,
    fontSize: 16,
    lineHeight: 23,
    maxWidth: 300,
    textAlign: 'center',
  },
  offlineTitle: {
    color: colors.text,
    fontSize: 27,
    fontWeight: '900',
  },
  redDot: {
    backgroundColor: colors.error,
    borderRadius: 999,
    height: 10,
    width: 10,
  },
  retryButton: {
    alignItems: 'center',
    backgroundColor: colors.error,
    borderRadius: radius.md,
    flex: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'center',
    paddingVertical: 16,
  },
  retryText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '900',
  },
  scroll: {
    gap: spacing.md,
    paddingBottom: spacing.lg,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '900',
    marginTop: spacing.xs,
  },
  settingsButton: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.borderMuted,
    borderRadius: radius.md,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'center',
    paddingVertical: 16,
  },
  settingsText: {
    color: colors.textSoft,
    fontSize: 16,
    fontWeight: '800',
  },
  subtitle: {
    color: colors.muted,
    fontSize: 15,
    marginTop: 3,
  },
  title: {
    color: colors.text,
    fontSize: 34,
    fontWeight: '900',
  },
  warningCard: {
    backgroundColor: colors.card,
    borderColor: 'rgba(210, 153, 34, 0.7)',
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  warningCopy: {
    color: colors.textSoft,
    fontSize: 15,
    lineHeight: 22,
  },
  warningHint: {
    color: colors.muted,
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  warningHintRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  warningTitle: {
    color: colors.warning,
    flex: 1,
    fontSize: 17,
    fontWeight: '900',
  },
  warningTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
})
