import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, expect, test, vi } from 'vitest'
import { type ScannerCore, ScanReport } from '@sealflare/shared/schemas'
import { createScanner, parseScanInput, suggestVerdict, hasDelegatecall, inspectProxy } from '@sealflare/scanner-core'
import { ADDRESS, cleanRpc, explorerWith } from './contract.fixtures'
import { loadSkill } from './skill.fixtures'

afterEach(() => vi.restoreAllMocks())

test('createScanner satisfies ScannerCore and executes a real contract scan with injected dependencies', async () => {
  const scanner = createScanner() satisfies ScannerCore
  const report = await scanner.scanContract(ADDRESS, { rpc: cleanRpc(), explorer: explorerWith() })
  expect(ScanReport.safeParse(report).success).toBe(true)
  expect(report.suggestedVerdict).toBe('SAFE')
  expect(report.targetType).toBe('SMART_CONTRACT')
})

test('the package entry point parses an input and executes a real skill scan without ambient fetch', async () => {
  const network = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => { throw Error('Unexpected network') })
  const input = parseScanInput('https://github.com/acme/skills')
  if (input.kind !== 'skill') throw Error('Expected skill input')
  const report = await createScanner().scanSkill(input, { repo: {
    listSkillFolders: async () => ({ commit: 'a'.repeat(40), folders: ['swap'] }),
    fetchBundle: async () => loadSkill('clean'),
  } })
  expect(report.suggestedVerdict).toBe('SAFE')
  expect(report.source).toMatchObject({ kind: 'skill', repo: 'acme/skills', path: 'swap', commit: 'a'.repeat(40) })
  expect(network).not.toHaveBeenCalled()
})

test('SDK inspection helpers are usable through the package entry point', async () => {
  expect(hasDelegatecall('0x60f4f4')).toBe(true)
  expect(await inspectProxy(ADDRESS, '0x6000', cleanRpc())).toBeNull()
  expect(suggestVerdict([], [], ['dry_run'])).toBe('CAUTION')
})

function coreFiles(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'adapters') return []
    const file = resolve(path, entry.name)
    return entry.isDirectory() ? coreFiles(file) : file.endsWith('.ts') ? [file] : []
  })
}

test('every core source file respects the no-environment/no-network boundary', () => {
  for (const path of coreFiles(resolve(import.meta.dirname, '../src'))) {
    const code = readFileSync(path, 'utf8')
    expect(code, path).not.toMatch(/node:|process\.env|\bfetch\s*\(/)
    expect(code, path).not.toMatch(/(?:from\s*|import\s*\()['"][^'"]*adapters(?:\/|['"])/)
  }
})
