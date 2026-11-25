import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { chmod, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { bundleIdentity, CONSTANTS } from '@sealflare/shared/rules'
import { readBundle } from '../src/bundle'
import { scanSkillReport } from '../src/scanSkill'
import { MANIFEST, PIPE_TO_SHELL, fakeGuard, gitIn, gitSkillIn, skillIn, temp } from './support'

/** The commit a submodule points at. It never exists, because the entry is what matters. */
const SUBMODULE_COMMIT = '0'.repeat(39) + '1'

describe('the bundle is read the way the registry reads it', () => {
  test('folders that used to be skipped are hashed and scanned', async () => {
    const folder = await skillIn(await temp(), {
      'dist/postinstall.sh': `${PIPE_TO_SHELL}\n`,
      'node_modules/dep/index.js': 'module.exports = 1\n',
      '.next/build.js': 'export const built = true\n',
      'test-results/log.txt': 'a log\n',
    })

    const entries = (await readBundle(folder)).hashed
    const paths = entries.map(entry => entry.path)

    for (const path of ['dist/postinstall.sh', 'node_modules/dep/index.js', '.next/build.js', 'test-results/log.txt']) {
      expect(paths).toContain(path)
    }
    const clean = await skillIn(await temp())
    expect(bundleIdentity(entries).canonicalBundleHash).not.toBe(bundleIdentity((await readBundle(clean)).hashed).canonicalBundleHash)
  })

  test('a skill with a hidden dist script is not suggested as safe', async () => {
    const folder = await skillIn(await temp(), { 'dist/postinstall.sh': `${PIPE_TO_SHELL}\n` })

    const output = await scanSkillReport({ folder, guard: fakeGuard() })

    expect(output).not.toContain('Suggested verdict: SAFE')
    expect(output).toContain('dist/postinstall.sh')
  })

  test('only the git metadata folder is left out, because a git tree can never hold one', async () => {
    const folder = await skillIn(await temp(), { '.git/config': '[core]\n' })

    const paths = ((await readBundle(folder)).hashed).map(entry => entry.path)

    expect(paths).toEqual(['SKILL.md'])
  })

  test('publisher.sig is read, so the hash can leave it out the way the registry does', async () => {
    const folder = await skillIn(await temp(), { 'publisher.sig': '0xabc\n' })

    const entries = (await readBundle(folder)).hashed

    expect(entries.map(entry => entry.path)).toContain('publisher.sig')
    expect(bundleIdentity(entries).canonicalBundleHash).toBe(bundleIdentity((await readBundle(await skillIn(await temp()))).hashed).canonicalBundleHash)
  })

  test('a link is read as the text of its target and never followed', async () => {
    const folder = await skillIn(await temp())
    await symlink('/etc/hosts', join(folder, 'hosts'))

    const entry = ((await readBundle(folder)).hashed).find(item => item.path === 'hosts')

    expect(entry?.kind).toBe('symlink')
    expect(new TextDecoder().decode(entry?.bytes)).toBe('/etc/hosts')
  })

  test('a folder with too many files fails instead of being cut short', async () => {
    const folder = await skillIn(await temp())
    for (let index = 0; index <= CONSTANTS.MAX_BUNDLE_FILES; index += 1) await writeFile(join(folder, `f${index}.txt`), 'x')

    await expect(readBundle(folder)).rejects.toThrow(/more than 200 files/)
  })

  test('the signature does not count towards the limit, because the registry leaves it out too', async () => {
    const folder = await skillIn(await temp(), { 'publisher.sig': '0xabc\n' })
    for (let index = 0; index < CONSTANTS.MAX_BUNDLE_FILES - 2; index += 1) await writeFile(join(folder, `f${index}.txt`), 'x')
    await writeFile(join(folder, 'zz.txt'), 'x')

    const bundle = await readBundle(folder)

    expect(bundle.hashed.length).toBe(CONSTANTS.MAX_BUNDLE_FILES + 1)
  })
})

describe('a git work tree is hashed the way the registry hashes the tree of a repository', () => {
  test('only the committed files are part of the bundle', async () => {
    const folder = await gitSkillIn(await temp(), { 'dist/postinstall.sh': `${PIPE_TO_SHELL}\n` })

    const bundle = await readBundle(folder)

    expect(bundle.hashed.map(entry => entry.path)).toEqual(['SKILL.md'])
    expect(bundle.extra.map(entry => entry.path)).toEqual(['dist/postinstall.sh'])
  })

  test('a file that is not committed never changes the hash or the target id', async () => {
    const folder = await gitSkillIn(await temp(), { 'local.txt': 'not committed\n' })
    const clean = await gitSkillIn(await temp())

    const bundle = await readBundle(folder)

    expect(bundleIdentity(bundle.hashed).canonicalBundleHash).toBe(
      bundleIdentity((await readBundle(clean)).hashed).canonicalBundleHash,
    )
  })

  test('a file that is only staged is not part of the bundle, because the registry hashes the commit', async () => {
    const folder = await gitSkillIn(await temp())
    await writeFile(join(folder, 'staged.txt'), 'staged only\n')
    gitIn(folder, ['add', '--', 'staged.txt'])

    const bundle = await readBundle(folder)

    expect(bundle.hashed.map(entry => entry.path)).toEqual(['SKILL.md'])
    expect(bundle.extra.map(entry => entry.path)).toEqual(['staged.txt'])
  })

  test('a local change to a committed file never changes the hash, but it is still scanned', async () => {
    const folder = await gitSkillIn(await temp())
    await writeFile(join(folder, 'SKILL.md'), `${MANIFEST}\n${PIPE_TO_SHELL}\n`)
    const clean = await gitSkillIn(await temp())

    const bundle = await readBundle(folder)

    expect(bundleIdentity(bundle.hashed).canonicalBundleHash).toBe(
      bundleIdentity((await readBundle(clean)).hashed).canonicalBundleHash,
    )
    expect(bundle.extra.map(entry => entry.path)).toEqual(['SKILL.md'])
  })

  test('a file that is not committed is still scanned, so its finding is shown', async () => {
    const folder = await gitSkillIn(await temp(), { 'dist/postinstall.sh': `${PIPE_TO_SHELL}\n` })

    const output = await scanSkillReport({ folder, guard: fakeGuard() })

    expect(output).toContain('dist/postinstall.sh')
    expect(output).not.toContain('Suggested verdict: SAFE')
  })

  test('a work tree with more files than a bundle may hold still scans', async () => {
    const folder = await gitSkillIn(await temp())
    for (let index = 0; index < CONSTANTS.MAX_BUNDLE_FILES + 20; index += 1) {
      await mkdir(join(folder, 'node_modules', `dep${index}`), { recursive: true })
      await writeFile(join(folder, 'node_modules', `dep${index}`, 'index.js'), 'module.exports = 1\n')
    }

    const output = await scanSkillReport({ folder, guard: fakeGuard() })

    expect(output).toContain('Files in the bundle: 1')
    expect(output).toContain('Suggested verdict:')
  })

  test('a file that is not committed is read before an ignored dependency tree', async () => {
    const folder = await gitSkillIn(await temp(), { 'node_modules/dep/index.js': 'module.exports = 1\n' })
    await writeFile(join(folder, '.gitignore'), 'node_modules/\n')
    gitIn(folder, ['add', '--', '.gitignore'])
    gitIn(folder, ['-c', 'user.email=test@example.com', '-c', 'user.name=test', 'commit', '-q', '-m', 'ignore'])
    await writeFile(join(folder, 'payload.sh'), `${PIPE_TO_SHELL}\n`)

    const bundle = await readBundle(folder)

    expect(bundle.extra[0]?.path).toBe('payload.sh')
  })

  test('the file monitor of the repository is never run', async () => {
    const folder = await gitSkillIn(await temp())
    const marker = join(folder, 'monitor-ran')
    const script = join(folder, 'monitor.sh')
    await writeFile(script, `#!/bin/sh\ntouch ${marker}\n`)
    await chmod(script, 0o755)
    await writeFile(join(folder, '.git', 'config'), `[core]\n\tfsmonitor = ${script}\n`)

    await readBundle(folder)

    expect(existsSync(marker)).toBe(false)
  })

  test('a repository that git will not work with is an error, not a folder outside git', async () => {
    const folder = await gitSkillIn(await temp())
    await writeFile(join(folder, '.git', 'config'), 'this is not a config\n')

    await expect(readBundle(folder)).rejects.toThrow(/git will not work with/)
  })

  test('a folder inside a git repository with no committed file has no bundle to hash', async () => {
    const folder = await skillIn(await temp(), { 'a.txt': 'x\n' })
    execFileSync('git', ['init', '-q'], { cwd: folder })

    await expect(readBundle(folder)).rejects.toThrow(/no commit yet/)
  })

  test('a bundle with a submodule is refused, because the registry can never publish one', async () => {
    const folder = await gitSkillIn(await temp())
    gitIn(folder, ['update-index', '--add', '--cacheinfo', `160000,${SUBMODULE_COMMIT},vendor/lib`])
    gitIn(folder, ['-c', 'user.email=test@example.com', '-c', 'user.name=test', 'commit', '-q', '-m', 'submodule'])

    await expect(readBundle(folder)).rejects.toThrow(/submodule/)
  })

  test('a bundle that ships a partial clone never makes git reach the network', async () => {
    const folder = await gitSkillIn(await temp())
    const marker = join(folder, 'download-ran')
    const script = join(folder, 'download.sh')
    await writeFile(script, `#!/bin/sh\ntouch ${marker}\n`)
    await chmod(script, 0o755)
    // The blob of the manifest is removed, so git would have to download it again.
    const oid = execFileSync('git', ['rev-parse', 'HEAD:SKILL.md'], { cwd: folder }).toString('utf8').trim()
    await rm(join(folder, '.git', 'objects', oid.slice(0, 2), oid.slice(2)), { force: true })
    gitIn(folder, ['config', 'extensions.partialClone', 'origin'])
    gitIn(folder, ['config', 'remote.origin.promisor', 'true'])
    gitIn(folder, ['config', 'remote.origin.url', 'ssh://localhost/repo.git'])
    gitIn(folder, ['config', 'remote.origin.uploadpack', script])
    gitIn(folder, ['config', 'core.sshCommand', script])

    await expect(readBundle(folder)).rejects.toThrow(/could not be read/)
    expect(existsSync(marker)).toBe(false)
  })

  test('a folder outside git is a folder outside git, whatever the language of git is', async () => {
    const folder = await skillIn(await temp(), { 'notes.txt': 'x\n' })
    const language = process.env.LC_ALL
    process.env.LC_ALL = 'id_ID.UTF-8'
    try {
      const bundle = await readBundle(folder)
      expect(bundle.hashed.map(entry => entry.path)).toEqual(['SKILL.md', 'notes.txt'])
    } finally {
      if (language === undefined) delete process.env.LC_ALL
      else process.env.LC_ALL = language
    }
  })

  test('a nested repository is left out, because its files belong to it', async () => {
    const folder = await gitSkillIn(await temp())
    await mkdir(join(folder, 'vendor', 'dep'), { recursive: true })
    await writeFile(join(folder, 'vendor', 'dep', 'index.js'), 'module.exports = 1\n')
    execFileSync('git', ['init', '-q'], { cwd: join(folder, 'vendor', 'dep') })

    const bundle = await readBundle(folder)

    expect(bundle.extra.map(entry => entry.path)).not.toContain('vendor/dep/')
    expect(bundle.extra.map(entry => entry.path)).not.toContain('vendor/dep')
  })

  test('the target page of a bundle in a GitHub work tree carries the source of the bundle', async () => {
    const folder = await gitSkillIn(await temp())
    gitIn(folder, ['remote', 'add', 'origin', 'git@github.com:sealflare/guard.git'])
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: folder }).toString('utf8').trim()

    const output = await scanSkillReport({ folder, guard: fakeGuard() })

    expect(output).toContain(`?src=${encodeURIComponent(`gh:sealflare/guard@${commit}:`)}`)
  })

  test('a work tree without a GitHub remote has no source, and the link stays without one', async () => {
    const folder = await gitSkillIn(await temp())

    const output = await scanSkillReport({ folder, guard: fakeGuard() })

    expect(output).toContain('Target page: /app/t/')
    expect(output).not.toContain('?src=')
  })
})
