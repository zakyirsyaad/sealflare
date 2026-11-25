import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { createScanner } from '@sealflare/scanner-core'
import { readFolder } from '../src/bundle'
import { localRepo } from '../src/scanSkill'

const packageDir = resolve(fileURLToPath(new URL('..', import.meta.url)))

describe('the skill scans itself', () => {
  test('the skill passes its own Layer 1 scan with a SAFE suggestion', async () => {
    const entries = await readFolder(packageDir)
    const report = await createScanner().scanSkill({ owner: 'local', repo: 'local' }, { repo: localRepo(entries) })

    expect(report.findings).toEqual([])
    expect(report.suggestedVerdict).toBe('SAFE')
    expect(report.checks.every(check => check.status === 'passed')).toBe(true)
  })
})
