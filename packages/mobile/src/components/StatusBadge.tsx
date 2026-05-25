import { StyleSheet, Text, View } from 'react-native'

const statusColors: Record<string, string> = {
  idle: '#3fb950',
  stopped: '#ff7b72',
  working: '#d29922',
}

export const statusColor = (status: string) => statusColors[status] ?? '#8b949e'

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
    color: '#e6edf3',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
})
