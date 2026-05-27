import { StyleSheet, Text, View } from 'react-native'

import { colors } from '../theme'

const statusColors: Record<string, string> = {
  idle: colors.success,
  stopped: colors.error,
  working: colors.warning,
}

export const statusColor = (status: string) => statusColors[status] ?? colors.muted

export const StatusBadge = ({ status }: { status: string }) => (
  <View style={[styles.badge, { borderColor: statusColor(status) }]}>
    <View style={[styles.dot, { backgroundColor: statusColor(status) }]} />
    <Text style={styles.text}>{status}</Text>
  </View>
)

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  dot: {
    borderRadius: 999,
    height: 7,
    width: 7,
  },
  text: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
})
