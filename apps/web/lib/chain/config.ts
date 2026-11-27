import { createConfig, http, type Transport } from 'wagmi'
import { injected, walletConnect } from 'wagmi/connectors'
import { publicEnv } from '../env.public'
import { chains } from './chains'

export const expectedChainId = publicEnv.NEXT_PUBLIC_CHAIN_ID
export const modulesLive = publicEnv.NEXT_PUBLIC_MODULES_LIVE
export const agentIdUrl = publicEnv.NEXT_PUBLIC_AGENT_ID_URL

/**
 * The wallet of the end-to-end suite, or nothing.
 *
 * The bundler only evaluates the literal `process.env.NEXT_PUBLIC_E2E === 'true'`, not a value
 * read from the parsed env, and it only skips a `require` that sits in the dead branch. A static
 * import would put the wallet in every bundle, so this one is the only way to keep it out of a
 * deployment.
 */
function e2eConnectors() {
  if (process.env.NEXT_PUBLIC_E2E !== 'true') return []
  const { e2eConnector } = require('./e2eConnector') as typeof import('./e2eConnector')
  return [e2eConnector()]
}

export function createWagmiConfig(projectId = publicEnv.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID) {
  const transports = Object.fromEntries(chains.map(chain => [chain.id, http()])) as Record<number, Transport>
  return createConfig({
    chains,
    ssr: true,
    connectors: [...e2eConnectors(), injected(), ...(projectId ? [walletConnect({ projectId })] : [])],
    transports,
  })
}
