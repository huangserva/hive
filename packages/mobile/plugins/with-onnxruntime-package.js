const { createRunOncePlugin, withMainApplication } = require('@expo/config-plugins')

const ONNXRUNTIME_IMPORT = 'import ai.onnxruntime.reactnative.OnnxruntimePackage'
const ONNXRUNTIME_PACKAGE_INSTANCE = 'add(OnnxruntimePackage())'

const addOnnxruntimePackageToMainApplication = (contents) => {
  let nextContents = contents

  if (!nextContents.includes(ONNXRUNTIME_IMPORT)) {
    nextContents = nextContents.replace(/(package\s+[\w.]+\s*\n)/, `$1\n${ONNXRUNTIME_IMPORT}\n`)
  }

  if (!nextContents.includes(ONNXRUNTIME_PACKAGE_INSTANCE)) {
    nextContents = nextContents.replace(
      /(PackageList\(this\)\.packages\.apply\s*\{\n)/,
      `$1          ${ONNXRUNTIME_PACKAGE_INSTANCE}\n`
    )
  }

  return nextContents
}

const withOnnxruntimePackage = (config) =>
  withMainApplication(config, (config) => {
    config.modResults.contents = addOnnxruntimePackageToMainApplication(config.modResults.contents)
    return config
  })

module.exports = createRunOncePlugin(withOnnxruntimePackage, 'with-onnxruntime-package', '1.0.0')
module.exports.addOnnxruntimePackageToMainApplication = addOnnxruntimePackageToMainApplication
