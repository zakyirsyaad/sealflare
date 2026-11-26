import { expect, test } from 'vitest'
import { FLAGS } from '@sealflare/shared/rules'
import { signalOf, signalOfTallies } from '../src/readModel/signal'

test('the signal splits weight-1 votes from weight-2-and-above votes', () => {
  const signal = signalOf([
    { verdict: 'SAFE', weight: 1, flags: 0 },
    { verdict: 'SAFE', weight: 1, flags: 0 },
    { verdict: 'DANGER', weight: 5, flags: FLAGS.HIDDEN_MINT },
  ])

  expect(signal.newIds.votes.safe).toBe(2)
  expect(signal.newIds.weight.safe).toBe(2)
  expect(signal.newIds.votes.danger).toBe(0)
  expect(signal.guardians.votes.danger).toBe(1)
  expect(signal.guardians.weight.danger).toBe(5)
  expect(signal.guardians.flags).toBe(FLAGS.HIDDEN_MINT)
  expect(signal.newIds.flags).toBe(0)
})

test('a vote of weight 0 is counted with the Guardians, the same way the SDK counts it', () => {
  const signal = signalOf([{ verdict: 'CAUTION', weight: 0, flags: 0 }])

  expect(signal.newIds.votes.caution).toBe(0)
  expect(signal.guardians.votes.caution).toBe(1)
  expect(signal.guardians.weight.caution).toBe(0)
})

test('a vote with a verdict the read model does not know is refused', () => {
  expect(() => signalOf([{ verdict: 'MAYBE' as 'SAFE', weight: 1, flags: 0 }])).toThrow(
    /the read model does not know/,
  )
})

test('the counted votes give the same signal as the votes themselves', () => {
  const votes = [
    { verdict: 'SAFE' as const, weight: 1, flags: 0 },
    { verdict: 'CAUTION' as const, weight: 2, flags: FLAGS.HIDDEN_MINT },
    { verdict: 'DANGER' as const, weight: 4, flags: FLAGS.UNPINNABLE_DELEGATECALL },
  ]
  const tallies = [
    { verdict: 'SAFE' as const, weight: 1, votes: 1, totalWeight: 1, flags: 0 },
    { verdict: 'CAUTION' as const, weight: 2, votes: 1, totalWeight: 2, flags: FLAGS.HIDDEN_MINT },
    { verdict: 'DANGER' as const, weight: 4, votes: 1, totalWeight: 4, flags: FLAGS.UNPINNABLE_DELEGATECALL },
  ]

  expect(signalOfTallies(tallies)).toEqual(signalOf(votes))
})

test('the counted votes keep the union of the flags of the group', () => {
  const signal = signalOfTallies([
    { verdict: 'DANGER', weight: 3, votes: 2, totalWeight: 6, flags: FLAGS.HIDDEN_MINT | FLAGS.UNPINNABLE_DELEGATECALL },
  ])

  expect(signal.guardians.votes.danger).toBe(2)
  expect(signal.guardians.weight.danger).toBe(6)
  expect(signal.guardians.flags).toBe(FLAGS.HIDDEN_MINT | FLAGS.UNPINNABLE_DELEGATECALL)
})
