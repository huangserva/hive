import { createRelayServer } from './relay-server.js'

const parsePort = (value: string | undefined) => {
  const parsed = Number(value ?? '8787')
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65_535) {
    throw new Error(`Invalid PORT: ${value}`)
  }
  return parsed
}

const authToken = process.env.RELAY_AUTH_TOKEN
if (!authToken) {
  throw new Error('RELAY_AUTH_TOKEN is required')
}

// HOST 默认 127.0.0.1（推荐：让 Caddy/Nginx 反代到本地）。仅在没有反代、要直接
// 暴露 ws://IP:port 的降级场景才设 HOST=0.0.0.0（不推荐，无 TLS）。
const relay = createRelayServer({
  port: parsePort(process.env.PORT),
  ...(process.env.HOST ? { host: process.env.HOST } : {}),
  authToken,
})

await relay.ready
console.log(`HippoTeam relay listening on port ${relay.port}`)

const shutdown = async () => {
  await relay.close()
  process.exit(0)
}

process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
