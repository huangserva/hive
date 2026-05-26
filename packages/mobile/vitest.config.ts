import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['packages/mobile/__tests__/**/*.test.ts'],
  },
})
