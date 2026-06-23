import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const readElectronBuilderFiles = () => {
  const configPath = resolve(process.cwd(), 'electron-builder.yml')
  const lines = readFileSync(configPath, 'utf8').split(/\r?\n/)
  const filesLine = lines.findIndex((line) => /^files:\s*$/.test(line))
  if (filesLine < 0) throw new Error('electron-builder.yml files section missing')

  const entries: string[] = []
  for (const line of lines.slice(filesLine + 1)) {
    if (/^\S/.test(line)) break
    const match = /^\s*-\s+(.+?)\s*$/.exec(line)
    if (match?.[1]) entries.push(match[1])
  }
  return entries
}

describe('electron-builder desktop packaging config', () => {
  it('does not package the developer root .env file', () => {
    const files = readElectronBuilderFiles()

    expect(files).toContain('package.json')
    expect(files).toContain('desktop/electron/main.mjs')
    expect(files).not.toContain('.env')
  })
})
