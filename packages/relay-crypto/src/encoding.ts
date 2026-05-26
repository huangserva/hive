export const encodeBase64 = (bytes: Uint8Array): string => {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i] as number)
  }
  return btoa(binary)
}

export const decodeBase64 = (str: string): Uint8Array => {
  const binary = atob(str)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

export const encodeJson = (obj: unknown): Uint8Array => textEncoder.encode(JSON.stringify(obj))

export const decodeJson = (bytes: Uint8Array): unknown => JSON.parse(textDecoder.decode(bytes))
