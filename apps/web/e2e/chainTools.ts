import { createPublicClient, encodeFunctionData, http, stringToHex, toHex, type Address, type Hex } from 'viem'
import { coreAbi, courtAbi, vaultAbi } from '@sealflare/shared/abi'
import { LOCAL_RPC, anvilAccount, internalKey, internalUrl, rpc } from './fixtures'

/**
 * The chain tools of the milestone two suite.
 *
 * Everything here talks to the local node, which signs for every account it holds, so no key of
 * the suite exists anywhere. The setup of a test goes through here; the action a test is about
 * goes through the app.
 */

const client = createPublicClient({ transport: http(LOCAL_RPC) })

/** Whether the main app of the run has the dispute, vault and bounty modules open. */
export function modulesAreLive(): boolean {
  return process.env.E2E_MODULES_LIVE === '1'
}

/** The address of the app as it is before the modules go live. The harness names it. */
export function offUrl(): string {
  const url = process.env.E2E_OFF_URL
  if (url === undefined || url === '') throw new Error('The harness did not name the app without the modules.')
  return url
}

/** The init code of a contract whose code is one STOP byte, so it has code and answers nothing. */
const EMPTY_CONTRACT: Hex = '0x6001600c60003960016000f300'

/** The accounts the dispute test uses. They stay clear of the accounts of the first milestone. */
export const ATTESTERS = [6, 7, 8] as const
export const CHALLENGER = 9
/** The seed script gave these accounts a profile before any challenge of the suite opens. */
export const JURORS = [1, 2, 3] as const

/** Sends a transaction from an account of the node and waits until it is mined. */
export async function sendFrom(from: Address, to: Address, data: Hex, value = 0n): Promise<Hex> {
  const hash = await rpc<Hex>('eth_sendTransaction', [{ from, to, data, value: toHex(value) }])
  const receipt = await client.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error(`The transaction ${hash} reverted.`)
  return hash
}

/** Deploys a contract nobody has rated and returns its address. */
export async function deployTarget(from: Address): Promise<Address> {
  const hash = await rpc<Hex>('eth_sendTransaction', [{ from, data: EMPTY_CONTRACT }])
  const receipt = await client.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success' || receipt.contractAddress == null) {
    throw new Error(`The contract of ${hash} was not deployed.`)
  }
  return receipt.contractAddress
}

/** The word of an address, the way the Core takes the target of a contract. */
export function wordOf(address: Address): Hex {
  return `0x${address.slice(2).toLowerCase().padStart(64, '0')}`
}

/** One Guardian attests a contract as safe, straight on the chain. The vote is setup, not the test. */
export async function attestSafe(core: Address, index: number, target: Address): Promise<void> {
  const data = encodeFunctionData({
    abi: coreAbi,
    functionName: 'attest',
    args: [0, wordOf(target), 0, 0, `0x${'0'.repeat(64)}`, '0x', ''],
  })
  await sendFrom(anvilAccount(index), core, data)
}

/** The time of the latest block, in seconds. */
export async function chainNow(): Promise<number> {
  const block = await client.getBlock()
  return Number(block.timestamp)
}

/** Moves the clock of the local node forward and mines the block that carries the new time. */
export async function warp(seconds: number): Promise<void> {
  await rpc('evm_increaseTime', [seconds])
  await rpc('evm_mine')
}

/** The balance of an account of the node, in wei. */
export async function balanceOf(address: Address): Promise<bigint> {
  return client.getBalance({ address })
}

/** What the vault holds for an account, in wei. It is what a withdrawal sends. */
export async function vaultBalanceOf(vault: Address, account: Address): Promise<bigint> {
  return client.readContract({ abi: vaultAbi, address: vault, functionName: 'balanceOf', args: [account] })
}

/** The bond of a depositor on a target, as the vault holds it. */
export async function bondOf(vault: Address, targetId: Hex, depositor: Address) {
  return client.readContract({ abi: vaultAbi, address: vault, functionName: 'bondOf', args: [targetId, depositor] })
}

/** The challenge the Court holds open on a target, or null. */
export async function openChallengeOf(court: Address, targetId: Hex): Promise<bigint | null> {
  const id = await client.readContract({ abi: courtAbi, address: court, functionName: 'activeChallengeOf', args: [targetId] })
  return id > 0n ? id : null
}

/** The stakes of the Court, as the contract fixes them. */
export const CHALLENGE_STAKE = 10_000_000_000_000_000n
export const JURY_STAKE = 5_000_000_000_000_000n

/** The flag a challenge of a contract names: the first of the flags a contract may carry. */
const CONTRACT_FLAG = 1

/** An account opens a challenge on a target, straight on the chain, and the id of the challenge is returned. */
export async function openChallengeOnChain(court: Address, from: Address, targetId: Hex): Promise<bigint> {
  const data = encodeFunctionData({
    abi: courtAbi,
    functionName: 'openChallenge',
    // The evidence is what the app writes. A challenge with an empty address of its evidence is
    // accepted by the Court and cannot be read back by the service, which the report of the suite names.
    args: [
      targetId,
      CONTRACT_FLAG,
      `0x${'11'.repeat(32)}`,
      stringToHex('UNVERIFIED_SOURCE @ user report: the source is not verified'),
      `ipfs://${'ab'.repeat(32)}`,
    ],
  })
  await sendFrom(from, court, data, CHALLENGE_STAKE)
  const id = await openChallengeOf(court, targetId)
  if (id === null) throw new Error('The Court holds no open challenge after the transaction.')
  return id
}

/** A juror commits a vote with a salt of their own, and the salt is returned so the vote can be revealed. */
export async function commitOnChain(court: Address, from: Address, id: bigint, uphold: boolean): Promise<Hex> {
  const salt = toHex(crypto.getRandomValues(new Uint8Array(32)))
  const hash = await client.readContract({
    abi: courtAbi,
    address: court,
    functionName: 'commitHashOf',
    args: [id, from, uphold, salt],
  })
  await sendFrom(from, court, encodeFunctionData({ abi: courtAbi, functionName: 'commitVote', args: [id, hash] }), JURY_STAKE)
  return salt
}

/** A juror opens the vote they committed. */
export async function revealOnChain(court: Address, from: Address, id: bigint, uphold: boolean, salt: Hex): Promise<void> {
  await sendFrom(from, court, encodeFunctionData({ abi: courtAbi, functionName: 'revealVote', args: [id, uphold, salt] }))
}

/**
 * Waits until the indexer has read a target, so its page has the rows of the registry. A test that
 * waits for a change of the target, such as a publisher, names it by `ready`.
 */
export async function waitForIndexedTarget(
  targetId: Hex,
  ready: (data: { publisher?: string | null }) => boolean = () => true,
): Promise<void> {
  const url = `${internalUrl()}/targets/${targetId}`
  const deadline = Date.now() + 60_000
  let last = 'the service did not answer'
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { headers: { authorization: `Bearer ${internalKey()}` } })
      if (response.ok) {
        const body = (await response.json()) as { data?: { publisher?: string | null } }
        if (ready(body.data ?? {})) return
        last = 'the target is read, but it has not changed yet'
      } else {
        last = `the service answered with ${response.status}`
      }
    } catch {
      last = 'the service is not up'
    }
    await sleep(200)
  }
  throw new Error(`The indexer did not read the target in time: ${last}.`)
}

/** Anyone closes a dispute that enough jurors revealed. */
export async function resolveOnChain(court: Address, from: Address, id: bigint): Promise<void> {
  await sendFrom(from, court, encodeFunctionData({ abi: courtAbi, functionName: 'resolve', args: [id] }))
}

/** An account funds a bounty on a target. */
export async function createBountyOnChain(vault: Address, from: Address, targetId: Hex, slots: number, value: bigint): Promise<void> {
  await sendFrom(from, vault, encodeFunctionData({ abi: vaultAbi, functionName: 'createBounty', args: [targetId, slots] }), value)
}

/** An Agent ID holder records themselves as the third-party sponsor of a target. */
export async function sponsorOnChain(core: Address, from: Address, targetId: Hex): Promise<void> {
  await sendFrom(from, core, encodeFunctionData({ abi: coreAbi, functionName: 'sponsor', args: [targetId] }))
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Waits until the indexer has read a challenge, so the page of the dispute exists.
 *
 * The page of a dispute is built from the rows of the indexer, so the suite asks the internal
 * service instead of sleeping for a fixed time.
 */
export async function waitForIndexedChallenge(id: bigint, closed = false): Promise<void> {
  const url = `${internalUrl()}/challenges/${id}`
  const deadline = Date.now() + 60_000
  let last = 'the service did not answer'
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { headers: { authorization: `Bearer ${internalKey()}` } })
      if (response.ok) {
        const body = (await response.json()) as { data?: { outcome?: string } }
        if (!closed || (body.data?.outcome !== undefined && body.data.outcome !== 'PENDING')) return
        last = `the challenge is still ${body.data?.outcome ?? 'unknown'}`
      } else {
        last = `the service answered with ${response.status}`
      }
    } catch {
      last = 'the service is not up'
    }
    await sleep(200)
  }
  throw new Error(`The indexer did not read challenge ${id} in time: ${last}.`)
}
