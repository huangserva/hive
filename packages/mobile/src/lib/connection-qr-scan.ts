import type { BarcodeScanningResult } from 'expo-camera'

import { parseConnectionQr, type ParsedConnectionQr } from './connection-qr'

export const resolveConnectionQrFromScanResults = (
  results: BarcodeScanningResult[]
): ParsedConnectionQr | null => {
  for (const result of results) {
    const parsed = parseConnectionQr(result.data)
    if (parsed) return parsed
  }
  return null
}
