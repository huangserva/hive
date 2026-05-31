import { Ionicons } from '@expo/vector-icons'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'

import { useMobileRuntime } from '../api/mobile-runtime-context'
import { useT } from '../i18n'
import { colors, radius, spacing } from '../theme'

const MODE_ICON: Record<'disconnected' | 'lan' | 'relay', keyof typeof Ionicons.glyphMap> = {
  disconnected: 'cloud-offline-outline',
  lan: 'wifi-outline',
  relay: 'swap-horizontal-outline',
}

export const ConnectionModeBanner = () => {
  const t = useT()
  const {
    connectionMode,
    outboxFailedCount,
    outboxPendingCount,
    outboxSendingCount,
    reconnecting,
    retryOutbox,
    state,
  } = useMobileRuntime()

  const displayMode: 'disconnected' | 'lan' | 'relay' =
    state === 'connected' || reconnecting ? connectionMode : 'disconnected'
  const modeKey =
    displayMode === 'lan'
      ? 'runtime.connectionMode.lan'
      : displayMode === 'relay'
        ? 'runtime.connectionMode.relay'
        : 'runtime.connectionMode.offline'
  const modeLabel = t(modeKey)
  const showRetry = outboxFailedCount > 0

  return (
    <View
      accessibilityLabel={modeLabel}
      style={[s.banner, displayMode === 'disconnected' ? s.offlineBanner : s.onlineBanner]}
    >
      <View style={s.modeRow}>
        <View
          style={[
            s.modeIconWrap,
            displayMode === 'disconnected' ? s.offlineIconWrap : s.onlineIconWrap,
          ]}
        >
          <Ionicons
            color={displayMode === 'disconnected' ? colors.error : colors.accent}
            name={MODE_ICON[displayMode]}
            size={15}
          />
        </View>
        <Text style={s.modeText}>{modeLabel}</Text>
        {state === 'checking' || reconnecting ? (
          <View style={s.loadingRow}>
            <ActivityIndicator color={colors.muted} size="small" />
            <Text style={s.loadingText}>{t('chat.status.connecting')}</Text>
          </View>
        ) : null}
      </View>

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
          <Pressable
            accessibilityRole="button"
            onPress={() => void retryOutbox()}
            style={s.retryBtn}
          >
            <Ionicons color={colors.error} name="alert-circle-outline" size={12} />
            <Text style={s.retryText}>{t('outbox.failed', { count: outboxFailedCount })}</Text>
            <Text style={s.retryAction}>{t('outbox.retry')}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  )
}

const s = StyleSheet.create({
  banner: {
    alignItems: 'center',
    borderColor: colors.borderMuted,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
    minHeight: 34,
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
  },
  loadingRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  loadingText: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '700',
  },
  modeIconWrap: {
    alignItems: 'center',
    borderRadius: 999,
    height: 22,
    justifyContent: 'center',
    width: 22,
  },
  modeRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 1,
    gap: 8,
  },
  modeText: {
    color: colors.text,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.2,
    textTransform: 'uppercase',
  },
  offlineBanner: {
    backgroundColor: 'rgba(248, 81, 73, 0.08)',
  },
  offlineIconWrap: {
    backgroundColor: 'rgba(248, 81, 73, 0.12)',
  },
  onlineBanner: {
    backgroundColor: 'rgba(88, 166, 255, 0.08)',
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
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  pendingText: {
    color: colors.warning,
    fontSize: 10,
    fontWeight: '800',
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
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  retryText: {
    color: colors.error,
    fontSize: 10,
    fontWeight: '800',
  },
  sendingPill: {
    alignItems: 'center',
    backgroundColor: 'rgba(88, 166, 255, 0.12)',
    borderRadius: 999,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  sendingText: {
    color: colors.accent,
    fontSize: 10,
    fontWeight: '800',
  },
})
