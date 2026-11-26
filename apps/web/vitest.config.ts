import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
export default defineConfig({
  resolve: { alias: { 'server-only': fileURLToPath(new URL('./test/server-only.ts', import.meta.url)) } },
  test: { environment: 'jsdom', include: ['test/**/*.test.{ts,tsx}'], setupFiles: ['./test/setup.ts'], testTimeout: 15_000, coverage: { provider: 'v8', include: ['components/**/*.{ts,tsx}', 'lib/**/*.ts'], exclude: ['lib/copy.ts', 'lib/env.ts', 'components/ui/index.ts'], thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 } } },
})
