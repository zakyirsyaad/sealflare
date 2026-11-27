import { getAddress, parseEther, type Address, type Hex } from 'viem'
import { CONSTANTS, targetIdOfContract } from '@sealflare/shared/rules'
import {
  ATTESTERS,
  CHALLENGER,
  JURORS,
  attestSafe,
  commitOnChain,
  createBountyOnChain,
  deployTarget,
  openChallengeOnChain,
  resolveOnChain,
  revealOnChain,
  sponsorOnChain,
  waitForIndexedChallenge,
  waitForIndexedTarget,
  warp,
} from './chainTools'
import { anvilAccount, giveAgentId, waitForIndexedAttestation, type LocalAddresses } from './fixtures'

/** The bounty of the seed: a tenth of a BNB, which is inside the cap of the Vault. */
const BOUNTY = parseEther('0.1')

/** The accounts that fund and sponsor in the seed. */
const FUNDER = 8
const SPONSOR = 8

/** A contract nobody rated, and the Guardians who voted safe on it. */
export async function ratedTarget(addresses: LocalAddresses, voters: readonly number[]) {
  const agentId = getAddress(addresses.agentId)
  for (const index of [...voters, CHALLENGER, FUNDER]) await giveAgentId(agentId, anvilAccount(index))
  const contract = await deployTarget(anvilAccount(0))
  for (const index of voters) await attestSafe(getAddress(addresses.core), index, contract)
  const targetId = targetIdOfContract(contract) as Hex
  const last = voters[voters.length - 1]
  if (last === undefined) throw new Error('A target needs a vote.')
  await waitForIndexedAttestation(targetId, anvilAccount(last))
  return { contract, targetId }
}

/** What the screens of the second milestone have to show, put on the chain once. */
export type Seed = {
  /** A target the jury confirmed as dangerous. The Guardian who voted safe on it has a penalty waiting. */
  dangerTargetId: Hex
  challengeId: bigint
  /** The account that voted safe on the dangerous target. */
  penalised: Address
  /** The account that was paid in the vault by that dispute. */
  creditedChallenger: Address
  /** A target with an open bounty. */
  bountyTargetId: Hex
  /** A target with a third-party sponsor. */
  sponsoredTargetId: Hex
  sponsor: Address
}

let cached: Promise<Seed> | null = null

/** Puts a closed dispute, a bounty and a sponsor on the chain, once for the whole run of a file. */
export function seedScreens(addresses: LocalAddresses): Promise<Seed> {
  cached ??= build(addresses)
  return cached
}

async function build(addresses: LocalAddresses): Promise<Seed> {
  const core = getAddress(addresses.core)
  const court = getAddress(addresses.court)
  const vault = getAddress(addresses.vault)
  const challenger = anvilAccount(CHALLENGER)

  const danger = await ratedTarget(addresses, [ATTESTERS[0]])
  await waitForIndexedTarget(danger.targetId)
  const id = await openChallengeOnChain(court, challenger, danger.targetId)
  await waitForIndexedChallenge(id)
  const salts = new Map<number, Hex>()
  for (const index of JURORS) salts.set(index, await commitOnChain(court, anvilAccount(index), id, true))
  await warp(CONSTANTS.COMMIT_WINDOW + 1)
  for (const index of JURORS) await revealOnChain(court, anvilAccount(index), id, true, salts.get(index) as Hex)
  await warp(CONSTANTS.REVEAL_WINDOW + 1)
  await resolveOnChain(court, anvilAccount(0), id)
  await waitForIndexedChallenge(id, true)

  const funded = await ratedTarget(addresses, [ATTESTERS[1]])
  await createBountyOnChain(vault, anvilAccount(FUNDER), funded.targetId, CONSTANTS.BOUNTY_MIN_SLOTS, BOUNTY)

  const sponsored = await ratedTarget(addresses, [ATTESTERS[2]])
  await sponsorOnChain(core, anvilAccount(SPONSOR), sponsored.targetId)
  await waitForIndexedTarget(sponsored.targetId, data => data.publisher != null)

  return {
    dangerTargetId: danger.targetId,
    challengeId: id,
    penalised: anvilAccount(ATTESTERS[0]),
    creditedChallenger: challenger,
    bountyTargetId: funded.targetId,
    sponsoredTargetId: sponsored.targetId,
    sponsor: anvilAccount(SPONSOR),
  }
}
