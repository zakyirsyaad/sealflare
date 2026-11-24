import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

test('the actual process stops on missing configuration and reports only variable names', () => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'src/main.ts'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8', timeout: 5000,
    env: { PATH: process.env.PATH, ANTHROPIC_API_KEY: 'fixture-must-not-be-printed' },
  })
  expect(result.status).toBe(1)
  expect(result.stderr).toContain('Invalid worker environment:')
  expect(result.stderr).toContain('WORKER_BEARER_KEY')
  expect(result.stderr).not.toContain('fixture-must-not-be-printed')
})
