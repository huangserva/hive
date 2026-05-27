import { Ionicons } from '@expo/vector-icons'
import { Tabs } from 'expo-router'
import type { ColorValue } from 'react-native'

import { colors } from '../../src/theme'

const tabIcon =
  (name: keyof typeof Ionicons.glyphMap) =>
  ({ color, size }: { color: ColorValue; size: number }) => (
    <Ionicons color={String(color)} name={name} size={size} />
  )

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '700' },
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopColor: colors.border,
          height: 68,
          paddingBottom: 10,
          paddingTop: 8,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ tabBarIcon: tabIcon('chatbubble-ellipses-outline'), title: 'Chat' }}
      />
      <Tabs.Screen
        name="workers"
        options={{ tabBarIcon: tabIcon('pulse-outline'), title: 'Status' }}
      />
      <Tabs.Screen
        name="tasks"
        options={{ href: null, tabBarIcon: tabIcon('checkbox-outline'), title: 'Tasks' }}
      />
      <Tabs.Screen
        name="settings"
        options={{ tabBarIcon: tabIcon('options-outline'), title: 'Settings' }}
      />
    </Tabs>
  )
}
