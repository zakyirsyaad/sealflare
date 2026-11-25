import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { keccak256, type Address } from 'viem'
import { targetIdOfContract, TRUST_TIERS } from '@sealflare/shared/rules'
import { createGuard } from '../src/index'
import { CORE, fakeChain, IMPLEMENTATION, IMPLEMENTATION_SLOT, TARGET, VAULT, wordOf } from './support'

const packageDir = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const safeTiers = ['COMMUNITY_SAFE', 'WARRANTY_BACKED_SAFE']
const IMPLEMENTATION_CODE = '0x6080'

/** A chain where the target is an EIP-1967 proxy pointing at IMPLEMENTATION. */
const proxyChain = (tier: number, pinnedCodehash = keccak256('0xdeadbeef')) => fakeChain({
  tier,
  pinnedCodehash,
  codeByAddress: { [IMPLEMENTATION]: IMPLEMENTATION_CODE },
  storage: { [IMPLEMENTATION_SLOT]: wordOf(IMPLEMENTATION) },
})

describe('checkContract', () => {
  test.each(TRUST_TIERS)('tier %s: safe is true only for the two SAFE tiers', async (tier) => {
    const chain = fakeChain({ tier: TRUST_TIERS.indexOf(tier) })
    const guard = createGuard({ client: chain.client, core: CORE })

    const verdict = await guard.checkContract(TARGET)

    expect(verdict.tier).toBe(tier)
    expect(verdict.safe).toBe(safeTiers.includes(tier))
    expect(verdict.isUpgradeableProxy).toBe(false)
    expect(verdict.implementationChanged).toBeNull()
  })

  test('a proxy is never safe, whatever its tier', async () => {
    const chain = proxyChain(TRUST_TIERS.indexOf('WARRANTY_BACKED_SAFE'))
    const guard = createGuard({ client: chain.client, core: CORE })

    const verdict = await guard.checkContract(TARGET)

    expect(verdict.tier).toBe('WARRANTY_BACKED_SAFE')
    expect(verdict.safe).toBe(false)
    expect(verdict.isUpgradeableProxy).toBe(true)
  })

  test('a proxy says that the code behind it differs from the code the registry pinned', async () => {
    const chain = proxyChain(TRUST_TIERS.indexOf('WARRANTY_BACKED_SAFE'))
    const guard = createGuard({ client: chain.client, core: CORE })

    const verdict = await guard.checkContract(TARGET)

    expect(verdict.reasons).toContain(
      'The code behind this proxy differs from the code that the registry pinned for it.',
    )
  })

  test('a proxy whose implementation slot now holds different code reports implementationChanged', async () => {
    const chain = proxyChain(TRUST_TIERS.indexOf('COMMUNITY_SAFE'))
    const guard = createGuard({ client: chain.client, core: CORE })

    const verdict = await guard.checkContract(TARGET)

    expect(verdict.implementationChanged).toBe(true)
    expect(verdict.safe).toBe(false)
  })

  test('a proxy whose implementation still holds the pinned code reports no change', async () => {
    const chain = proxyChain(TRUST_TIERS.indexOf('COMMUNITY_SAFE'), keccak256(IMPLEMENTATION_CODE))
    const guard = createGuard({ client: chain.client, core: CORE })

    const verdict = await guard.checkContract(TARGET)

    expect(verdict.implementationChanged).toBe(false)
    expect(verdict.isUpgradeableProxy).toBe(true)
  })

  test('a target the registry marks as a proxy is not safe', async () => {
    const chain = fakeChain({ tier: TRUST_TIERS.indexOf('COMMUNITY_SAFE'), firewallProxy: true })
    const guard = createGuard({ client: chain.client, core: CORE })

    const verdict = await guard.checkContract(TARGET)

    expect(verdict.isUpgradeableProxy).toBe(true)
    expect(verdict.safe).toBe(false)
  })

  test('an unknown target is UNRATED and not safe', async () => {
    const chain = fakeChain({ tier: 0 })
    const guard = createGuard({ client: chain.client, core: CORE })

    const verdict = await guard.checkContract(TARGET)

    expect(verdict.tier).toBe('UNRATED')
    expect(verdict.safe).toBe(false)
    expect(verdict.reasons.length).toBeGreaterThan(0)
  })

  test('an RPC failure throws; it never resolves to safe', async () => {
    for (const fail of ['tierOf', 'getTarget', 'verifyContract', 'getCode', 'getStorageAt', 'activeBond']) {
      const chain = fakeChain({ tier: TRUST_TIERS.indexOf('COMMUNITY_SAFE'), fail })
      const guard = createGuard({ client: chain.client, core: CORE, vault: VAULT })

      await expect(guard.checkContract(TARGET)).rejects.toThrow()
    }
  })

  test('the warranty bond is read from the vault when one is configured', async () => {
    const chain = fakeChain({ bond: 42n })
    const guard = createGuard({ client: chain.client, core: CORE, vault: VAULT })

    const verdict = await guard.checkContract(TARGET)

    expect(verdict.warrantyBond).toBe(42n)
  })

  test('the warranty bond is zero when no vault is configured', async () => {
    const chain = fakeChain({ bond: 42n })
    const guard = createGuard({ client: chain.client, core: CORE })

    const verdict = await guard.checkContract(TARGET)

    expect(verdict.warrantyBond).toBe(0n)
  })

  test('the active flags are decoded into flag names', async () => {
    const chain = fakeChain({ flags: 0b11 })
    const guard = createGuard({ client: chain.client, core: CORE })

    const verdict = await guard.checkContract(TARGET)

    expect(verdict.flags).toEqual(['UNVERIFIED_SOURCE', 'HIDDEN_MINT'])
  })

  test('the target id is the contract target id of the address', async () => {
    const chain = fakeChain({ tier: 0 })
    const guard = createGuard({ client: chain.client, core: CORE })

    await guard.checkContract(TARGET)

    const read = chain.reads.find((item) => item.functionName === 'tierOf')
    expect(read?.args?.[0]).toBe(targetIdOfContract(TARGET))
  })

  test('a malformed address is refused', async () => {
    const chain = fakeChain({ tier: 0 })
    const guard = createGuard({ client: chain.client, core: CORE })

    await expect(guard.checkContract('0x123' as Address)).rejects.toThrow()
  })

  test('reasons are plain English sentences with no em dash', async () => {
    const chain = fakeChain({ tier: TRUST_TIERS.indexOf('CAUTION_FLAGGED'), flags: 0b10 })
    const guard = createGuard({ client: chain.client, core: CORE })

    const verdict = await guard.checkContract(TARGET)

    expect(verdict.reasons.length).toBeGreaterThan(0)
    for (const reason of verdict.reasons) {
      expect(reason).toMatch(/^[A-Z]/)
      expect(reason.endsWith('.')).toBe(true)
      expect(reason).not.toContain('—')
      expect(reason).not.toContain('!')
      expect(reason).not.toMatch(/\p{Extended_Pictographic}/u)
    }
  })
})

describe('the README', () => {
  test('the example is three lines and type-checks', () => {
    const readme = readFileSync(join(packageDir, 'README.md'), 'utf8')
    const block = /```ts\n([\s\S]*?)\n```/.exec(readme)
    expect(block).not.toBeNull()
    const snippet = block?.[1] ?? ''
    const lines = snippet.split('\n').filter((line) => line.trim().length > 0)
    expect(lines).toHaveLength(3)

    const dir = join(packageDir, 'tmp')
    mkdirSync(dir, { recursive: true })
    const file = join(dir, 'readme-example.ts')
    const preamble = [
      "import type { PublicClient } from 'viem'",
      'declare const client: PublicClient',
      'declare const core: `0x${string}`',
      'declare const address: `0x${string}`',
      '',
    ].join('\n')
    writeFileSync(file, `${preamble}${snippet}\n`)
    try {
      const output = execFileSync(join(packageDir, 'node_modules', '.bin', 'tsc'), [
        '--noEmit',
        '--ignoreConfig',
        '--strict',
        '--noUncheckedIndexedAccess',
        '--target', 'es2022',
        '--lib', 'es2024,dom',
        '--module', 'esnext',
        '--moduleResolution', 'bundler',
        '--skipLibCheck',
        file,
      ], { encoding: 'utf8' })
      expect(output).toBe('')
    } catch (error) {
      const failure = error as { stdout?: string; stderr?: string }
      throw new Error(`The README example does not type-check.\n${failure.stdout ?? ''}\n${failure.stderr ?? ''}`)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
