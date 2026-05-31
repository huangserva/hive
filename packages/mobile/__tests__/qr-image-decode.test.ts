import QRCode from 'qrcode'
import UPNG from 'upng-js'
import { describe, expect, it } from 'vitest'

import {
  decodeConnectionQrFromPngBase64,
  decodeConnectionQrFromRgba,
  decodeConnectionQrOutcomeFromPngBase64,
  decodeQrTextFromRgba,
  rgbaFromPngBase64,
} from '../src/lib/qr-image-decode'

// 一张可正常解码、但里面没有二维码的纯白 PNG —— 用于 no-qr 结局。
const blankPngBase64 = (): string => {
  const width = 80
  const height = 80
  const rgba = new Uint8Array(width * height * 4).fill(255)
  const png = UPNG.encode([rgba.buffer], width, height, 0)
  return Buffer.from(new Uint8Array(png)).toString('base64')
}

// 用 qrcode 真生成一张二维码 PNG（base64），全程纯 JS 解码（upng + jsQR），
// 这正是华为机相册路径要走的链路；测它能解出预期内容 = 根治 scanFromURLAsync。
const qrPngBase64 = async (text: string): Promise<string> => {
  const buffer = await QRCode.toBuffer(text, { errorCorrectionLevel: 'M', margin: 2, scale: 6 })
  return buffer.toString('base64')
}

const whiteRgba = (width: number, height: number) => ({
  data: new Uint8ClampedArray(width * height * 4).fill(255),
  height,
  width,
})

describe('qr-image-decode (pure, no native / no GMS)', () => {
  it('decodes a LAN connection QR (host+token) from a generated PNG', async () => {
    const base64 = await qrPngBase64(
      JSON.stringify({ host: '192.168.1.50:4010', token: 'tok_abc123XYZ' })
    )
    const payload = decodeConnectionQrFromPngBase64(base64)
    expect(payload).toEqual({ host: '192.168.1.50:4010', token: 'tok_abc123XYZ' })
  })

  it('decodes a relay-bearing connection QR from a generated PNG', async () => {
    const base64 = await qrPngBase64(
      JSON.stringify({
        daemon_public_key: 'pk_daemon',
        device_id: 'dev_1',
        host: '10.0.0.2:4010',
        relay_auth_token: 'ra_tok',
        relay_url: 'wss://relay.example/ws',
        room_id: 'room_42',
        token: 'tok_999',
      })
    )
    const payload = decodeConnectionQrFromPngBase64(base64)
    expect(payload?.host).toBe('10.0.0.2:4010')
    expect(payload?.token).toBe('tok_999')
    expect(payload?.relay).toMatchObject({
      daemon_public_key: 'pk_daemon',
      device_id: 'dev_1',
      relay_auth_token: 'ra_tok',
      relay_url: 'wss://relay.example/ws',
      room_id: 'room_42',
    })
  })

  it('reads raw QR text but rejects a non-connection QR as a connection payload', async () => {
    const image = rgbaFromPngBase64(await qrPngBase64('just some text, not a connection'))
    expect(image).not.toBeNull()
    if (!image) return
    // jsQR 解得出文本……
    expect(decodeQrTextFromRgba(image)).toBe('just some text, not a connection')
    // ……但 parseConnectionQr 不认 → 顶层返回 null（这才弹"未找到二维码"）。
    expect(decodeConnectionQrFromRgba(image)).toBeNull()
  })

  it('returns null when the image has no QR code at all (real "未找到" path)', () => {
    expect(decodeQrTextFromRgba(whiteRgba(64, 64))).toBeNull()
    expect(decodeConnectionQrFromRgba(whiteRgba(64, 64))).toBeNull()
  })

  it('degrades gracefully on garbage / non-PNG base64 instead of throwing', () => {
    expect(rgbaFromPngBase64('not-a-real-png-base64')).toBeNull()
    expect(rgbaFromPngBase64('')).toBeNull()
    expect(decodeConnectionQrFromPngBase64('garbage')).toBeNull()
  })

  it('rejects an RGBA buffer smaller than width*height*4 (defensive)', () => {
    expect(
      decodeQrTextFromRgba({ data: new Uint8ClampedArray(10), height: 64, width: 64 })
    ).toBeNull()
  })

  describe('outcome split (#23: distinct failure states, not one blanket "no QR")', () => {
    it('ok → returns the parsed connection payload', async () => {
      const base64 = await qrPngBase64(JSON.stringify({ host: '1.2.3.4:4010', token: 'tok_ok' }))
      const outcome = decodeConnectionQrOutcomeFromPngBase64(base64)
      expect(outcome.status).toBe('ok')
      if (outcome.status === 'ok') {
        expect(outcome.payload).toEqual({ host: '1.2.3.4:4010', token: 'tok_ok' })
      }
    })

    it('not-connection → a real QR that is not a HippoTeam connection code', async () => {
      const base64 = await qrPngBase64('https://example.com/not-a-connection')
      expect(decodeConnectionQrOutcomeFromPngBase64(base64).status).toBe('not-connection')
    })

    it('no-qr → a decodable image with no QR code in it', () => {
      expect(decodeConnectionQrOutcomeFromPngBase64(blankPngBase64()).status).toBe('no-qr')
    })

    it('decode-failed → the image bytes cannot be decoded at all', () => {
      expect(decodeConnectionQrOutcomeFromPngBase64('not-a-real-png').status).toBe('decode-failed')
    })
  })
})
