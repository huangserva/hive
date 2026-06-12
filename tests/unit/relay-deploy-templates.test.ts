import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, test } from 'vitest'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const deployDir = join(repoRoot, 'packages', 'relay', 'deploy')

const readDeployFile = (filename: string) => readFileSync(join(deployDir, filename), 'utf8')

describe('relay deploy templates', () => {
  test('checked-in relay deploy templates default to yunzhong public entrypoint', () => {
    const files = [
      'Caddyfile.example',
      'nginx-relay.conf.example',
      'relay.json.example',
      'README.md',
    ]

    for (const filename of files) {
      const content = readDeployFile(filename)

      expect(content, filename).toContain('relay.yunzhong2020.com')
      expect(content, filename).not.toContain('aliyun.servasyy.com')
      expect(content, filename).not.toContain('dmit.servasyy.com')
      expect(content, filename).not.toContain('relay.example.com')
    }
  })

  test('relay deploy README documents download and view public routes separately', () => {
    const readme = readDeployFile('README.md')

    expect(readme).toContain('/dl/')
    expect(readme).toContain('/view/')
    expect(readme).toContain('下载')
    expect(readme).toContain('查看')
  })
})
