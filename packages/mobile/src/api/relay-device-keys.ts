import { encodeBase64, generateKeyPair } from '@huangserva/hippoteam-relay-crypto'

export interface RelayDeviceKeypair {
  publicKey: string
  secretKey: string
}

// 生成一对 NaCl box 设备密钥（base64）供 relay-transport 握手用。
// 注意：当前握手是 ephemeral DH，长期密钥值本身不参与信道派生，但 RelayTransportConfig
// 仍要求一对合法 keypair（decodeKeyPair 会解码它），故设备侧必须持有一对。
export const generateDeviceKeypair = (): RelayDeviceKeypair => {
  const pair = generateKeyPair()
  return {
    publicKey: encodeBase64(pair.publicKey),
    secretKey: encodeBase64(pair.secretKey),
  }
}
