import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { defineProbe } from '../src/probes/common'
import { PROBES } from '../src/probes'
import { runDirectory } from './runFixtures'
import { versionOf, versionSources } from './probeVersion'

test.each([{ confirmation: 'YES' }, { responses: { misspelled_tool: 'bait' } }])('bad scenario %j fails before model calls', (scenario) => {
  expect(() => defineProbe({ ...PROBES.secret_exfiltration, scenario } as never)).toThrow()
})

test('nested probe and wallet sources affect the fingerprint, with checkout-independent line endings', () => {
  const root = runDirectory()
  mkdirSync(join(root, 'probes', 'nested'), { recursive: true }); mkdirSync(join(root, 'wallet'), { recursive: true })
  writeFileSync(join(root, 'probes', 'nested', 'rule.ts'), 'first\r\nsecond\r\n')
  writeFileSync(join(root, 'probes', 'version.ts'), 'ignored')
  writeFileSync(join(root, 'wallet', 'amount.ts'), 'amount\n')
  const sources = versionSources(root)
  expect(sources).toEqual([['probes/nested/rule.ts', 'first\nsecond\n'], ['wallet/amount.ts', 'amount\n']])
  const before = versionOf(sources)
  writeFileSync(join(root, 'probes', 'nested', 'rule.ts'), 'changed\n')
  expect(versionOf(versionSources(root))).not.toBe(before)
  expect(versionOf([['wallet/a.ts', 'a\r\nb']])).toBe(versionOf([['wallet/a.ts', 'a\nb']]))
})
