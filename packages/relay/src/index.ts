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

const relay = createRelayServer({
  port: parsePort(process.env.PORT),
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
