import { describe, expect, test } from 'vitest'

const { addOnnxruntimePackageToMainApplication } = require('../plugins/with-onnxruntime-package')

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

describe('with-onnxruntime-package config plugin', () => {
  test('adds OnnxruntimePackage import and package registration to MainApplication.kt', () => {
    const result = addOnnxruntimePackageToMainApplication(mainApplication)

    expect(result).toContain('import ai.onnxruntime.reactnative.OnnxruntimePackage')
    expect(result).toContain('add(OnnxruntimePackage())')
    expect(result.indexOf('add(OnnxruntimePackage())')).toBeGreaterThan(
      result.indexOf('PackageList(this).packages.apply {')
    )
  })

  test('is idempotent when prebuild runs more than once', () => {
    const once = addOnnxruntimePackageToMainApplication(mainApplication)
    const twice = addOnnxruntimePackageToMainApplication(once)

    expect(twice.match(/import ai\.onnxruntime\.reactnative\.OnnxruntimePackage/g)).toHaveLength(1)
    expect(twice.match(/add\(OnnxruntimePackage\(\)\)/g)).toHaveLength(1)
  })
})
