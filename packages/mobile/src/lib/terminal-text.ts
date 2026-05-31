// 终端文本清理 —— 把服务端 headless-xterm 序列化出的「带 ANSI 的渲染快照」清成可读纯文本。
// 服务端只 strip 了 CSI（颜色/光标），残留 OSC / 字符集 / 控制字符 + 窄屏 reflow 会让手机端
// 看着错位吞字。这里做一层防御性清理（纯函数，可测）：去转义序列 + 控制字符 + 解 \r 覆盖。
// 不追求完整终端模拟，只求「明显更干净」。正则用 fromCharCode 拼，避免在源码里写裸控制字符。

const ESC = String.fromCharCode(0x1b)
const BEL = String.fromCharCode(0x07)

// OSC：ESC ] ... 以 BEL 或 ST(ESC \) 结尾（标题、超链接等）。先于其它处理，因其内部含 [ ] 等。
const OSC_PATTERN = new RegExp(`${ESC}\\][^${BEL}]*(?:${BEL}|${ESC}\\\\)`, 'g')
// CSI：ESC [ 参数 中间字节 终结字节（颜色、光标移动、清屏…）。服务端已 strip 大部分，这里兜底。
const CSI_PATTERN = new RegExp(`${ESC}\\[[0-9;?<>=!]*[ -/]*[@-~]`, 'g')
// 其余短转义：ESC + 可选中间字节 + 终结字节（字符集设计 ESC(B、reset ESC c、ESC 7/8 等）。
const SHORT_ESC_PATTERN = new RegExp(`${ESC}[ -/]*[0-~]`, 'g')
// 任何残留的孤立 ESC。
const LONE_ESC_PATTERN = new RegExp(ESC, 'g')
// 控制字符（保留 \t=0x09）：0x00-0x08、0x0B-0x1F、0x7F。
const CONTROL_PATTERN = new RegExp(
  `[${String.fromCharCode(0)}-${String.fromCharCode(8)}${String.fromCharCode(11)}-${String.fromCharCode(0x1f)}${String.fromCharCode(0x7f)}]`,
  'g'
)

// 单行清理：先解 \r 覆盖（终端只显示最后一次 \r 之后的内容），再去转义/控制字符，去尾随空白。
export const sanitizeTerminalLine = (line: string): string => {
  let value = line
  if (value.includes('\r')) {
    const segments = value.split('\r')
    value = segments[segments.length - 1] ?? value
  }
  value = value
    .replace(OSC_PATTERN, '')
    .replace(CSI_PATTERN, '')
    .replace(SHORT_ESC_PATTERN, '')
    .replace(LONE_ESC_PATTERN, '')
    .replace(CONTROL_PATTERN, '')
  return value.replace(/[ \t]+$/u, '')
}

// 批量清理 + 只保留最近 maxLines 行（服务端通常已截，双保险）。
export const cleanTerminalLines = (lines: string[], maxLines = 200): string[] => {
  const cleaned = lines.map(sanitizeTerminalLine)
  return cleaned.length > maxLines ? cleaned.slice(-maxLines) : cleaned
}
