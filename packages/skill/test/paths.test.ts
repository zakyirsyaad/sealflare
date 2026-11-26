import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { runPrepareAttestation, runScanSkill } from '../src/cli'
import { CORE, TARGET, fakeGuard, packageDir, skillIn, temp } from './support'

describe('relative paths resolve where the user typed the command', () => {
  beforeEach(() => { vi.stubEnv('INIT_CWD', undefined) })
  afterEach(() => { vi.unstubAllEnvs() })

  test('a relative folder resolves against INIT_CWD and the absolute path is printed', async () => {
    const base = await temp()
    const folder = await skillIn(join(base, 'foo'), { 'run.sh': 'echo hi\n' })
    vi.stubEnv('INIT_CWD', base)

    const result = await runScanSkill(['foo', '--core', CORE], { guard: fakeGuard() })

    expect(result.code).toBe(0)
    expect(result.output).toContain(`in ${folder}`)
    expect(result.output).toContain('Files in the bundle: 2')
  })

  test('a dot scans the folder where the command was typed, not this package', async () => {
    const base = await skillIn(await temp(), { 'run.sh': 'echo hi\n' })
    vi.stubEnv('INIT_CWD', base)

    const result = await runScanSkill(['.', '--core', CORE], { guard: fakeGuard() })

    expect(result.output).toContain(`in ${base}`)
    expect(result.output).not.toContain(packageDir)
    expect(result.output).toContain('Files in the bundle: 2')
  })

  test('a folder that does not exist names the absolute path in the failure', async () => {
    const base = await temp()
    vi.stubEnv('INIT_CWD', base)

    const result = await runScanSkill(['missing', '--core', CORE], { guard: fakeGuard() })

    expect(result.code).toBe(1)
    expect(result.output).toContain(join(base, 'missing'))
  })

  test('--skill and --evidence-file resolve against INIT_CWD too', async () => {
    const base = await temp()
    await skillIn(join(base, 'foo'), { 'run.sh': 'echo hi\n' })
    await writeFile(join(base, 'evidence.json'), '{"a":1}')
    vi.stubEnv('INIT_CWD', base)

    const result = await runPrepareAttestation(
      ['--skill', 'foo', '--verdict', 'CAUTION', '--flags', 'PROMPT_BYPASS_CONFIRMATION', '--core', CORE, '--evidence-file', 'evidence.json', '--evidence', 'ipfs://x'],
      { guard: fakeGuard() },
    )

    expect(result.code).toBe(0)
    expect(result.output).toContain(join(base, 'foo'))
  })

  test('without INIT_CWD the working directory is used', async () => {
    const result = await runScanSkill(['definitely-not-here', '--core', CORE], { guard: fakeGuard() })

    expect(result.code).toBe(1)
    expect(result.output).toContain(join(process.cwd(), 'definitely-not-here'))
  })
})

describe('the environment', () => {
  afterEach(() => { vi.unstubAllEnvs() })

  test('a missing RPC endpoint fails', async () => {
    vi.stubEnv('RPC_URL', '')
    try {
      const result = await runPrepareAttestation([TARGET, '--verdict', 'CAUTION', '--flags', 'HIDDEN_MINT', '--core', CORE])

      expect(result.code).toBe(1)
      expect(result.output).toContain('RPC_URL')
    } finally {
      vi.unstubAllEnvs()
    }
  })
})
