import type { ExpoConfig } from 'expo/config'

type ExpoConfigWithSplash = ExpoConfig & {
  splash?: {
    backgroundColor: string
    image: string
    resizeMode: 'contain' | 'cover' | 'native'
  }
}

const config: ExpoConfigWithSplash = {
  name: 'HippoTeam',
  slug: 'hippoteam',
  version: '0.1.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  scheme: 'hippoteam',
  userInterfaceStyle: 'automatic',
  ios: {
    bundleIdentifier: 'com.huangserva.hippoteam',
    infoPlist: {
      NSMicrophoneUsageDescription:
        'HippoTeam uses the microphone to turn voice commands into agent tasks.',
    },
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
    'expo-notifications',
    'expo-secure-store',
    [
      'expo-build-properties',
      {
        android: {
          usesCleartextTraffic: true,
        },
      },
    ],
  ],
  splash: {
    backgroundColor: '#0D1117',
    image: './assets/splash.png',
    resizeMode: 'contain',
  },
  web: {
    favicon: './assets/favicon.png',
  },
}

export default config
