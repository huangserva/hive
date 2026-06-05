let uuidCounter = 0

export const createUuid = () => {
  const cryptoObj = globalThis.crypto
  const uuid = cryptoObj?.randomUUID?.()
  if (uuid) return uuid

  if (cryptoObj?.getRandomValues) {
    const bytes = cryptoObj.getRandomValues(new Uint8Array(16))
    bytes[6] = (bytes[6] & 0x0f) | 0x40
    bytes[8] = (bytes[8] & 0x3f) | 0x80
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  }

  return `uuid-${Date.now()}-${uuidCounter++}`
}
