import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { createScanner } from '@sealflare/scanner-core'
import { readBundleFiles } from '../src/bundle'
import { localRepo } from '../src/scanSkill'

const packageDir = resolve(fileURLToPath(new URL('..', import.meta.url)))

/** The files that git manages in this package, tracked or not yet added. Never node_modules or caches. */
function managedFiles(): string[] {
  const listing = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: packageDir })
  return listing.toString('utf8').split('\0').filter(path => path.length > 0).sort()
}

describe('the skill scans itself', () => {
  test('the skill passes its own Layer 1 scan with a SAFE suggestion', async () => {
    const files = managedFiles()
    expect(files).toContain('SKILL.md')
    expect(files).toContain('src/cli.ts')
    expect(files.some(path => path.startsWith('node_modules/'))).toBe(false)

    const entries = await readBundleFiles(packageDir, files)
    const report = await createScanner().scanSkill({ owner: 'local', repo: 'local' }, { repo: localRepo(entries) })

    expect(report.findings).toEqual([])
    expect(report.suggestedVerdict).toBe('SAFE')
    expect(report.checks.every(check => check.status === 'passed')).toBe(true)
  })
})
