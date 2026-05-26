declare const process:
  | {
      env?: Record<string, string | undefined>
    }
  | undefined

const env = typeof process === 'undefined' ? undefined : process.env

export const config = {
  defaultLanPort: 4010,
  relayUrl: env?.EXPO_PUBLIC_RELAY_URL ?? null,
  version: '0.1.0',
}
