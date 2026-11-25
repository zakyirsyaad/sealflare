import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  getContract,
  http,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { coreAbi, vaultAbi } from '@sealflare/shared/abi'
import { migrate, type Db } from '@sealflare/internal/db'

export const RPC_URL = 'http://127.0.0.1:8546'
export const CHAIN_ID = 31337

export const chain = defineChain({
  id: CHAIN_ID,
  name: 'anvil',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
})

/** Anvil's public development accounts. They hold no real funds and are not secrets. */
export const ACCOUNTS = [
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
] as const

export function account(index: number): { address: Address; key: Hex } {
  const key = ACCOUNTS[index] as Hex
  return { address: privateKeyToAccount(key).address, key }
}

export interface DeployedAddresses {
  agentId: Address
  chainId: number
  core: Address
  court: Address
  vault: Address
}

export function addresses(): DeployedAddresses {
  const path = fileURLToPath(new URL('../../../shared/abi/addresses.local.json', import.meta.url))
  return JSON.parse(readFileSync(path, 'utf8')) as DeployedAddresses
}

const transport = http(RPC_URL)
const rpc = transport({ chain })

export function publicClient(): PublicClient {
  return createPublicClient({ chain, transport })
}

export function wallet(index: number) {
  return createWalletClient({ account: privateKeyToAccount(ACCOUNTS[index] as Hex), chain, transport })
}

export function coreContract() {
  return getContract({ abi: coreAbi, address: addresses().core, client: publicClient() })
}

/**
 * A client that reports the last final block `depth` blocks behind the tip.
 *
 * Anvil does not move its final block on its own, so the tests say how far the final block is
 * behind. The indexer only ever asks for the `finalized` tag, and everything else goes straight
 * to the chain.
 */
export function chainClient(depth = 0): PublicClient {
  const customTransport = custom({
    request: async ({ method, params }: { method: string; params?: unknown[] }) => {
      if (method === 'eth_getBlockByNumber' && Array.isArray(params) && params[0] === 'finalized') {
        const latest = await rpc.request({ method: 'eth_blockNumber', params: [] })
        const number = BigInt(String(latest)) - BigInt(depth)
        params[0] = `0x${(number > 0n ? number : 0n).toString(16)}`
      }
      return rpc.request({ method, params })
    },
  })
  return createPublicClient({ chain, transport: customTransport })
}

/** A target address the tests attest. The stub does not need code at it. */
export const TARGET = '0x1111111111111111111111111111111111111111' as Address

/**
 * A target of its own for a test. The chain is shared by the whole run and a guardian may vote
 * on a target only once, so every test votes somewhere of its own.
 */
export function targetAddress(number: number): Address {
  return `0x${number.toString(16).padStart(2, '0').repeat(20)}` as Address
}

export interface AttestOptions {
  from?: number
  /** The contract to vote on. Its address is what the contract stores. */
  contract?: Address
  /** The canonical bundle hash to vote on, for a skill. */
  skill?: Hex
  verdict?: 0 | 1 | 2
  flags?: number
  shortProof?: Hex
  evidenceURI?: string
}

/** The contract stores an address as a bytes32 with the address in the low bytes. */
export function asBytes32(address: Address): Hex {
  return `0x${address.slice(2).padStart(64, '0')}` as Hex
}

/** Casts one vote on the stub Core and waits for the block that holds it. */
export async function attest(options: AttestOptions = {}) {
  const client = wallet(options.from ?? 0)
  const hash = await client.writeContract({
    address: addresses().core,
    abi: coreAbi,
    functionName: 'attest',
    args: [
      options.skill ? 1 : 0,
      options.skill ?? asBytes32(options.contract ?? TARGET),
      options.verdict ?? 0,
      options.flags ?? 0,
      `0x${'0'.repeat(64)}` as Hex,
      options.shortProof ?? '0x',
      options.evidenceURI ?? '',
    ],
  })
  return publicClient().waitForTransactionReceipt({ hash })
}

/** Changes a guardian's score on the stub Core, which emits the score change the indexer reads. */
export async function adjustScore(options: {
  from?: number
  guardian: Address
  targetId: Hex
  delta: number
  reason?: number
}) {
  const client = wallet(options.from ?? 0)
  const hash = await client.writeContract({
    address: addresses().core,
    abi: coreAbi,
    functionName: 'adjustScore',
    args: [options.guardian, options.targetId, options.delta, options.reason ?? 0],
  })
  return publicClient().waitForTransactionReceipt({ hash })
}

/** Deposits a bond on the stub Vault, which emits an event of its own on another address. */
export async function depositBond(options: { from?: number; targetId?: Hex }) {
  const client = wallet(options.from ?? 0)
  const hash = await client.writeContract({
    address: addresses().vault,
    abi: vaultAbi,
    functionName: 'depositBond',
    args: [options.targetId ?? (`0x${'11'.repeat(32)}` as Hex)],
    value: 0n,
  })
  return publicClient().waitForTransactionReceipt({ hash })
}

/** Mines empty blocks, so the chain grows without any event in it. */
export async function mine(count: number): Promise<void> {
  for (let index = 0; index < count; index++) {
    await rpc.request({ method: 'evm_mine', params: [] })
  }
}

/** The in-memory Postgres the tests read and write. */
type PgliteRunner = Pick<PGlite, 'query' | 'exec'>

function pgliteRunner(client: PgliteRunner): Pick<Db, 'query' | 'exec'> {
  return {
    async query<T>(text: string, params?: readonly unknown[]): Promise<T[]> {
      const result = await client.query<T>(text, params ? [...params] : undefined)
      return result.rows
    },
    async exec(text: string): Promise<void> {
      await client.exec(text)
    },
  }
}

export function pgliteDb(client: PGlite): Db {
  return {
    ...pgliteRunner(client),
    async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
      return client.transaction(async (tx) =>
        fn({
          ...pgliteRunner(tx),
          transaction: async () => {
            throw new Error('a transaction cannot start inside a transaction')
          },
        }),
      )
    },
  }
}

export async function createTestDb(): Promise<{ db: Db; close: () => Promise<void> }> {
  const client = new PGlite()
  await client.waitReady
  const db = pgliteDb(client)
  await migrate(db)
  return { db, close: () => client.close() }
}
