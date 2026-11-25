import { describe, expect, test } from 'vitest'
import { bundleIdentity, TRUST_TIERS, type BundleEntry } from '@sealflare/shared/rules'
import { createGuard } from '../src/index'
import { CORE, fakeChain, VAULT } from './support'

const PUBLISHER = '0x5555555555555555555555555555555555555555'

const manifest = (publisher: string) => new TextEncoder().encode(
  `---\nmetadata:\n  sealflare-publisher: "${publisher}"\n---\n\n# Skill\n`,
)

const entries = (body: string, publisher: string | null = PUBLISHER): BundleEntry[] => {
  const files: BundleEntry[] = [{ path: 'SKILL.md', kind: 'file', bytes: manifest(publisher ?? PUBLISHER) }]
  if (publisher === null) files[0] = { path: 'SKILL.md', kind: 'file', bytes: new TextEncoder().encode('# Skill\n') }
  files.push({ path: 'run.sh', kind: 'file', bytes: new TextEncoder().encode(body) })
  return files
}

describe('checkSkill', () => {
  test('checkSkill computes the canonical hash locally from the entries, so a changed file changes the answer', async () => {
    const chain = fakeChain({ tier: TRUST_TIERS.indexOf('COMMUNITY_SAFE') })
    const guard = createGuard({ client: chain.client, core: CORE })
    const before = bundleIdentity(entries('echo one\n'))
    const after = bundleIdentity(entries('echo two\n'))

    const verdict = await guard.checkSkill(entries('echo two\n'))

    expect(verdict.canonicalBundleHash).toBe(after.canonicalBundleHash)
    expect(verdict.canonicalBundleHash).not.toBe(before.canonicalBundleHash)
    const read = chain.reads.find((item) => item.functionName === 'tierOf')
    expect(read?.args?.[0]).toBe(after.targetId)
  })

  test('the publisher comes from the manifest of the bundle', async () => {
    const chain = fakeChain({ tier: TRUST_TIERS.indexOf('COMMUNITY_SAFE') })
    const guard = createGuard({ client: chain.client, core: CORE })

    const verdict = await guard.checkSkill(entries('echo one\n'))

    expect(verdict.publisher).toBe(PUBLISHER)
  })

  test('a bundle without a publisher has no publisher', async () => {
    const chain = fakeChain({ tier: TRUST_TIERS.indexOf('COMMUNITY_SAFE') })
    const guard = createGuard({ client: chain.client, core: CORE })

    const verdict = await guard.checkSkill(entries('echo one\n', null))

    expect(verdict.publisher).toBeNull()
  })

  test('a safe tier with no flags is safe', async () => {
    const chain = fakeChain({ tier: TRUST_TIERS.indexOf('COMMUNITY_SAFE') })
    const guard = createGuard({ client: chain.client, core: CORE })

    const verdict = await guard.checkSkill(entries('echo one\n'))

    expect(verdict.tier).toBe('COMMUNITY_SAFE')
    expect(verdict.safe).toBe(true)
  })

  test.each(TRUST_TIERS)('tier %s: safe is true only for the two SAFE tiers', async (tier) => {
    const chain = fakeChain({ tier: TRUST_TIERS.indexOf(tier) })
    const guard = createGuard({ client: chain.client, core: CORE })

    const verdict = await guard.checkSkill(entries('echo one\n'))

    expect(verdict.tier).toBe(tier)
    expect(verdict.safe).toBe(['COMMUNITY_SAFE', 'WARRANTY_BACKED_SAFE'].includes(tier))
  })

  test('an unknown bundle is UNRATED and not safe', async () => {
    const chain = fakeChain({ tier: 0 })
    const guard = createGuard({ client: chain.client, core: CORE })

    const verdict = await guard.checkSkill(entries('echo one\n'))

    expect(verdict.tier).toBe('UNRATED')
    expect(verdict.safe).toBe(false)
  })

  test('the active flags of the skill target are decoded into flag names', async () => {
    const chain = fakeChain({ flags: 0b1 << 8 })
    const guard = createGuard({ client: chain.client, core: CORE })

    const verdict = await guard.checkSkill(entries('echo one\n'))

    expect(verdict.flags).toEqual(['PROMPT_BYPASS_CONFIRMATION'])
  })

  test('the warranty bond is read from the vault when one is configured', async () => {
    const chain = fakeChain({ bond: 7n })
    const guard = createGuard({ client: chain.client, core: CORE, vault: VAULT })

    const verdict = await guard.checkSkill(entries('echo one\n'))

    expect(verdict.warrantyBond).toBe(7n)
  })

  test('an RPC failure throws; it never resolves to safe', async () => {
    for (const fail of ['tierOf', 'getTarget', 'activeBond']) {
      const chain = fakeChain({ tier: TRUST_TIERS.indexOf('COMMUNITY_SAFE'), fail })
      const guard = createGuard({ client: chain.client, core: CORE, vault: VAULT })

      await expect(guard.checkSkill(entries('echo one\n'))).rejects.toThrow()
    }
  })

  test('reasons are plain English sentences with no em dash', async () => {
    const chain = fakeChain({ tier: TRUST_TIERS.indexOf('DISPUTED_CAUTION'), flags: 0b1 << 8 })
    const guard = createGuard({ client: chain.client, core: CORE })

    const verdict = await guard.checkSkill(entries('echo one\n'))

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
