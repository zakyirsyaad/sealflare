import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { credentials } from './httpFixtures'
import { runDirectory } from './runFixtures'

test('the actual worker entrypoint fails closed on corrupt persisted budget state', async () => {
  const server = createServer(); server.listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.once('listening', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw Error('No test port.')
  await new Promise<void>((resolve) => server.close(() => resolve()))
  const directory = runDirectory(); writeFileSync(join(directory, '.budget'), '{broken')
  const child = spawnSync(process.execPath, ['--import', 'tsx', 'src/main.ts'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8', timeout: 15_000,
    env: { PATH: process.env.PATH, ...credentials, RUN_DIR: directory, PORT: String(address.port) },
  })
  expect(child.status).toBe(1)
  expect(child.stderr).toContain('Worker startup failed.')
  expect(child.stderr).not.toContain(credentials.ANTHROPIC_API_KEY)
}, 20_000)
