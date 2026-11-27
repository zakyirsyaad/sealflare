import { test as base, expect, type Locator, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { encodeFunctionData, type Address, type Hex } from 'viem'
import { mnemonicToAccount } from 'viem/accounts'

/**
 * The helpers of the end-to-end suite.
 *
 * The suite runs against the stack the harness starts, so everything here talks to the local
 * node, the local service and the local app. No key of a real account is used anywhere, and no
 * request leaves the machine.
 */

/** Anvil's public development mnemonic. It holds no funds and is not a secret. */
export const ANVIL_MNEMONIC = 'test test test test test test test test test test test junk'

/** The address of the local node. */
export const LOCAL_RPC = 'http://127.0.0.1:8545'

/** The account of the local node with the given index. */
export function anvilAccount(index: number): Address {
  return mnemonicToAccount(ANVIL_MNEMONIC, { addressIndex: index }).address
}

/**
 * The accounts the suite uses.
 *
 * The seed script gives an Agent ID to the first five accounts and votes with the second and the
 * third. The fourth and the fifth hold an Agent ID and have not voted, so a vote of the suite
 * cannot meet one of the seed script.
 */
export const HOLDER = 3
export const SECOND_HOLDER = 4
/** The sixth account has no Agent ID, because the seed script stops after the fifth. */
export const WITHOUT_AGENT_ID = 5

/** The addresses of the stub contracts on the local chain. The harness writes them before the run. */
export type LocalAddresses = {
  agentId: string
  chainId: number
  core: string
  court: string
  vault: string
}

function readAddresses(): LocalAddresses {
  const path = fileURLToPath(new URL('../../../shared/abi/addresses.local.json', import.meta.url))
  return JSON.parse(readFileSync(path, 'utf8')) as LocalAddresses
}

/** The label of the scan field on the Scan screen. */
export const SCAN_FIELD = 'Contract address or repository link'

/** The name of the wallet of the suite, as the button of the wallet lists it. */
export const WALLET_NAME = 'End-to-end wallet'

export type Stack = {
  addresses: LocalAddresses
  /** A contract that has code on the local chain and that the registry has never rated. */
  contract: string
}

export type Wallet = {
  /** The account the wallet of the suite uses. */
  account: Address
}

/** The page errors of a run. A test fails when the app throws in the browser. */
export function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  return errors
}

/** Pastes an address into the scan field and waits for the target page. */
export async function scanContract(page: Page, address: string): Promise<void> {
  await page.getByLabel(SCAN_FIELD).fill(address)
  await page.getByLabel(SCAN_FIELD).press('Enter')
}

/**
 * Names the account the wallet of the suite uses.
 *
 * The name is written into the page before the app loads, so the wallet holds no key and the
 * browser never sees one. The local node signs everything with the account it has unlocked.
 */
export async function nameAccount(page: Page, account: Address): Promise<void> {
  await page.addInitScript((value: string) => {
    const target = window as Window & { __sealflareE2EAccount?: string }
    target.__sealflareE2EAccount = value
  }, account)
}

/** Connects the wallet of the suite, wherever the list of wallets is shown. */
export async function connectWallet(scope: Page | Locator): Promise<void> {
  await scope.getByRole('button', { name: WALLET_NAME }).click()
}

/** Calls the local node and returns what it answered. */
export async function rpc<T = unknown>(method: string, params: unknown[] = []): Promise<T> {
  const response = await fetch(LOCAL_RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  const body = (await response.json()) as { result?: T; error?: { message: string } }
  if (body.error !== undefined) throw new Error(`The node refused ${method}: ${body.error.message}`)
  return body.result as T
}

/**
 * Sends a transaction to the local node.
 *
 * The node signs it with the account it holds, so no key of the suite is ever needed.
 */
export async function sendToChain(to: Address, data: Hex): Promise<Hex> {
  return rpc<Hex>('eth_sendTransaction', [{ from: anvilAccount(0), to, data }])
}

/**
 * Mines blocks on the local node, so the block of a vote becomes a final one.
 *
 * The node takes one block per call: a call with a number in it reads that number as a timestamp,
 * not as a count of blocks.
 */
export async function mineBlocks(count: number): Promise<void> {
  for (let block = 0; block < count; block += 1) {
    await rpc('evm_mine')
  }
}

const AGENT_ID_ABI = [
  {
    type: 'function',
    name: 'setBalance',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'account', type: 'address' },
      { name: 'balance', type: 'uint256' },
    ],
    outputs: [],
  },
] as const

/** Gives an Agent ID to an account, the way the seed script does. */
export async function giveAgentId(agentId: Address, account: Address): Promise<void> {
  const data = encodeFunctionData({ abi: AGENT_ID_ABI, functionName: 'setBalance', args: [account, 1n] })
  await sendToChain(agentId, data)
}

const CORE_STUB_ABI = [
  {
    type: 'function',
    name: 'stubSetAttestationsLeft',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'guardian', type: 'address' },
      { name: 'left', type: 'uint8' },
    ],
    outputs: [],
  },
] as const

/**
 * Uses up the daily quota of an account.
 *
 * The stub keeps no quota of its own, so the suite sets the number the contract answers with.
 * The state is the one the account is in after five attestations, so the sixth is refused.
 */
export async function useAllAttestations(core: Address, guardian: Address): Promise<void> {
  const data = encodeFunctionData({ abi: CORE_STUB_ABI, functionName: 'stubSetAttestationsLeft', args: [guardian, 0] })
  await sendToChain(core, data)
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Waits until the indexer has read a vote of the account.
 *
 * The indexer reads the final blocks only, so the vote appears a moment after the block of the
 * transaction is final. The suite waits for that moment, because the row of the attestations
 * tab is only complete when the indexer has the evidence of the vote.
 */
export async function waitForIndexedAttestation(targetId: string, guardian: Address): Promise<void> {
  const url = `${internalUrl()}/targets/${targetId}/attestations`
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { headers: { authorization: `Bearer ${internalKey()}` } })
      if (response.ok) {
        const body = (await response.json()) as { data?: { items?: { guardian: string }[] } }
        const items = body.data?.items ?? []
        if (items.some(item => item.guardian.toLowerCase() === guardian.toLowerCase())) return
      }
    } catch {
      // The service is not up yet.
    }
    await sleep(200)
  }
  throw new Error('The indexer did not read the vote in time.')
}

/** The address of the internal service. The harness names it. */
export function internalUrl(): string {
  return process.env.E2E_INTERNAL_URL ?? 'http://127.0.0.1:9999'
}

/** The key between the app and the internal service. It never leaves this machine. */
export function internalKey(): string {
  return process.env.E2E_INTERNAL_KEY ?? ''
}

export const test = base.extend<{ stack: Stack; wallet: Wallet }>({
  stack: async ({}, use) => {
    const addresses = readAddresses()
    await use({ addresses, contract: addresses.agentId })
  },
  wallet: async ({ page }, use) => {
    const account = anvilAccount(HOLDER)
    await nameAccount(page, account)
    await use({ account })
  },
})

export { expect }
