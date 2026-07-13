import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './test/visual',
  outputDir: './tmp/playwright-results',
  reporter: 'list',
  timeout: 90_000,
  workers: 1
})
