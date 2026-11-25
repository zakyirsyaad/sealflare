import { describe, expect, test } from 'vitest'
import { FLAGS, targetIdOfContract } from '@sealflare/shared/rules'
import { createGuard } from '../src/index'
import { CORE, fakeChain, TARGET } from './support'

const targetId = targetIdOfContract(TARGET)

describe('the community signal', () => {
  test('the new Agent IDs and the experienced Guardians are counted apart', async () => {
    const chain = fakeChain({
      attestations: [
        { verdict: 0, weight: 1 },
        { verdict: 0, weight: 1 },
        { verdict: 2, weight: 3, flags: FLAGS.HIDDEN_MINT },
      ],
    })
    const guard = createGuard({ client: chain.client, core: CORE })

    const signal = await guard.signal(targetId)

    expect(signal.newIds.votes.safe).toBe(2)
    expect(signal.newIds.weight.safe).toBe(2)
    expect(signal.newIds.flags).toBe(0)
    expect(signal.guardians.votes.danger).toBe(1)
    expect(signal.guardians.weight.danger).toBe(3)
    expect(signal.guardians.flags).toBe(FLAGS.HIDDEN_MINT)
  })

  test('a target without votes has an empty signal', async () => {
    const chain = fakeChain({ attestations: [] })
    const guard = createGuard({ client: chain.client, core: CORE })

    const signal = await guard.signal(targetId)

    expect(signal.newIds.votes).toEqual({ safe: 0, caution: 0, danger: 0 })
    expect(signal.guardians.weight).toEqual({ safe: 0, caution: 0, danger: 0 })
  })

  test('a failure to read the votes throws', async () => {
    const chain = fakeChain({ attestations: [{ verdict: 0, weight: 1 }], fail: 'getAttestation' })
    const guard = createGuard({ client: chain.client, core: CORE })

    await expect(guard.signal(targetId)).rejects.toThrow()
  })
})
