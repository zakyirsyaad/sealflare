import { expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { CHALLENGE_OUTCOMES, PUBLISHER_ROLES, SCORE_REASONS, TARGET_TYPE_NAMES, VERDICT_NAMES } from '../src/enums'

const TYPES = fileURLToPath(new URL('../../../contracts/src/interfaces/Types.sol', import.meta.url))

/**
 * The members of one enum of the frozen contract, in the order it declares them.
 *
 * A number on the wire names a member by its place in the list, so the list in the indexer has to
 * be the list of the contract. The contract is frozen, so this test is what keeps the two apart.
 */
function membersOf(source: string, name: string): string[] {
  const match = source.match(new RegExp(`enum ${name} \\{([^}]*)\\}`))
  if (!match?.[1]) throw new Error(`The frozen contract has no enum ${name}`)
  return match[1]
    .split(',')
    .map((member) => member.trim())
    .filter((member) => member.length > 0)
}

test('the enum lists of the indexer are the order the frozen contract uses', () => {
  const source = readFileSync(TYPES, 'utf8')

  expect(membersOf(source, 'TargetType')).toEqual([...TARGET_TYPE_NAMES])
  expect(membersOf(source, 'Verdict')).toEqual([...VERDICT_NAMES])
  expect(membersOf(source, 'PublisherRole')).toEqual([...PUBLISHER_ROLES])
  expect(membersOf(source, 'ChallengeOutcome')).toEqual([...CHALLENGE_OUTCOMES])
  expect(membersOf(source, 'ScoreReason')).toEqual([...SCORE_REASONS])
})
