import { Ionicons } from '@expo/vector-icons'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'

import { useMobileRuntime } from '../api/mobile-runtime-context'
import { useT } from '../i18n'
import { colors, radius, spacing } from '../theme'
import { getConnectionModeBannerSnapshot } from './connection-mode-banner-state'

const MODE_ICON: Record<'disconnected' | 'lan' | 'relay', keyof typeof Ionicons.glyphMap> = {
  disconnected: 'cloud-offline-outline',
  lan: 'wifi-outline',
  relay: 'swap-horizontal-outline',
}

export const ConnectionModeBadge = () => {
  const t = useT()
  const { connectionMode, reconnecting, state } = useMobileRuntime()

  const { displayMode, showConnecting } = getConnectionModeBannerSnapshot({
    connectionMode,
    reconnecting,
    state,
  })
  const modeKey =
    displayMode === 'lan'
      ? 'runtime.connectionMode.lan'
      : displayMode === 'relay'
        ? 'runtime.connectionMode.relay'
        : 'runtime.connectionMode.offline'
  const modeLabel = t(modeKey)

  return (
    <View
      accessibilityLabel={modeLabel}
      style={[s.badge, displayMode === 'disconnected' ? s.offlineBadge : s.onlineBadge]}
    >
      <View
        style={[
          s.badgeIconWrap,
          displayMode === 'disconnected' ? s.offlineIconWrap : s.onlineIconWrap,
        ]}
      >
        <Ionicons
          color={displayMode === 'disconnected' ? colors.error : colors.accent}
          name={MODE_ICON[displayMode]}
          size={12}
        />
      </View>
      <Text style={s.badgeText}>{modeLabel}</Text>
      {showConnecting ? <ActivityIndicator color={colors.muted} size="small" /> : null}
    </View>
  )
}

export const ConnectionModeBanner = () => {
  const t = useT()
  const {
    clearFailedOutbox,
    outboxFailedCount,
    outboxPendingCount,
    outboxSendingCount,
    retryOutbox,
  } = useMobileRuntime()
  const showRetry = outboxFailedCount > 0

  return (
    <View style={s.banner}>
      <ConnectionModeBadge />

      <View style={s.outboxRow}>
        {outboxPendingCount > 0 ? (
          <View style={s.pendingPill}>
            <Ionicons color={colors.warning} name="time-outline" size={12} />
            <Text style={s.pendingText}>{t('outbox.pending', { count: outboxPendingCount })}</Text>
          </View>
        ) : null}
        {outboxSendingCount > 0 ? (
          <View style={s.sendingPill}>
            <Ionicons color={colors.accent} name="sync-outline" size={12} />
            <Text style={s.sendingText}>{t('outbox.sending')}</Text>
          </View>
        ) : null}
        {showRetry ? (
          <View style={s.retryBtn}>
            <Ionicons color={colors.error} name="alert-circle-outline" size={12} />
            <Text style={s.retryText}>{t('outbox.failed', { count: outboxFailedCount })}</Text>
            <Pressable accessibilityRole="button" onPress={() => void retryOutbox()}>
              <Text style={s.retryAction}>{t('outbox.retry')}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => void clearFailedOutbox()}>
              <Text style={s.retryAction}>{t('outbox.clear')}</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </View>
  )
}

const s = StyleSheet.create({
  banner: {
    backgroundColor: colors.card,
    borderColor: colors.borderMuted,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
    minHeight: 30,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  badge: {
    alignItems: 'center',
    borderRadius: 999,
    flexDirection: 'row',
    gap: 4,
    height: 24,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  badgeIconWrap: {
    alignItems: 'center',
    borderRadius: 999,
    height: 18,
    justifyContent: 'center',
    width: 18,
  },
  badgeText: {
    color: colors.text,
    fontSize: 10,
    fontWeight: '800',
    lineHeight: 12,
    textTransform: 'uppercase',
  },
  offlineBadge: {
    backgroundColor: 'rgba(248, 81, 73, 0.12)',
  },
  offlineIconWrap: {
    backgroundColor: 'rgba(248, 81, 73, 0.12)',
  },
  onlineBadge: {
    backgroundColor: 'rgba(88, 166, 255, 0.12)',
  },
  onlineIconWrap: {
    backgroundColor: 'rgba(88, 166, 255, 0.12)',
  },
  outboxRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  pendingPill: {
    alignItems: 'center',
    backgroundColor: 'rgba(210, 153, 34, 0.12)',
    borderRadius: 999,
    flexDirection: 'row',
    gap: 4,
    height: 24,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  pendingText: {
    color: colors.warning,
    fontSize: 10,
    fontWeight: '800',
    lineHeight: 12,
  },
  retryAction: {
    color: colors.error,
    fontSize: 10,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  retryBtn: {
    alignItems: 'center',
    backgroundColor: 'rgba(248, 81, 73, 0.12)',
    borderRadius: 999,
    flexDirection: 'row',
    gap: 4,
    height: 24,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  retryText: {
    color: colors.error,
    fontSize: 10,
    fontWeight: '800',
    lineHeight: 12,
  },
  sendingPill: {
    alignItems: 'center',
    backgroundColor: 'rgba(88, 166, 255, 0.12)',
    borderRadius: 999,
    flexDirection: 'row',
    gap: 4,
    height: 24,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  sendingText: {
    color: colors.accent,
    fontSize: 10,
    fontWeight: '800',
    lineHeight: 12,
  },
})
