import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { keccak256, type Address } from 'viem'
import { targetIdOfContract, TRUST_TIERS } from '@sealflare/shared/rules'
import { createGuard } from '../src/index'
import { CORE, fakeChain, IMPLEMENTATION, IMPLEMENTATION_SLOT, TARGET, wordOf } from './support'

const packageDir = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const safeTiers = ['COMMUNITY_SAFE', 'WARRANTY_BACKED_SAFE']
const IMPLEMENTATION_CODE = '0x6080'
/** Code that holds the delegatecall opcode, without any of the standard proxy slots. */
const DELEGATECALL_CODE = '0x6080f4'

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

  test('code that holds the delegatecall opcode is never safe', async () => {
    const chain = fakeChain({ tier: TRUST_TIERS.indexOf('COMMUNITY_SAFE'), code: DELEGATECALL_CODE })
    const guard = createGuard({ client: chain.client, core: CORE })

    const verdict = await guard.checkContract(TARGET)

    expect(verdict.tier).toBe('COMMUNITY_SAFE')
    expect(verdict.isUpgradeableProxy).toBe(true)
    expect(verdict.safe).toBe(false)
  })

  test('the code behind a proxy is unknown when there is no baseline', async () => {
    const chain = proxyChain(TRUST_TIERS.indexOf('WARRANTY_BACKED_SAFE'))
    const guard = createGuard({ client: chain.client, core: CORE })

    const verdict = await guard.checkContract(TARGET)

    expect(verdict.implementationChanged).toBeNull()
    expect(verdict.reasons).toContain(
      'The address can change its own code, so the guard cannot prove that the code behind it is unchanged.',
    )
  })

  test('a proxy whose implementation moved since the last scan reports the change', async () => {
    const chain = proxyChain(TRUST_TIERS.indexOf('COMMUNITY_SAFE'))
    const guard = createGuard({ client: chain.client, core: CORE })
    const baseline = { address: IMPLEMENTATION, codehash: keccak256('0xdeadbeef') }

    const verdict = await guard.checkContract(TARGET, baseline)

    expect(verdict.implementationChanged).toBe(true)
    expect(verdict.safe).toBe(false)
    expect(verdict.reasons).toContain('The code behind this proxy differs from the code it had at the last scan.')
  })

  test('a proxy whose implementation still holds the code of the last scan reports no change', async () => {
    const chain = proxyChain(TRUST_TIERS.indexOf('COMMUNITY_SAFE'))
    const guard = createGuard({ client: chain.client, core: CORE })
    const baseline = { address: IMPLEMENTATION, codehash: keccak256(IMPLEMENTATION_CODE) }

    const verdict = await guard.checkContract(TARGET, baseline)

    expect(verdict.implementationChanged).toBe(false)
    expect(verdict.isUpgradeableProxy).toBe(true)
  })

  test('a proxy that points at another implementation since the last scan reports the change', async () => {
    const chain = proxyChain(TRUST_TIERS.indexOf('COMMUNITY_SAFE'))
    const guard = createGuard({ client: chain.client, core: CORE })
    const baseline = { address: '0x9999999999999999999999999999999999999999' as Address, codehash: keccak256(IMPLEMENTATION_CODE) }

    const verdict = await guard.checkContract(TARGET, baseline)

    expect(verdict.implementationChanged).toBe(true)
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

  test('an address without code is reported, not rejected', async () => {
    const chain = fakeChain({ tier: TRUST_TIERS.indexOf('STALE_CODEHASH_DRIFT'), noCode: true })
    const guard = createGuard({ client: chain.client, core: CORE })

    const verdict = await guard.checkContract(TARGET)

    expect(verdict.tier).toBe('STALE_CODEHASH_DRIFT')
    expect(verdict.isUpgradeableProxy).toBe(false)
    expect(verdict.safe).toBe(false)
  })

  test('an address without code and without a rating is UNRATED, not rejected', async () => {
    const chain = fakeChain({ tier: 0, noCode: true })
    const guard = createGuard({ client: chain.client, core: CORE })

    const verdict = await guard.checkContract(TARGET)

    expect(verdict.tier).toBe('UNRATED')
    expect(verdict.safe).toBe(false)
  })

  test('an RPC failure throws; it never resolves to safe', async () => {
    for (const fail of ['tierOf', 'getTarget', 'verifyContract', 'getCode', 'getStorageAt']) {
      const chain = fakeChain({ tier: TRUST_TIERS.indexOf('COMMUNITY_SAFE'), fail })
      const guard = createGuard({ client: chain.client, core: CORE })

      await expect(guard.checkContract(TARGET)).rejects.toThrow()
    }
  })

  test('the warranty bond is the bond of the verified publisher, as the firewall reports it', async () => {
    const chain = fakeChain({ firewallBond: 42n })
    const guard = createGuard({ client: chain.client, core: CORE })

    const verdict = await guard.checkContract(TARGET)

    expect(verdict.warrantyBond).toBe(42n)
    expect(verdict.reasons).toContain('The warranty bond of the publisher holds 42 wei.')
  })

  test('a target without a verified publisher has no warranty bond', async () => {
    const chain = fakeChain({ firewallBond: 0n })
    const guard = createGuard({ client: chain.client, core: CORE })

    const verdict = await guard.checkContract(TARGET)

    expect(verdict.warrantyBond).toBe(0n)
    expect(verdict.reasons).toContain('No warranty bond is recorded for this target.')
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

  test('a malformed core address is refused before any read', async () => {
    const chain = fakeChain({ tier: 0 })

    expect(() => createGuard({ client: chain.client, core: '0x123' as Address })).toThrow()
    expect(chain.calls).toEqual([])
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
  // The type-check runs the compiler in a child process, which takes longer than the five seconds
  // the test waits by default when the machine is busy.
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
  }, 60_000)
})
