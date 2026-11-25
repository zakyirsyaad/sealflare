import type { Address } from 'viem'
import type { Guard } from '@sealflare/guard'
import { targetIdOfContract } from '@sealflare/shared/rules'
import { bullet, field, groupLine, join, scanLink, section, targetLink } from './output'

/**
 * The report of a contract: what the registry says, what the community voted and where to look.
 *
 * The tier always comes from the registry. The script never rates a target by itself.
 */
export async function scanContractReport(input: { address: Address; guard: Guard }): Promise<string> {
  const verdict = await input.guard.checkContract(input.address)
  const targetId = targetIdOfContract(input.address)
  const signal = await input.guard.signal(targetId)
  const lines = [
    `Sealflare check for ${input.address}`,
    field('Tier', verdict.tier),
    field('Safe', verdict.safe ? 'yes' : 'no'),
    field('Upgradeable proxy', verdict.isUpgradeableProxy ? 'yes' : 'no'),
    field('Flags', verdict.flags.length > 0 ? verdict.flags.join(', ') : 'none'),
    field('Warranty bond', `${verdict.warrantyBond} wei`),
    section('Community signal', [
      groupLine('New Agent IDs', signal.newIds),
      groupLine('Guardians', signal.guardians),
    ]),
    section('Reasons', verdict.reasons.map(bullet)),
    field('Target page', targetLink(targetId)),
    field('Scan in the app', scanLink(input.address)),
  ]
  return join(lines)
}
