import { createConnector } from 'wagmi'
import { getAddress, numberToHex, type Address } from 'viem'
import { rpc } from 'viem/utils'
import { publicEnv } from '../env.public'

/** The chain of the local node. The wallet of the suite talks to no other chain. */
const LOCAL_CHAIN_ID = 31337

/**
 * The wallet of the end-to-end suite.
 *
 * It stands in for a browser wallet without being one: it holds no key and signs nothing itself.
 * Every call that needs a signature goes to the local node, which signs with the account it has
 * unlocked. The test names the account by writing it into the page before the app loads, so no
 * key ever reaches the browser.
 *
 * The connector is only built for a build that says it is an end-to-end build, so a deployment
 * never offers it.
 */

/** The account the test chose. The test writes it into the page. */
function chosenAccount(): Address {
  const value = typeof window === 'undefined' ? undefined : window.__sealflareE2EAccount
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('The end-to-end wallet has no account. The test has to name one.')
  }
  return getAddress(value)
}

declare global {
  interface Window {
    /** The account the end-to-end wallet uses. The test writes it before the app loads. */
    __sealflareE2EAccount?: string
  }
}

/** The provider of the suite: it asks the local node, and the node signs. */
type Provider = {
  request: (args: { method: string; params?: unknown }) => Promise<unknown>
}

/** The connection of the suite. It names the accounts and the chain of the node. */
type Connection = {
  connect<withCapabilities extends boolean = false>(parameters?: {
    chainId?: number
    withCapabilities?: withCapabilities | boolean
  }): Promise<{
    accounts: withCapabilities extends true
      ? readonly { address: Address; capabilities: Record<string, unknown> }[]
      : readonly Address[]
    chainId: number
  }>
}

/** What a connection answers. */
type Connected<withCapabilities extends boolean> = {
  accounts: withCapabilities extends true
    ? readonly { address: Address; capabilities: Record<string, unknown> }[]
    : readonly Address[]
  chainId: number
}

/** The connector of the suite. It only works on the chain of the local node. */
export function e2eConnector() {
  return createConnector<Provider, Connection>(config => {
    const chain = config.chains.find(item => item.id === LOCAL_CHAIN_ID)
    // The wallet of the suite may only talk to the local node. Without this the connector would
    // fall back to the first chain of the app, which is BNB Smart Chain, and a run of the suite
    // would send its transaction to a public chain.
    if (chain === undefined) {
      throw new Error('The end-to-end wallet needs the local chain of Anvil.')
    }
    if (publicEnv.NEXT_PUBLIC_CHAIN_ID !== LOCAL_CHAIN_ID) {
      throw new Error('The end-to-end wallet needs a build for the local chain of Anvil.')
    }
    const url = chain.rpcUrls.default.http[0] ?? 'http://127.0.0.1:8545'
    let account: Address | null = null

    /** The calls of a wallet, and the calls of the node that has to be reached. */
    const request = async ({ method, params }: { method: string; params?: unknown }): Promise<unknown> => {
      if (method === 'eth_accounts' || method === 'eth_requestAccounts') {
        if (account === null) account = chosenAccount()
        return [account]
      }
      if (method === 'eth_chainId') return numberToHex(chain.id)
      // The node signs with the account it holds, so the wallet needs no key of its own.
      const { result, error } = await rpc.http(url, { body: { method, params } })
      if (error) throw new Error(`The node refused ${method}: ${error.message}`)
      return result
    }

    return {
      id: 'sealflare-e2e',
      name: 'End-to-end wallet',
      type: 'injected',
      async connect<withCapabilities extends boolean = false>(
        { chainId, withCapabilities: capabilities }: {
          chainId?: number
          withCapabilities?: withCapabilities | boolean
        } = {},
      ): Promise<Connected<withCapabilities>> {
        account = chosenAccount()
        const accounts = capabilities ? [{ address: account, capabilities: {} }] : [account]
        return { accounts, chainId: chainId ?? chain.id } as unknown as Connected<withCapabilities>
      },
      async disconnect() {
        account = null
      },
      async getAccounts() {
        if (account === null) throw new Error('The end-to-end wallet is not connected.')
        return [account]
      },
      async getChainId() {
        return chain.id
      },
      async getProvider() {
        return { request }
      },
      async isAuthorized() {
        // The user always chooses to connect, so the wallet never connects by itself.
        return false
      },
      onAccountsChanged(accounts: string[]) {
        if (accounts.length === 0) {
          this.onDisconnect()
          return
        }
        config.emitter.emit('change', { accounts: accounts.map(item => getAddress(item)) })
      },
      onChainChanged(chainId: string) {
        config.emitter.emit('change', { chainId: Number(chainId) })
      },
      onDisconnect() {
        account = null
        config.emitter.emit('disconnect')
      },
    }
  })
}
