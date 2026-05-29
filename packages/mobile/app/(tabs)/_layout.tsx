import { Ionicons } from '@expo/vector-icons'
import { Tabs } from 'expo-router'
import { type ColorValue, View } from 'react-native'

import { colors } from '../../src/theme'

const tabIcon =
  (name: keyof typeof Ionicons.glyphMap) =>
  ({ color, focused, size }: { color: ColorValue; focused: boolean; size: number }) => (
    <View
      style={{
        alignItems: 'center',
        backgroundColor: focused ? colors.accent : 'transparent',
        borderRadius: 10,
        height: 34,
        justifyContent: 'center',
        width: 34,
      }}
    >
      <Ionicons color={focused ? colors.text : String(color)} name={name} size={size} />
    </View>
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
          backgroundColor: colors.background,
          borderTopColor: colors.border,
          height: 78,
          paddingBottom: 14,
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
        name="cockpit"
        options={{ tabBarIcon: tabIcon('grid-outline'), title: 'Cockpit' }}
      />
      <Tabs.Screen
        name="settings"
        options={{ tabBarIcon: tabIcon('settings-outline'), title: 'Settings' }}
      />
    </Tabs>
  )
}
