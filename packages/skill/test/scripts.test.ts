import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'
import type { Address, Hex } from 'viem'
import type { Guard } from '@sealflare/guard'
import { targetIdOfContract } from '@sealflare/shared/rules'
import { prepareAttestationReport } from '../src/prepareAttestation'
import { scanContractReport } from '../src/scanContract'
import { scanSkillReport } from '../src/scanSkill'
import { runPrepareAttestation, runScanContract, runScanSkill } from '../src/cli'

const packageDir = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))

const CORE = '0x1111111111111111111111111111111111111111' as Address
const TARGET = '0x60b9262456de011f7d15a54cdd8c48baaa8b022f' as Address
const ZERO_HASH = `0x${'0'.repeat(64)}` as Hex

const folders: string[] = []

afterAll(async () => {
  for (const folder of folders) await rm(folder, { recursive: true, force: true })
})

function group(safe: number, caution: number, danger: number, weight: number) {
  return {
    votes: { safe, caution, danger },
    weight: { safe: weight, caution: 0, danger: 0 },
    flags: 0,
  }
}

function fakeGuard(overrides: Partial<Guard> = {}): Guard {
  return {
    checkContract: async () => ({
      tier: 'CAUTION_FLAGGED',
      safe: false,
      isUpgradeableProxy: false,
      implementationChanged: null,
      flags: ['HIDDEN_MINT'],
      warrantyBond: 0n,
      reasons: ['The registry rates this target as CAUTION_FLAGGED.'],
    }),
    checkSkill: async () => ({
      tier: 'UNRATED',
      safe: false,
      canonicalBundleHash: ZERO_HASH,
      publisher: null,
      flags: [],
      warrantyBond: 0n,
      reasons: ['The registry has not rated this target yet.'],
    }),
    signal: async () => ({
      newIds: group(42, 0, 0, 42),
      guardians: group(0, 0, 3, 15),
    }),
    ...overrides,
  }
}

/** A skill folder with a manifest and one script. */
async function skillFolder(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), 'sealflare-skill-'))
  folders.push(folder)
  await writeFile(
    join(folder, 'SKILL.md'),
    ['---', 'name: sample', 'metadata:', '  sealflare-publisher: "0x0000000000000000000000000000000000000000"', '---', '', 'A sample skill.', ''].join('\n'),
  )
  await writeFile(join(folder, 'run.ts'), 'export const run = (): string => "done"\n')
  return folder
}

/** Every file of the package, so the tests can read the sources of the skill. */
async function packageFiles(): Promise<string[]> {
  const found: string[] = []
  async function walk(current: string): Promise<void> {
    for (const item of await readdir(current, { withFileTypes: true })) {
      if (item.name === 'node_modules' || item.name.startsWith('.')) continue
      const full = join(current, item.name)
      if (item.isDirectory()) await walk(full)
      else found.push(full)
    }
  }
  await walk(packageDir)
  return found
}

/** The sources of the skill itself: the scripts and the modules they call. */
async function skillSources(): Promise<string> {
  const files = (await packageFiles()).filter(file => file.includes('/src/') || file.includes('/scripts/'))
  const sources = await Promise.all(files.map(file => readFile(file, 'utf8')))
  return sources.join('\n')
}

describe('scan-contract', () => {
  test('prints the tier, both signal groups and the flags, and links to the target page', async () => {
    const output = await scanContractReport({ address: TARGET, guard: fakeGuard() })

    expect(output).toContain('Tier: CAUTION_FLAGGED')
    expect(output).toContain('Flags: HIDDEN_MINT')
    expect(output).toContain('New Agent IDs: safe 42, caution 0, danger 0 (weight 42, 42 votes)')
    expect(output).toContain('Guardians: safe 0, caution 0, danger 3 (weight 15, 3 votes)')
    expect(output).toContain(`/app/t/${targetIdOfContract(TARGET)}`)
  })

  test('the flags of the registry are never turned into a safe verdict', async () => {
    const output = await scanContractReport({
      address: TARGET,
      guard: fakeGuard({
        checkContract: async () => ({
          tier: 'CONFIRMED_DANGER',
          safe: false,
          isUpgradeableProxy: true,
          implementationChanged: true,
          flags: ['HIDDEN_MINT'],
          warrantyBond: 0n,
          reasons: ['The registry has confirmed this target as dangerous.'],
        }),
      }),
    })

    expect(output).toContain('Safe: no')
    expect(output).toContain('Upgradeable proxy: yes')
  })
})

describe('scan-skill', () => {
  test('prints the canonical bundle hash, the findings and the on-chain status', async () => {
    const folder = await skillFolder()
    const output = await scanSkillReport({ folder, guard: fakeGuard() })

    expect(output).toContain('Canonical bundle hash: 0x')
    expect(output).toContain('Target id: 0x')
    expect(output).toContain('Tier: UNRATED')
    expect(output).toContain('Layer 1 findings')
    expect(output).toContain('/app/t/0x')
  })

  test('a folder that is not a skill fails instead of pretending it is safe', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'sealflare-empty-'))
    folders.push(folder)

    await expect(scanSkillReport({ folder, guard: fakeGuard() })).rejects.toThrow()
  })
})

describe('prepare-attestation', () => {
  test('prints the attest() parameters and a summary', () => {
    const output = prepareAttestationReport({
      target: {
        type: 'SMART_CONTRACT',
        target: `0x${'0'.repeat(24)}${TARGET.slice(2)}` as Hex,
        targetId: targetIdOfContract(TARGET),
        label: TARGET,
        address: TARGET,
      },
      verdict: 'CAUTION',
      flags: 2,
      shortProof: 'HIDDEN_MINT @ mint: owner can mint',
      evidenceHash: ZERO_HASH,
      evidenceURI: '',
      summary: { tier: 'CAUTION_FLAGGED', signal: { newIds: group(0, 0, 0, 0), guardians: group(0, 0, 3, 15) } },
    })

    expect(output).toContain('Target type: SMART_CONTRACT')
    expect(output).toContain('Verdict: CAUTION')
    expect(output).toContain('Flags: HIDDEN_MINT (0x00000002)')
    expect(output).toContain('- HIDDEN_MINT @ mint: owner can mint')
    expect(output).toContain('Short proof bytes: 0x')
    expect(output).toContain('Nothing was signed and nothing was sent.')
  })

  test('a safe verdict with a flag is refused', () => {
    expect(() =>
      prepareAttestationReport({
        target: {
          type: 'SMART_CONTRACT',
          target: `0x${'0'.repeat(24)}${TARGET.slice(2)}` as Hex,
          targetId: targetIdOfContract(TARGET),
          label: TARGET,
          address: TARGET,
        },
        verdict: 'SAFE',
        flags: 2,
        shortProof: '',
        evidenceHash: ZERO_HASH,
        evidenceURI: '',
      }),
    ).toThrow()
  })
})

describe('the scripts', () => {
  test('no script signs, sends or writes a file', async () => {
    const joined = await skillSources()

    expect(joined).not.toMatch(/privateKey|signTransaction|sendTransaction/)
    expect(joined).not.toMatch(/writeFile|appendFile|mkdir|createWriteStream/)
  })

  test('the only secret that is read from the environment is the RPC endpoint', async () => {
    const joined = await skillSources()
    const names = new Set<string>()
    for (const match of joined.matchAll(/process\.env\.([A-Z_]+)/g)) names.add(match[1] ?? '')

    // INIT_CWD is not a secret: pnpm sets it to the folder the command was typed in.
    expect([...names].sort()).toEqual(['INIT_CWD', 'RPC_URL'])
  })

  test('a bad argument prints the usage and exits with a non zero code', async () => {
    const result = await runScanContract(['--core'])

    expect(result.code).toBe(1)
    expect(result.output).toContain('Usage:')
    expect(result.output).toContain('scan-contract <address>')
  })

  test('a missing address prints the usage and exits with a non zero code', async () => {
    const result = await runScanSkill([])

    expect(result.code).toBe(1)
    expect(result.output).toContain('Usage:')
  })

  test('a wrong verdict prints the usage and exits with a non zero code', async () => {
    const result = await runPrepareAttestation([TARGET, '--verdict', 'MAYBE', '--core', CORE])

    expect(result.code).toBe(1)
    expect(result.output).toContain('Usage:')
  })

  test('a missing core address is reported instead of a silent read', async () => {
    const result = await runScanContract([TARGET])

    expect(result.code).toBe(1)
    expect(result.output).toContain('--core')
  })
})
