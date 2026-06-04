import { describe, expect, test } from 'vitest'

const {
  addWebRtcDependencyToAppBuildGradle,
  addWebRtcPackageToMainApplication,
  addWebRtcProjectToSettingsGradle,
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

describe('with-webrtc-package config plugin', () => {
  test('adds WebRTC import and package registration to MainApplication.kt', () => {
    const result = addWebRtcPackageToMainApplication(mainApplication)

    expect(result).toContain('import com.oney.WebRTCModule.WebRTCModulePackage')
    expect(result).toContain('add(WebRTCModulePackage())')
    expect(result.indexOf('add(WebRTCModulePackage())')).toBeGreaterThan(
      result.indexOf('PackageList(this).packages.apply {')
    )
  })

  test('is idempotent when prebuild runs more than once', () => {
    const once = addWebRtcPackageToMainApplication(mainApplication)
    const twice = addWebRtcPackageToMainApplication(once)

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
})
