import { deriveRoomAuthToken, generateRelaySecrets } from './keygen.js'

// 生成一套 relay 部署用的密钥/标识，打印成可直接复制的形式。
// 用法：node dist/src/keygen-cli.js
const secrets = generateRelaySecrets()

console.log('# HippoTeam relay secrets — 生成于本机，请妥善保存')
console.log('#')
console.log('# 1) VPS relay 服务器 env（systemd / shell）：')
console.log(`RELAY_AUTH_TOKEN=${secrets.authToken}`)
console.log('#')
console.log('# 2) Mac runtime 的 ~/.config/hive/relay.json（auth_token 必须与上面一致）：')
console.log(
  JSON.stringify(
    {
      enabled: true,
      relay_url: 'wss://relay.yunzhong2020.com',
      relay_auth_token: secrets.authToken,
      relay_protocol_version: 2,
      room_auth_token: deriveRoomAuthToken(secrets.authToken, secrets.roomId),
      room_id: secrets.roomId,
      runtime_id: secrets.runtimeId,
    },
    null,
    2
  )
)
console.log('#')
console.log(
  '# relay_url 默认指向 relay.yunzhong2020.com；如部署到其他域名，再改成对应 wss://<domain>。'
)
console.log(
  '# daemon 密钥对由 runtime 首次启动时自动生成到 ~/.config/hive/relay-keypair.json，无需手动。'
)
