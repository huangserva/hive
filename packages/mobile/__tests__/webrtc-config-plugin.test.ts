import { describe, expect, test } from 'vitest'

const {
  addWebRtcDependencyToAppBuildGradle,
  addWebRtcPackageToMainApplication,
  addWebRtcProjectToSettingsGradle,
  removeWebRtcDependencyFromAppBuildGradle,
  removeWebRtcProjectFromSettingsGradle,
  resolveWebRtcNativeRegistrationEnabled,
} = require('../plugins/with-webrtc-package')

const mainApplication = `package com.huangserva.hippoteam

import android.app.Application
import android.content.res.Configuration

import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.ReactPackage
import com.facebook.react.ReactHost

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    ExpoReactHostFactory.getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          // Packages that cannot be autolinked yet can be added manually here, for example:
          // add(MyReactNativePackage())
        }
    )
  }
}
`

const settingsGradle = `include ':app'
`

const appBuildGradle = `android {
}

dependencies {
    implementation("com.facebook.react:react-android")
}
`

const registeredSettingsGradle = addWebRtcProjectToSettingsGradle(settingsGradle)
const registeredAppBuildGradle = addWebRtcDependencyToAppBuildGradle(appBuildGradle)

const registeredMainApplication = addWebRtcPackageToMainApplication(mainApplication, {
  registerNativeModule: true,
})

describe('with-webrtc-package config plugin', () => {
  test('enables native registration from explicit build env flags only for experiment builds', () => {
    expect(
      resolveWebRtcNativeRegistrationEnabled(
        {},
        { EXPO_PUBLIC_WEBRTC_NATIVE_REGISTER: undefined, WEBRTC_NATIVE_REGISTER: undefined }
      )
    ).toBe(false)
    expect(
      resolveWebRtcNativeRegistrationEnabled(
        {},
        { EXPO_PUBLIC_WEBRTC_NATIVE_REGISTER: '1', WEBRTC_NATIVE_REGISTER: undefined }
      )
    ).toBe(true)
    expect(
      resolveWebRtcNativeRegistrationEnabled(
        {},
        { EXPO_PUBLIC_WEBRTC_NATIVE_REGISTER: undefined, WEBRTC_NATIVE_REGISTER: 'true' }
      )
    ).toBe(true)
  })

  test('does not register WebRTCModulePackage by default so app startup does not initialize WebRTC audio', () => {
    const result = addWebRtcPackageToMainApplication(mainApplication)

    expect(result).not.toContain('import com.oney.WebRTCModule.WebRTCModulePackage')
    expect(result).not.toContain('add(WebRTCModulePackage())')
  })

  test('removes a stale WebRTCModulePackage registration when native registration is disabled', () => {
    const result = addWebRtcPackageToMainApplication(registeredMainApplication)

    expect(result).not.toContain('import com.oney.WebRTCModule.WebRTCModulePackage')
    expect(result).not.toContain('add(WebRTCModulePackage())')
  })

  test('adds WebRTC import and package registration only when explicitly enabled', () => {
    const result = addWebRtcPackageToMainApplication(mainApplication, {
      registerNativeModule: true,
    })

    expect(result).toContain('import com.oney.WebRTCModule.WebRTCModulePackage')
    expect(result).toContain('add(WebRTCModulePackage())')
    expect(result.indexOf('add(WebRTCModulePackage())')).toBeGreaterThan(
      result.indexOf('PackageList(this).packages.apply {')
    )
  })

  test('is idempotent when prebuild runs more than once', () => {
    const once = addWebRtcPackageToMainApplication(mainApplication, { registerNativeModule: true })
    const twice = addWebRtcPackageToMainApplication(once, { registerNativeModule: true })

    expect(twice.match(/import com\.oney\.WebRTCModule\.WebRTCModulePackage/g)).toHaveLength(1)
    expect(twice.match(/add\(WebRTCModulePackage\(\)\)/g)).toHaveLength(1)
  })

  test('adds Android project include and app dependency', () => {
    const settings = addWebRtcProjectToSettingsGradle(settingsGradle)
    const buildGradle = addWebRtcDependencyToAppBuildGradle(appBuildGradle)

    expect(settings).toContain("include ':react-native-webrtc'")
    expect(settings).toContain(
      "project(':react-native-webrtc').projectDir = new File(rootProject.projectDir, '../../../node_modules/react-native-webrtc/android')"
    )
    expect(buildGradle).toContain("implementation project(':react-native-webrtc')")
  })

  test('removes Android project include and app dependency when native registration is disabled', () => {
    const settings = removeWebRtcProjectFromSettingsGradle(registeredSettingsGradle)
    const buildGradle = removeWebRtcDependencyFromAppBuildGradle(registeredAppBuildGradle)

    expect(settings).not.toContain("include ':react-native-webrtc'")
    expect(settings).not.toContain('react-native-webrtc/android')
    expect(buildGradle).not.toContain("implementation project(':react-native-webrtc')")
  })
})
