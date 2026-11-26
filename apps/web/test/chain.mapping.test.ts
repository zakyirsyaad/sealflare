import { expect, test } from 'vitest'
import { publisherRoleOf, targetTypeOf, verdictOf } from '../server/chain'

test.each([[0, 'SAFE'], [1, 'CAUTION'], [2, 'DANGER'], [2n, 'DANGER']])('verdict %s is %s', (index, name) => {
  expect(verdictOf(index)).toBe(name)
})

test.each([[0, 'SMART_CONTRACT'], [1, 'AI_SKILL_BUNDLE']])('target type %s is %s', (index, name) => {
  expect(targetTypeOf(index)).toBe(name)
})

test.each([[0, 'NONE'], [1, 'THIRD_PARTY_SPONSOR'], [2, 'VERIFIED_PUBLISHER']])('publisher role %s is %s', (index, name) => {
  expect(publisherRoleOf(index)).toBe(name)
})

test.each([[3], [-1], [1.5], [99n]])('an index Core could not have returned (%s) throws instead of becoming undefined', index => {
  expect(() => verdictOf(index)).toThrow(RangeError)
  expect(() => publisherRoleOf(index)).toThrow(RangeError)
})

test('a target type index outside the frozen list throws', () => {
  expect(() => targetTypeOf(2)).toThrow(RangeError)
})
