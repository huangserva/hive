import { Ionicons } from '@expo/vector-icons'
import { Tabs } from 'expo-router'
import type { ColorValue } from 'react-native'

const tabIcon =
  (name: keyof typeof Ionicons.glyphMap) =>
  ({ color, size }: { color: ColorValue; size: number }) => (
    <Ionicons color={String(color)} name={name} size={size} />
  )

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: '#0d1117' },
        headerTintColor: '#e6edf3',
        tabBarActiveTintColor: '#58a6ff',
        tabBarInactiveTintColor: '#8b949e',
        tabBarStyle: { backgroundColor: '#161b22', borderTopColor: '#30363d' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ tabBarIcon: tabIcon('speedometer-outline'), title: 'Dashboard' }}
      />
      <Tabs.Screen
        name="workers"
        options={{ tabBarIcon: tabIcon('people-outline'), title: 'Workers' }}
      />
      <Tabs.Screen
        name="tasks"
        options={{ tabBarIcon: tabIcon('checkbox-outline'), title: 'Tasks' }}
      />
      <Tabs.Screen
        name="settings"
        options={{ tabBarIcon: tabIcon('settings-outline'), title: 'Settings' }}
      />
    </Tabs>
  )
}
