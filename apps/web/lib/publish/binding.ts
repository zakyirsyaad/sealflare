import { TargetSummary } from '@sealflare/shared/schemas'

/**
 * The enums of Core, in the order the contracts declare them. The publisher role comes from the
 * shared schemas, and the bind method mirrors the frozen enum of contracts/src/interfaces/Types.sol.
 */
export const PUBLISHER_ROLES = TargetSummary.shape.publisherRole.options
export const BIND_METHODS = ['OWNER', 'DEPLOYER', 'SKILL', 'SPONSOR'] as const

export type PublisherRole = (typeof PUBLISHER_ROLES)[number]
export type BindMethod = (typeof BIND_METHODS)[number]

/** How a target was bound, read from the PublisherBound event of Core. */
export type Binding = { publisher: `0x${string}`; role: PublisherRole; method: BindMethod }

/** An index outside the enum throws instead of becoming undefined. */
function pick<T>(list: readonly T[], index: number | bigint, what: string): T {
  const position = Number(index)
  const found = Number.isInteger(position) && position >= 0 ? list[position] : undefined
  if (found === undefined) throw new RangeError(`Core returned an unknown ${what}.`)
  return found
}

export function publisherRoleOf(index: number | bigint): PublisherRole {
  return pick(PUBLISHER_ROLES, index, 'publisher role')
}

export function bindMethodOf(index: number | bigint): BindMethod {
  return pick(BIND_METHODS, index, 'bind method')
}
