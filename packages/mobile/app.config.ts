import type { ExpoConfig } from 'expo/config'

const config: ExpoConfig = {
  name: 'HippoTeam',
  slug: 'hippoteam-mobile',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  scheme: 'hippoteam',
  userInterfaceStyle: 'automatic',
  ios: {
    bundleIdentifier: 'com.huangserva.hippoteam',
    supportsTablet: true,
  },
  android: {
    adaptiveIcon: {
      backgroundColor: '#E6F4FE',
      backgroundImage: './assets/android-icon-background.png',
      foregroundImage: './assets/android-icon-foreground.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    package: 'com.huangserva.hippoteam',
    predictiveBackGestureEnabled: false,
  },
  plugins: [
    'expo-router',
    [
      'expo-build-properties',
      {
        android: {
          usesCleartextTraffic: true,
        },
      },
    ],
  ],
  web: {
    favicon: './assets/favicon.png',
  },
}

export default config
