const normalizeBooleanFlag = (value) => value === true || value === '1' || value === 'true'

const resolveWebRtcAutolinkEnabled = (env = process.env) =>
  normalizeBooleanFlag(env.EXPO_PUBLIC_WEBRTC_NATIVE_REGISTER) ||
  normalizeBooleanFlag(env.WEBRTC_NATIVE_REGISTER)

const webRtcAutolinkEnabled = resolveWebRtcAutolinkEnabled()

module.exports = {
  dependencies: {
    'react-native-webrtc': webRtcAutolinkEnabled
      ? {}
      : {
          platforms: {
            android: null,
            ios: null,
          },
        },
  },
}
module.exports.resolveWebRtcAutolinkEnabled = resolveWebRtcAutolinkEnabled
