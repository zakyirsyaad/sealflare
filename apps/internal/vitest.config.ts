import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // PGlite starts a Postgres in WebAssembly. The first query of a file pays for the start,
    // and the runner is slower than a laptop, so the default five seconds is too short.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
