const URL_PATTERN = /https?:\/\/[^\s<>"')\]]+/gi
const FENCED_CODE_PATTERN = /```[\s\S]*?```/g
const FILE_NAME_PATTERN =
  /\b[\w.-]{6,}\.(?:apk|zip|tar\.gz|tgz|gz|m4a|mp3|wav|json|log|txt|md|tsx?|jsx?|py|sh|html|css)\b/gi
const HASH_PATTERN = /\b[0-9a-f]{7,40}\b/gi
const LONG_MIXED_TOKEN_PATTERN =
  /\b(?=[A-Za-z0-9._-]{12,}\b)(?=[A-Za-z0-9._-]*[A-Za-z])(?=[A-Za-z0-9._-]*\d)[A-Za-z0-9._-]{12,}\b/g
const MARKDOWN_LINK_PATTERN = /\[([^\]]+)\]\((?:链接|[^)]+)\)/g
const MARKDOWN_MARKER_PATTERN = /[*_~`>#|/[\]{}()\\]/g
const LIST_MARKER_PATTERN = /^\s*[-+]\s+/gm
const EMOJI_PATTERN = /[\u{1f300}-\u{1faff}\u{2600}-\u{27bf}]/gu

const EMOJI_SPEECH_LABELS = new Map<string, string>([
  ['✅', '完成'],
  ['☑️', '完成'],
  ['✔️', '完成'],
  ['❌', ''],
  ['✖️', ''],
  ['🔴', ''],
  ['🟢', ''],
  ['🟡', ''],
  ['📦', ''],
  ['•', ''],
])

const replaceEmoji = (text: string) =>
  text.replace(EMOJI_PATTERN, (match) => EMOJI_SPEECH_LABELS.get(match) ?? '')

export const sanitizeForSpeech = (text: string) =>
  replaceEmoji(text)
    .replace(FENCED_CODE_PATTERN, ' 代码片段 ')
    .replace(URL_PATTERN, ' 链接 ')
    .replace(MARKDOWN_LINK_PATTERN, '$1')
    .replace(FILE_NAME_PATTERN, ' 一个文件 ')
    .replace(HASH_PATTERN, ' 一个版本 ')
    .replace(LONG_MIXED_TOKEN_PATTERN, ' 一段编号 ')
    .replace(LIST_MARKER_PATTERN, '')
    .replace(MARKDOWN_MARKER_PATTERN, '')
    .replace(/[ \t]*\n+[ \t]*/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([，。！？：；,.!?])/g, '$1')
    .replace(/([：:])\s+/g, '$1')
    .trim()
