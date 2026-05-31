// upng-js 不带类型声明，这里只声明本项目用到的最小 surface（纯 JS PNG 编解码）。
declare module 'upng-js' {
  interface UPNGImage {
    ctype: number
    data: Uint8Array
    depth: number
    frames: unknown[]
    height: number
    tabs: Record<string, unknown>
    width: number
  }
  const UPNG: {
    decode(buffer: ArrayBufferLike): UPNGImage
    // 返回每帧 RGBA8 像素的 ArrayBuffer（静态图取 [0]）。
    toRGBA8(img: UPNGImage): ArrayBuffer[]
    // cnum=0 → 无损 truecolor。仅测试用（造无码 PNG fixture）。
    encode(imgs: ArrayBufferLike[], width: number, height: number, cnum: number): ArrayBuffer
  }
  export default UPNG
}
