import { defineConfig, devices } from '@playwright/test'

// The harness starts the app, the chain and the database, so the suite runs against a stack that
// is already up. The address of that stack comes from the environment.
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3102'

export default defineConfig({
  testDir: './e2e',
  // One worker: the tests share one chain and one database, so they run one after the other.
  fullyParallel: false,
  workers: 1,
  use: { baseURL, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
