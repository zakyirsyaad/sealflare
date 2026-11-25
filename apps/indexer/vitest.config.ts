import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/chain.setup.ts'],
    // One chain is shared by the whole run, so the test files run one after another.
    fileParallelism: false,
    // The chain is started once for the whole run and the first query of a file waits for it.
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
})
