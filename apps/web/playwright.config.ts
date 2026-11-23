import { defineConfig, devices } from '@playwright/test'
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  use: { baseURL: 'http://127.0.0.1:3102', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm start --hostname 127.0.0.1 --port 3102',
    url: 'http://127.0.0.1:3102/app',
    reuseExistingServer: !process.env.CI,
    env: {
      INTERNAL_URL: 'http://127.0.0.1:9999', INTERNAL_KEY: 'e2e-placeholder',
      RPC_URLS: 'http://127.0.0.1:8545', BSCSCAN_KEY: 'e2e-placeholder',
      GITHUB_TOKEN: 'e2e-placeholder', PINATA_JWT: 'e2e-placeholder', SCANNER: 'mock',
    },
  },
})
