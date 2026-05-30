import { Ionicons } from '@expo/vector-icons'
import type { ReactNode } from 'react'
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  type StyleProp,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native'

import { useT } from '../i18n'
import { colors, radius, spacing } from '../theme'

// cockpit 5 个标签页共用的滚动容器：
// - 首次加载（loading 且无数据）→ 居中转圈 + 文案，不空白。
// - 有数据后 refetch / 下拉 / 实时推送 → 顶部 RefreshControl 转圈，**保留旧数据**不清屏。
// - 刷新失败 → 顶部错误条「刷新失败，下拉重试」，旧数据仍在。
// - 下拉刷新 → RefreshControl 触发 onRefresh。
export function CockpitScroll({
  children,
  contentContainerStyle,
  error,
  loading,
  onRefresh,
  refreshing,
}: {
  children: ReactNode
  contentContainerStyle?: StyleProp<ViewStyle>
  error: string | null
  loading: boolean
  onRefresh: () => void
  refreshing: boolean
}) {
  const t = useT()

  if (loading) {
    return (
      <View style={s.loadingWrap}>
        <ActivityIndicator color={colors.accent} />
        <Text style={s.loadingText}>{t('cockpit.loading')}</Text>
      </View>
    )
  }

  return (
    <ScrollView
      contentContainerStyle={contentContainerStyle}
      refreshControl={
        <RefreshControl
          colors={[colors.accent]}
          onRefresh={onRefresh}
          refreshing={refreshing}
          tintColor={colors.accent}
        />
      }
      showsVerticalScrollIndicator={false}
      style={s.scroll}
    >
      {error ? (
        <View style={s.errorBanner}>
          <Ionicons color={colors.warning} name="cloud-offline-outline" size={16} />
          <Text style={s.errorText}>{t('cockpit.refreshFailed')}</Text>
        </View>
      ) : null}
      {children}
    </ScrollView>
  )
}

const s = StyleSheet.create({
  errorBanner: {
    alignItems: 'center',
    backgroundColor: colors.warningSoft,
    borderColor: colors.warning,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    marginBottom: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  errorText: { color: colors.warning, flex: 1, fontSize: 12, fontWeight: '700' },
  loadingText: { color: colors.muted, fontSize: 13, marginTop: spacing.sm },
  loadingWrap: { alignItems: 'center', flex: 1, justifyContent: 'center', paddingTop: 60 },
  scroll: { flex: 1 },
})
