import { Ionicons } from '@expo/vector-icons'
import { Tabs } from 'expo-router'
import { type ColorValue, View } from 'react-native'

import { useT } from '../../src/i18n'
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
        marginBottom: 4,
        width: 34,
      }}
    >
      <Ionicons color={focused ? colors.text : String(color)} name={name} size={size} />
    </View>
  )

export default function TabsLayout() {
  const t = useT()
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
        options={{ tabBarIcon: tabIcon('chatbubble-ellipses-outline'), title: t('tabs.chat') }}
      />
      <Tabs.Screen
        name="workers"
        options={{ tabBarIcon: tabIcon('pulse-outline'), title: t('tabs.status') }}
      />
      <Tabs.Screen
        name="talk"
        options={{ tabBarIcon: tabIcon('mic-outline'), title: t('tabs.talk') }}
      />
      <Tabs.Screen
        name="cockpit"
        options={{ tabBarIcon: tabIcon('grid-outline'), title: t('tabs.cockpit') }}
      />
      <Tabs.Screen
        name="settings"
        options={{ tabBarIcon: tabIcon('settings-outline'), title: t('tabs.settings') }}
      />
    </Tabs>
  )
}
