const {
  createRunOncePlugin,
  withAppBuildGradle,
  withMainApplication,
  withSettingsGradle,
} = require('@expo/config-plugins')

const WEBRTC_IMPORT = 'import com.oney.WebRTCModule.WebRTCModulePackage'
const WEBRTC_PACKAGE_INSTANCE = 'add(WebRTCModulePackage())'
const WEBRTC_PROJECT_INCLUDE = "include ':react-native-webrtc'"
const WEBRTC_PROJECT_DIR =
  "project(':react-native-webrtc').projectDir = new File(rootProject.projectDir, '../../../node_modules/react-native-webrtc/android')"
const WEBRTC_APP_DEPENDENCY = "implementation project(':react-native-webrtc')"

const normalizeBooleanFlag = (value) => value === true || value === '1' || value === 'true'

const resolveWebRtcNativeRegistrationEnabled = (options = {}, env = process.env) =>
  normalizeBooleanFlag(options.registerNativeModule) ||
  normalizeBooleanFlag(env.EXPO_PUBLIC_WEBRTC_NATIVE_REGISTER) ||
  normalizeBooleanFlag(env.WEBRTC_NATIVE_REGISTER)

const removeWebRtcPackageFromMainApplication = (contents) =>
  contents
    .replace(
      new RegExp(`\\n?${WEBRTC_IMPORT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n?`, 'g'),
      '\n'
    )
    .replace(/\n\s*add\(WebRTCModulePackage\(\)\)\n/g, '\n')

const addWebRtcPackageToMainApplication = (contents, options = {}) => {
  if (!resolveWebRtcNativeRegistrationEnabled(options)) {
    return removeWebRtcPackageFromMainApplication(contents)
  }

  let nextContents = contents

  if (!nextContents.includes(WEBRTC_IMPORT)) {
    nextContents = nextContents.replace(/(package\s+[\w.]+\s*\n)/, `$1\n${WEBRTC_IMPORT}\n`)
  }

  if (!nextContents.includes(WEBRTC_PACKAGE_INSTANCE)) {
    nextContents = nextContents.replace(
      /(PackageList\(this\)\.packages\.apply\s*\{\n)/,
      `$1          ${WEBRTC_PACKAGE_INSTANCE}\n`
    )
  }

  return nextContents
}

const addWebRtcProjectToSettingsGradle = (contents) => {
  let nextContents = contents
  if (!nextContents.includes(WEBRTC_PROJECT_INCLUDE)) {
    nextContents = `${nextContents.trimEnd()}\n\n${WEBRTC_PROJECT_INCLUDE}\n`
  }
  if (!nextContents.includes(WEBRTC_PROJECT_DIR)) {
    nextContents = `${nextContents.trimEnd()}\n${WEBRTC_PROJECT_DIR}\n`
  }
  return nextContents
}

const removeWebRtcProjectFromSettingsGradle = (contents) =>
  contents
    .replace(
      new RegExp(`\\n?${WEBRTC_PROJECT_INCLUDE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g'),
      ''
    )
    .replace(
      new RegExp(`\\n?${WEBRTC_PROJECT_DIR.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g'),
      ''
    )

const addWebRtcDependencyToAppBuildGradle = (contents) => {
  if (contents.includes(WEBRTC_APP_DEPENDENCY)) return contents
  return contents.replace(/(dependencies\s*\{\n)/, `$1    ${WEBRTC_APP_DEPENDENCY}\n`)
}

const removeWebRtcDependencyFromAppBuildGradle = (contents) =>
  contents.replace(
    new RegExp(`\\n\\s*${WEBRTC_APP_DEPENDENCY.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g'),
    ''
  )

const withWebRtcPackage = (config, options = {}) => {
  const shouldRegisterNativeModule = resolveWebRtcNativeRegistrationEnabled(options)

  config = withMainApplication(config, (config) => {
    config.modResults.contents = addWebRtcPackageToMainApplication(
      config.modResults.contents,
      options
    )
    return config
  })

  config = withSettingsGradle(config, (config) => {
    config.modResults.contents = shouldRegisterNativeModule
      ? addWebRtcProjectToSettingsGradle(config.modResults.contents)
      : removeWebRtcProjectFromSettingsGradle(config.modResults.contents)
    return config
  })

  return withAppBuildGradle(config, (config) => {
    config.modResults.contents = shouldRegisterNativeModule
      ? addWebRtcDependencyToAppBuildGradle(config.modResults.contents)
      : removeWebRtcDependencyFromAppBuildGradle(config.modResults.contents)
    return config
  })
}

module.exports = createRunOncePlugin(withWebRtcPackage, 'with-webrtc-package', '1.0.0')
module.exports.addWebRtcDependencyToAppBuildGradle = addWebRtcDependencyToAppBuildGradle
module.exports.addWebRtcPackageToMainApplication = addWebRtcPackageToMainApplication
module.exports.addWebRtcProjectToSettingsGradle = addWebRtcProjectToSettingsGradle
module.exports.removeWebRtcDependencyFromAppBuildGradle = removeWebRtcDependencyFromAppBuildGradle
module.exports.removeWebRtcProjectFromSettingsGradle = removeWebRtcProjectFromSettingsGradle
module.exports.resolveWebRtcNativeRegistrationEnabled = resolveWebRtcNativeRegistrationEnabled
