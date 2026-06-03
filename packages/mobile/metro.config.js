const { getDefaultConfig } = require('expo/metro-config')
const path = require('node:path')

const projectRoot = __dirname
const monorepoRoot = path.resolve(projectRoot, '../..')

const config = getDefaultConfig(projectRoot)

config.watchFolders = [monorepoRoot, path.resolve(monorepoRoot, 'packages/relay-crypto')]

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
]

config.resolver.extraNodeModules = {
  '@huangserva/hippoteam-relay-crypto': path.resolve(monorepoRoot, 'packages/relay-crypto'),
}

config.resolver.assetExts = [...new Set([...config.resolver.assetExts, 'onnx'])]

module.exports = config
