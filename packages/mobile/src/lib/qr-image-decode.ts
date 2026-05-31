// 从相册图片解二维码 —— 纯 JS 路径，绕开 expo-camera 的 scanFromURLAsync（安卓上不靠谱）。
// 关键：jsQR + upng-js 全是纯 JS，不依赖任何原生/Google 服务，华为无 GMS 机也能跑
// （已证实：华为相机实时扫能用 = 解码引擎本就不靠 GMS，问题只在 scanFromURLAsync 这个接口）。
import jsQR from 'jsqr'
import UPNG from 'upng-js'

import { type ParsedConnectionQr, parseConnectionQr } from './connection-qr'

export interface RgbaImage {
  data: Uint8ClampedArray
  height: number
  width: number
}

const stripDataUriPrefix = (base64: string): string => {
  if (!base64.startsWith('data:')) return base64
  const comma = base64.indexOf(',')
  return comma >= 0 ? base64.slice(comma + 1) : base64
}

// base64 → 字节。atob 在 Node 16+ 与 Hermes(RN 0.85) 均为全局，跨环境可用。
const base64ToBytes = (base64: string): Uint8Array => {
  const binary = atob(stripDataUriPrefix(base64))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

// base64 PNG → RGBA 像素（upng 纯 JS 解码）。失败返回 null（不抛）。
export const rgbaFromPngBase64 = (base64: string): RgbaImage | null => {
  try {
    const bytes = base64ToBytes(base64)
    if (bytes.length === 0) return null
    const png = UPNG.decode(bytes.buffer)
    const frames = UPNG.toRGBA8(png)
    const first = frames[0]
    if (!first || png.width <= 0 || png.height <= 0) return null
    return { data: new Uint8ClampedArray(first), height: png.height, width: png.width }
  } catch {
    return null
  }
}

// RGBA 像素 → 二维码文本内容（jsQR）。没解出码返回 null。
export const decodeQrTextFromRgba = (image: RgbaImage): string | null => {
  if (image.width <= 0 || image.height <= 0) return null
  if (image.data.length < image.width * image.height * 4) return null
  const result = jsQR(image.data, image.width, image.height)
  const text = result?.data
  return typeof text === 'string' && text.length > 0 ? text : null
}

// RGBA 像素 → 解析后的连接配置（复用现有 parseConnectionQr 录入逻辑）。
// 返回 null 的两种情况：图里没二维码，或二维码不是合法连接配置。
export const decodeConnectionQrFromRgba = (image: RgbaImage): ParsedConnectionQr | null => {
  const text = decodeQrTextFromRgba(image)
  return text === null ? null : parseConnectionQr(text)
}

// 区分相册解码的四种结局，让 UI 能给不同提示（不再全部笼统报"未找到二维码"）：
// - ok：解出合法连接配置
// - decode-failed：图片本身解不开（PNG/base64 坏）
// - no-qr：图能解，但里面没有二维码
// - not-connection：有二维码，但不是 HippoTeam 连接配置
export type QrDecodeOutcome =
  | { payload: ParsedConnectionQr; status: 'ok' }
  | { status: 'decode-failed' }
  | { status: 'no-qr' }
  | { status: 'not-connection' }

// 顶层入口（带分类结局）：settings.tsx 拿 image-manipulator 的 base64 PNG 喂这里。全程纯 JS。
export const decodeConnectionQrOutcomeFromPngBase64 = (base64: string): QrDecodeOutcome => {
  const image = rgbaFromPngBase64(base64)
  if (image === null) return { status: 'decode-failed' }
  const text = decodeQrTextFromRgba(image)
  if (text === null) return { status: 'no-qr' }
  const payload = parseConnectionQr(text)
  if (payload === null) return { status: 'not-connection' }
  return { payload, status: 'ok' }
}

// 顶层入口（仅成功才回 payload）：保留旧签名，内部走分类结局。
export const decodeConnectionQrFromPngBase64 = (base64: string): ParsedConnectionQr | null => {
  const outcome = decodeConnectionQrOutcomeFromPngBase64(base64)
  return outcome.status === 'ok' ? outcome.payload : null
}
