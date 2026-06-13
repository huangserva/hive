import { execSync } from 'node:child_process'

import type { ExpoConfig } from 'expo/config'

type ExpoConfigWithSplash = ExpoConfig & {
  autolinking?: {
    exclude?: string[]
  }
  splash?: {
    backgroundColor: string
    image: string
    resizeMode: 'contain' | 'cover' | 'native'
  }
}

const normalizeBooleanFlag = (value: unknown) => value === true || value === '1' || value === 'true'
const webRtcNativeRegistrationEnabled =
  normalizeBooleanFlag(process.env.EXPO_PUBLIC_WEBRTC_NATIVE_REGISTER) ||
  normalizeBooleanFlag(process.env.WEBRTC_NATIVE_REGISTER)

const getBuildSha = () => {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
}

const buildTime = new Date()
const buildSha = getBuildSha()
const androidVersionCode = Math.floor(buildTime.getTime() / 60_000)

const config: ExpoConfigWithSplash = {
  name: 'HippoTeam',
  slug: 'hippoteam',
  version: '2.8.17',
  autolinking: webRtcNativeRegistrationEnabled
    ? {}
    : {
        exclude: ['react-native-webrtc'],
      },
  orientation: 'portrait',
  icon: './assets/icon.png',
  scheme: 'hippoteam',
  userInterfaceStyle: 'automatic',
  ios: {
    bundleIdentifier: 'com.huangserva.hippoteam',
    infoPlist: {
      NSCameraUsageDescription: 'HippoTeam uses the camera to scan desktop connection QR codes.',
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
    softwareKeyboardLayoutMode: 'resize',
    versionCode: androidVersionCode,
  },
  plugins: [
    'expo-router',
    'expo-localization',
    'expo-notifications',
    [
      'expo-audio',
      {
        microphonePermission:
          'HippoTeam uses the microphone to turn voice commands into agent tasks.',
      },
    ],
    [
      'expo-camera',
      {
        cameraPermission: 'HippoTeam uses the camera to scan desktop connection QR codes.',
      },
    ],
    'expo-secure-store',
    [
      'expo-image-picker',
      {
        photosPermission: 'HippoTeam needs access to your photos to send images in chat.',
        cameraPermission: 'HippoTeam needs access to your camera to take photos.',
      },
    ],
    'expo-video',
    [
      'expo-build-properties',
      {
        android: {
          usesCleartextTraffic: true,
        },
      },
    ],
    './plugins/with-onnxruntime-package',
    [
      './plugins/with-webrtc-package',
      {
        registerNativeModule:
          process.env.EXPO_PUBLIC_WEBRTC_NATIVE_REGISTER ?? process.env.WEBRTC_NATIVE_REGISTER,
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
  extra: {
    buildSha,
    buildTime: buildTime.toISOString(),
    neuralVadPcmProbe:
      process.env.EXPO_PUBLIC_NEURAL_VAD_PCM_PROBE ?? process.env.NEURAL_VAD_PCM_PROBE,
    neuralVadShadow: process.env.EXPO_PUBLIC_NEURAL_VAD_SHADOW ?? process.env.NEURAL_VAD_SHADOW,
    webRtcProbe: process.env.EXPO_PUBLIC_WEBRTC_PROBE ?? process.env.WEBRTC_PROBE,
    webRtcNativeRegister:
      process.env.EXPO_PUBLIC_WEBRTC_NATIVE_REGISTER ?? process.env.WEBRTC_NATIVE_REGISTER,
    webRtcForceRelay: process.env.EXPO_PUBLIC_WEBRTC_FORCE_RELAY ?? process.env.WEBRTC_FORCE_RELAY,
    webRtcAudioRoute: process.env.EXPO_PUBLIC_WEBRTC_AUDIO_ROUTE ?? process.env.WEBRTC_AUDIO_ROUTE,
    webRtcDownlinkMode:
      process.env.EXPO_PUBLIC_WEBRTC_DOWNLINK_MODE ?? process.env.WEBRTC_DOWNLINK_MODE,
    eas: {
      projectId: '9fc7ebf2-5db2-4c6e-8bc4-c57b2d9f2873',
    },
  },
}

export default config
