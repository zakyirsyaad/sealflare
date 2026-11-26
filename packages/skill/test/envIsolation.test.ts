import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { readBundle } from '../src/bundle'
import { gitSkillIn, temp } from './support'

/** The variables that point git at another repository or another configuration. */
const KEYS = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0']

afterEach(() => {
  for (const key of KEYS) delete process.env[key]
})

describe('git reads the folder and not the environment around it', () => {
  test('a stale GIT_DIR does not point git at another repository', async () => {
    const folder = await gitSkillIn(await temp(), { 'local.txt': 'mine\n' })
    const other = await gitSkillIn(await temp(), { 'other.txt': 'theirs\n' }, ['SKILL.md', 'other.txt'])
    process.env.GIT_DIR = join(other, '.git')
    process.env.GIT_WORK_TREE = other

    const bundle = await readBundle(folder)

    expect(bundle.hashed.map(entry => entry.path)).toEqual(['SKILL.md'])
    expect(bundle.extra.map(entry => entry.path)).toContain('local.txt')
  })

  test('a configuration that comes from the environment is not used', async () => {
    const folder = await gitSkillIn(await temp(), { 'secret.txt': 'untracked\n' })
    const excludes = join(folder, 'excludes')
    await writeFile(excludes, 'secret.txt\n')
    process.env.GIT_CONFIG_COUNT = '1'
    process.env.GIT_CONFIG_KEY_0 = 'core.excludesFile'
    process.env.GIT_CONFIG_VALUE_0 = excludes

    const bundle = await readBundle(folder)

    expect(bundle.extra.map(entry => entry.path)).toContain('secret.txt')
  })
})
